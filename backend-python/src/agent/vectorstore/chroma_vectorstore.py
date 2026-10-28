import logging
import os
from functools import lru_cache

import chromadb
from langchain_chroma import Chroma
from langchain_core.documents import Document

from src.agent.embedding_model.embedding_alli_model import get_embeddings

logger = logging.getLogger(__name__)

# 允许用环境变量覆盖，默认值保持与历史一致（内网 Chroma）。
CHROMA_HOST = os.getenv("CHROMA_HOST", "192.168.150.100")
CHROMA_PORT = int(os.getenv("CHROMA_PORT", "8000"))
CHROMA_SSL = os.getenv("CHROMA_SSL", "false").strip().lower() in ("1", "true", "yes")

BATCH_SIZE = 500

# ---------- 检索参数 ----------
# k：一次取回多少块。原来是 4（4 × 512 字符 ≈ 2300 token），而模型窗口是 1M ——
# 这个预算卡得毫无必要，多文档问题（「奖学金有哪几类、分别什么条件」）4 块根本装不下。
RETRIEVE_K = int(os.getenv("RETRIEVE_K", "8"))
# 相对闸：只保留距离不超过「最佳 × RETRIEVE_REL_THRESHOLD」的块，切掉尾巴上的噪音。
# 1.5 是个刻意宽松的起步值：归一化向量上 l2²=2-2cos，1.5 倍大致相当于 cos 0.775，
# 只切明显沾不上边的。收紧前务必用 _rag_recall_eval.py 看真实分布 —— 切狠了是直接掉召回。
RETRIEVE_REL_THRESHOLD = float(os.getenv("RETRIEVE_REL_THRESHOLD", "1.5"))
# 绝对闸：最佳距离超过它就判定「库外问题」，整批丢弃。
# ★ 默认 0 = 关闭。距离尺度取决于 embedding 是否归一化，凭空设一个数只会
#   要么永不触发、要么全量误杀。先开着日志跑几天，看 best 的分布再定值。
RETRIEVE_MAX_DIST = float(os.getenv("RETRIEVE_MAX_DIST", "0"))
# 乘法闸在极小距离上几乎没有区分度（0.001 × 1.15 还是 0.00115），兜一个绝对余量。
RETRIEVE_MIN_GAP = 0.02
# 相对闸再狠也至少留这么多块。
# 实测依据：线上 27 块的真实库上跑 15 题，1.5 倍会把 1/3 的题裁到只剩 1 块 ——
# 单点事实题够用，但「国奖还能申请助学金吗」这种要拼两条的就会被裁掉一半依据。
RETRIEVE_MIN_KEEP = int(os.getenv("RETRIEVE_MIN_KEEP", "3"))

# ---------- 跨分类检索 ----------
# 每个分类先各取多少块，合并后再统一裁剪
RETRIEVE_PER_KB = int(os.getenv("RETRIEVE_PER_KB", "4"))
# 分类数不超过这个值就全查（5~8 个类全查比路由更简单、也更不容易漏）
RETRIEVE_ROUTE_ALL_MAX = int(os.getenv("RETRIEVE_ROUTE_ALL_MAX", "8"))
# 分类数超过上界时，类心路由取前几个分类
RETRIEVE_TOP_CATEGORIES = int(os.getenv("RETRIEVE_TOP_CATEGORIES", "3"))
# 算类心时最多读多少块（超大集合只抽样估算，避免每次拉全量向量）
CENTROID_MAX_CHUNKS = int(os.getenv("CENTROID_MAX_CHUNKS", "2000"))


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


def _trim_by_distance(pairs, rel=None, max_dist=None, min_keep=None):
    """按距离裁剪检索结果。pairs = [(Document, distance)]，distance 越小越像。

    为什么必须裁：`as_retriever(k=4)` 对**非空 collection 永远返回 4 条**，
    不管相不相关 —— 问一个库里根本没有的问题，模型照样拿到 4 段最近的文本
    然后照着编。这比回「未检索到」糟得多。

    两道闸，都只做减法：
      1. 绝对闸（`RETRIEVE_MAX_DIST`，默认关）：最佳距离都超过上限 ⇒ 库外问题，
         整批丢空，上层回「未检索到相关文档」。
      2. 相对闸（`RETRIEVE_REL_THRESHOLD`）：只留距离在「最佳 × rel」以内的块，
         把明显沾不上边的尾巴切掉，少给模型喂噪音。

    相对闸有下限 `min_keep`（默认 3）：真实库里 1.5 倍常常只留下 1 块，
    多段答案（「材料有哪些、交到哪」）就被裁掉一半依据，得不偿失。

    纯函数，不碰网络，离线自测直接喂假 pairs 验证。
    """
    rel = RETRIEVE_REL_THRESHOLD if rel is None else rel
    max_dist = RETRIEVE_MAX_DIST if max_dist is None else max_dist
    min_keep = RETRIEVE_MIN_KEEP if min_keep is None else min_keep
    if not pairs:
        return []

    best = min(float(d) for _, d in pairs)
    if max_dist > 0 and best > max_dist:
        logger.info("检索最佳距离 %.4f > 上限 %.4f，判定为库外问题", best, max_dist)
        return []

    cut = best * rel
    if cut - best < RETRIEVE_MIN_GAP:
        cut = best + RETRIEVE_MIN_GAP
    kept = [doc for doc, d in pairs if float(d) <= cut]
    if len(kept) < min_keep:                      # 相对闸再狠也留够 min_keep 块
        kept = [doc for doc, _ in pairs[:min_keep]]
    logger.info("检索 k=%d best=%.4f cut=%.4f 保留=%d", len(pairs), best, cut, len(kept))
    return kept


