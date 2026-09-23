import asyncio

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import StateGraph, START
from psycopg import AsyncConnection
from psycopg.rows import dict_row

from src.agent.nodes.academic_agent_node import academic_agent_node
from src.agent.nodes.policy_agent_node import policy_agent_node
from src.agent.nodes.workflow_agent_node import workflow_agent_node
from src.agent.router_agent import router_agent_node
from src.agent.nodes.campusflow_agent_node import common_agent_node
from src.agent.state.common_state import MultiAgentState

DB_URI = "postgresql://postgres:0706@192.168.150.101:5432/campusflow?sslmode=disable"

# 路由决策(LLM 输出的 key) -> 图中的节点名
AGENT_NODE_MAPPING = {
    "policy_agent": "common_agent_node",
    "academic_agent": "common_agent_node",
    "workflow_agent": "workflow_agent_node",
    "common_agent": "common_agent_node",
}


def route_after_router(state: MultiAgentState) -> str:
    """根据路由决策返回下一个节点名，未匹配时兜底到 common_agent_node。"""
    return AGENT_NODE_MAPPING.get(state["agent_mode"], "common_agent_node")


work_flow = StateGraph(MultiAgentState)
work_flow.add_node("router_agent_node", router_agent_node)
work_flow.add_node("common_agent_node", common_agent_node)
work_flow.add_edge(START, "router_agent_node")
work_flow.add_node("workflow_agent_node",workflow_agent_node)
work_flow.add_node("policy_agent_node",policy_agent_node)
work_flow.add_node("academic_agent_node",academic_agent_node)
work_flow.add_conditional_edges("router_agent_node", route_after_router)

# 同步 PostgresSaver 不能配 astream(langgraph-checkpoint 4.x 移除了同步兜底，
# aget_tuple 等直接 NotImplementedError)，必须用 AsyncPostgresSaver；
# 而异步连接要在事件循环里创建，不能在 import 时建，故推迟到首个请求前(get_app)
_agent_app = None
_init_lock = asyncio.Lock()


async def get_app():
    """惰性创建 AsyncPostgresSaver 并编译图；连接参数与官方 from_conn_string 一致。"""
    global _agent_app
    if _agent_app is not None:
        return _agent_app
    async with _init_lock:
        if _agent_app is None:
            conn = await AsyncConnection.connect(
                DB_URI, autocommit=True, prepare_threshold=0, row_factory=dict_row
            )
            checkpointer = AsyncPostgresSaver(conn)
            await checkpointer.setup()  # 幂等建表/迁移
            _agent_app = work_flow.compile(checkpointer=checkpointer)
    return _agent_app

