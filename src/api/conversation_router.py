from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from src.db.basic_config import get_session_mysql
from src.db.db_conversation import conversation
from src.jwt.JWTAuthMiddleware import get_current_user_id
from src.models.meassage import Message
from src.repositories.conversations_repo import (
    create_conversation, chat_create_conversation, stop_stream,
)

conversation_router = APIRouter(prefix="/conversations")

chat_or_agent={
    "chat": chat_create_conversation,
    "agent": create_conversation
}

# ⚠️ `message` 必须标成表单模型：请求是 multipart/form-data（里面含文件本体，
# 见 src/models/meassage.py 顶部注释）。只写成 `message: Message` 会被 FastAPI 当成
# JSON body 参数，multipart 正文整体当字符串塞进模型 → 422 model_attributes_type。
# 两个端点都要这么写，漏一个就有一条路进不来。
@conversation_router.post("/messages/stream")
async def stream_messages(message: Annotated[Message, Form()], session=Depends(get_session_mysql), user_id=Depends(get_current_user_id)):
    """
    Endpoint to stream messages in real-time.
    """
    return StreamingResponse(
        chat_or_agent[message.mode] (message, session, user_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

@conversation_router.post("/{conversation_id}/messages/stream")
async def stream_messages(conversation_id: int, message: Annotated[Message, Form()], session=Depends(get_session_mysql),
                          user_id=Depends(get_current_user_id)):
    """
    Endpoint to stream messages in real-time.
    """
    message.conversation_id = conversation_id
    return StreamingResponse(
        chat_or_agent[message.mode] (message, session, user_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@conversation_router.post("/{conversation_id}/stop")
async def stop_conversation_stream(conversation_id: str, session=Depends(get_session_mysql),
                                   user_id=Depends(get_current_user_id)):
    """停止某会话正在执行的 agent 轮次（前端「停止」按钮）。

    - 幂等：连点返回同样的结果，不会打断正在进行的收尾落库；
    - 该会话没有在跑的流时返回 stopped=False（比如流刚好自己结束了）；
    - 归属校验：会话行已存在时校验 user_id，别人的会话不许你停（403）。
      首轮运行时会话行还没插入，此时只有 thread_id（雪花 ID）持有者自己知道，
      放行由注册表里查无此流自然兜底。
    """
    row = (await session.execute(
        select(conversation.user_id).where(conversation.id == conversation_id)
    )).first()
    if row is not None and row.user_id != user_id:
        raise HTTPException(status_code=403, detail="无权操作该会话")
    stopped = stop_stream(str(conversation_id))
    return {"stopped": stopped}
