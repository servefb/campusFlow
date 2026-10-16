from sqlalchemy import Column, Integer, String, Enum, Boolean, DateTime

from src.db.db_base import Base, utcnow as _utcnow


class workspace_quick_entries(Base):
    __tablename__ = "workspace_quick_entries"
    id = Column(Integer, primary_key=True, autoincrement=True)
    entry_key = Column(String(64), nullable=False, unique=True, comment='前端使用的唯一 key')
    title = Column(String(120), nullable=False, comment='快捷入口标题')
    category = Column(String(120), nullable=False, comment='业务分类')
    prompt = Column(String(500), nullable=False, comment='点击后自动填入的问题')
    sort_order = Column(Integer, nullable=False, default=0, comment='排序，越小越靠前')
    visibility = Column(Enum('public', 'student', 'teacher', 'admin'), nullable=False, default='public')
    is_enabled = Column(Boolean, nullable=False, default=True, comment='是否启用')
    valid_from = Column(DateTime(3), nullable=True)
    valid_to = Column(DateTime(3), nullable=True)
    created_at = Column(DateTime(3), nullable=False, default=_utcnow)
    updated_at = Column(DateTime(3), nullable=False, default=_utcnow, onupdate=_utcnow)
