import time

from deepagents import create_deep_agent
from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig
from src.agent.file_backend import build_file_backend
from src.agent.history_utils import round_attachments, round_messages, sanitize_history
from src.agent.llm import llm_node
from src.agent.prompt.common_agent_prompt import READONLY_FILE_NOTICE, common_agent_prompt
from src.agent.state.common_state import MultiAgentState
from src.agent.tools.knowledge_categories_tool import get_knowledge_tool
from src.agent.tools.retriever_tool import retriever_tool
from src.agent.tools.submit_answer import submit_answer
from src.agent.prompt.chat_agent_prompt import _ANSWER_STYLES
from deepagents_code.ask_user import AskUserMiddleware


async def policy_agent_node(state: MultiAgentState, config: RunnableConfig):
    start = time.time_ns()
    question = state["question"]
    history = sanitize_history(list(state.get("messages") or []))

    configurable = config.get("configurable") or {}
    thread_id = configurable.get("thread_id") or "common-default"
    # 思考等级：透传原始值，收敛成网关枚举由 llm_node 一个出口负责（写错的代价是整轮 422）
    reasoning_effort = configurable.get("reasoning_effort")
    # 本轮附件块（见 conversations_repo.build_attachment_block）：只在本轮给模型看一次
    attachments = round_attachments(config)

    # 文件路由：挂上 /user/（用户选的工作文件夹，或没选时的默认附件目录），**不带沙箱** ——
    # 政策问答不需要跑代码；read_only=True 让写 /user/** 被直接拒（src/agent/file_backend.py）。
    backend, permissions = build_file_backend(
        configurable.get("user_folder"), configurable.get("permission_mode"), read_only=True)
    answer_style = ""
    if configurable.get("answer_style") in _ANSWER_STYLES:
        answer_style = _ANSWER_STYLES[configurable.get("answer_style")] or ""
    # 只读节点必须拼上这段：否则模型会去试写、甚至声称"已经保存好了"（写其实被 deny 了）
    prompt = common_agent_prompt + answer_style + READONLY_FILE_NOTICE

    agent = create_deep_agent(
        system_prompt=prompt,
        model=llm_node.get_model(thread_id, reasoning_effort),  # promptCacheKey 按会话隔离
        tools=[
            retriever_tool, get_knowledge_tool,
            # 回答唯一出口：调用即收尾（return_direct），参数就是给用户的回答
            submit_answer
        ],
        backend=backend,
        permissions=permissions,
        middleware=[
            # 让 common agent 也能主动向用户提问（界面渲染成可点选项，靠 LangGraph interrupt 暂停）
            AskUserMiddleware(),
        ],
    )

    res = await agent.ainvoke(
        {"messages": [*history, HumanMessage(content=question + attachments)]}, config)
    # 落进 state 的那条必须是干净提问：附件正文只给模型看这一次，
    # 否则会被 checkpoint 持久化，之后每轮历史重发都再烧一次 token
    end = time.time_ns()
    return {"messages": round_messages(res["messages"], len(history), question, bool(attachments)),
            "response_time_ms": state["response_time_ms"]+(end - start)}
