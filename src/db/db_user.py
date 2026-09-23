# models/user.py
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, String, Boolean, DateTime, ForeignKey, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.db.db_agent import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    organization_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("organizations.id"), nullable=True
    )
    account: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # student / teacher / admin
    department_name: Mapped[Optional[str]] = mapped_column(String(160), nullable=True)
    student_or_staff_no: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(254), nullable=True)
    phone_encrypted: Mapped[Optional[bytes]] = mapped_column(nullable=True)
    avatar_file_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(3), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(3), nullable=False, server_default=func.now(3))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(3), nullable=False, server_default=func.now(3), onupdate=func.now(3)
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(3), nullable=True)

    organization: Mapped[Optional["Organization"]] = relationship(
        "Organization", back_populates="users", foreign_keys=[organization_id]
    )

    __table_args__ = (
        Index("idx_users_org_role", "organization_id", "role", "deleted_at"),
    )

    def __repr__(self) -> str:
        return f"<User(id={self.id}, account='{self.account}', role='{self.role}')>"


# 放在文件底部：保证 User 已定义后再导入，避免与 db_organization 循环导入。
# 必须 import，否则 User.organization 的 "Organization" 字符串无法在 registry 解析。
from src.db.db_organization import Organization  # noqa: E402,F401