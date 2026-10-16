"""角色节点 —— 每个角色一个 deepagent，产出的东西是「证据」，不是给用户的答复。

为什么四个角色各自 create_deep_agent，而不是搞一个「角色 agent 工厂」（09-23 定）：

工厂把差异藏进配置，后期给某个角色加工具时要在配置 + 分发两处对齐，很容易漏；
直接写在节点里，加工具就是改下面 ROLE_TOOLS 对应那一行。而且这样和
workflow_agent_node / campusflow_agent_node 完全同构 —— 读一个就懂全部。

⚠️ 角色永远不持有 submit_answer / ask_user / run_on_host：
submit_answer 调用即收尾（return_direct），谁拿到它谁就能打断打字机收尾这轮对话。
用户的答复只由 synthesis 产出，角色的唯一出口是 structured_response。
"""

import logging

from deepagents import create_deep_agent
from langchain.agents.structured_output import ToolStrategy
from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig

from src.agent.findings import Finding
from src.agent.llm import llm_node
from src.agent.prompt.role_prompt import ROLE_NAMES, ROLE_PROMPT
from src.agent.state.common_state import MultiAgentState
from src.agent.tools.knowledge_categories_tool import get_knowledge_tool
from src.agent.tools.retriever_tool import retriever_tool

logger = logging.getLogger(__name__)

ROLE_NODES = ("policy_node", "academic_node", "workflow_node", "research_node")

# 每个角色的工具就写在节点名旁边：加一个工具只改这里，不碰任何共享的构建代码。
# 四个角色现在工具相同是暂时的（先不砍，后期再分化），差异化弹药仓库里都已经有了：
#   workflow → get_task_info（办事事项要读工单上下文）
#   research → search / extract / crawl / map_site（外部信息只有它能拿到）
# 真要分化时，把上面那几个直接挪进对应的列表即可。
ROLE_TOOLS = {
    "policy_node": [retriever_tool, get_knowledge_tool],
    "academic_node": [retriever_tool, get_knowledge_tool],
    "workflow_node": [retriever_tool, get_knowledge_tool],
    "research_node": [retriever_tool, get_knowledge_tool],
}


def make_role_node(node_name: str):
    role = node_name.removesuffix("_node")

    async def role_node(state: MultiAgentState, config: RunnableConfig) -> dict:
        item = next((p for p in (state.get("plan") or []) if p["role"] == role), None)
        if item is None:
            return {}                 # 本轮没派给它：不空跑模型，也不写任何通道
        configurable = config.get("configurable") or {}
        thread_id = configurable.get("thread_id") or f"{role}-default"

        agent = create_deep_agent(
            system_prompt=ROLE_PROMPT.format(role=ROLE_NAMES[role]),
            # 结构化输出会强制 tool_choice，思考模式的网关直接 400 →
            # 只能取这个关思考的构造器（见 llm_node.get_structured_model 注释）
            model=llm_node.get_structured_model(thread_id),
            tools=ROLE_TOOLS[node_name],
            response_format=ToolStrategy(Finding),
        )
        res = await agent.ainvoke(
            {"messages": [HumanMessage(content=item["sub_question"])]}, config)
        finding = res.get("structured_response")
        if not finding or not (finding.get("claims") or finding.get("notes")):
            # 空产出不能算"这条答过了"，否则 gate 会认为它已覆盖，
            # synthesis 拿着一份空证据写出个幻觉式结论。
            logger.error("角色 %s 未产出有效 Finding（sub_question=%r）",
                         role, item["sub_question"])
            return {}     # 不写通道：gate 会判成 gap，在 MAX_ROUNDS 内补派一次
        # 只返回 findings！角色的 messages 一个字段都不许进 state ——
        # 进了就会被 checkpointer 持久化，之后每轮历史重发都再烧一次 token
        finding = {**finding,
                   "role": role,                            # 覆盖成英文：提示词里渲染的是中文名
                   "sub_question": item["sub_question"]}    # 覆盖成原文：gate 靠字符串全等判"答没答"
        return {"findings": [finding]}

    return role_node
