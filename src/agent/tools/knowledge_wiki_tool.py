"""经验知识库三件套（OpenWiki personal 模式），**按用户隔离**。

目录布局：`~/.openwiki/users/<user_id>/wiki/`（每人一份，互不可见）；
蒸馏子进程用 `OPENWIKI_CONFIG_DIR` 把 OpenWiki CLI 的 home 指到
`~/.openwiki/users/<user_id>/`（CLI 会把 wiki 放在 `<home>/wiki`，.env 凭据
也在 home 下——首次蒸馏前从共享 home `~/.openwiki/` 复制一份）。
旧的全系统共享目录 `~/.openwiki/wiki` 不再读写，留着不迁移（当时里面只有
inbox 草稿，没有蒸馏页）。

定位：与 `/memories/`（用户画像，按用户隔离）和 Mongo store（search_memories）
互补的知识区——沉淀"下次还用得上"的事实与经验：真实查询结果、办事流程的
实际经验、可靠出处、踩坑记录、被用户纠正过的错误认知。

user_id 从哪来（与 store_tool._current_user_id 同一套约定）：
  · 主智能体：conversations_repo._agent_stream 的 `astream(context={"user_id": ...})`
    → ToolRuntime.context；
  · 子智能体：deepagents 的 task 工具起子图时**不带 context**（subagents.py
    显式只造了 ls_agent_type 一项 configurable），context 传不下去 —— 所以
    _agent_stream 同时把 user_id 放进了 config.configurable 作为兜底通道，
    两处必须成对（改这里先看 conversations_repo.py:825 那段）。

闭环（"越用越好用"）：
  1. `wiki_search` —— 回答前先查，查到历史经验（含踩坑）就直接复用；
  2. `wiki_save`  —— 当轮顺手把有价值知识写进 `inbox/` 待整理区（廉价、即时）；
  3. `wiki_sync`  —— inbox 攒到一定量后，后台起 OpenWiki CLI 把笔记蒸馏进正式 wiki
     （`openwiki personal --update`，一次要跑几分钟，所以**必须**脱离等待、不阻塞对话）。

纪律（与项目硬约束对齐）：
  · 模块顶层只做纯路径常量，不构造任何会发请求的东西（外部依赖纪律）；
  · 三个工具都是辅助步骤：任何失败都返回错误字符串**降级**，绝不中断主流程；
  · 写入固定在当前用户的 wiki 目录内，不碰用户工作文件夹（不经过 /user/ 权限档位，
    路径是工具内部按 user_id 算死的，模型指定不了落点）；
  · wiki_sync 用 Popen 脱离 + pid 锁防重入；日志落在 `inbox/.sync.log`。
"""
import hashlib
import os
import re
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path

from src.agent.tools.laya_guard import guard_retrieved

from langchain.tools import tool, ToolRuntime

# 两个测试/部署覆盖口（模块级读一次，自测 reload 生效，同旧行为）：
#   OPENWIKI_WIKI_DIR  —— 直接钉死 wiki 目录（扁平，不分用户；旧自测兼容）
#   OPENWIKI_USERS_BASE —— 钉死 per-user 根目录（自测隔离用，正式部署不用）
_WIKI_DIR_OVERRIDE = os.environ.get("OPENWIKI_WIKI_DIR")
_USERS_BASE_OVERRIDE = os.environ.get("OPENWIKI_USERS_BASE")
_INBOX = "inbox"
_SYNC_PID = ".sync.pid"
_SYNC_LOG = ".sync.log"
# 蒸馏提示：攒到这个条数就该催一次 sync（由 wiki_save 的返回值带给模型）。
_SYNC_THRESHOLD = 5
# sync 子进程观察窗口：超时不杀（让它跑完），只是不再等它。
_SYNC_STALE_SECONDS = 30 * 60


def _current_user_id(runtime: ToolRuntime) -> str:
    """当前用户的 id（字符串），取不到用 "default"。

    user_id 有两条通道（见模块 docstring）：主智能体走 context，子智能体走
    config.configurable —— 子图拿不到 context，绝不能只查一边。
    """
    ctx = getattr(runtime, "context", None) or {}
    uid = ctx.get("user_id") if isinstance(ctx, dict) else None
    if not uid:
        uid = (runtime.config.get("configurable") or {}).get("user_id")
    return _sanitize_uid(str(uid or "default"))


def _sanitize_uid(uid: str) -> str:
    """user_id 只能落进路径的一个目录段：白名单字符直接用，其余做确定性
    哈希（同一个非法 id 永远落到同一个目录，不炸、不注入、不越界）。"""
    uid = (uid or "").strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{1,64}", uid):
        return uid
    return "u-" + hashlib.md5(uid.encode("utf-8")).hexdigest()[:16]


