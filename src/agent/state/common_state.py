from typing import Annotated, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages
from typing import Annotated

class MultiAgentState(TypedDict):
    # 用户输入的问题
    question: str
    agent_mode: str
    # 完整对话历史(HumanMessage/AIMessage 对象，带 usage_metadata)
    # add_messages 负责追加并按消息 id 去重
    messages: Annotated[list[AnyMessage], add_messages]
    # 存储最终生成的报告
    final_report: str
    response_time_ms: int
