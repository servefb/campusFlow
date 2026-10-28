from langchain_core.tools import tool
from sqlalchemy import select

from src.db.basic_config import AsyncSessionLocal
from src.db.db_Knowledge import KnowledgeCategory


@tool
async def get_knowledge_tool() -> str:
    """获取知识库分类清单，用来判断用户问题属于哪个分类。

    返回格式：每行一条「分类名 → code」。检索时 `retriever_tool` 的 kb_id
    只填箭头右边的 code；分类名只是给你判断用的，不要一起填进去。
    """
    # 注意三点（原实现的坑）：
    # 1. LangChain 工具里不能用 fastapi.Depends —— 那是请求依赖注入，只对
    #    FastAPI 路由生效；工具里拿到的是 Depends 对象本身，不是 session。
    # 2. `await session.execute(stmt).all()` 优先级是
    #    await (execute().all())，coroutine 没有 .all() → AttributeError。
    # 3. KnowledgeCategory 的字段是 name，没有 category_name。
    # 工具自建短连接，用完即关。
    #
    # 为什么把 name 也回出去：原来只回一串 code（"、".join(c.code)），模型只能
    # 看着 code 猜「这个问题属于哪类」。code 是拼音/英文还能猜，一旦是编号式
    # 的 code 就全靠运气 —— 猜错等于检索打到空 collection，召回直接归 0，
    # 而且错在分类这一层，看检索日志完全看不出来。
    async with AsyncSessionLocal() as session:
        stmt = select(KnowledgeCategory).where(KnowledgeCategory.is_active == True)
        result = await session.execute(stmt)
        cats = result.scalars().all()
        lines = [f"{c.name} → {c.code}" if c.name else c.code for c in cats]
    return "\n".join(lines) if lines else "uncategorized"
