from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from src.db.basic_config import get_session_mysql
from src.db.db_conversation import conversation
from src.jwt.JWTAuthMiddleware import get_current_user_id
from src.models.meassage import Message
from src.repositories.conversations_repo import (
    create_conversation, chat_create_conversation, stop_stream, send_supplement,
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


@conversation_router.post("/{conversation_id}/supplement")
async def supplement_conversation(conversation_id: str, message: Annotated[Message, Form()], session=Depends(get_session_mysql),
                                  user_id=Depends(get_current_user_id)):
    """「执行中追加」（09-23 二次定稿）：把补充内容递给正在执行的轮次（不打断任务）。

    - 与 stop 端点同一套归属校验：会话行存在时校验 user_id，别人的会话不许补（403）；
    - 返回 queued=False 表示该会话当前没有在跑的流（可能刚好自己结束了），前端提示兜底；
    - 真正的注入在主智能体下一次调用模型前由 SupplementInjectionMiddleware 完成。
    """
    row = (await session.execute(
        select(conversation.user_id).where(conversation.id == conversation_id)
    )).first()
    if row is not None and row.user_id != user_id:
        raise HTTPException(status_code=403, detail="无权操作该会话")
    message.conversation_id = conversation_id
    return await send_supplement(message, session, user_id)


@conversation_router.post("/{conversation_id}/stop")
async def stop_conversation_stream(conversation_id: str, session=Depends(get_session_mysql),
                                   user_id=Depends(get_current_user_id)):
    """停止某会话正在执行的 agent 轮次（前端「停止」按钮）。

    2026-10-08 改版 —— 软暂停优先，强杀兜底：
    - 第一次点击：置暂停位，agent 在下一次模型调用边界干净暂停（图停在 interrupt 上，
      不产生半截回答），流以 paused 事件收尾；前端把「停止」换成「继续」。
      继续 = 该端点族走 resume={"action":"continue"}；暂停中直接输入新消息 = 隐式继续+补充。
    - 连点第二次 / 软暂停超时未落地（卡在长工具或子代理里）：强杀（同旧版硬取消，
      不可续跑，半截回答标 cancelled）。
    - 幂等：连点不会重复取消已收尾的落库；该会话没有在跑的流时返回 stopped=False；
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
