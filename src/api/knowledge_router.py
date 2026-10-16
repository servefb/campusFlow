

import logging

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from src.agent.rag_worker import ingest_service as kb
from src.api.audit import audited, from_data, from_path
from src.jwt.JWTAuthMiddleware import get_current_user_id
from src.models.common_responce import result

logger = logging.getLogger(__name__)

knowledge_router = APIRouter(prefix="/knowledge")


class IngestRequest(BaseModel):
    fileId: int = Field(..., description="Java 侧的文件 id（files.id），同时是幂等键")
    categoryId: int = Field(
        ..., description="人工指定的分类 id，取自 Java 的 GET /knowledge/categories",
    )

    title: str | None = Field(None, description="可选：人工指定标题，优先级高于 LLM 抽取")
    documentNo: str | None = Field(None, description="可选：人工指定文号")
    effectiveFrom: str | None = Field(
        None, description="可选：生效日期 YYYY-MM-DD，优先级高于 LLM 抽取")
    versionNo: str | None = Field(None, description="可选：版本号，默认 1.0")
    retry: bool = Field(False, description="上次失败后需显式重试；已 ready 时重跑也要带上")


def _err(exc: Exception):
    reason = getattr(exc, "reason", "invalid_argument")
    # 409 = 状态冲突（失败未确认要重试 / 文件还没扫描完），改条件后重发即可；
    # 404 = 目标不存在（重建索引时 documentId 查不到）；
    # 400 = 参数或文件本身不合法（分类不存在、用途不对、已删除）。
    #
    # ⚠️ 与 Java 侧同一个口径：业务码走**响应体**，HTTP 状态仍是 200
    # （FastAPI 返回的是 dict，不是带状态码的响应）。前端必须读 body.code，
    # 不能只看 HTTP 状态 —— 否则「文档不存在」会被当成导出/操作成功。
    if reason in ("retry_required", "file_not_ready"):
        code = 409
    elif reason == "not_found":
        code = 404
    else:
        code = 400
    payload = result(code, str(exc)).error()
    payload["data"] = {"reason": reason}
    return payload


@knowledge_router.get("/pending-files")
async def pending_files(limit: int = 50, user_id=Depends(get_current_user_id)):
    """待入库文件：上传过、但还没成功进知识库的那些。

    只含 purpose=knowledge_doc 的上传（上传那一刻就声明了「这是给知识库的」），
    所以头像、办事材料、新闻封面不会出现。每条带 ingestStatus：
      none    —— 从未确认入库，管理员可以点「加入知识库」
      failed  —— 上次入库失败，可点「重试」
      removed —— 曾入库后被移出，想恢复就再点一次「加入知识库」
    """
    try:
        data = await kb.list_pending_files(limit=limit)
    except Exception as exc:
        logger.exception("查询待入库文件失败")
        return result(500, f"查询待入库文件失败: {exc}").error()
    return result.success(data={"items": data})


@knowledge_router.post("/ingest")
@audited(
    action="knowledge.ingest",
    resource_type="knowledge_document",
    # 库里没有「文件」这个资源：真正被操作的是知识库文档，成功时才知道 id；
    # 被「分类不存在」挡回来时拿不到，那行记录靠 after_data 里的 fileId 追。
    resource_id=from_data("documentId"),
    detail=lambda kwargs, data: {
        "fileId": kwargs["req"].fileId,
        "categoryId": kwargs["req"].categoryId,
        "retry": kwargs["req"].retry,
        "documentId": (data or {}).get("documentId"),
        "status": (data or {}).get("status"),
        "reused": (data or {}).get("reused"),
    },
)
async def ingest(req: IngestRequest, request: Request,
                 user_id=Depends(get_current_user_id)):
    """确认把某个已上传的文件加入知识库。

    立即返回状态（通常为 processing），真正的解析/向量化在后台跑；
    前端轮询 `GET /knowledge/ingest/{fileId}` 看结果。
    重复调用是安全的：正在处理或已入库时直接返回既有状态（reused=true）。
    """
    try:
        data = await kb.start_ingest(
            file_id=req.fileId,
            category_id=req.categoryId,
            user_id=user_id,
            title=req.title,
            document_no=req.documentNo,
            effective_from=req.effectiveFrom,
            version_no=req.versionNo,
            retry=req.retry,
        )
    except kb.IngestError as exc:
        return _err(exc)
    except Exception as exc:
        logger.exception(f"触发入库失败 fileId={req.fileId}")
        return result(500, f"触发入库失败: {exc}").error()
    return result.success(data=data)


@knowledge_router.get("/ingest/{file_id}")
async def ingest_status(file_id: int, user_id=Depends(get_current_user_id)):
    """按上传文件 id 查入库状态，前端轮询用。

    status: none（尚未确认入库）| processing | ready | failed | removed
    failed 时 data.error 给出失败原因，前端可据此提供「重试」按钮
    （重试时调 POST /knowledge/ingest 并带 retry=true）。
    """
    try:
        data = await kb.get_ingest_status(file_id=file_id)
    except Exception as exc:
        logger.exception(f"查询入库状态失败 fileId={file_id}")
        return result(500, f"查询入库状态失败: {exc}").error()
    return result.success(data=data)


