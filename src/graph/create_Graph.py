import asyncio

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import StateGraph, START, END
from psycopg import AsyncConnection
from psycopg.rows import dict_row

from src.agent.nodes.campusflow_agent_node import common_agent_node
from src.agent.state.common_state import MultiAgentState
from src.agent.store.mongdb_store import store

DB_URI = "postgresql://postgres:0706@192.168.150.100:5432/campusflow?sslmode=disable"


# 单节点图：主智能体自己理解问题、拆解、派活、整合。
# 「多智能体」体现在主智能体手里那 5 个子智能体上（deepagents 的 task 工具），
# **子智能体不进图**——它们由框架托管，图里再摆一份就是两套编排打架。
#
# ⚠️ 节点名必须与 conversations_repo.STREAMING_NODES 逐字一致（09-18 实测：名字对不上时
# LLM token 会被 `outer_node not in STREAMING_NODES` 静默滤掉，不报错，前端只剩
# tool_result + done）。`_graph_selftest.py` 里有一条断言守着这两处的对应关系。
work_flow = StateGraph(MultiAgentState)
work_flow.add_node("common_agent_node", common_agent_node)
work_flow.add_edge(START, "common_agent_node")
work_flow.add_edge("common_agent_node", END)


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
            _agent_app = work_flow.compile(checkpointer=checkpointer,store=store)
    return _agent_app
