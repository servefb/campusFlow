"""工作空间目录浏览：可浏览的根、目录列举、路径解析。

背景：浏览器拿不到本机绝对路径——`<input type="file">` 只给 File 对象
（文件名 / 大小 / 内容），File System Access API 给的是 handle 而非路径。
所以「用户选文件夹」必须由后端来导航：前端从固定根开始逐层点选，
提交 `<root_key>:<相对路径>`，绝对路径始终留在后端侧。

安全：一切路径经 path_jail 校验（canonicalize 后必须仍在根内），
系统目录不出现在列表里。
"""
import os
from datetime import datetime
from pathlib import Path, PurePosixPath

from path_jail import Jail

MAX_ENTRIES = 500  # 单次列目录返回上限

#: 文件预览上限（「已修改的文件」抽屉）：超过字节上限不做全量读取；
#: 解出文本后再卡一道字符上限（宽字符场景 256KB 可能解出几万字符）。
MAX_PREVIEW_BYTES = 256 * 1024
MAX_PREVIEW_CHARS = 20000

# 不出现在列表里的系统目录（按小写名比较）
_SYSTEM_DIRS = {
    "$recycle.bin", "system volume information", "found.000", "found.001",
    "recovery", "config.msi", "perflogs", "msocache", "$windows.~ws",
    "$windows.~bt", "documents and settings",
}


def desktop_dir() -> Path | None:
    """桌面目录；OneDrive 接管桌面时优先用它的那份。"""
    candidates: list[Path] = []
    onedrive = os.getenv("OneDrive")
    if onedrive:
        candidates.append(Path(onedrive) / "Desktop")
    candidates.append(Path.home() / "Desktop")
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    return None


def _root_path(key: str) -> Path:
    """根标识 → 本机绝对路径。"""
    if key == "desktop":
        path = desktop_dir()
        if path is None:
            raise ValueError("找不到桌面目录")
        return path
    if key == "d":
        path = Path("D:/")
        if not path.is_dir():
            raise ValueError("D 盘不可用")
        return path
    raise ValueError(f"未知的根标识：{key}")


def _under(root: Path, rel: str) -> Path:
    """相对路径 → root 内绝对路径（浏览导航用，root 允许是盘根）。

    ⚠️ path_jail 不接受「文件系统根」（如 D:\\）作为 jail root，而浏览必须
    从盘根开始逐层点选，所以这一层用 resolve + 前缀校验。文件读写（root 是
    用户选定的具体文件夹）请用 resolve_in_root，那里有 Jail 加持。
    """
    cleaned = str(rel).replace("\\", "/").strip("/")
    root_real = root.resolve()
    target = (root_real / cleaned).resolve() if cleaned else root_real
    if target != root_real and root_real not in target.parents:
        raise ValueError(f"路径不合法：{rel}")
    return target


def resolve_in_root(root: Path, rel: str) -> Path:
    """相对路径 → 根内绝对路径；空串返回根目录本身。

    两道校验：
    1. path_jail（Rust）：拦绝对路径与 `..` 逃逸——盘符、混合斜杠、junction
       这些形式都由它 canonicalize 后判断，比手写字符串检查可靠；
    2. realpath 兜底：Jail 不解析链接，根内若有指向外部的 junction/symlink，
       这里解析真实路径后再卡一次边界。
    """
    try:
        target = Path(Jail(str(root)).join(rel))
    except ValueError as exc:  # 越界、绝对路径、非法形式
        raise ValueError(f"路径不合法：{rel}") from exc
    except OSError as exc:  # 根目录不存在或不可访问
        raise ValueError(f"目录不可用（{exc}）") from exc

    root_real = Path(os.path.realpath(root))
    real = Path(os.path.realpath(target))
    if real != root_real and root_real not in real.parents:
        raise ValueError(f"路径不合法（指向了允许范围之外）：{rel}")
    return target


def list_roots() -> list[dict]:
    """可浏览的根清单（前端文件夹选择器的入口）。"""
    roots: list[dict] = []
    if desktop_dir() is not None:
        roots.append({"key": "desktop", "name": "桌面"})
    if Path("D:/").is_dir():
        roots.append({"key": "d", "name": "D 盘"})
    return roots