def _user_root(uid: str) -> Path:
    """该用户的 wiki 目录。override 存在时扁平共用一份（自测兼容）。"""
    if _WIKI_DIR_OVERRIDE:
        return Path(_WIKI_DIR_OVERRIDE)
    base = Path(_USERS_BASE_OVERRIDE) if _USERS_BASE_OVERRIDE else Path.home() / ".openwiki" / "users"
    return base / uid / "wiki"


def _shared_home() -> Path:
    """OpenWiki CLI 的默认 home（共享凭据所在地）：~/.openwiki。"""
    return Path.home() / ".openwiki"


def _inbox_dir(uid: str) -> Path:
    d = _user_root(uid) / _INBOX
    d.mkdir(parents=True, exist_ok=True)
    return d


def _pending_notes(uid: str) -> int:
    inbox = _user_root(uid) / _INBOX
    if not inbox.is_dir():
        return 0
    return sum(1 for p in inbox.glob("*.md"))


def _slug(text: str, limit: int = 32) -> str:
    """文件名安全化：中英文都保留主干，其余压成 -。"""
    s = re.sub(r"\s+", "-", text.strip())
    s = re.sub(r"[^\w\u4e00-\u9fff-]", "", s)
    return (s[:limit] or "note").strip("-")


@tool
def wiki_search(query: str, runtime: ToolRuntime) -> str:
    """回答前先查当前用户的个人经验库（历史经验、踩坑记录、已核实结论；按用户隔离）。
    返回内容与问题直接相关时可直接复用、不必再走正式知识库检索；返回「无匹配」或
    内容沾边、拿不准时，再照常调正式知识库检索（retriever_tool 等）。
    注意核对时效，与校内正式文件冲突时以正式文件为准。"""
    try:
        uid = _current_user_id(runtime)
        root = _user_root(uid)
        if not root.is_dir():
            return "知识库尚未初始化（目录不存在），本次无匹配。"
        # 分词：英文按词、中文按二元组（bigram 对中文检索够用且零依赖）
        raw_terms = [t for t in re.split(r"[\s,，。;；、?!？!]+", query) if t]
        terms: list[str] = []
        for t in raw_terms:
            if re.search(r"[\u4e00-\u9fff]", t):
                terms.extend(t[i:i + 2] for i in range(len(t) - 1))
                terms.append(t)
            else:
                terms.append(t.lower())
        terms = [t for t in dict.fromkeys(terms) if t]
        if not terms:
            return "查询词为空，无匹配。"

        scored: list[tuple[float, Path, list[str]]] = []
        for page in root.rglob("*.md"):
            try:
                text = page.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            low = text.lower()
            score = sum(low.count(t) for t in terms)
            if score <= 0:
                continue
            # 摘出命中行（每页最多 6 行，防撑爆上下文）
            hits: list[str] = []
            for line in text.splitlines():
                ll = line.lower()
                if any(t in ll for t in terms):
                    hits.append(line.strip()[:200])
                    if len(hits) >= 6:
                        break
            scored.append((float(score), page, hits))
        if not scored:
            return "无匹配。知识库里还没有与该问题相关的页面。"
        scored.sort(key=lambda x: x[0], reverse=True)
        out = [f"命中 {len(scored)} 页，取最相关的 {min(3, len(scored))} 页："]
        for score, page, hits in scored[:3]:
            rel = page.relative_to(root).as_posix()
            mtime = datetime.fromtimestamp(page.stat().st_mtime).strftime("%Y-%m-%d")
            out.append(f"\n## {rel}（相关度 {score:.0f}，更新于 {mtime}）")
            if hits:
                out.extend(f"- {h}" for h in hits)
            else:
                out.append("（无逐行命中，标题级相关）")
        return guard_retrieved("wiki", "\n".join(out)[:4000])
    except Exception as e:  # noqa: BLE001 —— 辅助步骤只降级
        return f"知识库查询失败（已降级，不影响主流程）：{e!r}"


