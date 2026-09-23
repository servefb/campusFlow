import time

from deepagents import create_deep_agent
from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig

from src.agent.file_backend import build_file_backend
from src.agent.history_utils import round_attachments, round_messages, sanitize_history
from src.agent.llm import llm_node
from src.agent.prompt.common_agent_prompt import common_agent_prompt
from src.agent.sandbox.open_sandbox import get_backend
from src.agent.state.common_state import MultiAgentState
from src.agent.tools.host_exec import run_on_host
from src.agent.tools.knowledge_categories_tool import get_knowledge_tool
from src.agent.tools.retriever_tool import retriever_tool
from src.agent.tools.search_tool import map_site, crawl, extract, search
from src.agent.tools.submit_answer import submit_answer
from src.agent.tools.task_info import get_task_info
from src.agent.tools.workspace_files import (
    download_from_sandbox,
    upload_to_sandbox,
)
from src.agent.prompt.chat_agent_prompt import _ANSWER_STYLES
from deepagents_code.ask_user import AskUserMiddleware


async def common_agent_node(state: MultiAgentState, config: RunnableConfig):
    start = time.time_ns()
    question = state["question"]
    history = sanitize_history(list(state.get("messages") or []))

    configurable = config.get("configurable") or {}
    thread_id = configurable.get("thread_id") or "common-default"
    user_folder = configurable.get("user_folder")
    # 思考等级：透传原始值，收敛成网关枚举由 llm_node 一个出口负责（写错的代价是整轮 422）
    reasoning_effort = configurable.get("reasoning_effort")
    # 本轮附件块（见 conversations_repo.build_attachment_block）：只在本轮给模型看一次
    attachments = round_attachments(config)

    # 沙箱后端负责执行代码；用户的工作文件夹（选过的，或没选时的默认附件目录）用
    # FilesystemBackend 直接读写（零拷贝）。这是**唯一**带沙箱的节点：二进制附件要解析、
    # 统计转换要跑代码，都靠它。
    # ⚠️ 不能用 LocalShellBackend：它带 execute（宿主机 shell，官方标注 Unrestricted
    # Execution），root_dir 约束不住命令，等于把整台机器交出去。
    composite, permissions = build_file_backend(
        user_folder, configurable.get("permission_mode"), sandbox=get_backend(thread_id))
    answer_style = ""
    if configurable.get("answer_style") in _ANSWER_STYLES:
        answer_style = _ANSWER_STYLES[configurable.get("answer_style")] or ""
    prompt = common_agent_prompt + answer_style

    agent = create_deep_agent(
        system_prompt=prompt,
        model=llm_node.get_model(thread_id, reasoning_effort),  # promptCacheKey 按会话隔离
        tools=[
            retriever_tool, get_knowledge_tool, get_task_info,
            # 用户文件夹 ↔ 沙箱 的搬运工具（需要把文件送进沙箱执行代码时用）
            upload_to_sandbox, download_from_sandbox,
            # 在用户电脑上执行命令（沙箱外）——比写文件危险，靠 interrupt_on 把关
            run_on_host,
            # 回答唯一出口：调用即收尾（return_direct），参数就是给用户的回答
            submit_answer, search, extract, crawl, map_site
        ],
        # 沙箱后端按会话隔离（thread_id）；/user/ 路由直连用户选的工作文件夹
        backend=composite,
        # 这些工具在真正执行前一律中断，用户点「允许」才继续 —— 权限卡是执行的前置条件，
        # 不是事后审计。run_on_host 在宿主机跑命令，任何档位（含 full）都必须确认。
        interrupt_on={
            "run_on_host": True,
            "search": True,
            "extract": True,
            "crawl": True,
            "map_site": True,
            # 子代理唯一入口也要拦：research 内部跑的 search 不经父级 HITL，
            # 若不拦 task，联网就会多出一条完全不弹卡的路（见 docs/subagents-design.md）
            "task": True,
        },
        # 权限档位来自前端「批准方式」（ask/auto/full），映射见 src/agent/permissions.py。
        # 没有工作文件夹时是 []：那时 routes 为空，带路由外路径的权限会被框架直接拒绝
        permissions=permissions,
        subagents=[{
            "name": "research",
            "description": "联网调研：需要查最新外部信息（新闻、版本、政策动态、网页内容）时委派。子代理内部会多轮搜索与抓取，返回一段带来源的结论。",
            "system_prompt": "要点：① 你是调研员，围绕 description 把事查清，可多轮 search + extract；② 最终回复=给主代理看的调研报告：结论先行、要点列表、每条结论后附来源 URL；③ 查不到就明说查到了什么、缺什么，不编造；④ 你没有文件工具、不能执行代码、不能直接回复用户。",
            # raw SubAgent spec 必填（create_sub_agent 缺了直接 ValueError，eager 编译
            # 意味着每条消息处理时都会炸）。model 与主代理一致，工具只给联网四件套——
            # 不配 interrupt_on：门禁只落在父级 task 一次（一次委派一张卡），
            # 子代理内部多轮搜索不再逐次弹卡，但事件仍会浮进父级流给前端展示。
            "model": llm_node.get_model(thread_id, reasoning_effort),
            "tools": [search, extract, crawl, map_site],
        }],
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
    return {"messages": round_messages(res["messages"], len(history), question, bool(attachments))
            ,"response_time_ms": state["response_time_ms"]+(end - start)}
