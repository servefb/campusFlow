"""文档冲突扫描 —— 入库时对同分类已有文档做冲突检测，结果落 knowledge_conflicts。

链路背景（为什么检测在 Python、处理在 Java）：
  - knowledge_conflicts 表、管理端「冲突列表 / 处理冲突」接口都在 Java 侧
    （AdminKnowledgeServiceImpl.getConflicts / resolveConflict），
    文档列表的 has_conflict 角标也是 Java 读表打的 —— 那半条链路是现成的。
  - 但冲突**检测**要读文档内容做比对，而分块与向量只有这边有（Java 硬做就是
    「返回任务已创建」的假成功，见 reindex_document 的注释）。所以检测落在这里，
    用参数化 text() 写 Java 共库表（硬约束：Python 写 Java 表不建 ORM；
    severity/status 受表 CHECK 约束：low|medium|high、pending|resolved|ignored）。

两层检测，**每层独立降级、绝不影响入库结果**（冲突提示是锦上添花，入库失败才是事故）：
  1. 规则层（零 LLM 成本）：同分类下已存在「同文号 / 同标题 / 高相似标题」的文档
     → duplicate_document_no / duplicate_title / similar_title。
  2. LLM 语义层：拿新文档的头部分块去同分类 Chroma 检索 top-k 旧片段，
     让模型只找「金额/比例/期限/日期/次数」这类硬数字矛盾 → value_discrepancy。
     模型输出的 old_document_id 必须落在检索到的旧文档集合里，否则丢弃 ——
     防止模型拿训练记忆编一个不存在的文档 id。

幂等：重试/重建索引会重跑扫描，开始前先删掉本文档 status=pending 的旧记录
（resolved/ignored 保留，那是管理员的历史处理决定，不能动）。
"""

import asyncio
import difflib
import logging
import re
from typing import Optional

from sqlalchemy import text

from src.agent.rag_worker.extractor import _message_text, _loads_json_object

logger = logging.getLogger(__name__)

# severity 的表 CHECK 枚举（knowledge_conflicts_chk_1），LLM 给什么都得收敛进来
VALID_SEVERITY = {"low", "medium", "high"}

# 标题归一后相似度达到该值记 similar_title（低severity）；完全相等记 duplicate_title
# 取 0.85 保不误报：「（2025版）」vs「（2026版）」≈0.92 会命中；「（2026修订）」vs
# 「（修订版）」≈0.83 故意放行 —— 数字差异交给 LLM 语义层兜，规则层只抓明显重复
RULE_TITLE_SIMILARITY = 0.85

# 语义层取的规模：新文档只看头部块（数字类规定基本都在前半篇），旧文档取 top-k
SEMANTIC_NEW_CHUNKS = 12
SEMANTIC_TOP_K = 6

DOC_CONFLICT_PROMPT = """你是校园制度文档审核助手。判断「新入库文档」与「同知识库已有文档」之间是否存在事实性冲突。

## 新入库文档内容（截取）
{new_content}

## 已有文档片段（来自同一分类的知识库检索，每段开头标注了来源 documentId）
{old_content}

## 任务
只找「同一事项两边给出的数字/日期/期限/比例/次数/额度不一致」这类硬冲突，例如：
同一笔费用两边金额不同、同一项报销比例不同、同一事项截止日期不同、同一个额度上限不同。
不要报：适用对象不同、内容互补、措辞差异、只是旧文档没有涉及新事项。

## 输出
只返回一个 JSON 对象，不要有任何其他文字：
{{"conflicts": [
  {{"old_document_id": 123, "field": "冲突字段名", "new_value": "新文档的说法", "old_value": "已有文档的说法", "severity": "high|medium|low", "description": "一句话说明两边各是什么、为什么冲突"}}
]}}
没有冲突就返回 {{"conflicts": []}}。约束：
- old_document_id 必须取自上方已有文档片段标注的 documentId，不要编造；
- severity：金额/比例/期限这类直接影响办事的矛盾用 high，次要差异用 medium，拿不准用 low；
- description 不超过 120 字。
"""


# --------------------------------------------------------------------------
# 纯函数：规则匹配 + LLM 输出校验（离线自测 _conflict_scan_selftest.py 覆盖这里）
# --------------------------------------------------------------------------
def normalize_title(t) -> str:
    """标题归一：去所有空白后比较（全角/半角空格、换行差异不算不同）。"""
    return re.sub(r"\s+", "", str(t or "").strip())


