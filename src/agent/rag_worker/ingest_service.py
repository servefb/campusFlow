"""知识库入库编排 —— 取代原 RabbitMQ 消费链路。

对外只有一个入口 `start_ingest`，由 HTTP 接口（knowledge_router）调用：

  1. **分类由管理员人工指定**（categoryCode 参数），不再由 LLM 猜。
     LLM 只负责从正文提炼标题/摘要/文号/日期这些「人工看也未必更准」的字段。
  2. **幂等**：同一个 fileId 已有 processing / ready 记录时不重复入库，
     直接返回既有状态（前端连点、网络重发都安全）。
  3. **两阶段落库**：先以 status=processing 建 document + version 并立刻返回，
     后台任务再跑「下载 MinIO → 解析分块 → LLM 抽元数据 → 写 sections → 写 Chroma」。
     于是「入库状态」在 MySQL 里有唯一的事实来源，前端轮询
     `GET /knowledge/ingest/{fileId}` 即可 —— 不再需要把执行结果回执给 Java。

状态取值（knowledge_documents.status / knowledge_document_versions.status）：
    processing → ready | failed
    移出不留状态值：判据 = knowledge_documents.deleted_at IS NOT NULL（见下）

失败重试复用同一条 version 记录（清掉上次的 sections 与向量），不堆版本号。
"""

import asyncio
import logging
import os
from datetime import date, datetime
from typing import Optional

from src.agent.llm.llm_node import model
from src.agent.rag_worker.chunk import parse_and_chunk
from src.agent.rag_worker.extractor import (
    llm_extract_meta, extract_title, extract_document_no,
    extract_published_at, extract_effective_from,
)
from src.agent.rag_worker.minio_client import download
from src.agent.rag_worker.repository import Repository
from src.agent.vectorstore.chroma_vectorstore import VectorStore
from src.db.basic_config import AsyncSessionLocal
from src.db.db_Knowledge import KnowledgeDocument, KnowledgeDocumentVersion

logger = logging.getLogger(__name__)

PROCESSING = "processing"
READY = "ready"
FAILED = "failed"
# 🔴 「已移出」**没有** status 值：库枚举里不含 'removed'（写进去会静默变空串），
# 判据唯一 = knowledge_documents.deleted_at IS NOT NULL，状态保持原值（通常是 ready）。
# 这与 Java 侧「软删一律 deleted_at IS NOT NULL」的口径天然一致。

# processing 卡住多久算僵死、允许重新触发。进程中途挂掉会让任务丢失，
# 没有这个兜底那条记录就永远停在 processing，所以必须留一个出口。
STALE_PROCESSING_SECONDS = 30 * 60


class IngestError(Exception):
    """参数或状态不合法 —— 由路由层转成 4xx，不要当成系统故障。

    reason 供前端区分处理：
      invalid_category —— 分类不存在，前端应刷新下拉列表；
      retry_required   —— 上次入库失败，需带 retry=true 显式重来；
      invalid_argument —— 其它参数问题。
    """

    def __init__(self, message: str, reason: str = "invalid_argument"):
        super().__init__(message)
        self.reason = reason


# --------------------------------------------------------------------------
# 后台任务：create_task 的返回值必须留强引用，否则可能被 GC 掉导致任务半途消失
# --------------------------------------------------------------------------
_BACKGROUND_TASKS: set = set()


def spawn(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)
    return task


# --------------------------------------------------------------------------
# 小工具
# --------------------------------------------------------------------------
def _parser_name(file_name: str) -> str:
    import os
    ext = os.path.splitext(file_name)[1].lower()
    return {
        ".pdf": "pypdf", ".docx": "python-docx",
        ".xlsx": "openpyxl", ".xls": "openpyxl",
        ".md": "markdown", ".txt": "plain",
    }.get(ext, "unknown")


def _parse_dt(value, as_date: bool = False):
    """LLM 给的是 'YYYY-MM-DD' 字符串，DB 列是 DateTime / Date。

    解析失败一律返回 None —— 元数据日期缺失不该让整次入库失败。
    """
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date() if as_date else value
    if isinstance(value, date):
        return value if as_date else datetime(value.year, value.month, value.day)
    try:
        d = datetime.strptime(str(value).strip()[:10], "%Y-%m-%d")
    except ValueError:
        logger.warning(f"日期无法解析，已忽略: {value!r}")
        return None
    return d.date() if as_date else d


