from sqlalchemy import Column, Integer, BigInteger, String, Text, Enum, JSON, Boolean, DateTime

from src.db.db_base import Base, utcnow as _utcnow


class messages(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    # 存 conversations.id(雪花ID)，必须 BIGINT 才装得下
    conversation_id = Column(BigInteger, nullable=False)
    parent_message_id = Column(Integer, nullable=True)
    role = Column(Enum("user", "assistant", "system", "tool"), nullable=False)
    status = Column(Enum("pending", "streaming", "completed", "failed", "cancelled"), nullable=False, default="pending")
    content = Column(Text, nullable=False, default="")
    content_format = Column(String(16), nullable=False, default="markdown")
    grounded = Column(Boolean, nullable=True)
    confidence = Column(JSON, nullable=True)
    elapsed_ms = Column(Integer, nullable=True)
    token_usage = Column(JSON, nullable=False, default={})
    error_code = Column(String(32), nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    completed_at = Column(DateTime, nullable=True)
    deleted_at = Column(DateTime, nullable=True)
    reasoning_content = Column(Text, nullable=False)