def _query_by_vector(vs, qv, k: int) -> list:
    """按已有向量查一个集合，返回 [(Document, distance)]。

    为什么不直接用 langchain 的接口：langchain-chroma 1.1.0 只有
    `similarity_search_by_vector`（不给分数），而跨分类合并**必须**按距离排序，
    没有距离就没法把几个集合的结果放一起排。所以这里直接走 collection.query。
    距离语义与 `similarity_search_with_score` 完全一致（距离升序，越小越像）。
    """
    raw = vs._collection.query(
        query_embeddings=[qv], n_results=k,
        include=["documents", "metadatas", "distances"])
    docs, metas, dists = raw["documents"][0], raw["metadatas"][0], raw["distances"][0]
    return [(Document(page_content=t, metadata=m or {}), float(d))
            for t, m, d in zip(docs, metas, dists)]


def _format_hit(i: int, doc, code=None) -> str:
    """把一条命中拼成喂给模型的文本。code 只在跨分类检索时带上。"""
    meta = doc.metadata or {}
    head = f"[{i}] "
    if code:
        head += f"category={code} "
    head += (f"documentId={meta.get('documentId')} "
             f"sectionId={meta.get('sectionId')} page={meta.get('pageStart')}")
    return f"{head}\n{doc.page_content}"


def _gate_categories(per_kb, rel=None):
    """分类级相对闸：某一类里最好的块都比全局最佳差太多，就整类不要。

    为什么要单独一层：跨分类把 4 个类的结果混在一起后，"至少留 3 块"的下限会把
    距离接近的**别类噪音**一起拉进提示词（实测「能借几本书」里混进了缴费条款）。
    先按类淘汰，再在存活类内部排序裁剪，噪音就进不来了。
    """
    rel = RETRIEVE_REL_THRESHOLD if rel is None else rel
    best = {c: min(float(d) for _, d in pairs) for c, pairs in per_kb if pairs}
    if not best:
        return []
    g = min(best.values())
    cut = g * rel
    if cut - g < RETRIEVE_MIN_GAP:
        cut = g + RETRIEVE_MIN_GAP
    keep = {c for c, d in best.items() if d <= cut} or {min(best, key=best.get)}
    return [(c, pairs) for c, pairs in per_kb if c in keep]


def _merge_results(per_kb, k, rel=None, max_dist=None, min_keep=None):
    """把多个分类各自的检索结果合并、按距离排序、再裁剪。纯函数，可离线测。

    per_kb = [(code, [(Document, distance)])]
    返回 [(code, Document)]，保持距离升序。

    跨集合的距离为什么可比：同一个 embedding 模型、同维度、同一度量（l2），
    所以 0.45 和 0.74 放一起排序是有意义的。若某个集合换过模型，这里就废了 ——
    这也是为什么 embedding 模型必须全局统一。
    """
    cands = []
    for code, pairs in per_kb:
        for doc, dist in pairs:
            cands.append((float(dist), code, doc))
    cands.sort(key=lambda x: x[0])
    top = cands[:k]
    kept = _trim_by_distance([(doc, d) for d, _, doc in top], rel, max_dist, min_keep)
    code_of = {id(doc): code for _, code, doc in top}
    return [(code_of[id(doc)], doc) for doc in kept]


# 类心缓存：key = (code, 该集合当前块数)，块数变了自动重算
_CENTROIDS = {}


def _get_centroid(code: str, count: int):
    """分类的类心 = 该类所有已入库向量的均值。空集合返回 None。

    为什么要它：分类多到十几个时，逐个集合查图是浪费 —— 先拿问题和十几个
    类心比距离（纯内存点乘，微秒级），选出最可能的两三个再去查图。

    ⚠️ 均值只适合"类内内容内聚"的分类。若一个类里混了图书馆/食堂/报修三件事，
    类心会落在三者中间，谁都不像，这一类就永远选不中（实测见 _rag_router_eval.py）。
    """
    key = (code, count)
    if key in _CENTROIDS:
        return _CENTROIDS[key]
    if count <= 0:
        return None
    import numpy as np

    data = get_vectorstore(code)._collection.get(
        limit=CENTROID_MAX_CHUNKS, include=["embeddings"])
    emb = data.get("embeddings")
    if emb is None or len(emb) == 0:
        return None
    c = np.asarray(emb, dtype="float32").mean(axis=0)
    _CENTROIDS[key] = c
    return c


