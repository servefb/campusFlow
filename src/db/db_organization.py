# models/organization.py
# 列结构以数据库 organizations 表为准（已用 DESCRIBE organizations 校对）
from datetime import datetime
from typing import List, Optional

from sqlalchemy import BigInteger, String, DateTime, Boolean, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.db.db_base import Base


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    parent_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    short_name: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    organization_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    contact_phone: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    contact_email: Mapped[Optional[str]] = mapped_column(String(254), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(3), nullable=False, server_default=func.now(3))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(3), nullable=False, server_default=func.now(3), onupdate=func.now(3)
    )

    # 与 User.organization 配对。
    # users 与 organizations 之间只有 users.organization_id 一个 FK，
    # SQLAlchemy 可自动推断，不必写 foreign_keys="User.organization_id"
    # （字符串会在本模块命名空间 eval，导致 NameError: User not defined）
    users: Mapped[List["User"]] = relationship(
        "User", back_populates="organization"
    )

    def __repr__(self) -> str:
        return f"<Organization(id={self.id}, name='{self.name}')>"


# 放在文件底部：保证 Organization 已定义后再导入，避免与 db_user 循环导入。
# 必须 import，否则 back_populates="users" 的 "User" 字符串无法在 registry 解析。
from src.db.db_user import User  # noqa: E402,F401
