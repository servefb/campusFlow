from sqlalchemy import Column, Integer, BigInteger, String, Text, Enum, Boolean, DateTime

from src.db.db_base import Base, utcnow as _utcnow


class conversation(Base):
    __tablename__ = "conversations"
    # 雪花ID(19位)远超 INT 上限，必须用 BIGINT
    id = Column(BigInteger, primary_key=True, autoincrement=False)
    user_id = Column(Integer, nullable=False)
    title = Column(String(240), nullable=False)
    agent_mode = Column(String(32), nullable=False, default='auto')
    source = Column(String(32), nullable=False, default='workspace')
    status = Column(Enum('active', 'archived', 'deleted'), nullable=False, default='active')
    is_bookmarked = Column(Boolean, nullable=False, default=False)
    last_message_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    updated_at = Column(DateTime, nullable=False, default=_utcnow, onupdate=_utcnow)
    deleted_at = Column(DateTime, nullable=True)
    last_reply_preview = Column(Text, nullable=True)
    work_space = Column(String(100), nullable=False)