class _SectionRow:
    """事务外要用的纯对象快照（避免 session 关闭后碰 detached 实例）。"""

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


def _to_section_models(chunks, version_id: int):
    from src.db.db_Knowledge import KnowledgeSection
    sections = []
    for c in chunks:
        m = c.metadata
        chapter_no=m.get("chapter_no")
        sections.append(KnowledgeSection(
            version_id=version_id,
            chunk_index=m["chunkIndex"],
            content=c.page_content,
            heading=m.get("heading"),
            chapter_no=chapter_no,
            article_no=m.get("article_no"),
            section_label=m.get("section_label"),
            page_start=m.get("page"),
            page_end=m.get("page"),
            token_count=m.get("token_count"),
            meta={"source": m.get("source"), "chunkTotal": m.get("chunkTotal")},
        ))
    return sections


def _is_stale(ver) -> bool:
    updated = ver.updated_at
    if not updated:
        return True
    return (datetime.now() - updated).total_seconds() > STALE_PROCESSING_SECONDS


async def resolve_category(session, category_id: Optional[int]):
    """校验管理员选的分类存在，并取回它的 code。返回 (id, code)。

    为什么入口是 id 而不是 code：分类下拉用的是 Java 的 `GET /knowledge/categories`，
    它返回的是 `knowledge_categories.id`（**没有 code 字段**）。两边共库同一张表，
    前端把 id 原样传回来最省事，也让「前端能选到的分类」与「后端校验的分类」
    天然是同一集合。

    刻意不兜底 uncategorized：分类是管理员点的，点了一个不存在的分类属于调用方
    bug，静默落到 uncategorized 只会让检索莫名其妙地缺东西。

    返回的 code 用作 Chroma collection 名（检索侧 `search_with_db` 的 kb_id 也是
    这个 code），必须与 `knowledge_categories.code` 一致，否则写进去也检不出来。
    """
    if not category_id:
        raise IngestError("必须指定分类（categoryId）", "invalid_category")
    code = await Repository(session).get_category_code(category_id)
    if not code:
        raise IngestError(f"分类不存在: categoryId={category_id}", "invalid_category")
    return int(category_id), code


async def _require_file(repo: Repository, file_id: int) -> dict:
    """确认这个上传文件可以入库，并补齐 MinIO 定位信息。

    检查顺序刻意如此：先确认文件存在与用途，再确认扫描通过。若文件还在扫描中就放行，
    入库任务会去 MinIO 拉一个可能已被安全策略移走的对象，失败要到几分钟后才以
    「下载失败」的形式暴露 —— 比在这里当场说清楚难查得多。

    ready 是硬校验（文档第 9 章第 3 条：扫描通过前业务接口不得引用该 file_id）。
    前端本来就会轮询到 ready 才让管理员点确认，所以正常路径下必然满足；
    真报出来 status=uploaded/scanning 说明 Java 的状态机没往前推，该去查那边。
    """
    meta = await repo.load_file_meta(file_id)
    if not meta:
        raise IngestError(f"上传文件不存在或已删除: fileId={file_id}", "invalid_file")
    if meta["purpose"] != "knowledge_doc":
        raise IngestError(
            f"该文件的上传用途是 {meta['purpose']}，不是知识库资料", "invalid_file")
    if meta["status"] in ("rejected", "deleted"):
        raise IngestError(f"文件未通过安全扫描（status={meta['status']}）", "invalid_file")
    if meta["status"] != "ready":
        raise IngestError(
            f"文件尚未通过安全扫描（status={meta['status']}），请稍后再试", "file_not_ready")
    if not meta.get("object_key"):
        raise IngestError("文件缺少对象存储定位信息（object_key）", "invalid_file")

    bucket = os.getenv("MINIO_BUCKET_NAME")
    if not bucket:
        raise IngestError("服务器未配置 MINIO_BUCKET_NAME", "server_misconfigured")
    return {**meta, "bucket": bucket}


