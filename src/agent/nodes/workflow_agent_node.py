import time

from deepagents import create_deep_agent
from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig
from src.agent.file_backend import build_file_backend
from src.agent.history_utils import round_attachments, round_messages, sanitize_history
from src.agent.llm import llm_node
from src.agent.prompt.workflow_agent_prompt import WORK_FLOW_PROMPT
from src.agent.state.common_state import MultiAgentState
from src.agent.tools.knowledge_categories_tool import get_knowledge_tool
from src.agent.tools.submit_answer import submit_answer
from src.agent.tools.task_info import get_task_info
from deepagents_code.ask_user import AskUserMiddleware


async def workflow_agent_node(state: MultiAgentState, config: RunnableConfig):
    start = time.time_ns()
    question = state["question"]
    history = sanitize_history(list(state.get("messages") or []))

    configurable = config.get("configurable") or {}
    thread_id = configurable.get("thread_id") or "workflow-default"
    reasoning_effort = configurable.get("reasoning_effort")  # 原始值透传，llm_node 统一收敛成网关枚举
    # 本轮附件块（见 conversations_repo.build_attachment_block）：只在本轮给模型看一次
    attachments = round_attachments(config)

    # 文件路由：挂上 /user/（用户选的工作文件夹，或没选时的默认附件目录），**不带沙箱**。
    # 与 academic / policy 的区别：workflow **可写**（用户拍板）—— 办事项要能产出材料清单、
    # 申请草稿这类文件，写权限走 permission_mode 档位（ask 弹卡片问 / auto 产物直放 / full 全放），
    # 不写 read_only。框架会按 permissions 里的 interrupt 条目自动装配 HITL 中间件
    # （见 deepagents/graph.py `_build_interrupt_on_from_permissions`）。
    backend, permissions = build_file_backend(
        configurable.get("user_folder"), configurable.get("permission_mode"))

    agent = create_deep_agent(
        system_prompt=WORK_FLOW_PROMPT,
        model=llm_node.get_model(thread_id, reasoning_effort),  # promptCacheKey 按会话隔离
        tools=[
            get_knowledge_tool, get_task_info,
            # 回答唯一出口：调用即收尾（return_direct），参数就是给用户的回答
            submit_answer,
        ],
        backend=backend,
        permissions=permissions,
        # 宿主机执行在真正跑之前一律中断，用户点「允许」才继续；任何档位（含 full）都要确认
        interrupt_on={"run_on_host": True},
        middleware=[AskUserMiddleware(),
                    ],
    )

    res = await agent.ainvoke(
        {"messages": [*history, HumanMessage(content=question + attachments)]}, config)
    # 落进 state 的那条必须是干净提问：附件正文只给模型看这一次，
    # 否则会被 checkpoint 持久化，之后每轮历史重发都再烧一次 token
    end = time.time_ns()
    return {"messages": round_messages(res["messages"], len(history), question, bool(attachments)),
            "response_time_ms": state["response_time_ms"]+(end - start)}
