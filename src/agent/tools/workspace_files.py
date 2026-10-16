"""用户文件夹 ↔ 沙箱 的文件搬运工具（不依赖挂载）。

沙箱是独立容器，看不到宿主机文件。挂载方案依赖服务端 host-mount 能力、
白名单、路径翻译，边界复杂且受部署形态制约；这里改为「AI 按需搬运」：

- upload_to_sandbox       把需要的文件读成 bytes 传进沙箱（之后才可处理）
- download_from_sandbox   沙箱产物写回 <用户文件夹>/ai_output/（不覆盖原件）

（查看用户文件夹不在这里：内置 ls 走 /user/ 路由直连同一目录，能力重复的
list_user_folder 已于 09-19 删除，路径口径统一为 /user/ 前缀。）

会话上下文（用户文件夹、会话 id）由 create_conversation 注入
config.configurable，工具执行时用 get_config() 读取。
"""
import asyncio
import logging
import shlex
from pathlib import Path, PurePosixPath

from langchain_core.tools import tool
from langgraph.config import get_config

from src.agent.sandbox.open_sandbox import get_backend
from src.repositories.workspace_browse_repo import resolve_in_root

logger = logging.getLogger(__name__)

SANDBOX_UPLOAD_DIR = "/workspace"   # 沙箱内固定落点（AI 在沙箱里直接访问这里）
AI_OUTPUT_SUBDIR = "ai_output"      # 本机产物目录：不覆盖用户原文件
MAX_FILE_BYTES = 20 * 1024 * 1024   # 单文件上限
MAX_TOTAL_BYTES = 50 * 1024 * 1024  # 单次上传总大小上限
MAX_FILES_PER_CALL = 50             # 单次上传文件数上限
MAX_LIST_ENTRIES = 200              # 列目录最多返回条目


def _session_folder() -> tuple[str, Path]:
    """取当前会话的（会话 id, 用户文件夹根）。

    ⚠️ 必须在事件循环线程里调用：get_config() 依赖 contextvar，
    asyncio.to_thread 的子线程里读不到。
    """
    conf = (get_config() or {}).get("configurable") or {}
    thread_id, folder = conf.get("thread_id"), conf.get("user_folder")
    if not thread_id or not folder:
        raise RuntimeError(
            "当前会话没有关联工作文件夹。请先让用户在界面上选择要处理的文件夹"
            "，再重新发起请求"
        )
    return thread_id, Path(folder)


def _resolve_local(root: Path, rel: str) -> Path:
    """相对路径 → 根内绝对路径。空串返回根目录本身。

    两道校验：
    1. path_jail（Rust）：拦绝对路径与 `..` 逃逸，比手写字符串检查可靠
       ——Windows 的盘符、混合斜杠等形式它都覆盖到了；
    2. realpath 兜底：Jail 只做字符串层面判断、**不解析 symlink**，
       根目录里若有指向外部的链接，join 会照常放行。由 resolve_in_root 解析真实路径后
       再卡一次边界（超长路径的 `\\\\?\\` 前缀不影响 realpath）。
    """
    return resolve_in_root(root, rel)


