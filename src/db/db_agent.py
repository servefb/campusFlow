from sqlalchemy import Column, Integer, String, Text, Enum, JSON, Boolean, DateTime

from src.db.db_base import Base, utcnow as _utcnow


class agent(Base):
    __tablename__ = "agents"
    id = Column(Integer, primary_key=True, autoincrement=True)
    agent_key = Column(String(255), nullable=False, unique=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(Enum('online', 'busy', 'degraded', 'offline'), nullable=False, default='offline')
    model_name = Column(String(120), nullable=True)
    model_config = Column(JSON, nullable=False, default={})
    supports_attachments = Column(Boolean, nullable=False, default=False)
    is_enabled = Column(Boolean, nullable=False, default=True)
    last_heartbeat_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    updated_at = Column(DateTime, nullable=False, default=_utcnow, onupdate=_utcnow)
    domains = Column(JSON, nullable=True)  # 新增 domains 字段，存储支持的域名列表
