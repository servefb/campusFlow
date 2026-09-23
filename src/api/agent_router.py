from fastapi import APIRouter, Depends

from src.db.basic_config import get_session_mysql
from src.models.common_responce import result
from src.repositories.agent_repo import get_agents as get_agents_service

agent_router = APIRouter(prefix="/agents")


@agent_router.get("")
async def get_agents(session=Depends(get_session_mysql)):
    return result.success(data= {"items": await get_agents_service(session)})