async def list_pending_files(limit: int = 50) -> list:
    """待入库文件（已上传、尚未成功进知识库）。"""
    async with AsyncSessionLocal() as session:
        return await Repository(session).list_pending_files(limit)


# --------------------------------------------------------------------------
# 入口：触发入库
# --------------------------------------------------------------------------
async def start_ingest(
        *,
        file_id: int,
        category_id: int,
        user_id: Optional[int],
        title: Optional[str] = None,
        document_no: Optional[str] = None,
        effective_from: Optional[str] = None,
        version_no: Optional[str] = None,
        retry: bool = False,
) -> dict:
    """登记一次入库并调度后台任务。返回给前端的就是「当前状态」。

    bucket / object_key / file_name 都不由调用方提供，而是按 file_id 从 Java
    写入的 files 表读出 —— 前端拿不到这些字段（见 _require_file 的说明）。

    返回 dict：{fileId, documentId, versionId, status, reused, chunkCount, error}
    """
    async with AsyncSessionLocal() as session:
        repo = Repository(session)
        category_id, category_code = await resolve_category(session, category_id)
        file_meta = await _require_file(repo, file_id)
        bucket = file_meta["bucket"]
        object_key = file_meta["object_key"]
        file_name = file_meta["original_name"]

        ver = await repo.find_version_by_source_file_id(file_id)
        if ver:
            doc = await repo.get_document_by_id(ver.document_id)
            if doc and doc.deleted_at is not None:
                # 曾移出知识库的文件再入库 → 当作全新入库，不复用旧记录
                ver, doc = None, None

        if ver:
            if ver.status == PROCESSING and not _is_stale(ver):
                logger.info(f"fileId={file_id} 正在入库中，忽略重复触发")
                return _status_payload(ver, doc, reused=True)

            if ver.status == READY and not retry:
                logger.info(f"fileId={file_id} 已在库中(ready)，忽略重复触发")
                return _status_payload(ver, doc, reused=True)

            if ver.status == FAILED and not retry:
                # 失败要管理员显式点「重试」，避免前端转一圈就自动重跑烧 LLM
                payload = _status_payload(ver, doc, reused=True)
                raise IngestError(
                    f"上次入库失败，需显式重试: {payload.get('error') or '未知原因'}",
                    "retry_required",
                )

            # 到这里是「重试」或「processing 已僵死」或「ready 且显式重试」：
            # 复用同一条版本记录，清干净再来一遍
            doc_id, ver_id = ver.document_id, ver.id
            old_code = await repo.get_category_code(doc.category_id) if (doc and doc.category_id) else None

            await repo.delete_sections_by_version(ver_id)
            await repo.update_version_fields(
                ver_id, status=PROCESSING, chunk_count=0, meta={"source": file_name},
            )
            await repo.update_document_fields(
                doc_id, status=PROCESSING, category_id=category_id,
            )
            await session.commit()

            # 向量清理放事务外：先删旧 collection（分类可能变了），再删新 collection 防残留
            for code in {old_code, category_code} - {None}:
                try:
                    await asyncio.get_running_loop().run_in_executor(
                        None, VectorStore.delete_by_version, code, ver_id,
                    )
                except Exception:
                    logger.exception(f"重试前清理旧向量失败 code={code} versionId={ver_id}")

            spawn(run_ingest(
                document_id=doc_id, version_id=ver_id, file_id=file_id,
                bucket=bucket, object_key=object_key, file_name=file_name,
                category_code=category_code, user_id=user_id,
                title=title, document_no=document_no,
                effective_from=effective_from, version_no=version_no,
            ))
            logger.info(f"重试入库已调度 fileId={file_id} docId={doc_id} verId={ver_id}")
            return {
                "fileId": file_id, "documentId": doc_id, "versionId": ver_id,
                "status": PROCESSING, "reused": True,
                "chunkCount": 0, "error": None,
            }

        # ---------- 全新入库 ----------
        doc = KnowledgeDocument(
            category_id=category_id,
            title=title or _fallback_title(file_name),
            document_no=document_no,
            issuer_level="school",
            validity="current",
            visibility="campus",
            status=PROCESSING,
            created_by=user_id,
        )
        doc_id = await repo.insert_document(doc)

        ver = KnowledgeDocumentVersion(
            document_id=doc_id,
            source_file_id=file_id,
            version_no=version_no or "1.0",
            is_current=True,
            status=PROCESSING,
            chunk_count=0,
            meta={"source": file_name},
            created_by=user_id,
        )
        ver_id = await repo.insert_version(ver)
        await session.commit()

    spawn(run_ingest(
        document_id=doc_id, version_id=ver_id, file_id=file_id,
        bucket=bucket, object_key=object_key, file_name=file_name,
        category_code=category_code, user_id=user_id,
        title=title, document_no=document_no,
        effective_from=effective_from, version_no=version_no,
    ))
    logger.info(
        f"入库已调度 fileId={file_id} docId={doc_id} verId={ver_id} category={category_code}"
    )
    return {
        "fileId": file_id, "documentId": doc_id, "versionId": ver_id,
        "status": PROCESSING, "reused": False, "chunkCount": 0, "error": None,
    }


