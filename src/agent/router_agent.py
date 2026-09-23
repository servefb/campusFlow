import time

from langchain.agents import create_agent
from langchain_core.messages import HumanMessage

from src.agent.history_utils import sanitize_history
from src.agent.llm import llm_node
from src.agent.prompt import router_prompt
from src.agent.state.common_state import MultiAgentState

# 路由同样需要上下文：追问("那第二个呢")只看本轮问题判不出领域，
# 会一路兜底到 common_agent；这里带少量历史即可。
MAX_HISTORY_MESSAGES = 8
ROUTE_KEYS = ("policy_agent", "academic_agent", "workflow_agent", "campusflow_agent")

router_agent = create_agent(
    model=llm_node.model,
    system_prompt=router_prompt.system_PromptTemplate.template,
)


def router_agent_node(state: MultiAgentState) -> dict:
    start = time.time_ns()
    if state["agent_mode"] != "auto":
        return {"agent_mode": state["agent_mode"],}
    question = state["question"]
    history = sanitize_history(list(state["messages"] or []))[-MAX_HISTORY_MESSAGES:]
    msgs = [*history, HumanMessage(content=question)]
    res = router_agent.invoke({"messages": msgs})
    chosen = res["messages"][-1].content.strip()
    if chosen not in ROUTE_KEYS:
        hits = [(chosen.find(key), key) for key in ROUTE_KEYS if key in chosen]
        chosen = min(hits)[1] if hits else "campusflow_agent"
    end = time.time_ns()
    return {"agent_mode": chosen,
            "response_time_ms": state["response_time_ms"]+(end - start)}
