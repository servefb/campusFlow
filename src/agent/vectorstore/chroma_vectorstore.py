import logging
import os
from functools import lru_cache

import chromadb
from langchain_chroma import Chroma

from src.agent.embedding_model.embedding_alli_model import get_embeddings

logger = logging.getLogger(__name__)

# 允许用环境变量覆盖，默认值保持与历史一致（内网 Chroma）。
CHROMA_HOST = os.getenv("CHROMA_HOST", "192.168.150.101")
CHROMA_PORT = int(os.getenv("CHROMA_PORT", "8000"))
CHROMA_SSL = os.getenv("CHROMA_SSL", "false").strip().lower() in ("1", "true", "yes")

BATCH_SIZE = 500


def _ensure_direct_route() -> None:
    """让内网 Chroma 走直连，别被 shell 里的 HTTP_PROXY 劫持。

    chromadb 内部建的是 `httpx.Client(timeout=None, ...)`，默认 trust_env=True，
    会去读 HTTP_PROXY / HTTPS_PROXY。而 Chroma 是内网地址（192.168.x.x），
    本来就该直连；一旦代理没在监听，连接会被直接拒绝（[WinError 10061]），
    现象极具误导性 —— 表现为「Chroma 服务明明是活着的，客户端却报连不上」。

    httpx 认 NO_PROXY，这里做幂等追加，不覆盖用户已有的其他配置。
    """
    bypass = ("127.0.0.1", "localhost", CHROMA_HOST)
    for var in ("NO_PROXY", "no_proxy"):
        cur = [x.strip() for x in os.environ.get(var, "").split(",") if x.strip()]
        os.environ[var] = ",".join(cur + [h for h in bypass if h not in cur])


@lru_cache(maxsize=1)
def _get_client() -> chromadb.ClientAPI:
    """惰性单例。★ 绝不能写成模块级 `_client = chromadb.HttpClient(...)`：

    `chromadb.HttpClient()` 构造时就会发一次真实请求（get_user_identity），
    放在模块顶层等于把「连没连上 Chroma」变成「能不能 import 这个模块」。
    而本模块的导入链是 main → conversation_router → conversations_repo →
    retriever_tool → 这里，于是 Chroma 一挂，整个 FastAPI 连启动都起不来
    （ValueError: Could not connect to a Chroma server）。

    现在只在真正用到时才建连；构建失败不会进 lru_cache，
    下次调用会重新尝试，Chroma 恢复后无需重启服务。
    """
    _ensure_direct_route()
    return chromadb.HttpClient(
        host=CHROMA_HOST,
        port=CHROMA_PORT,
        ssl=CHROMA_SSL,
    )


def _collection_name(kb_id: str) -> str:
    """统一加前缀，避免 Chroma 命名限制。"""
    return f"kb_{kb_id}"


@lru_cache(maxsize=128)
def get_vectorstore(kb_id: str) -> Chroma:
    """按 kbId 缓存 Chroma 实例，避免重复创建。"""
    return Chroma(
        client=_get_client(),
        collection_name=_collection_name(kb_id),
        embedding_function=get_embeddings(),
    )


class VectorStore:
    """Chroma 写入/删除/检索的封装。

    ★ 全部方法是 @staticmethod：调用方（ingest_service / retriever_tool）一律按
      `VectorStore.xxx(...)` 类名直调，从不实例化。历史上这几个方法漏写了
      @staticmethod，导致首参 self 吃掉第一个实参、每次写向量都抛 TypeError，
      入库必然失败（且失败的只是向量，PG 里看着像成功了）。
      新增方法请一并加 @staticmethod，不要退回实例方法。
    """

    @staticmethod
    def add_sections(kb_id: str, document_id: int,
                     version_id: int, sections: list):
        """
        sections: List[KnowledgeSection]，每个有 id、content、chunk_index、metadata
        """
        if not sections:
            return

        vs = get_vectorstore(kb_id)

        for i in range(0, len(sections), BATCH_SIZE):
            batch = sections[i:i + BATCH_SIZE]
            vs.add_texts(
                texts=[s.content for s in batch],
                ids=[f"section_{s.id}" for s in batch],
                metadatas=[{
                    "sectionId": s.id,
                    "documentId": document_id,
                    "versionId": version_id,
                    "categoryCode": kb_id,
                    "chunkIndex": s.chunk_index,
                    "heading": s.heading or "",
                    "sectionLabel": s.section_label or "",
                    "pageStart": s.page_start or 0,
                    "pageEnd": s.page_end or 0,
                } for s in batch],
            )
        logger.info(f"Chroma 写入 {len(sections)} 条，collection=kb_{kb_id}")

    @staticmethod
    def delete_document(kb_id: str, document_id: int):
        """删某个文档的所有 chunk（移出知识库、版本更新时用）。"""
        vs = get_vectorstore(kb_id)
        vs.delete(where={"documentId": document_id})
        logger.info(f"Chroma 删除 documentId={document_id}，collection=kb_{kb_id}")

    @staticmethod
    def delete_sections(kb_id: str, section_ids: list):
        """按 section_id 精确删除。"""
        if not section_ids:
            return
        vs = get_vectorstore(kb_id)
        vs.delete(ids=[f"section_{sid}" for sid in section_ids])

    @staticmethod
    def search_with_db(kb_id: str, question: str, k: int = 4, session=None):
        """从 kb_{kb_id} collection 检索，返回拼接好的文档片段文本。"""
        docs = get_vectorstore(kb_id).as_retriever(
            search_kwargs={"k": k}
        ).invoke(question)
        if not docs:
            return "未检索到相关文档"
        parts = []
        for i, d in enumerate(docs, 1):
            meta = d.metadata or {}
            parts.append(
                f"[{i}] documentId={meta.get('documentId')} "
                f"sectionId={meta.get('sectionId')} page={meta.get('pageStart')}\n"
                f"{d.page_content}"
            )
        return "\n\n".join(parts)

    @staticmethod
    def delete_by_version(kb_id: str, version_id: int):
        """按 versionId 精确删某个版本的向量，不影响同文档其他版本。"""
        vs = get_vectorstore(kb_id)
        vs.delete(where={"versionId": version_id})
        logger.info(f"Chroma 删除 versionId={version_id}，collection=kb_{kb_id}")