def _fallback_title(file_name: str) -> str:
    import os
    return os.path.splitext(file_name or "")[0].strip() or "未命名文档"


# --------------------------------------------------------------------------
# 后台：真正干活的一段
# --------------------------------------------------------------------------
async def run_ingest(
        *,
        document_id: int,
        version_id: int,
        file_id: int,
        bucket: str,
        object_key: str,
        file_name: str,
        category_code: str,
        user_id: Optional[int],
        title: Optional[str] = None,
        document_no: Optional[str] = None,
        effective_from: Optional[str] = None,
        version_no: Optional[str] = None,
):
    tmp_path = None
    loop = asyncio.get_running_loop()
    try:
        # 1. 下载 + 解析分块（都是同步阻塞，丢线程池）
        tmp_path = await loop.run_in_executor(None, download, bucket, object_key)
        chunks = await loop.run_in_executor(None, parse_and_chunk, tmp_path, file_name)
        if not chunks:
            raise ValueError(f"文件解析后无内容: {file_name}")
        full_text = "\n".join(c.page_content for c in chunks)

        # 2. LLM 抽元数据（不含分类）
        #    ★ 降级而非中断：元数据是「锦上添花」，正文分块才是入库的必需品；
        #      下面每个字段都有正则/文件名兜底，所以模型抽失败不该把整篇文档卡在 FAILED。
        #      （09-21 就是这么挂的：extractor 取了 OpenAI 原生 SDK 的 .choices，
        #        异常冒泡后 document status=FAILED、正文白解析一遍。）
        try:
            meta = await loop.run_in_executor(
                None, llm_extract_meta, model, file_name, full_text
            )
        except Exception:
            logger.warning(f"LLM 元数据抽取失败，改用规则兜底 fileId={file_id}", exc_info=True)
            meta = {}
        if not isinstance(meta, dict):
            meta = {}

        # 3. 落库：元数据 + sections（人工传入的 title/document_no 优先于 LLM）
        async with AsyncSessionLocal() as session:
            repo = Repository(session)
            await repo.update_document_fields(
                document_id,
                title=title or meta.get("title") or extract_title(file_name, full_text),
                summary=meta.get("summary"),
                document_no=(document_no or meta.get("document_no")
                             or extract_document_no(full_text)),
                published_at=(_parse_dt(meta.get("published_at"))
                              or _parse_dt(extract_published_at(full_text))),
                effective_from=(_parse_dt(effective_from, as_date=True)
                                or _parse_dt(meta.get("effective_from"), as_date=True)
                                or _parse_dt(extract_effective_from(full_text), as_date=True)),
            )
            sections = _to_section_models(chunks, version_id)
            await repo.insert_sections(sections)
            await repo.update_version_fields(
                version_id,
                chunk_count=len(sections),
                page_count=chunks[0].metadata.get("pageCount") if chunks else None,
                parser_name=_parser_name(file_name),
            )
            await session.commit()
            rows = [_SectionRow(s) for s in sections]

        # 4. 写 Chroma（外部系统，放事务外；分类用人工指定的 code 作 collection）
        await loop.run_in_executor(
            None, VectorStore.add_sections,
            category_code, document_id, version_id, rows,
        )

        # 5. 两处状态一起置 ready
        async with AsyncSessionLocal() as session:
            repo = Repository(session)
            await repo.update_document_fields(document_id, status=READY)
            await repo.update_version_status(version_id, READY)
            await session.commit()

        # 6. 冲突扫描（规则层 + LLM 语义层）→ knowledge_conflicts（pending），
        #    管理端「冲突列表」读的就是这张表。★ 只降级不中断：
        #    扫描挂了入库照样 ready —— 冲突提示是锦上添花，入库失败才是事故。
        try:
            from src.agent.rag_worker.conflict_scan import scan_conflicts
            cstats = await scan_conflicts(
                document_id=document_id,
                category_code=category_code,
                chunk_texts=[c.page_content for c in chunks],
                title=title or meta.get("title"),
                document_no=document_no or meta.get("document_no"),
            )
            if cstats.get("total"):
                logger.info(
                    f"冲突扫描发现疑似冲突 docId={document_id} "
                    f"rule={cstats['rule']} semantic={cstats['semantic']}"
                )
        except Exception:
            logger.exception(f"冲突扫描异常（不影响入库结果）docId={document_id}")

        logger.info(
            f"入库完成 fileId={file_id} docId={document_id} "
            f"verId={version_id} category={category_code} chunks={len(rows)}"
        )

    except Exception as e:
        logger.exception(f"入库失败 fileId={file_id} docId={document_id}")
        try:
            async with AsyncSessionLocal() as session:
                repo = Repository(session)
                await repo.update_document_fields(document_id, status=FAILED)
                await repo.update_version_status(version_id, FAILED)
                await repo.update_version_fields(
                    version_id,
                    meta={"source": file_name, "error": str(e)[:1000]},
                )
                await session.commit()
        except Exception:
            logger.exception("标记失败状态也失败")
    finally:
        import os
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


