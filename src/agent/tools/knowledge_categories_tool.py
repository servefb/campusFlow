from langchain_core.tools import tool
from sqlalchemy import select

from src.db.basic_config import AsyncSessionLocal
from src.db.db_Knowledge import KnowledgeCategory


@tool
async def get_knowledge_tool() -> str:
    """获取知识库类别列表，用来判断用户问题属于哪个知识分类"""
    # 注意三点（原实现的坑）：
    # 1. LangChain 工具里不能用 fastapi.Depends —— 那是请求依赖注入，只对
    #    FastAPI 路由生效；工具里拿到的是 Depends 对象本身，不是 session。
    # 2. `await session.execute(stmt).all()` 优先级是
    #    await (execute().all())，coroutine 没有 .all() → AttributeError。
    # 3. KnowledgeCategory 的字段是 name，没有 category_name。
    # 工具自建短连接，用完即关。
    async with AsyncSessionLocal() as session:
        stmt = select(KnowledgeCategory).where(KnowledgeCategory.is_active == True)
        result = await session.execute(stmt)
        cats = result.scalars().all()
        names = [c.code for c in cats]
    return "、".join(names) if names else "uncategorized"
