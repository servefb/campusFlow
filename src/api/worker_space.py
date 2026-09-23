from fastapi import APIRouter,Depends

from src.db.basic_config import get_session_mysql
from src.models.common_responce import result
from src.repositories.worker_space_repo import get_summary as get_summary_service
from src.repositories.workspace_browse_repo import (
    list_dir as list_dir_service,
    list_roots,
)
from src.jwt.JWTAuthMiddleware import get_current_user_id

worker_space_router = APIRouter(prefix="/workspace")

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