def resolve_workspace_path(workspace_path: str) -> Path:
    """`<root_key>:<相对路径>` → 本机绝对路径（无效则抛 ValueError）。

    例：`desktop:材料/2026` → 桌面下的 材料/2026；`d:exam` → D:\\exam；
        不能选盘根本身（path_jail 不接受盘根）。
    """
    key, _, sub = str(workspace_path).partition(":")
    target = _under(_root_path(key), sub)
    if not target.is_dir():
        raise ValueError(f"文件夹不存在：{workspace_path}")
    if target.parent == target:  # 盘根：path_jail 不接受，工作范围也不该是整个盘
        raise ValueError("请选择盘符下的具体文件夹，不要直接选盘根")
    return target


def resolve_workspace_file(workspace_path: str, rel: str) -> Path:
    """定位用户工作文件夹里的一个文件（只校验路径、不读内容）。

    raw 二进制预览（docx 等，10-07）用：校验与 read_file_preview 同源 ——
    resolve_workspace_path（必须是用户选定的具体文件夹）+ resolve_in_root（path_jail
    + realpath 兜底），绝不许跳出工作文件夹。不存在抛 ValueError。
    """
    folder = resolve_workspace_path(workspace_path)
    target = resolve_in_root(folder, str(rel).replace("\\", "/").strip("/"))
    if not target.is_file():
        raise ValueError(f"文件不存在或已被删除：{rel}")
    return target


def read_file_preview(workspace_path: str, rel: str) -> dict:
    """读取用户工作文件夹里的一个文本文件，供「已修改的文件」抽屉预览（10-07）。

    workspace_path: `<root_key>:<相对路径>`（与提问时提交的 workspace_path 同一口径）
    rel: agent 虚拟路径（/user/xxx）去掉 /user/ 前缀后的相对路径

    安全：路径校验走 resolve_workspace_file（path_jail + realpath 双道），绝不许跳出工作文件夹。
    读不了不报 5xx：二进制 / 超大返回带 binary / too_large 标记的空内容，前端措辞降级。
    """
    target = resolve_workspace_file(workspace_path, rel)

    stat = target.stat()
    size = stat.st_size
    if size > MAX_PREVIEW_BYTES:
        return {"name": target.name, "size": size, "modified_at": "",
                "content": "", "truncated": False, "binary": False, "too_large": True}
    raw = target.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return {"name": target.name, "size": size, "modified_at": "",
                "content": "", "truncated": False, "binary": True, "too_large": False}

    truncated = len(text) > MAX_PREVIEW_CHARS
    if truncated:
        text = text[:MAX_PREVIEW_CHARS]
    return {
        "name": target.name,
        "size": size,
        # 本地墙钟（无时区后缀），前端直接展示
        "modified_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
        "content": text,
        "truncated": truncated,
        "binary": False,
        "too_large": False,
    }


def list_dir(root_key: str, sub_path: str = "") -> dict:
    """列出某个根下、某子目录的内容（目录在前，供前端点选）。"""
    target = _under(_root_path(root_key), sub_path)
    if not target.is_dir():
        raise ValueError(f"目录不存在：{sub_path}")

    try:
        items = sorted(target.iterdir(), key=lambda p: p.name.lower())
    except OSError as exc:
        raise ValueError(f"无法读取目录（{exc}）") from exc

    dirs: list[dict] = []
    files: list[dict] = []
    for item in items:
        name = item.name
        if name.startswith("$") or name.lower() in _SYSTEM_DIRS:
            continue
        try:
            if item.is_dir():
                dirs.append({"name": name, "type": "dir"})
                continue
            size = item.stat().st_size
        except OSError:  # 权限不足 / 链接失效，跳过
            continue
        files.append({"name": name, "type": "file", "size": size})

    entries = dirs + files
    parent = ""
    if sub_path:
        up = PurePosixPath(sub_path).parent
        parent = "" if str(up) == "." else str(up)
    return {
        "root": root_key,
        "path": sub_path,
        "parent": parent,
        "entries": entries[:MAX_ENTRIES],
        "truncated": len(entries) > MAX_ENTRIES,
    }
