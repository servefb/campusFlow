"""经验知识库三件套（wiki_search / wiki_save / wiki_sync）接线自测。

守四件事（结构断言走 AST，不 grep 文本 —— 同 `_laya_*_selftest` 的纪律）：
  1. campusflow_agent_node.py 里主智能体 tools 列表确实挂了三件套；
  2. policy / academic / workflow / general-purpose 四个子智能体 spec 都显式声明
     了 wiki_search + wiki_save（不写会继承主智能体全量，那条守卫只查键存在，
     这里查的是"该给的给了"）；
  3. 两份提示词真的写了经验知识库的纪律（AST 常量里找节点，防有人改提示词时顺手删掉）；
  4. 功能冒烟：在临时目录（OPENWIKI_WIKI_DIR 覆盖）里真跑 save → search →
     防重入锁判断，**不起真蒸馏进程**（wiki_sync 只验证"无笔记时直接返回"分支）；
  5. 按用户隔离：OPENWIKI_USERS_BASE 覆盖下，两个 configurable user_id 的
     save/search 互不可见，路径卫生（非法 uid 哈希化）。

头部环境补丁同 `_subagent_perms_selftest.py`：沙箱注入的 no_proxy 带 [::1]，
httpx 一构造就崩，不补丁连 import 都进不去。
"""
import os

os.environ["no_proxy"] = "localhost,127.0.0.1,::1"
os.environ["NO_PROXY"] = "localhost,127.0.0.1,::1"
for _k in ("http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY"):
    os.environ.pop(_k, None)
os.environ.setdefault("DEEPSEEK_API_KEY", "sk-dummy")

import ast  # noqa: E402
import tempfile  # noqa: E402
from pathlib import Path  # noqa: E402

PASS = FAIL = 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  OK   %s" % label)
    else:
        FAIL += 1
        print("  FAIL %s" % label)


ROOT = Path(__file__).resolve().parent
NODE_FILE = ROOT / "src" / "agent" / "nodes" / "campusflow_agent_node.py"
MAIN_PROMPT = ROOT / "src" / "agent" / "prompt" / "common_agent_prompt.py"
SUB_PROMPTS = ROOT / "src" / "agent" / "prompt" / "subagent_prompts.py"

TRIO = {"wiki_search", "wiki_save", "wiki_sync"}
KB_SUBAGENTS = {"policy", "academic", "workflow", "general-purpose"}