# --------------------------------------------------------------------------
# 查询 / 移出
# --------------------------------------------------------------------------
def _status_payload(ver, doc, reused: bool) -> dict:
    return {
        "fileId": ver.source_file_id,
        "documentId": ver.document_id,
        "versionId": ver.id,
        "status": ver.status,
        "reused": reused,
        "chunkCount": ver.chunk_count,
        "error": (ver.meta or {}).get("error"),
    }


async def get_ingest_status(*, file_id: int) -> dict:
    """前端轮询用。没有记录 = 这个文件还没被确认入库（status=none）。"""
    async with AsyncSessionLocal() as session:
        repo = Repository(session)
        ver = await repo.find_version_by_source_file_id(file_id)
        if not ver:
            return {
                "fileId": file_id, "status": "none", "documentId": None,
                "versionId": None, "title": None, "categoryCode": None,
                "chunkCount": None, "pageCount": None, "parserName": None,
                "error": None, "updatedAt": None,
            }
        doc = await repo.get_document_by_id(ver.document_id)
        category_code = None
        if doc and doc.category_id:
            category_code = await repo.get_category_code(doc.category_id)
        return {
            "fileId": file_id,
            "status": ver.status,
            "documentId": ver.document_id,
            "versionId": ver.id,
            "title": doc.title if doc else None,
            "categoryCode": category_code,
            "chunkCount": ver.chunk_count,
            "pageCount": ver.page_count,
            "parserName": ver.parser_name,
            "error": (ver.meta or {}).get("error"),
            "updatedAt": ver.updated_at.isoformat() if ver.updated_at else None,
        }


