from sqlalchemy.ext.asyncio import AsyncSession
from src.db.db_conversation import conversation
from src.db.db_agent import agent
from src.models.worker_space_res import worker_space_res
from sqlalchemy import select
from src.db.db_quick_entries import workspace_quick_entries


async def get_summary(session: AsyncSession, user_id: int):
    stmt = (
        select(conversation.id, conversation.title, conversation.agent_mode, conversation.updated_at)
        .where(conversation.user_id == user_id)
        .order_by(conversation.updated_at.desc())
        .limit(20)  # 只取最近20条
    )
    result = await session.execute(stmt)
    cons = result.all()  # 这里可以保留 Row 对象，不用转 dict

    # 2. 获取在线代理映射（如有必要，可缓存）
    stmt = select(agent.agent_key, agent.name,agent.domains).where(agent.status == 'online')
    result = await session.execute(stmt)
    agents ={}
    domains=[]
    for row in result:
        agents[row.agent_key] = row.name
        domains.append(row.domains)
    # 3. 构建近期会话数据，安全获取代理名称
    wsr = []
    hot_topics = []
    for con in cons:
        agent_name = agents.get(con.agent_mode, "未知代理")  # 避免 KeyError
        wsr.append(worker_space_res(con.id, con.title, agent_name, con.updated_at))
        hot_topics.append(con.title)  # 若要去重可改为 if con.title not in hot_topics

    # 4. 快速入口（建议加条件）
    stmt = select(workspace_quick_entries.entry_key, workspace_quick_entries.title,
                  workspace_quick_entries.category, workspace_quick_entries.prompt)
    # 如果只查启用的：.where(workspace_quick_entries.enabled == True)
    result = await session.execute(stmt)
    quick_entries = [dict(row._mapping) for row in result]

    return {
        "active_agent_count": len(agents),
        "quick_entries": quick_entries,
        "recent_conversations": wsr,
        "domains": domains,
        "hot_topics": hot_topics[:10],  # 限制热门话题数量
    }