def main():
    print("[1] 主智能体 tools 列表挂了三件套（AST）")
    tree = ast.parse(NODE_FILE.read_text(encoding="utf-8"))
    trio_in_main = set()
    create_call = None
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id == "create_deep_agent"):
            create_call = node
    check(create_call is not None, "找到 create_deep_agent(...) 调用")
    if create_call:
        for kw in create_call.keywords:
            if kw.arg == "tools":
                for el in ast.walk(kw.value):
                    if isinstance(el, ast.Name) and el.id in TRIO:
                        trio_in_main.add(el.id)
    check(trio_in_main == TRIO, "主 tools 含 %s（实得 %s）" % (sorted(TRIO), sorted(trio_in_main)))

    print("\n[2] 四个子智能体 spec 显式声明了 wiki_search + wiki_save（AST）")
    specs: dict[str, set] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "") == "SUBAGENTS":
            for el in ast.walk(node.value):
                if (isinstance(el, ast.Dict)
                        and any(isinstance(k, ast.Constant) and k.value == "name" for k in el.keys)):
                    name = tools = None
                    for k, v in zip(el.keys, el.values):
                        if isinstance(k, ast.Constant) and k.value == "name":
                            name = v.value
                        if isinstance(k, ast.Constant) and k.value == "tools":
                            tools = {n.id for n in ast.walk(v)
                                     if isinstance(n, ast.Name) and n.id in TRIO}
                    if name:
                        specs[name] = tools or set()
    check(KB_SUBAGENTS <= set(specs), "4 个目标 spec 都解析到（其余 spec 不要求）")
    for name in sorted(KB_SUBAGENTS):
        got = specs.get(name, set())
        check({"wiki_search", "wiki_save"} <= got,
              "%s 的 tools 含 wiki_search+wiki_save（实得 %s）" % (name, sorted(got)))
    check("wiki_sync" not in specs.get("policy", set()),
          "子智能体不持有 wiki_sync（蒸馏由主智能体统一触发）")

    print("\n[3] 提示词写了经验知识库纪律（AST 常量扫描）")
    for path, marker, label in [
        (MAIN_PROMPT, "wiki_search", "主提示词提到 wiki_search"),
        (MAIN_PROMPT, "wiki_save", "主提示词提到 wiki_save"),
        (MAIN_PROMPT, "wiki_sync", "主提示词提到 wiki_sync"),
        (SUB_PROMPTS, "wiki_search", "子代理公共规则提到 wiki_search"),
        (SUB_PROMPTS, "wiki_save", "子代理公共规则提到 wiki_save"),
    ]:
        found = any(isinstance(n, ast.Constant) and isinstance(n.value, str)
                    and marker in n.value
                    for n in ast.walk(ast.parse(path.read_text(encoding="utf-8"))))
        check(found, label)

    print("\n[4] 功能冒烟（扁平临时 wiki 目录，零网络）")

    def _rt(uid=None, ctx=None):
        """手工构造 ToolRuntime（langchain 只在图内注入，裸 invoke 不注入）。
        ctx 模拟 astream(context=...)，uid 模拟 configurable 兜底通道。"""
        from langchain.tools import ToolRuntime
        return ToolRuntime(state={}, context=ctx,
                           config={"configurable": {"user_id": uid}} if uid else {},
                           stream_writer=None, tool_call_id=None, store=None)

    with tempfile.TemporaryDirectory() as td:
        os.environ["OPENWIKI_WIKI_DIR"] = td
        os.environ.pop("OPENWIKI_USERS_BASE", None)
        import importlib
        kw = importlib.import_module("src.agent.tools.knowledge_wiki_tool")
        importlib.reload(kw)  # 让模块级读到的 override 生效

        empty = kw.wiki_sync.func(runtime=_rt())
        check("没有笔记" in empty, "空 inbox 时 wiki_sync 直接返回不启动进程：%s" % empty)

        r1 = kw.wiki_save.func(title="测试沉淀", content="奖学金评定每年九月开放，出自学生手册 2026 版。", runtime=_rt())
        check("已存入" in r1, "wiki_save 写入成功：%s" % r1)
        kw.wiki_save.func(title="第二条", content="普通占位内容，为了凑蒸馏阈值提示。", runtime=_rt())
        r3 = kw.wiki_save.func(title="第三条", content="另一条占位。", runtime=_rt())
        check("建议调用 wiki_sync" not in r3, "未达阈值(3<5)不催蒸馏：%s" % r3)

        hit = kw.wiki_search.func(query="奖学金评定 时间", runtime=_rt())
        check("奖学金" in hit and "test" not in hit.lower().split("\n")[0],
              "wiki_search 命中刚存的笔记")
        miss = kw.wiki_search.func(query="完全不相关的量子术语", runtime=_rt())
        check("无匹配" in miss, "不相关查询返回「无匹配」：%s" % miss[:40])

        check(kw._sync_running("default") is None, "无残留 pid 锁（_sync_running=None）")
        (Path(td) / "inbox" / ".sync.pid").write_text("999999", encoding="utf-8")
        check(kw._sync_running("default") is None, "死 pid 不算在跑（防锁死）")

    print("\n[5] 按用户隔离（per-user 根目录，configurable 兜底通道）")
    with tempfile.TemporaryDirectory() as td2:
        os.environ.pop("OPENWIKI_WIKI_DIR", None)
        os.environ["OPENWIKI_USERS_BASE"] = td2
        import importlib
        kw = importlib.import_module("src.agent.tools.knowledge_wiki_tool")
        importlib.reload(kw)

        # 路径卫生：非法 uid 不得形成路径穿越
        safe = kw._sanitize_uid("../evil uid")
        check("/" not in safe and "\\" not in safe and ".." not in safe,
              "非法 uid 被哈希化（%r）" % safe)
        check(kw._sanitize_uid("42") == "42", "合法 uid 原样保留")

        r = kw.wiki_save.func(
            title="用户42的沉淀", content="校车时刻表每天七点首班，出处是后勤处 2026-10 通知。",
            runtime=_rt(uid="42"))
        check("已存入" in r, "user42 wiki_save 成功：%s" % r)
        landed = (Path(td2) / "42" / "wiki" / "inbox").is_dir() and \
                 any((Path(td2) / "42" / "wiki" / "inbox").glob("*.md"))
        check(landed, "笔记落在 <base>/42/wiki/inbox（不是共享目录）")

        own = kw.wiki_search.func(query="校车时刻表", runtime=_rt(uid="42"))
        check("校车" in own, "user42 能查到自己的笔记")
        other = kw.wiki_search.func(query="校车时刻表", runtime=_rt(uid="43"))
        check("无匹配" in other or "尚未初始化" in other, "user43 查不到 user42 的笔记（隔离生效）：%s" % other[:40])

        # fallback 顺序：context 优先于 configurable（模拟主智能体双通道）
        check(kw._current_user_id(_rt(uid="43", ctx={"user_id": "42"})) == "42",
              "context 里的 user_id 优先于 configurable")

    print("\n==== %d passed, %d failed ====" % (PASS, FAIL))
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
