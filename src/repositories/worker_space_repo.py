from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.db_conversation import conversation
from src.db.db_quick_entries import workspace_quick_entries


async def get_summary(session: AsyncSession, user_id: int):
    """工作台首页汇总：最近会话 + 快速入口。

    注：原实现还会统计 agents 表（active_agent_count / domains / hot_topics），
    该表已随智能体整合删除（现在只有一个主智能体），相关统计一并移除。
    """
    stmt = (
        select(conversation.id, conversation.title, conversation.agent_mode, conversation.updated_at)
        .where(conversation.user_id == user_id)
        .order_by(conversation.updated_at.desc())
        .limit(20)  # 只取最近20条
    )
    result = await session.execute(stmt)
    recent_conversations = [dict(row._mapping) for row in result]

    # 快速入口
    stmt = select(workspace_quick_entries.entry_key, workspace_quick_entries.title,
                  workspace_quick_entries.category, workspace_quick_entries.prompt)
    # 如果只查启用的：.where(workspace_quick_entries.enabled == True)
    result = await session.execute(stmt)
    quick_entries = [dict(row._mapping) for row in result]

    return {
        "quick_entries": quick_entries,
        "recent_conversations": recent_conversations,
    }