def _pick_collections(qv, cols, top_n):
    """决定这一次要查哪几个分类。cols = [(code, count)]。"""
    if len(cols) <= RETRIEVE_ROUTE_ALL_MAX:
        return [c for c, _ in cols]
    import numpy as np

    scored = []
    for code, count in cols:
        c = _get_centroid(code, count)
        if c is not None:
            scored.append((float(((qv - np.asarray(c)) ** 2).sum()), code))
    if not scored:
        return [c for c, _ in cols]
    scored.sort()
    return [code for _, code in scored[:top_n]]


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
    def search_with_db(kb_id: str, question: str, k: int = RETRIEVE_K, session=None):
        """从 kb_{kb_id} collection 检索，返回拼接好的文档片段文本。

        用 `similarity_search_with_score` 而不是 `as_retriever`：后者拿不到距离，
        没法做任何筛选。取回后交给 `_trim_by_distance` 裁。
        """
        pairs = get_vectorstore(kb_id).similarity_search_with_score(question, k=k)
        docs = _trim_by_distance(pairs)
        if not docs:
            return "未检索到相关文档"
        return "\n\n".join(_format_hit(i, d) for i, d in enumerate(docs, 1))

    @staticmethod
    def active_collections() -> list:
        """有数据的分类，返回 [(code, count)]，空集合直接剔掉。

        空集合必须剔除：它检不出东西，留在候选里只会让"分类选错"变成一次空手而归。
        """
        out = []
        for c in _get_client().list_collections():
            name = c.name if not isinstance(c, str) else c
            if not name.startswith("kb_"):
                continue
            code = name[len("kb_"):]
            try:
                n = _get_client().get_collection(name).count()
            except Exception as e:
                logger.warning("读取集合 %s 失败：%s", name, e)
                continue
            if n > 0:
                out.append((code, n))
        return sorted(out)

    @staticmethod
    def search_across(question: str, k: int = RETRIEVE_K,
                      per_kb: int = RETRIEVE_PER_KB,
                      top_categories: int = RETRIEVE_TOP_CATEGORIES) -> str:
        """跨分类检索：问题向量只算一次，查多个分类，合并按距离排序后裁剪。

        为什么要它：让模型自己挑一个分类 code 是整条链路最容易出错的一步 ——
        挑错就是打空 collection、返回「未检索到」，而且从日志里看不出是分类错了。
        向量判定反而稳（实测 _rag_router_eval.py：类间可分时 19/19 全对），
        所以把"选分类"从"模型猜"换成"按距离筛"。

        分类数 ≤ RETRIEVE_ROUTE_ALL_MAX 时全查（简单、不漏）；
        超过则先用类心挑前 top_categories 个再查（分类多了不至于线性变慢）。
        """
        cols = VectorStore.active_collections()
        if not cols:
            logger.warning("跨分类检索：没有任何非空分类")
            return "未检索到相关文档"

        qv = get_embeddings().embed_query(question)
        picked = _pick_collections(qv, cols, top_categories)
        per_kb_results = []
        for code in picked:
            try:
                pairs = _query_by_vector(get_vectorstore(code), qv, per_kb)
            except Exception as e:
                logger.warning("分类 %s 检索失败，跳过：%s", code, e)
                continue
            per_kb_results.append((code, pairs))

        kept = _merge_results(_gate_categories(per_kb_results), k)
        logger.info("跨分类检索 分类=%s 候选=%d 保留=%d",
                    picked, sum(len(p) for _, p in per_kb_results), len(kept))
        if not kept:
            return "未检索到相关文档"
        return "\n\n".join(_format_hit(i, d, code) for i, (code, d) in enumerate(kept, 1))

    @staticmethod
    def search_raw(kb_id: str, question: str, k: int = 6,
                   exclude_document_id=None) -> list:
        """检索并返回原始片段（content + metadata），供冲突扫描等后台场景用。

        与 search_with_db 的差别：不拼接展示文本，保留 metadata（documentId 等），
        让调用方能定位「这段话来自哪篇文档」。检索系统（retriever_tool）的用户
        可见路径不要改用这里 —— 那边的输出要过 laya 护栏（guard_retrieved），
        本方法只服务不入提示词的后台比对。

        exclude_document_id：跳过刚写入的自己（冲突扫描在 add_sections 之后跑，
        自己的块必然是最像的，不排除会全打在自己身上）。
        """
        docs = get_vectorstore(kb_id).similarity_search(question, k=k * 3)
        out = []
        for d in docs:
            meta = d.metadata or {}
            if exclude_document_id is not None:
                try:
                    if int(meta.get("documentId")) == int(exclude_document_id):
                        continue
                except (TypeError, ValueError):
                    pass
            out.append({"content": d.page_content, "metadata": meta})
            if len(out) >= k:
                break
        return out

    @staticmethod
    def delete_by_version(kb_id: str, version_id: int):
        """按 versionId 精确删某个版本的向量，不影响同文档其他版本。"""
        vs = get_vectorstore(kb_id)
        vs.delete(where={"versionId": version_id})
        logger.info(f"Chroma 删除 versionId={version_id}，collection=kb_{kb_id}")
