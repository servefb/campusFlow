from fastapi import APIRouter
from fastapi import Depends
from src.models.page_query_res import page_query
from src.db.basic_config import get_session_mysql
from src.jwt.JWTAuthMiddleware import get_current_user_id
from src.repositories.conversations_repo import get_conversations_service, get_conversation_detail_service, \
    delete_conversation_service

history_router = APIRouter(prefix="/history")


@history_router.get("/conversations")
async def get_conversations(page: page_query = Depends(), session=Depends(get_session_mysql),
                            user_id=Depends(get_current_user_id)):
    """
    Endpoint to get conversations.
    """

    return await get_conversations_service(page, session, user_id)


@history_router.get("/conversations/{id}")
async def get_conversation(id: int, session=Depends(get_session_mysql),
                            user_id=Depends(get_current_user_id)):
    """
    Endpoint to get a conversation by id.
    """

    return await get_conversation_detail_service(id, session, user_id)

@history_router.delete("/conversations/{id}")
async def delete_conversation(id: int, session=Depends(get_session_mysql),
                            user_id=Depends(get_current_user_id)):
    """
    Endpoint to delete a conversation by id.
    """
    ids=[id]
    return await delete_conversation_service(ids, session, user_id)

