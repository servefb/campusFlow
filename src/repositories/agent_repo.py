
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


from src.db.db_agent import agent
from src.models.common_responce import result


async def get_agents(session: AsyncSession):
    """
    Endpoint to retrieve a list of agents from the database.
    """
    stmt = select(agent.agent_key, agent.name, agent.description, agent.status, agent.supports_attachments,
                  agent.domains)  # domains（JSON 列表）：该 Agent 覆盖的专精协同领域，前端卡片直接贴标签
    res = await session.execute(stmt)
    content = res.all()
    if not content:
        return result(code=404, message="No agents found").error()
    return [dict(row._mapping) for row in content]