@tool
def wiki_save(title: str, content: str, runtime: ToolRuntime) -> str:
    """把一条"下次还用得上"的知识沉淀进当前用户的个人经验库待整理区（inbox）。
    title 用类型前缀 + 一句话：[踩坑]（报错→根因→解法）、[纠错]（用户指出的错误认知，
    必须当场记）、[决策]（已核实口径/已否决方案及原因）、[经验]（走通的流程、真实出处）。
    content 写清事实本身 + 出处/依据 + 日期，并把关键词写全（同义词、正式名和俗称
    都写——检索按关键词匹配，没有语义召回，写不全就搜不到）。
    不存用户个人信息、密码验证码等敏感内容。写入即时生效，后续由 wiki_sync 蒸馏进正式 wiki。"""
    try:
        uid = _current_user_id(runtime)
        title = (title or "").strip() or "未命名笔记"
        now = datetime.now()
        fname = f"{now:%Y%m%d-%H%M%S}-{_slug(title)}.md"
        body = (
            "---\n"
            'type: agent-note\n'
            f"created: {now.isoformat(timespec='seconds')}\n"
            f"title: {title}\n"
            "---\n\n"
            f"# {title}\n\n"
            f"{(content or '').strip()}\n"
        )
        path = _inbox_dir(uid) / fname
        path.write_text(body, encoding="utf-8")
        pending = _pending_notes(uid)
        hint = ""
        if pending >= _SYNC_THRESHOLD:
            hint = f"待蒸馏笔记已达 {pending} 条（≥{_SYNC_THRESHOLD}），建议调用 wiki_sync 在后台蒸馏。"
        return f"已存入待整理区（{fname}）。当前待蒸馏 {pending} 条。{hint}"
    except Exception as e:  # noqa: BLE001
        return f"知识沉淀失败（已降级，不影响主流程）：{e!r}"


def _sync_running(uid: str) -> int | None:
    pid_file = _inbox_dir(uid) / _SYNC_PID
    try:
        pid = int(pid_file.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None
    # 探活不引第三方依赖：Windows 用 tasklist /FI，POSIX 用 kill(pid, 0)。
    if os.name == "nt":
        # tasklist 在中文 Windows 上输出 GBK，不能用默认 utf-8 text 模式解码（会炸）；
        # 只关心 ASCII 的 PID 数字，errors="replace" 丢弃其余
        probe = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=15)
        alive = str(pid) in (probe.stdout or "")
    else:
        try:
            os.kill(pid, 0)
            alive = True
        except OSError:
            alive = False
    return pid if alive else None


def _npx_candidates() -> list[str]:
    """npx 候选列表（去重、解析成可直接执行的 .CMD）：环境变量优先，再
    `where/which -a` 全量，再 PATH 首个。

    为什么不止取一个：openwiki 全局安装里的 better-sqlite3 是按某个 Node 大版本
    编译的原生模块，PATH 上排前面的 npx 若是另一个 Node 大版本（ABI 不同），
    `personal` 模式一开 sqlite 就崩（NODE_MODULE_VERSION 不匹配）；`--help` 不碰
    sqlite 看不出来。所以 sync 要能逐个候选探测、自动换用能跑的那个。
    Windows 上 `where` 会给出无扩展名的 shim 文件，CreateProcess 起不来，
    必须按 PATHEXT 补出 `.CMD` 才是可执行体。可用 OPENWIKI_NPX 直接钉死。
    """
    cands: list[str] = []
    env = os.environ.get("OPENWIKI_NPX")
    if env:
        cands.append(env)
    try:
        cmd = ["where", "npx"] if os.name == "nt" else ["which", "-a", "npx"]
        out = subprocess.run(cmd, capture_output=True, text=True,
                             encoding="utf-8", errors="replace", timeout=15).stdout or ""
        cands += [line.strip() for line in out.splitlines() if line.strip()]
    except Exception:  # noqa: BLE001
        pass
    w = shutil.which("npx")
    if w:
        cands.append(w)
    resolved: list[str] = []
    for c in cands:
        if os.name == "nt" and c and not Path(c).suffix and Path(c).is_file():
            # 无扩展名 shim → 按常见可执行后缀补全
            for ext in (".cmd", ".CMD", ".exe", ".bat"):
                if Path(c + ext).is_file():
                    c = c + ext
                    break
        resolved.append(c)
    return list(dict.fromkeys(resolved))


def _bootstrap_user_home(home: Path) -> None:
    """该用户第一次蒸馏前，把共享 home 的 .env（模型凭据）复制进他自己的 CLI home。
    只复制 .env；connectors/skills/sqlite 都让 CLI 在用户 home 里自行初始化，
    保证各用户的蒸馏语料互不串味。失败只降级（sync 可能因缺凭据失败，日志可查）。"""
    try:
        src = _shared_home() / ".env"
        dst = home / ".env"
        if src.is_file() and not dst.exists():
            home.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
    except Exception:  # noqa: BLE001
        pass


