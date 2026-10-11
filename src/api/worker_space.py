from fastapi import APIRouter,Depends
from fastapi.responses import FileResponse

from src.db.basic_config import get_session_mysql
from src.models.common_responce import result
from src.repositories.worker_space_repo import get_summary as get_summary_service
from src.repositories.workspace_browse_repo import (
    list_dir as list_dir_service,
    list_roots,
    read_file_preview as read_file_preview_service,
    resolve_workspace_file as resolve_workspace_file_service,
)
from src.jwt.JWTAuthMiddleware import get_current_user_id

worker_space_router = APIRouter(prefix="/workspace")

#: raw 模式直出文件本体的大小上限：预览用，别让一个大文件把浏览器拖爆
MAX_RAW_PREVIEW_BYTES = 10 * 1024 * 1024

@worker_space_router.get("/summary")
async def get_summary(session=Depends(get_session_mysql),user_id=Depends(get_current_user_id)):
    """
    Endpoint to get a summary of the worker space.
    """
    summary = await get_summary_service(session, user_id)
    return result.success(data=summary)


@worker_space_router.get("/dirs/roots")
async def browse_roots(user_id=Depends(get_current_user_id)):
    """文件夹选择器入口：返回可浏览的根目录清单（key 用于后续请求）。"""
    return result.success(data={"roots": list_roots()})


@worker_space_router.get("/dirs")
async def browse_dirs(root: str, path: str = "", user_id=Depends(get_current_user_id)):
    """列出某个根下、某子目录的内容，供用户逐层点选文件夹。

    root: 根标识，取自 /workspace/dirs/roots
    path: 相对该根的子目录，空串表示根目录本身
    """
    try:
        data = list_dir_service(root, path)
    except ValueError as exc:
        return result(400, str(exc)).error()
    return result.success(data=data)


@worker_space_router.get("/file")
async def read_workspace_file(workspace: str, path: str, raw: int = 0, user_id=Depends(get_current_user_id)):
    """读取用户工作文件夹里的一个文件（「已修改的文件」边栏预览用，10-07）。

    workspace: `<root>:<相对路径>`（提问时提交的 workspace_path，决定 /user/ 路由到哪）
    path: agent 虚拟路径去掉 /user/ 前缀后的相对路径（如 `奖助政策/申报材料清单.md`）
    raw=1: 直出文件**本体**（FileResponse，不走 JSON 信封）—— 供前端解压 .docx 提取正文等
           二进制预览；上限 10MB。默认（raw=0）行为不变：文本内容 JSON，二进制/超大给标记降级。
    """
    try:
        target = resolve_workspace_file_service(workspace, path)
    except ValueError as exc:
        return result(400, str(exc)).error()
    if raw:
        if target.stat().st_size > MAX_RAW_PREVIEW_BYTES:
            return result(400, "文件超过 10MB，不支持在线预览").error()
        return FileResponse(target)
    try:
        data = read_file_preview_service(workspace, path)
    except ValueError as exc:
        return result(400, str(exc)).error()
    return result.success(data=data)