def _human(num: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if num < 1024 or unit == "GB":
            return f"{int(num)} B" if unit == "B" else f"{num:.1f} {unit}"
        num /= 1024
    return f"{num:.1f} GB"


def _plan_uploads(
    root: Path, paths: list[str]
) -> list[tuple[str, Path]] | str:
    """展开待上传文件，返回 [(沙箱目标路径, 本机文件)]；出错返回说明文字。"""
    root_r = root.resolve()
    picked: list[Path] = []
    for raw in paths:
        try:
            local = _resolve_local(root_r, raw)
        except ValueError as exc:
            return f"上传失败：{exc}"
        if local.is_dir():
            picked.extend(p for p in sorted(local.rglob("*")) if p.is_file())
        elif local.is_file():
            picked.append(local)
        else:
            return f"上传失败：找不到 {raw}"

    if not picked:
        return "上传失败：没有选中任何文件"
    if len(picked) > MAX_FILES_PER_CALL:
        return f"上传失败：一次最多 {MAX_FILES_PER_CALL} 个文件（本次选中 {len(picked)} 个）"

    items: list[tuple[str, Path]] = []
    total = 0
    for local in picked:
        try:
            size = local.stat().st_size
        except OSError as exc:
            return f"上传失败：读取 {local.name} 失败（{exc}）"
        if size > MAX_FILE_BYTES:
            return (f"上传失败：{local.name} 有 {_human(size)}，"
                    f"超过单文件上限 {_human(MAX_FILE_BYTES)}")
        total += size
        items.append((f"{SANDBOX_UPLOAD_DIR}/{local.relative_to(root_r).as_posix()}", local))
    if total > MAX_TOTAL_BYTES:
        return f"上传失败：合计 {_human(total)}，超过单次上限 {_human(MAX_TOTAL_BYTES)}"
    return items


def _do_upload(backend, items: list[tuple[str, Path]]) -> str:
    """同步执行：清理旧文件 → 上传（阻塞 HTTP，调用方需 to_thread）。"""
    dirs = sorted({str(PurePosixPath(dest).parent) for dest, _ in items})
    backend.execute("mkdir -p " + " ".join(shlex.quote(d) for d in dirs))
    # ⚠️ 适配器的 upload_files 遇到已存在文件会直接返回 already exists 并且不写入，
    # 所以同一文件第二次上传必须先清掉沙箱里的旧副本。
    backend.execute("rm -f " + " ".join(shlex.quote(dest) for dest, _ in items))

    try:
        payload = [(dest, local.read_bytes()) for dest, local in items]
    except OSError as exc:
        return f"上传失败：读取本地文件出错（{exc}）"

    responses = backend.upload_files(payload)
    ok: list[str] = []
    failed: list[str] = []
    for resp, (dest, local) in zip(responses, items):
        if resp.error:
            failed.append(f"  {local.name} → {dest}（{resp.error}）")
        else:
            ok.append(f"  {dest}（{_human(local.stat().st_size)}）")
    lines = []
    if ok:
        lines.append(f"已上传 {len(ok)} 个文件到沙箱：")
        lines.extend(ok)
    if failed:
        lines.append(f"失败 {len(failed)} 个：")
        lines.extend(failed)
    return "\n".join(lines) or "上传失败：未知错误"


def _do_download(backend, paths: list[str], out_dir: Path) -> str:
    """同步执行：从沙箱取文件写到 ai_output（阻塞 HTTP，调用方需 to_thread）。"""
    responses = backend.download_files(list(paths))
    out_dir.mkdir(parents=True, exist_ok=True)
    ok: list[str] = []
    failed: list[str] = []
    for resp in responses:
        name = PurePosixPath(resp.path).name or "unnamed"
        if resp.error or resp.content is None:
            failed.append(f"  {resp.path}（{resp.error or '读取失败'}）")
            continue
        target = out_dir / name
        try:
            target.write_bytes(resp.content)
        except OSError as exc:
            failed.append(f"  {resp.path}（写入失败：{exc}）")
            continue
        ok.append(f"  {target}（{_human(len(resp.content))}）")
    lines = []
    if ok:
        # 机器格式 + 原始数据标注，避免被整段贴进回答
        lines.append(f"[原始数据] saved={len(ok)} dir={out_dir}")
        lines.extend(ok)
    if failed:
        lines.append(f"[原始数据] failed={len(failed)}:")
        lines.extend(failed)
    return "\n".join(lines) or "下载失败：没有取到任何文件"


@tool
async def upload_to_sandbox(paths: list[str]) -> str:
    """把用户工作文件夹里的文件送进沙箱，之后才能在沙箱中读取和处理它们。

    沙箱看不到用户电脑上的文件，处理前必须先上传。路径用相对工作文件夹的
    相对路径（如 "123.txt"、"材料/成绩.xlsx"）；传目录会递归上传其中所有文件。
    沙箱内的落点固定为 /workspace/<同样的相对路径>。

    Args:
        paths: 要上传的文件（或目录）相对路径列表。

    Returns:
        每个文件的上传结果，失败项会说明原因。
    """
    try:
        thread_id, root = _session_folder()
    except RuntimeError as exc:
        return str(exc)
    planned = _plan_uploads(root, paths)
    if isinstance(planned, str):
        return planned
    # 异常细节只写日志：工具返回值会被模型原样复述进回答，不能带内部堆栈
    try:
        backend = get_backend(thread_id)
        return await asyncio.to_thread(_do_upload, backend, planned)
    except Exception:  # noqa: BLE001 - 沙箱服务不可用等情况
        logger.exception("上传到沙箱失败 thread_id=%s", thread_id)
        return "上传失败：沙箱服务暂时不可用，请稍后重试；如果持续失败请联系管理员"


@tool
async def download_from_sandbox(paths: list[str]) -> str:
    """把沙箱里生成的文件保存到用户电脑上（统一放在 ai_output 子目录，不覆盖原件）。

    在沙箱里处理完成、生成结果文件后调用本工具交付给用户。只传需要交付的
    产物，不要把中间临时文件一并下载。

    Args:
        paths: 沙箱内文件的绝对路径列表（如 "/workspace/report.md"）。

    Returns:
        实际保存位置与文件名，失败项会说明原因。
    """
    try:
        thread_id, root = _session_folder()
    except RuntimeError as exc:
        return str(exc)
    if not paths:
        return "下载失败：没有指定要保存的文件"
    out_dir = root.resolve() / AI_OUTPUT_SUBDIR
    try:
        backend = get_backend(thread_id)
        return await asyncio.to_thread(_do_download, backend, paths, out_dir)
    except Exception:  # noqa: BLE001 - 沙箱服务不可用等情况
        logger.exception("从沙箱下载失败 thread_id=%s", thread_id)
        return "保存失败：沙箱服务暂时不可用，请稍后重试；如果持续失败请联系管理员"
