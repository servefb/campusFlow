import logging
import time

from deepagents import create_deep_agent
from langchain.agents.structured_output import ToolStrategy
from langchain_core.messages import HumanMessage

from src.agent.findings import MAX_SUBTASKS, Plan
from src.agent.history_utils import sanitize_history
from src.agent.llm import llm_node
from src.agent.prompt.planner_prompt import PLANNER_PROMPT
from src.agent.state.common_state import MultiAgentState
from langgraph.types import Send

from laya import Router
logger = logging.getLogger(__name__)

MAX_HISTORY_MESSAGES = 8

PINNED = {"campusflow_agent": "common_agent_node", "policy_agent": "common_agent_node",
          "academic_agent": "common_agent_node", "workflow_agent": "workflow_agent_node"}

DIRECT_AGENT_KEY = {"workflow_agent_node": "workflow_agent",
                    "common_agent_node": "campusflow_agent"}

# 模块级单例：构造只走对象装配，不发任何网络请求，所以放在模块顶层是安全的
# （对照 llm_node 里那条"别把外部服务可用性变成服务能不能启动"的红线）。
# 与角色节点同构，全部用 create_deep_agent —— 没有共享的工厂需要同步改。
planner_agent = create_deep_agent(
    system_prompt=PLANNER_PROMPT,
    # 结构化输出强制 tool_choice，思考模式必 400 → 只能取关思考的构造器
    model=llm_node.get_structured_model("planner"),
    response_format=ToolStrategy(Plan),
)

def laya_planner(user_question:str):
        state = {
            "user_question": user_question
        }

            # questions：把 CampusFlow 规划器的判断逻辑编码成 Laya 的决策原语
        questions = {
            # 判断模式：单领域直接答，还是跨领域拆解协作
            "mode": {
                "type": "choice",
                "instructions": "判断该校园事务问题是单领域问题还是跨领域复合问题。单领域问题一个角色一次就能答完；跨领域复合问题必须拆给多个角色协作。",
                "criteria": {
                    "direct": "单领域问题，只涉及一个领域，且不需要另一个领域的实际情况作为前提，一个角色一次就能答完",
                    "collaborate": "跨领域复合问题，需要同时用到两个及以上领域的知识，或结论依赖另一个领域的实际情况"
                }
            },
            # 如果是单领域，决定交给哪个角色
            "direct_node": {
                "type": "choice",
                "instructions": "如果该问题是单领域问题，应交给哪个角色回答？如果该问题是跨领域复合问题，选择 none。",
                "criteria": {
                    "workflow_agent_node": "问题本身就是一个具体办事事项：怎么办、要什么材料、满足什么条件、走什么流程、有哪些时间节点",
                    "common_agent_node": "其余全部单领域情况：政策解释、学业咨询、平台使用、寒暄、身份询问等",
                    "none": "该问题是跨领域复合问题，不适用单角色直接回答"
                }
            }
        }

        # 一次调用，获取两个决策结果
        return Router().predict(state, questions)


def planner_node(state: MultiAgentState) -> dict:
    start = time.time_ns()
    if (state.get("agent_mode") or "auto") != "auto":
        return {"round_start": start}     # 钉住领域：不拆解，交给 after_planner 直连

    res=laya_planner(state["question"])

    msgs = [*sanitize_history(list(state.get("messages") or []))[-MAX_HISTORY_MESSAGES:],
            HumanMessage(content=state["question"])]
    plan = planner_agent.invoke({"messages": msgs})["structured_response"]
    elapsed = time.time_ns() - start
    if plan["mode"] == "collaborate":
        return {"plan": plan["subtasks"], "agent_mode": "collaborate",
                "round_start": start, "rounds": 0,
                "response_time_ms": (state.get("response_time_ms") or 0) + elapsed}
    node = plan["direct_node"]
    return {"plan": [], "direct_node": node, "round_start": start, "rounds": 0,
            "agent_mode": DIRECT_AGENT_KEY[node],
            "response_time_ms": (state.get("response_time_ms") or 0) + elapsed}


def after_planner(state):
    if (state.get("agent_mode") or "") == "collaborate":
        return [Send(f"{p['role']}_node", {**state, "plan": [p]})
                for p in (state.get("plan") or [])]
    return state.get("direct_node") or PINNED.get(state.get("agent_mode"), "common_agent_node")
