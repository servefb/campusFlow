from sqlalchemy import (
    BigInteger, Integer, String, Text, JSON, Boolean, Date, DateTime, func
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import Optional
from datetime import datetime, date

from src.db.db_base import Base
# noqa: F401 —— primaryjoin 字符串在模块命名空间求值，必须提前导入 Organization
from src.db.db_organization import Organization  # noqa: F401


class KnowledgeCategory(Base):
    __tablename__ = "knowledge_categories"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    parent_id: Mapped[Optional[int]] = mapped_column(BigInteger)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(3), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(3), server_default=func.now(),
                                                 onupdate=func.now())


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    category_id: Mapped[Optional[int]] = mapped_column(BigInteger)
    issuer_organization_id: Mapped[Optional[int]] = mapped_column(BigInteger)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    document_no: Mapped[Optional[str]] = mapped_column(String(120))
    issuer_level: Mapped[str] = mapped_column(String(32), default="school")
    validity: Mapped[str] = mapped_column(String(16), default="current")
    visibility: Mapped[str] = mapped_column(String(16), default="campus")
    status: Mapped[str] = mapped_column(String(16), default="draft")
    summary: Mapped[Optional[str]] = mapped_column(Text)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    effective_from: Mapped[Optional[date]] = mapped_column(Date)
    effective_to: Mapped[Optional[date]] = mapped_column(Date)
    reference_count: Mapped[int] = mapped_column(BigInteger, default=0)
    created_by: Mapped[Optional[int]] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(),
                                                 onupdate=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    # 关系（selectinload(KnowledgeDocument.category) 等查询依赖这两个属性）。
    # 表列未声明 ForeignKey，故用 foreign() 注解的 primaryjoin 显式指定连接条件。
    category: Mapped[Optional["KnowledgeCategory"]] = relationship(
        "KnowledgeCategory",
        primaryjoin="foreign(KnowledgeDocument.category_id) == KnowledgeCategory.id",
        lazy="selectin",
    )
    issuer_organization: Mapped[Optional["Organization"]] = relationship(
        "Organization",
        primaryjoin="foreign(KnowledgeDocument.issuer_organization_id) == Organization.id",
        lazy="selectin",
    )


class KnowledgeDocumentVersion(Base):
    __tablename__ = "knowledge_document_versions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    source_file_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    version_no: Mapped[str] = mapped_column(String(48), nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(16), default="processing")
    signature_algorithm: Mapped[Optional[str]] = mapped_column(String(32))
    signature_digest: Mapped[Optional[str]] = mapped_column(String(256))
    signature_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    signature_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    page_count: Mapped[Optional[int]] = mapped_column(Integer)
    parser_name: Mapped[Optional[str]] = mapped_column(String(80))
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    # ★ metadata 是 SQLAlchemy 保留字，属性名用 meta，列名仍映射为 metadata
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_by: Mapped[Optional[int]] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(),
                                                 onupdate=func.now())


class KnowledgeSection(Base):
    __tablename__ = "knowledge_sections"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    version_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    parent_section_id: Mapped[Optional[int]] = mapped_column(BigInteger)
    chapter_no: Mapped[Optional[int]] = mapped_column(Integer)
    article_no: Mapped[Optional[int]] = mapped_column(Integer)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    heading: Mapped[Optional[str]] = mapped_column(Text)
    section_label: Mapped[Optional[str]] = mapped_column(String(160))
    content: Mapped[str] = mapped_column(Text, nullable=False)
    page_start: Mapped[Optional[int]] = mapped_column(Integer)
    page_end: Mapped[Optional[int]] = mapped_column(Integer)
    token_count: Mapped[Optional[int]] = mapped_column(Integer)
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())