def _spawn_update(npx: str, uid: str, msg: str, log_path: Path) -> subprocess.Popen:
    kwargs: dict = {}
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    # 🔴 关键：把候选 npx 自己的目录前置到子进程 PATH。
    # nvm4w 风格的 npx.cmd shim 内部调的是 PATH 上裸的 `node`，不是它同目录的
    # node —— 子进程默认继承父 PATH（别的 Node 大版本排前面），ABI 对不上
    # better-sqlite3 就崩（NODE_MODULE_VERSION mismatch）。前置后 shim 用同版本
    # node，自洽。
    env = os.environ.copy()
    env["PATH"] = str(Path(npx).parent) + os.pathsep + env.get("PATH", "")
    # 按用户隔离蒸馏：OPENWIKI_CONFIG_DIR 指向该用户的 CLI home
    #（CLI 的 wiki 固定在 <home>/wiki，与 _user_root 的落点一致）。
    # WIKI_DIR_OVERRIDE 模式（自测）不设——测试目录布局不归 CLI 管。
    user_home = str(Path.home())
    if not _WIKI_DIR_OVERRIDE:
        user_home = str(_user_root(uid).parent)
        _bootstrap_user_home(Path(user_home))
        env["OPENWIKI_CONFIG_DIR"] = user_home
    log = open(log_path, "w", encoding="utf-8")  # 每次尝试覆盖写，log 就是最后一次尝试的现场
    try:
        return subprocess.Popen(
            [npx, "openwiki", "personal", "--update", msg],
            cwd=user_home,
            stdout=log, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL, env=env, **kwargs)
    finally:
        log.close()  # 子进程持有自己的句柄副本，父侧关掉不影响写入


@tool
def wiki_sync(runtime: ToolRuntime) -> str:
    """把当前用户待整理区（inbox）的知识笔记蒸馏进正式经验库（wiki 页面）：后台运行 OpenWiki CLI
    （openwiki personal --update，按用户隔离），需要几分钟，本工具**立即返回**、
    不阻塞当前回答。蒸馏在后台进行，期间可正常继续工作；重复调用有锁保护，不会叠加。"""
    try:
        uid = _current_user_id(runtime)
        pending = _pending_notes(uid)
        running = _sync_running(uid)
        if running:
            return f"蒸馏已在后台进行（pid {running}），无需重复启动。待蒸馏 {pending} 条。"
        if pending == 0:
            return "待整理区没有笔记，无需蒸馏。"
        inbox = _inbox_dir(uid)
        (inbox / _SYNC_PID).unlink(missing_ok=True)  # 清掉上次失败残留的死锁文件
        log_path = inbox / _SYNC_LOG
        msg = ("整合 inbox/ 目录下的 agent-note 笔记：把仍然成立的知识合并进对应 wiki 页面"
               "（保留出处与日期），已过时的内容修正或删除，然后把处理完的笔记从 inbox/ 清掉。")
        # 逐个候选 npx 探测：子进程秒退且日志里有 ABI 报错 → 换下一个（见 _npx_candidates 注释）
        last_tail = ""
        for npx in _npx_candidates():
            try:
                proc = _spawn_update(npx, uid, msg, log_path)
            except Exception:  # noqa: BLE001 —— 这个 npx 起不来，换下一个
                continue
            for _ in range(45):  # 最多等 45 s 判断起没起来（npx 冷启动 ~25 s）
                time.sleep(1)
                if proc.poll() is not None:
                    break
            if proc.poll() is None:
                # 45 s 还活着 = 通过了启动期（含 sqlite 加载），交给后台继续跑
                (inbox / _SYNC_PID).write_text(str(proc.pid), encoding="utf-8")
                return (f"蒸馏已在后台启动（pid {proc.pid}，处理 {pending} 条笔记，"
                        f"日志 {log_path}）。完成后 inbox 清空；可用 wiki_search 查蒸馏结果。")
            tail = _log_tail(log_path)
            last_tail = tail or last_tail
            if "NODE_MODULE_VERSION" not in tail:
                break  # 不是 ABI 问题，换 npx 也救不了，带着日志尾巴如实上报
        return (f"蒸馏启动失败（已降级，不影响主流程）。日志尾巴：{last_tail[:500] or '空'}")
    except Exception as e:  # noqa: BLE001
        return f"蒸馏启动失败（已降级，不影响主流程）：{e!r}"


def _log_tail(log_path: Path, limit: int = 2000) -> str:
    try:
        return log_path.read_text(encoding="utf-8", errors="replace")[-limit:]
    except OSError:
        return ""
