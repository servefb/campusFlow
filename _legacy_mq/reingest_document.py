import os
import asyncio
import logging


from src.agent.rag_worker.chunk import parse_and_chunk
from src.agent.rag_worker.minio_client import download
from src.agent.rag_worker.repository import Repository
from src.agent.rag_worker.extractor import (
    llm_extract_meta, extract_title, extract_document_no,
)
from src.agent.rag_worker.ingest import (
    _to_section_models, _parser_name, ingest_document,
)
from src.agent.vectorstore.chroma_vectorstore import VectorStore
from src.db.basic_config import AsyncSessionLocal
from src.db.db_Knowledge import KnowledgeDocumentVersion

logger = logging.getLogger(__name__)


async def reingest_document(
        *,
        file_id: int,
        bucket: str,
        object_key: str,
        file_name: str,
        user_id: int,
        vector_store: VectorStore,
        llm_client,
        existing_document_id: int = None,
        version_no: str = None,
):
    """
    版本更新流程：
    1. 下载、解析、分块
    2. LLM 提取元数据
    3. 找已有文档（显式传入 or 按 document_no/title 匹配）
    4. 旧版本 is_current=false，删旧 Chroma 向量
    5. 插入新版本 + sections
    6. 更新文档主表
    7. 写新 Chroma 向量
    """
    tmp_path = None
    doc_id = None
    old_version_id = None
    old_category_code = None
    category_code = "uncategorized"
    loop = asyncio.get_running_loop()

    try:
        # ========== 1. 下载、解析、分块 ==========
        tmp_path = await loop.run_in_executor(None, download, bucket, object_key)
        chunks = await loop.run_in_executor(None, parse_and_chunk, tmp_path, file_name)
        if not chunks:
            raise ValueError(f"文件解析后无内容: {file_name}")
        full_text = "\n".join(c.page_content for c in chunks)

        # ========== 2. LLM 提取元数据 ==========
        async with AsyncSessionLocal() as session:
            categories = await Repository(session).list_categories()

        meta = await loop.run_in_executor(
            None, llm_extract_meta, llm_client, file_name, full_text, categories
        )

        new_doc_no = meta.get("document_no") or extract_document_no(full_text)
        new_title = meta.get("title") or extract_title(file_name, full_text)

        # ========== 3. 定位已有文档（短事务） ==========
        if not existing_document_id:
            async with AsyncSessionLocal() as session:
                existing_document_id = await Repository(session).find_document_by_no_or_title(
                    new_doc_no, new_title
                )

        # 找不到已有文档 → 退化为新建
        if not existing_document_id:
            logger.info(f"未找到已有文档，走新建流程 fileId={file_id}")
            return await ingest_document(
                file_id=file_id, bucket=bucket, object_key=object_key,
                file_name=file_name, user_id=user_id,
                vector_store=vector_store, llm_client=llm_client,
                version_no=version_no,
            )

        doc_id = existing_document_id

        # ========== 4. 事务：旧版本下线 + 插新版本 ==========
        async with AsyncSessionLocal() as session:
            repo = Repository(session)

            # 4.1 查旧版本和旧类别（删除时要用旧 collection）
            old_ver = await repo.get_current_version(doc_id)
            if old_ver:
                old_version_id = old_ver.id

            old_doc = await repo.get_document_by_id(doc_id)
            if old_doc and old_doc.category_id:
                old_category_code = await repo.get_category_code(old_doc.category_id)

            # 4.2 旧版本 is_current=false
            await repo.deactivate_old_versions(doc_id)

            # 4.3 新类别
            category_code = meta.get("category_code", "uncategorized")
            category_id = await repo.find_category_id(category_code)
            if not category_id:
                category_code = "uncategorized"
                category_id = await repo.find_category_id(category_code)
                if not category_id:
                    raise ValueError("缺少 uncategorized 兜底类别")

            # 4.4 更新文档主表
            await repo.update_document_meta(
                doc_id,
                title=new_title,
                summary=meta.get("summary"),
                document_no=new_doc_no,
                category_id=category_id,
            )

            # 4.5 插入新版本
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

            # 4.6 插入新 sections
            sections = _to_section_models(chunks, ver_id)
            await repo.insert_sections(sections)

            await session.commit()

            # 4.7 事务内提取成纯对象，避免 DetachedInstanceError
            class _Row:
                __slots__ = ("id", "content", "chunk_index", "heading",
                             "section_label", "page_start", "page_end")
                def __init__(self, s):
                    self.id = s.id
                    self.content = s.content
                    self.chunk_index = s.chunk_index
                    self.heading = s.heading
                    self.section_label = s.section_label
                    self.page_start = s.page_start
                    self.page_end = s.page_end

            chroma_rows = [_Row(s) for s in sections]

        # ========== 5. Chroma：删旧向量 + 写新向量 ==========
        try:
            # 5.1 删旧版本向量（用旧 collection，防止 category 变更后找不到）
            if old_version_id and old_category_code:
                await loop.run_in_executor(
                    None,
                    lambda: vector_store.delete_by_version(
                        kb_id=old_category_code,
                        version_id=old_version_id,
                    ),
                )
            # 如果 category 没变，前面已经删过；如果变了，这里不需要再删新 collection

            # 5.2 写新向量
            await loop.run_in_executor(
                None,
                lambda: vector_store.add_sections(
                    kb_id=category_code,
                    document_id=doc_id,
                    version_id=ver_id,
                    sections=chroma_rows,
                ),
            )
        except Exception:
            logger.exception(f"Chroma 更新失败 docId={doc_id}，标记 failed 待补偿")
            async with AsyncSessionLocal() as session:
                await Repository(session).update_document_status(doc_id, "failed")
                await session.commit()
            raise

        # ========== 6. 状态置 ready ==========
        async with AsyncSessionLocal() as session:
            await Repository(session).update_document_status(doc_id, "ready")
            await session.commit()

        logger.info(
            f"版本更新完成 fileId={file_id} docId={doc_id} "
            f"oldVerId={old_version_id} newVerId={ver_id} chunks={len(chroma_rows)}"
        )
        return doc_id, ver_id, len(chroma_rows)

    except Exception as e:
        logger.exception(f"版本更新失败 fileId={file_id}")
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