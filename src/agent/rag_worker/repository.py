import logging
from typing import List, Optional
from sqlalchemy import select, update, delete, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.db_Knowledge import (
    KnowledgeCategory, KnowledgeDocument,
    KnowledgeDocumentVersion, KnowledgeSection,
)

logger = logging.getLogger(__name__)


class Repository:
    def __init__(self, session: AsyncSession):
        self.session = session

    # ---------- 类别 ----------
    # 刻意**不提供** list_categories / find_category_id：
    # 分类下拉由 Java 的 `GET /api/v1/knowledge/categories` 提供（管理后台的读接口
    # 全在业务服务），这里再实现一份就是两套事实来源。本服务只需要「按 id 取 code」
    # 这一个动作 —— 它同时承担存在性校验与 Chroma collection 命名。
    # （knowledge_categories 表没有 description 列，已 DESCRIBE 校对过。）

    # ---------- document ----------
    async def insert_document(self, doc: KnowledgeDocument) -> int:
        self.session.add(doc)
        await self.session.flush()  # ★ 异步 flush
        return doc.id

    # ---------- version ----------
    async def insert_version(self, ver: KnowledgeDocumentVersion) -> int:
        self.session.add(ver)
        await self.session.flush()
        return ver.id

    # ---------- sections 批量插入 ----------
    async def insert_sections(self, sections: List[KnowledgeSection]) -> List[KnowledgeSection]:
        if not sections:
            return []
        self.session.add_all(sections)
        await self.session.flush()  # ★ 一次 flush，id 自动回填
        return sections

    # ---------- 状态更新 ----------
    async def update_document_status(self, document_id: int, status: str):
        await self.session.execute(
            update(KnowledgeDocument)
            .where(KnowledgeDocument.id == document_id)
            .values(status=status)
        )
        await self.session.execute(
            update(KnowledgeDocumentVersion)
            .where(KnowledgeDocumentVersion.document_id == document_id)
            .values(status=status)
        )

    # ---------- 旧版本下线 ----------
    async def find_document_by_no_or_title(self, document_no, title):
        """按文号优先、其次标题，查找已有文档。"""
        if document_no:
            result = await self.session.execute(
                select(KnowledgeDocument.id)
                .where(KnowledgeDocument.document_no == document_no,
                       KnowledgeDocument.deleted_at.is_(None))
                .limit(1)
            )
            doc_id = result.scalar_one_or_none()
            if doc_id:
                return doc_id

        if title:
            result = await self.session.execute(
                select(KnowledgeDocument.id)
                .where(KnowledgeDocument.title == title,
                       KnowledgeDocument.deleted_at.is_(None))
                .limit(1)
            )
            doc_id = result.scalar_one_or_none()
            if doc_id:
                return doc_id

        return None

    async def get_current_version(self, document_id):
        result = await self.session.execute(
            select(KnowledgeDocumentVersion)
            .where(KnowledgeDocumentVersion.document_id == document_id,
                   KnowledgeDocumentVersion.is_current == True)
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_document_by_id(self, document_id):
        result = await self.session.execute(
            select(KnowledgeDocument).where(KnowledgeDocument.id == document_id)
        )
        return result.scalar_one_or_none()

    async def get_category_code(self, category_id):
        result = await self.session.execute(
            select(KnowledgeCategory.code).where(KnowledgeCategory.id == category_id)
        )
        return result.scalar_one_or_none()

    async def update_document_meta(self, document_id, *, title=None, summary=None,
                                   document_no=None, category_id=None):
        values = {}
        if title is not None:
            values["title"] = title
        if summary is not None:
            values["summary"] = summary
        if document_no is not None:
            values["document_no"] = document_no
        if category_id is not None:
            values["category_id"] = category_id
        if values:
            await self.session.execute(
                update(KnowledgeDocument)
                .where(KnowledgeDocument.id == document_id)
                .values(**values)
            )

    async def deactivate_old_versions(self, document_id):
        """旧版本下线：is_current=false，status=archived。"""
        await self.session.execute(
            update(KnowledgeDocumentVersion)
            .where(KnowledgeDocumentVersion.document_id == document_id,
                   KnowledgeDocumentVersion.is_current == True)
            .values(is_current=False, status="archived")
        )

    # ---------- 按源文件查（幂等 / 轮询状态的落点） ----------
    async def find_version_by_source_file_id(self, file_id: int):
        """取某个上传文件最新的一条版本记录（同一文件可能重试过多次）。

        幂等判定与「按 fileId 查入库状态」都靠它 —— 这是前端轮询接口的
        唯一事实来源，所以按 id 倒序取最新一条。
        """
        result = await self.session.execute(
            select(KnowledgeDocumentVersion)
            .where(KnowledgeDocumentVersion.source_file_id == file_id)
            .order_by(KnowledgeDocumentVersion.id.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_version_by_id(self, version_id: int):
        result = await self.session.execute(
            select(KnowledgeDocumentVersion)
            .where(KnowledgeDocumentVersion.id == version_id)
            .limit(1)
        )
        return result.scalar_one_or_none()

    # ---------- 版本状态 / 元数据 ----------
    async def update_version_status(self, version_id: int, status: str):
        await self.session.execute(
            update(KnowledgeDocumentVersion)
            .where(KnowledgeDocumentVersion.id == version_id)
            .values(status=status)
        )

    async def update_version_fields(self, version_id: int, **values):
        if not values:
            return
        await self.session.execute(
            update(KnowledgeDocumentVersion)
            .where(KnowledgeDocumentVersion.id == version_id)
            .values(**values)
        )

    # ---------- sections ----------
    async def count_sections(self, version_id: int) -> int:
        result = await self.session.execute(
            select(func.count())
            .select_from(KnowledgeSection)
            .where(KnowledgeSection.version_id == version_id)
        )
        return int(result.scalar_one() or 0)

    async def delete_sections_by_version(self, version_id: int) -> int:
        """重试前清掉上次残留的 sections，避免正文重复堆积。"""
        result = await self.session.execute(
            delete(KnowledgeSection)
            .where(KnowledgeSection.version_id == version_id)
        )
        return int(result.rowcount or 0)

    # ---------- 文档 ----------
    async def update_document_fields(self, document_id: int, **values):
        if not values:
            return
        await self.session.execute(
            update(KnowledgeDocument)
            .where(KnowledgeDocument.id == document_id)
            .values(**values)
        )

    async def mark_document_removed(self, document_id: int):
        """移出知识库：状态置 removed + deleted_at 打时间戳，不物理删行。"""
        from datetime import datetime
        await self.session.execute(
            update(KnowledgeDocument)
            .where(KnowledgeDocument.id == document_id)
            .values(status="removed", deleted_at=datetime.now())
        )

    # ---------- 上传文件表（Java 与 Python 共用 campus_flow 库，这里只读） ----------
    async def load_file_meta(self, file_id: int) -> Optional[dict]:
        """按 fileId 读 Java 写入的 files 行，拿 MinIO 定位信息。

        为什么在 Python 侧读表而不是让前端传 bucket/objectKey：
        前端从 `POST /files/presign` 与 `GET /files/{id}` 都拿不到 object_key，
        bucket 更是固定配置值。两边既然共库，直接读是最短且不会漂移的一条路；
        代价是耦合了 files 表的列名，改动时两边要一起看。
        """
        row = (await self.session.execute(
            text(
                "SELECT id, original_name, object_key, content_type, "
                "       size_bytes, purpose, status "
                "FROM files WHERE id = :fid AND deleted_at IS NULL"
            ),
            {"fid": file_id},
        )).mappings().first()
        return dict(row) if row else None

    async def list_pending_files(self, limit: int = 50) -> List[dict]:
        # 注意：SQL 字符串里刻意不写 `--` 注释。某些驱动/日志路径会把整条语句
        # 压成一行，那时行尾注释会把后面的语句一起注释掉，排查起来非常费劲。
        rows = (await self.session.execute(
            text(
                """
                SELECT f.id            AS file_id,
                       f.original_name AS file_name,
                       f.size_bytes    AS size_bytes,
                       f.content_type  AS content_type,
                       f.status        AS scan_status,
                       f.uploaded_at   AS uploaded_at,
                       f.created_at    AS created_at,
                       v.id            AS version_id,
                       v.status        AS version_status,
                       v.chunk_count   AS chunk_count,
                       d.id            AS document_id,
                       d.status        AS document_status,
                       d.title         AS title,
                       c.code          AS category_code,
                       c.name          AS category_name
                FROM files f
                LEFT JOIN (
                    SELECT source_file_id, MAX(id) AS vid
                    FROM knowledge_document_versions
                    GROUP BY source_file_id
                ) lv ON lv.source_file_id = f.id
                LEFT JOIN knowledge_document_versions v ON v.id = lv.vid
                LEFT JOIN knowledge_documents d ON d.id = v.document_id
                LEFT JOIN knowledge_categories c ON c.id = d.category_id
                WHERE f.purpose = 'knowledge_doc'
                  AND f.deleted_at IS NULL
                  AND f.status NOT IN ('rejected', 'deleted')
                  AND (v.id IS NULL OR v.status <> 'ready')
                ORDER BY f.created_at DESC
                LIMIT :lim
                """
            ),
            {"lim": limit},
        )).mappings().all()

        import os

        def _ingest_status(row) -> str:
            """把「文件行 + 版本行 + 文档行」折叠成一个入库状态。

            刻意在 Python 侧折叠而不是让前端拼：前端只该消费一个状态字符串，
            三张表的 NULL 组合规则留在这里一处维护。
            """
            if row["version_id"] is None:
                return "none"          # 从未确认入库
            if row["document_status"] == "removed":
                return "removed"       # 曾入库后被移出
            return row["version_status"] or "none"

        out = []
        for r in rows:
            out.append({
                "fileId": r["file_id"],
                "fileName": r["file_name"],
                "title": r["title"],
                "sizeBytes": int(r["size_bytes"] or 0),
                "contentType": r["content_type"],
                "extension": os.path.splitext(r["file_name"] or "")[1].lower().lstrip("."),
                "scanStatus": r["scan_status"],
                "uploadedAt": (r["uploaded_at"] or r["created_at"]).isoformat()
                if (r["uploaded_at"] or r["created_at"]) else None,
                "ingestStatus": _ingest_status(r),
                "documentId": r["document_id"],
                "versionId": r["version_id"],
                "chunkCount": r["chunk_count"],
                "categoryCode": r["category_code"],
                "categoryName": r["category_name"],
            })
        return out