async def get_document_detail(*, document_id: int) -> dict:
    async with AsyncSessionLocal() as session:
        repo = Repository(session)
        doc = await repo.get_document_by_id(document_id)
        if not doc:
            raise IngestError(f"文档不存在: {document_id}")
        cur = await repo.get_current_version(document_id)
        category_code = None
        if doc.category_id:
            category_code = await repo.get_category_code(doc.category_id)
        section_count = await repo.count_sections(cur.id) if cur else 0
        return {
            "documentId": doc.id,
            "title": doc.title,
            "summary": doc.summary,
            "documentNo": doc.document_no,
            "status": doc.status,
            "categoryCode": category_code,
            "visibility": doc.visibility,
            "publishedAt": doc.published_at.isoformat() if doc.published_at else None,
            "effectiveFrom": doc.effective_from.isoformat() if doc.effective_from else None,
            "createdAt": doc.created_at.isoformat() if doc.created_at else None,
            "currentVersion": None if not cur else {
                "versionId": cur.id,
                "sourceFileId": cur.source_file_id,
                "versionNo": cur.version_no,
                "status": cur.status,
                "chunkCount": cur.chunk_count,
                "pageCount": cur.page_count,
                "parserName": cur.parser_name,
            },
            "sectionCount": section_count,
        }


async def list_removed_documents(
        *,
        query: Optional[str] = None,
        category: Optional[str] = None,
        page: int = 1,
        page_size: int = 8,
) -> dict:
    """已移出知识库的文档列表（管理端「移除知识库」页签）。

    判据 = `knowledge_documents.deleted_at IS NOT NULL`（向量在移出那一刻已删干净，
    所以这份数据与向量库天然一致 —— 不需要再去向量库反查「缺了谁」）。

    检索口径与 Java 文档列表对齐：
      query    —— LIKE title / document_no / summary；
      category —— 分类**名称**精确匹配（Java resolveCategoryIds 同款）；
                  指定了不存在的分类 → 空页，绝不退回「不过滤」。
    分页包络：{items, page, page_size, total, has_more}。
    """
    page = max(1, int(page or 1))
    page_size = min(max(1, int(page_size or 8)), 100)
    keyword = (query or "").strip() or None
    category_name = (category or "").strip() or None

    empty = {"items": [], "page": page, "page_size": page_size,
             "total": 0, "has_more": False}

    async with AsyncSessionLocal() as session:
        repo = Repository(session)
        category_ids = None
        if category_name:
            category_ids = await repo.get_category_ids_by_name(category_name)
            if not category_ids:
                return empty
        total = await repo.count_removed_documents(keyword, category_ids)
        if total == 0:
            return empty
        rows = await repo.list_removed_documents(
            keyword, category_ids,
            offset=(page - 1) * page_size, limit=page_size,
        )

    items = [_removed_item(r) for r in rows]
    return {
        "items": items, "page": page, "page_size": page_size,
        "total": total, "has_more": page * page_size < total,
    }


def _removed_item(r: dict) -> dict:
    """字段口径对齐 Java 文档列表 KnowledgeDocumentVo（snake_case），缺的留给前端显示「未回传」。

    补充一个契约外字段 removed_at（= deleted_at）—— 移除页签最关心的就是「什么时候移的」。
    """
    return {
        "id": r["id"],
        "title": r["title"],
        "document_no": r["document_no"],
        "issuer": r["issuer"],
        "category": r["category"],
        "validity": r["validity"],
        "status": r["status"],
        "published_at": r["published_at"].isoformat() if r["published_at"] else None,
        "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
        "removed_at": r["removed_at"].isoformat() if r["removed_at"] else None,
    }


async def remove_document(*, document_id: int) -> dict:
    """移出知识库：删向量 + deleted_at 打软删戳，不物理删行。

    🔴 **判据唯一 = deleted_at IS NOT NULL**（状态保持原值，不改写成 removed ——
    枚举里没有这个值）。保留行是为了留痕（谁、什么时候移出的），也供
    「已移出」列表展示；同一文件日后重新入库会建**新** document 行，旧行留作痕迹。

    顺序刻意是「先删向量、成功后才写 deleted_at」：向量删除失败就抛错，
    库里一个字都不动 —— 不会出现「列表里显示已移出、向量却还能被检索到」的脏状态。

    返回契约：`{"id": document_id}`，前端不依赖状态回显；重复移出是幂等的成功。
    """
    async with AsyncSessionLocal() as session:
        repo = Repository(session)
        doc = await repo.get_document_by_id(document_id)
        if not doc:
            raise IngestError(f"文档不存在: {document_id}")
        if doc.deleted_at is not None:
            return {"id": document_id}
        category_code = await repo.get_category_code(doc.category_id) if doc.category_id else None
        cur = await repo.get_current_version(document_id)
        cur_id = cur.id if cur else None

    if category_code:
        try:
            await asyncio.get_running_loop().run_in_executor(
                None, VectorStore.delete_document, category_code, document_id,
            )
        except Exception:
            logger.exception(f"移出知识库时删向量失败 docId={document_id}")
            raise IngestError("删除向量失败，未变更状态，请稍后重试")

    async with AsyncSessionLocal() as session:
        repo = Repository(session)
        await repo.mark_document_removed(document_id)
        if cur_id:
            # 版本只下线（is_current=false）；status 保持原值，不写 'removed'
            await repo.update_version_fields(cur_id, is_current=False)
        await session.commit()

    logger.info(f"已移出知识库 docId={document_id}")
    return {"id": document_id}