def find_rule_conflicts(new_title, new_no, existing: list) -> list:
    """规则层：把新文档与同分类已有文档（existing: [{id,title,document_no}]）比对。

    同一文号命中时不再重复报标题（同一份文件两处问题只报最确定的那条）。
    """
    out = []
    n_title = normalize_title(new_title)
    n_no = str(new_no or "").strip()
    for row in existing or []:
        try:
            oid = int(row["id"])
        except (KeyError, TypeError, ValueError):
            continue
        o_no = str(row.get("document_no") or "").strip()
        if n_no and o_no and o_no == n_no:
            out.append({
                "conflicting_document_id": oid,
                "conflict_type": "duplicate_document_no",
                "severity": "medium",
                "description": f"文号相同（{n_no}）：疑似同一份文件的重复上传或新旧版本并存",
            })
            continue
        o_title = normalize_title(row.get("title"))
        if not n_title or not o_title:
            continue
        if n_title == o_title:
            out.append({
                "conflicting_document_id": oid,
                "conflict_type": "duplicate_title",
                "severity": "medium",
                "description": "标题完全相同：疑似重复文档，请管理员确认是否同一份材料",
            })
            continue
        ratio = difflib.SequenceMatcher(None, n_title, o_title).ratio()
        if ratio >= RULE_TITLE_SIMILARITY:
            out.append({
                "conflicting_document_id": oid,
                "conflict_type": "similar_title",
                "severity": "low",
                "description": f"标题高度相似：疑似同一主题的新旧文档，请确认替代关系",
            })
    return out


def validate_llm_conflicts(raw, valid_doc_ids: set) -> list:
    """校验 LLM 语义层输出，不合规的条目静默丢弃（防幻觉，不是防用户）。"""
    conflicts = (raw or {}).get("conflicts") if isinstance(raw, dict) else None
    if not isinstance(conflicts, list):
        return []
    out = []
    for c in conflicts:
        if not isinstance(c, dict):
            continue
        try:
            oid = int(c.get("old_document_id"))
        except (TypeError, ValueError):
            continue
        if oid not in valid_doc_ids:
            continue
        sev = str(c.get("severity") or "medium").strip().lower()
        desc = str(c.get("description") or "").strip()[:500]
        if not desc:
            field = str(c.get("field") or "未指明字段").strip()[:50]
            new_v = str(c.get("new_value") or "").strip()[:100]
            old_v = str(c.get("old_value") or "").strip()[:100]
            desc = f"「{field}」不一致：本文档为「{new_v}」，已有文档#{oid}为「{old_v}」"
        out.append({
            "conflicting_document_id": oid,
            "conflict_type": "value_discrepancy",
            "severity": sev if sev in VALID_SEVERITY else "medium",
            "description": desc,
        })
    return out


def build_old_content(retrieved: list) -> tuple:
    """把检索片段拼成提示词正文，同时返回出现过的旧文档 id 集合（校验用）。"""
    parts, ids = [], set()
    for i, r in enumerate(retrieved or [], 1):
        meta = (r or {}).get("metadata") or {}
        try:
            did = int(meta.get("documentId"))
        except (TypeError, ValueError):
            continue
        ids.add(did)
        parts.append(f"[旧文档 documentId={did} 片段{i}]\n{str((r or {}).get('content') or '')[:800]}")
    return "\n\n".join(parts), ids


# --------------------------------------------------------------------------
# 落库（Java 共库表，参数化 text()，不建 ORM）
# --------------------------------------------------------------------------
_INSERT_CONFLICT = text(
    """
    INSERT INTO knowledge_conflicts
        (document_id, conflicting_document_id, conflict_type, severity, description, status)
    VALUES
        (:did, :cdid, :ctype, :sev, :descr, 'pending')
    """
)

_CLEAR_PENDING = text(
    "DELETE FROM knowledge_conflicts WHERE document_id = :did AND status = 'pending'"
)


async def _insert_conflicts(session, document_id: int, items: list) -> int:
    n = 0
    for it in items:
        await session.execute(_INSERT_CONFLICT, {
            "did": int(document_id),
            "cdid": it["conflicting_document_id"],
            "ctype": str(it["conflict_type"])[:48],
            "sev": it["severity"],
            "descr": it["description"],
        })
        n += 1
    return n