@knowledge_router.get("/documents/removed")
async def removed_documents(
        query: str | None = None,
        category: str | None = None,
        page: int = 1,
        page_size: int = 8,
        user_id=Depends(get_current_user_id)):
    """已移出知识库的文档列表（管理端「移除知识库」页签）。

    ⚠️ 必须声明在 `GET /documents/{document_id}` **之前**：FastAPI 按声明顺序匹配，
    若顺序颠倒，"removed" 会被拿去解析 document_id(int) 直接 422。

    query / category 是页签共享检索框的透传（口径同 Java 文档列表：
    query LIKE 标题/文号/摘要，category 为分类名精确匹配，不存在的分类回空页）。
    响应分页包络：data.items / page / page_size / total / has_more；
    item 字段对齐 Java 文档列表（title / document_no / issuer / category /
    updated_at…，另补 removed_at），缺的字段前端显示「未回传」。
    """
    try:
        data = await kb.list_removed_documents(
            query=query, category=category, page=page, page_size=page_size,
        )
    except Exception as exc:
        logger.exception("查询已移出文档列表失败")
        return result(500, f"查询已移出文档列表失败: {exc}").error()
    return result.success(data=data)


@knowledge_router.get("/documents/{document_id}")
async def document_detail(document_id: int, user_id=Depends(get_current_user_id)):
    """文档详情（含当前版本、分块数、分类）。"""
    try:
        data = await kb.get_document_detail(document_id=document_id)
    except kb.IngestError as exc:
        return _err(exc)
    except Exception as exc:
        logger.exception(f"查询文档详情失败 documentId={document_id}")
        return result(500, f"查询文档详情失败: {exc}").error()
    return result.success(data=data)


@knowledge_router.post("/documents/{document_id}/remove")
@audited(
    action="knowledge.remove",
    resource_type="knowledge_document",
    resource_id=from_path("document_id"),
    # 响应契约只有 {"id": ...}（前端不依赖状态回显），审计里能拿到的就这一个
    detail=lambda kwargs, data: {
        "documentId": kwargs.get("document_id"),
        "id": (data or {}).get("id"),
    },
)
async def remove_document(document_id: int, request: Request,
                          user_id=Depends(get_current_user_id)):
    """把文档移出知识库（删向量，行保留为软删留痕）。

    🔴 移出判据唯一 = knowledge_documents.deleted_at IS NOT NULL（status 枚举里
    没有 'removed'，不写状态）。响应契约：`{ "code": 0, "data": { "id": 123 } }`。
    """
    try:
        data = await kb.remove_document(document_id=document_id)
    except kb.IngestError as exc:
        return _err(exc)
    except Exception as exc:
        logger.exception(f"移出知识库失败 documentId={document_id}")
        return result(500, f"移出知识库失败: {exc}").error()
    return result.success(data=data)


@knowledge_router.post("/documents/{document_id}/reindex")
@audited(
    action="knowledge.reindex",
    resource_type="knowledge_document",
    resource_id=from_path("document_id"),
    detail=lambda kwargs, data: {
        "documentId": kwargs.get("document_id"),
        "versionId": (data or {}).get("versionId"),
        "status": (data or {}).get("status"),
    },
)
async def reindex_document(document_id: int, request: Request,
                           user_id=Depends(get_current_user_id)):
    """重新解析并重建索引（管理端「重建索引」按钮）。

    为什么这个接口在**这里**（AI 服务 `/api/v2`）而不是 Java 的 `/api/v1`：
    它要真的跑解析器、重新分块、重写向量，只有这边有那套代码。
    Java 侧就算加一个同名路径，也只能返回「任务已创建」然后什么都不做 ——
    那正是本工程已经在「新闻同步」上犯过的错（那里刻意改成回 501 而不是假成功）。

    ⚠️ 与其他几个动作（上线 / 下线 / 处理冲突）不同，那几个只改数据库状态，
    留在 Java 的 `/knowledge/admin/*` 下，两边不要互相搬。

    返回与 `POST /knowledge/ingest` 同构：`documentId / versionId / status / reused / ...`。
    **秒回**，真正的活在后台跑，状态去 `GET /knowledge/ingest/{fileId}` 轮询
    （status ∈ processing → ready / failed）。
    """
    try:
        data = await kb.reindex_document(document_id=document_id, user_id=user_id)
    except kb.IngestError as exc:
        return _err(exc)
    except Exception as exc:
        logger.exception(f"重建索引失败 documentId={document_id}")
        return result(500, f"重建索引失败: {exc}").error()
    return result.success(data=data)