# --------------------------------------------------------------------------
# 重建索引（管理端「重建索引」按钮）
# --------------------------------------------------------------------------
async def reindex_document(*, document_id: int, user_id: Optional[int]) -> dict:
    """按**文档 id**重新解析并重建索引。

    管理端调的是 `POST /knowledge/documents/{id}/reindex`。之所以这个动作归 AI 服务
    而不是 Java 业务服务：它要真的跑解析器、重新分块、重新写向量 —— 那套东西只在
    这边有（`run_ingest`），Java 侧做不到，硬做就只能返回一个「任务已创建」的假成功。

    ## 实现方式：复用入库链路，而不是另写一套解析

    `start_ingest(retry=True)` 做的事实上就是「重建索引」：
      1. 复用**同一条**版本记录（不新建版本、不涨版本号）；
      2. `delete_sections_by_version` 清掉旧分块；
      3. `VectorStore.delete_by_version` 清掉旧向量（旧 collection 与新 collection 都清，
         因为分类可能被改过）；
      4. 两处状态置回 `processing`，再 `spawn(run_ingest(...))` 从头跑一遍。

    另写一套解析的结局是两条路径慢慢分叉：某天修了 ingest 的解析 bug、
    reindex 那边没跟上，于是「重建索引」重建出来的东西和正常入库不一致，
    而这种不一致极难被发现。

    ## 与「入库」的差别只有入口

    入库入口是 `fileId`（刚上传的文件），重建索引入口是 `documentId`（库里已有的文档），
    后者要先反查出「当前版本 → source_file_id」再交给同一段逻辑。

    ## 返回

    与 `POST /knowledge/ingest` **完全同构**的载荷
    （`documentId / versionId / status / reused / chunkCount / error`）。
    ⚠️ 其中的 `reused` 在这里恒为 `True` —— 它表示「复用了已有版本记录」，
    不是「复用了已有任务」。前端别把它读成「什么都没干」。
    """
    async with AsyncSessionLocal() as session:
        repo = Repository(session)
        doc = await repo.get_document_by_id(document_id)
        if not doc:
            raise IngestError(f"文档不存在: documentId={document_id}", "not_found")
        if doc.deleted_at is not None:
            # 已移出的文档在库里留着痕（版本 is_current=false），走的是「重新加入」那条路
            raise IngestError(
                "该文档已移出知识库，请用「加入知识库」重新入库，而不是重建索引", "removed")

        ver = await repo.get_current_version(document_id)
        if not ver:
            raise IngestError(
                f"文档没有当前版本，无法重建索引: documentId={document_id}", "no_current_version")

        # 在 session 内取值：session 关闭后 ORM 对象已 detached，属性访问随时可能抛错
        file_id = ver.source_file_id
        category_id = doc.category_id

    if not file_id:
        raise IngestError("该版本的来源文件缺失（source_file_id 为空），无法重建索引", "no_source_file")
    if not category_id:
        # category_code 是 Chroma 的 collection 名，缺了就没法决定向量写哪儿
        raise IngestError("该文档没有分类，无法重建索引（分类决定向量写入哪个 collection）", "invalid_category")

    logger.info(f"重建索引已触发 docId={document_id} fileId={file_id}")
    return await start_ingest(
        file_id=file_id,
        category_id=category_id,
        user_id=user_id,
        retry=True,
    )
