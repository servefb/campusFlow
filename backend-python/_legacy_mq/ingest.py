import os
import logging
from src.agent.rag_worker.chunk import parse_and_chunk
from src.agent.rag_worker.extractor import llm_extract_meta, extract_title, extract_document_no, extract_published_at, \
    extract_effective_from
from src.agent.rag_worker.minio_client import download
from src.agent.rag_worker.repository import Repository
from src.agent.vectorstore.chroma_vectorstore import VectorStore
from src.db.basic_config import AsyncSessionLocal
from src.db.db_Knowledge import KnowledgeSection, KnowledgeDocument, KnowledgeDocumentVersion

logger = logging.getLogger(__name__)


def _to_section_models(chunks, version_id: int) -> list[KnowledgeSection]:
    sections = []
    for c in chunks:
        m = c.metadata
        sections.append(KnowledgeSection(
            version_id=version_id,
            chunk_index=m["chunkIndex"],
            content=c.page_content,
            heading=m.get("heading"),
            chapter_no=m.get("chapter_no"),
            article_no=m.get("article_no"),
            section_label=m.get("section_label"),
            page_start=m.get("page"),
            page_end=m.get("page"),
            token_count=m.get("token_count"),
            meta={"source": m.get("source"), "chunkTotal": m.get("chunkTotal")},
        ))
    return sections


def _parser_name(file_name: str) -> str:
    ext = os.path.splitext(file_name)[1].lower()
    return {
        ".pdf": "pypdf", ".docx": "python-docx",
        ".xlsx": "openpyxl", ".xls": "openpyxl",
        ".md": "markdown", ".txt": "plain",
    }.get(ext, "unknown")


async def ingest_document(
        *,
        file_id: int,
        bucket: str,
        object_key: str,
        file_name: str,
        user_id: int,
        vector_store: VectorStore,
        llm_client,
        version_no: str = None,
):
    tmp_path = None
    doc_id = None
    category_code = "uncategorized"

    try:
        # 1. 下载（同步 IO，用 run_in_executor 包一层避免阻塞事件循环）
        import asyncio
        loop = asyncio.get_running_loop()
        tmp_path = await loop.run_in_executor(
            None, download, bucket, object_key
        )

        # 2. 解析 + 分块（CPU/IO 密集，同样丢到线程池）
        chunks = await loop.run_in_executor(
            None, parse_and_chunk, tmp_path, file_name
        )
        if not chunks:
            raise ValueError(f"文件解析后无内容: {file_name}")
        full_text = "\n".join(c.page_content for c in chunks)

        # 3. LLM 提取（同步 HTTP，包一层）
        async with AsyncSessionLocal() as session:
            repo = Repository(session)
            categories = await repo.list_categories()

        meta = await loop.run_in_executor(
            None, llm_extract_meta, llm_client, file_name, full_text, categories
        )

        # ========== 事务 ==========
        async with AsyncSessionLocal() as session:
            repo = Repository(session)

            category_code = meta.get("category_code", "uncategorized")
            category_id = await repo.find_category_id(category_code)
            if not category_id:
                category_code = "uncategorized"
                category_id = await repo.find_category_id(category_code)
                if not category_id:
                    raise ValueError("缺少 uncategorized 兜底类别")

            doc = KnowledgeDocument(
                category_id=category_id,
                title=meta.get("title") or extract_title(file_name, full_text),
                summary=meta.get("summary"),
                document_no=meta.get("document_no") or extract_document_no(full_text),
                issuer_level="school",
                validity="current",
                visibility="campus",
                status="processing",
                published_at=meta.get("published_at") or extract_published_at(full_text),
                effective_from=meta.get("effective_from") or extract_effective_from(full_text),
                reference_count=0,
                created_by=user_id,
            )
            doc_id = await repo.insert_document(doc)

            page_count = chunks[0].metadata.get("pageCount") if chunks else None
            ver = KnowledgeDocumentVersion(
                document_id=doc_id,
                source_file_id=file_id,
                version_no=version_no or meta.get("version_no") or "1.0",
                is_current=True,
                status="processing",
                page_count=page_count,
                parser_name=_parser_name(file_name),
                chunk_count=len(chunks),
                meta={"source": file_name},
                created_by=user_id,
            )
            ver_id = await repo.insert_version(ver)

            sections = _to_section_models(chunks, ver_id)
            await repo.insert_sections(sections)

            await repo.update_document_status(doc_id, "ready")

            await session.commit()

        # 4. 写 Chroma（外部系统，事务外）
        await loop.run_in_executor(
            None, vector_store.add_sections,
            category_code, doc_id, ver_id, sections,
        )

        logger.info(f"入库完成 fileId={file_id} docId={doc_id} chunks={len(sections)}")
        return doc_id, ver_id, len(sections)

    except Exception as e:
        logger.exception(f"入库失败 fileId={file_id}")
        if doc_id:
            try:
                async with AsyncSessionLocal() as session:
                    await Repository(session).update_document_status(doc_id, "failed")
                    await session.commit()
            except Exception:
                logger.exception("标记失败状态也失败")
        raise

    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