# --------------------------------------------------------------------------
# 主入口
# --------------------------------------------------------------------------
async def scan_conflicts(
        *,
        document_id: int,
        category_code: str,
        chunk_texts: list,
        title: Optional[str] = None,
        document_no: Optional[str] = None,
        llm_client=None,
) -> dict:
    """对刚入库的文档做冲突扫描。返回 {"rule": n, "semantic": n, "total": n}。

    ★ 只降级不中断：任何一层失败都 warning 后返回已拿到的那部分，
      调用方（run_ingest）无须也不会因此改变入库状态。
    """
    stats = {"rule": 0, "semantic": 0, "total": 0}

    # ---------- 规则层（一次 DB 会话搞定：清旧 pending + 查同分类 + 插入） ----------
    try:
        from src.db.basic_config import AsyncSessionLocal
        from src.db.db_Knowledge import KnowledgeDocument
        from sqlalchemy import select

        async with AsyncSessionLocal() as session:
            # 清掉重试/重建索引上一次扫描留下的 pending（历史处理决定保留）
            await session.execute(_CLEAR_PENDING, {"did": document_id})

            doc = (await session.execute(
                select(KnowledgeDocument)
                .where(KnowledgeDocument.id == document_id)
            )).scalar_one_or_none()
            if doc is None:
                logger.warning(f"冲突扫描：文档不存在，跳过 docId={document_id}")
                return stats

            rows = (await session.execute(
                select(KnowledgeDocument.id, KnowledgeDocument.title,
                       KnowledgeDocument.document_no)
                .where(KnowledgeDocument.category_id == doc.category_id,
                       KnowledgeDocument.id != document_id,
                       KnowledgeDocument.deleted_at.is_(None))
            )).mappings().all()

            rule_items = find_rule_conflicts(
                title if title is not None else doc.title,
                document_no if document_no is not None else doc.document_no,
                [dict(r) for r in rows],
            )
            if rule_items:
                await _insert_conflicts(session, document_id, rule_items)
            await session.commit()
            stats["rule"] = len(rule_items)
    except Exception:
        logger.exception(f"冲突扫描规则层失败 docId={document_id}（不影响入库）")

    # ---------- 语义层（LLM，在线程池里同步跑） ----------
    try:
        texts = [str(t) for t in (chunk_texts or []) if str(t or "").strip()]
        if not texts:
            return stats
        new_content = "\n\n".join(texts[:SEMANTIC_NEW_CHUNKS])[:6000]

        loop = asyncio.get_running_loop()
        from src.agent.vectorstore.chroma_vectorstore import VectorStore

        # 检索用「标题 + 首块」当查询：数字矛盾双方用词往往不同，纯标题召回更稳
        query_text = f"{title or ''}\n{texts[0][:1500]}"
        retrieved = await loop.run_in_executor(
            None, VectorStore.search_raw,
            category_code, query_text, SEMANTIC_TOP_K, document_id,
        )
        old_content, valid_ids = build_old_content(retrieved)
        if not valid_ids:
            return stats  # 该分类只有这一篇文档，谈不上冲突

        prompt = DOC_CONFLICT_PROMPT.format(new_content=new_content, old_content=old_content)
        llm = llm_client if llm_client is not None else _default_llm()
        response = await loop.run_in_executor(
            None, lambda: llm.invoke(prompt, config={"tags": ["internal"]})
        )
        raw = _loads_json_object(_message_text(response))
        sem_items = validate_llm_conflicts(raw, valid_ids)
        if sem_items:
            # 补标题进描述，管理端读起来不用再点一次
            from src.db.basic_config import AsyncSessionLocal
            from src.db.db_Knowledge import KnowledgeDocument
            from sqlalchemy import select

            async with AsyncSessionLocal() as session:
                id_list = [it["conflicting_document_id"] for it in sem_items]
                title_rows = (await session.execute(
                    select(KnowledgeDocument.id, KnowledgeDocument.title)
                    .where(KnowledgeDocument.id.in_(id_list))
                )).mappings().all()
                title_map = {int(r["id"]): str(r["title"] or "") for r in title_rows}
                for it in sem_items:
                    t = title_map.get(it["conflicting_document_id"])
                    if t:
                        it["description"] = f"与《{t[:60]}》冲突：{it['description']}"
                stats["semantic"] = await _insert_conflicts(session, document_id, sem_items)
                await session.commit()
    except Exception:
        logger.exception(f"冲突扫描语义层失败 docId={document_id}（不影响入库）")

    stats["total"] = stats["rule"] + stats["semantic"]
    return stats


def _default_llm():
    """惰性取全局 model（外部依赖纪律：模块顶层禁止真发请求的构造）。"""
    from src.agent.llm.llm_node import model
    return model
