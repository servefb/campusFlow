from typing import Annotated, TypedDict
from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages


class MultiAgentState(TypedDict):
    """图状态 —— 只有主智能体一个节点，所以只留它真正读写的那几个字段。

    09-23：`plan` / `findings` / `round_start` / `rounds` / `gate_report` / `final_report`
    几个通道随「节点编排」方案一起归档（见 `_legacy_multi_agent/README.md`）。子智能体由
    deepagents 托管，它们的中转材料**不经过本 state**，所以这里没有对应通道。
    """

    question: str
    agent_mode: str                                     # 入参：前端选定的智能体；出参：主智能体回写实际作答者
    messages: Annotated[list[AnyMessage], add_messages]
    response_time_ms: int
    # 跨轮历史窗口（见 history_utils 模块注释「跨轮历史窗口」）：
    # 更早轮次折叠成的滚动摘要 + 已折叠覆盖的前缀条数（按 sanitize_history 之后计）。
    # 摘要**只存这里**，每轮由节点以一条 HumanMessage 临时拼进模型输入，不进 messages。
    history_summary: str
    history_covered: int
