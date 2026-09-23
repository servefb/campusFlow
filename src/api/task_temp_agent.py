from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.basic_config import get_session_mysql
from src.jwt.JWTAuthMiddleware import get_current_user_id
from src.models.task_temp import TaskMatchRequest
from src.repositories.tasks_templates_match import (
    get_tasks_templates_match_to_llm,
    get_tasks_document_match_to_llm,
)

task_router = APIRouter(prefix="/tasks")


@task_router.post("/templates/match")
async def get_tasks_templates_match(
    body: TaskMatchRequest,
    session: AsyncSession = Depends(get_session_mysql),
):
    """按用户提问匹配任务模板。"""
    return await get_tasks_templates_match_to_llm(body.title, session)


@task_router.post("/document/match")
async def get_task_document_match(
    body: TaskMatchRequest,
    session: AsyncSession = Depends(get_session_mysql),
    user_id: int = Depends(get_current_user_id),
):
    """按用户提问匹配其可见的文档。"""
    return await get_tasks_document_match_to_llm(body.query, session, user_id)
