"""主智能体节点 —— 理解问题、编排子智能体、整合后答复用户。

    用户 ──▶ 主智能体（理解 / 拆分 / 派活）
                  ├─ task → policy     政策与奖助
                  ├─ task → academic   学业与选课
                  ├─ task → workflow   办事事项
                  ├─ task → research   联网调研
                  └─ task → general-purpose  通用兜底（文件 / 沙箱 / 多步任务）
             子智能体的报告回到主智能体（用户看不见）
                  ↓
             主智能体检查，必要时追派
                  ↓
             主智能体整合 ──▶ submit_answer ──▶ 用户

框架侧的保证：`task` 工具的描述原文写着 "The agent's report is not shown to the user;
relay a summary yourself." —— 「用户只看到主智能体整合的一份答复」是 deepagents 的既定语义，
不需要在主智能体之外再造一个汇总节点。

⚠️ 子智能体有三条**必须显式声明**的配置，不声明就出事（deepagents 0.7.14）：

1. `tools`：不写就**继承主智能体的全部工具**（`graph.py:760`
   `spec.get("tools") if "tools" in spec else tools`）。主智能体持有 `submit_answer`
   （全链路唯一出口）和 `run_on_host`（在用户电脑上执行命令），继承过去就是两个事故：
   子智能体抢走用户答复、子智能体无人拦地执行命令。**每个子智能体都显式写 tools**。
2. `interrupt_on`：不写就继承主智能体的（`graph.py:752`
   `spec.get("interrupt_on", interrupt_on)`）。主智能体拦的是 task / search / extract /
   crawl / map_site，子智能体一并继承 → 09-19 实测过的「批准 task 卡之后子智能体内部又弹一张」，
   与「一委派一张卡」的验收标准正好相反。这里一律显式给空 dict：联网这类动作在主智能体
   委派那一步已经批准过一次，子智能体内部不必逐次弹卡。
3. `permissions`：不写就**继承主智能体的**（`graph.py:683`
   `spec.get("permissions", permissions)`）。⚠️ 这一条是 2026-10-07 补的，此前注释里
   「子智能体手里没有需要拦的工具」**写错了**：框架给每个子智能体都装了
   `FilesystemMiddleware(backend=...)`，所以它手里有 `write_file` / `edit_file` / `delete`；
   而继承来的 permissions 在 ask/auto 档下含 `write: /user/** → interrupt`。
   更坑的是**第 2 条的空 dict 清不掉这些卡** —— `_merge_fs_interrupt_on`（`graph.py:191`）
   只按「同名工具」覆盖，空 dict 里没有工具名。⇒ 子代理内部会弹写卡，
   而子代理没有 checkpointer，**批准后续跑语义未定义**。
   所以一律显式写 `permissions.SUBAGENT_RULES`（无 interrupt 档：产物目录放行、
   改用户原文件直接拒，把写卡推回有 checkpointer 的主智能体）。
"""

import asyncio
import logging
import time

from deepagents import create_deep_agent
from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig
from deepagents.middleware.summarization import create_summarization_tool_middleware
from langchain.agents.middleware import TodoListMiddleware

from src.agent.file_backend import build_file_backend
from src.agent.history_utils import (
    fold_history_summary,
    plan_history_window,
    round_attachments,
    round_messages,
    sanitize_history,
    summary_message,
)
from src.agent.llm import llm_node
from src.agent.permissions import SUBAGENT_RULES
from src.agent.prompt.chat_agent_prompt import _ANSWER_STYLES
from src.agent.prompt.common_agent_prompt import common_agent_prompt
from src.agent.prompt.subagent_prompts import (
    ACADEMIC_SUBAGENT_PROMPT,
    GENERAL_PURPOSE_SUBAGENT_PROMPT,
    ORCHESTRATION_PROMPT,
    POLICY_SUBAGENT_PROMPT,
    RESEARCH_SUBAGENT_PROMPT,
    WORKFLOW_SUBAGENT_PROMPT,
)
from src.agent.sandbox.open_sandbox import get_backend
from src.agent.state.common_state import MultiAgentState
from src.agent.store.mongdb_store import store
from src.agent.supplement_inject import StopPauseMiddleware, SupplementInjectionMiddleware
from src.agent.tools import laya_guard
from src.agent.tools.host_exec import run_on_host
from src.agent.tools.knowledge_categories_tool import get_knowledge_tool
from src.agent.tools.knowledge_wiki_tool import wiki_save, wiki_search, wiki_sync
from src.agent.tools.mcp_tool import get_mcp_tools_sync
from src.agent.tools.openwiki_tool import run_openwiki

from src.agent.tools.retriever_tool import retriever_tool
from src.agent.tools.search_tool import map_site, crawl, extract, search
from src.agent.tools.store_tool import search_memories
from src.agent.tools.submit_answer import submit_answer
from src.agent.tools.task_info import get_task_info
from src.agent.tools.workspace_files import (
    download_from_sandbox,
    upload_to_sandbox,
)
from deepagents_code.ask_user import AskUserMiddleware

logger = logging.getLogger(__name__)

# 子智能体永远不许持有的两个工具（见模块顶部注释）。下面有断言守着。
_SUBAGENT_FORBIDDEN = {"submit_answer", "run_on_host"}

# 子智能体配置。每个都**显式**写 tools、interrupt_on、permissions —— 这三项都不能指望框架默认，
# 框架的默认恰恰是"继承主智能体"（见模块顶部注释第 1、2 条，以及
# `permissions.SUBAGENT_RULES` 上那段"为什么必须显式声明"）。
# model 由节点在运行时补（同一个 thread_id 共用一份）。
SUBAGENTS = [
    {
        "name": "documentation-maintainer",
        "description": "A specialized subagent that generates and updates the OpenWiki documentation for the codebase.",
        "system_prompt": "You are a documentation subagent. Your job is to run the OpenWiki CLI to generate or update the repository wiki. Use the shell to run `openwiki --init` for first-time setup or `openwiki --update` to refresh the docs.",
        "tools": [run_openwiki],  # 复用上面的 Shell 工具
        "interrupt_on": {},
        "permissions": SUBAGENT_RULES,
    },
    {
        "name": "policy",
        "description": "政策与奖助：校规校纪、奖助学金、荣誉评定与评优、违纪处分等政策性规定的查询"
                       "（申请条件、评定标准、额度、时间节点、适用范围、依据条文）。",
        "system_prompt": POLICY_SUBAGENT_PROMPT,
        "tools": [retriever_tool, get_knowledge_tool, wiki_search, wiki_save],
        "interrupt_on": {},
        "permissions": SUBAGENT_RULES,
    },
    {
        "name": "academic",
        "description": "学业与选课：选课与退改选、考试与成绩、学籍异动（休学复学转专业）、"
                       "培养方案与学分、毕业与学位要求、先修课与课程认定。",
        "system_prompt": ACADEMIC_SUBAGENT_PROMPT,
        "tools": [retriever_tool, get_knowledge_tool, wiki_search, wiki_save],
        "interrupt_on": {},
        "permissions": SUBAGENT_RULES,
    },
    {
        "name": "workflow",
        "description": "办事事项：某件事怎么办、要什么材料、满足什么条件、走什么流程、涉及哪些部门与"
                       "审批节点、有哪些时间节点；以及已有任务/工单的进度、状态与退回原因。",
        "system_prompt": WORKFLOW_SUBAGENT_PROMPT,
        "tools": [get_task_info, retriever_tool, get_knowledge_tool,
                  wiki_search, wiki_save],
        "interrupt_on": {},
        "permissions": SUBAGENT_RULES,
    },
    {
        "name": "research",
        "description": "资料调研：需要查最新外部信息（新闻、版本、政策动态、网页内容）时委派。"
                       "子代理内部会多轮搜索与抓取，返回一段带来源 URL 的报告。",
        "system_prompt": RESEARCH_SUBAGENT_PROMPT,
        "tools": [search, extract, crawl, map_site],
        "interrupt_on": {},
        "permissions": SUBAGENT_RULES,
    },
    {
        # 显式提供本 spec 会**顶掉**框架自动加的那个 general-purpose
        # （graph.py:795：只在"调用方没给同名 spec"时才自动补）。不顶掉的话，
        # 框架给它的 tools 是主智能体的全量（含 submit_answer），见模块顶部第 1 条。
        "name": "general-purpose",
        "description": "通用兜底：需要读写/处理用户上传的文件、跑代码，或不属于上面四个领域的"
                       "多步任务时委派。它拥有主智能体除「答复用户」「在用户电脑上执行命令」之外的"
                       "全部工具。",
        "system_prompt": GENERAL_PURPOSE_SUBAGENT_PROMPT,
        "tools": [retriever_tool, get_knowledge_tool, get_task_info,
                  upload_to_sandbox, download_from_sandbox,
                  search, extract, crawl, map_site,
                  wiki_search, wiki_save],
        "interrupt_on": {},
        "permissions": SUBAGENT_RULES,
    },
]

# 防回退：改 SUBAGENTS 时若有人抄了主智能体的 tools 又忘了删这两个，import 当场就抛，
# 而不是等线上出现「子智能体把用户答复抢走了」。同理，"漏写 tools 键"也会被下面拦下 ——
# 漏写 = 继承主智能体全量，比抄错更隐蔽，所以这里查的是"键存不存在"而不是"内容对不对"。
for _spec in SUBAGENTS:
    if "tools" not in _spec:
        raise ValueError(f"子智能体 {_spec['name']} 必须显式声明 tools（不写会继承主智能体全量）")
    # permissions 同理，而且比 tools 更隐蔽 —— 不写就继承主智能体在 ask/auto 档下的
    # `write: /user/** → interrupt`，而 `interrupt_on={}` **清不掉**它（只按同名工具覆盖）
    # ⇒ 子代理内部会弹写卡，而子代理没有 checkpointer，批准后续跑语义未定义。
    # 值用 `SUBAGENT_RULES`（无 interrupt 档）：产物目录放行、改用户原文件直接拒。
    if "permissions" not in _spec:
        raise ValueError(
            f"子智能体 {_spec['name']} 必须显式声明 permissions"
            f"（不写会继承主智能体的写卡，在子代理里弹卡无法续跑）")
    _leaked = _SUBAGENT_FORBIDDEN & {getattr(t, "name", "") for t in _spec["tools"]}
    if _leaked:
        raise ValueError(f"子智能体 {_spec['name']} 不许持有 {sorted(_leaked)}")
del _spec, _leaked


async def common_agent_node(state: MultiAgentState, config: RunnableConfig):
    # 单调时钟测耗时：time.time_ns 会被系统对时拨动，perf_counter 只进不退，专门干这个
    start = time.perf_counter()
    question = state["question"]
    sanitized_history = sanitize_history(list(state.get("messages") or []))

    # 跨轮历史窗口（见 history_utils 模块注释）：近 KEEP_ROUNDS 轮原文保留，
    # 更早轮次攒够 FOLD_ROUNDS 轮就折叠成滚动摘要。摘要是辅助步骤：折叠失败
    # 就本轮不折（待折叠内容原样留在上下文里，下轮重试），绝不中断主流程。
    # 摘要消息只进本轮模型输入，不返回进 state（与 laya 警示语同一纪律）。
    history_summary = state.get("history_summary") or ""
    history_covered = int(state.get("history_covered") or 0)
    to_fold, kept = plan_history_window(sanitized_history, history_covered)
    if to_fold:
        new_summary = await fold_history_summary(llm_node.model, history_summary, to_fold)
        if new_summary:
            history_summary = new_summary
            history_covered += len(to_fold)
        else:
            logger.warning("跨轮摘要折叠失败，本轮按未折叠窗口继续（%d 条待下轮重试）",
                           len(to_fold))
    history = ([summary_message(history_summary)] if history_summary else []) + kept

    configurable = config.get("configurable") or {}
    user_id = config.get("user_id")
    thread_id = configurable.get("thread_id") or "common-default"
    user_folder = configurable.get("user_folder")
    # 思考等级：透传原始值，收敛成网关枚举由 llm_node 一个出口负责（写错的代价是整轮 422）
    reasoning_effort = configurable.get("reasoning_effort")
    # 本轮附件块（见 conversations_repo.build_attachment_block）：只在本轮给模型看一次
    attachments = round_attachments(config)
    composite, permissions = build_file_backend(
        user_folder, configurable.get("permission_mode"), sandbox=get_backend(thread_id))
    answer_style = ""
    if configurable.get("answer_style") in _ANSWER_STYLES:
        answer_style = _ANSWER_STYLES.get(configurable.get("answer_style")) or ""
    # ORCHESTRATION_PROMPT 紧跟主提示词：它是"怎么派活"的约定，与子智能体侧的"怎么交活"
    # 成对（那份写在 subagent_prompts.py 里），分开改一边 = 主智能体在派活时按老规矩要求
    prompt = common_agent_prompt + ORCHESTRATION_PROMPT + answer_style

    # laya 输入护栏（本地 torch 决策模型，`laya_guard.py`）：命中就**在 prompt 末尾
    # 注入一句内部警示**。三条纪律，改这里之前先读 laya_guard 文件末尾那段注释：
    #   · 只拼进本轮 prompt，**绝不写进 state / messages** —— 否则被 checkpointer
    #     持久化，之后每轮历史重发都再烧一遍 token（对照"附件正文不进 messages"）。
    #   · 是"注入警示"而**不是拒绝回答** —— submit_answer 仍是唯一出口。
    #   · 护栏是辅助步骤：任何失败都降级成"本轮不筛"，绝不中断主流程。
    # ⚠️ 两个必须：① `screen_input` 是同步 CPU 推理（热调用实测 ~0.5 s），必须 to_thread，
    #    直接在 async def 里调会阻塞事件循环、把并发请求一起拖住；② 必须先问 `is_ready()`
    #    —— 预热要 80~130 s，未就绪就调会被 `Router._lock` 挂住近 2 分钟。
    #    护栏晚一两分钟生效可以接受，第一个用户等 2 分钟不可以。
    # ⚠️ 已知缺口：只筛 `question`，**不筛附件正文**（附件是后来拼进 HumanMessage 的）。
    #    要补的话在这里加，别挪到 `round_attachments` 里去筛。
    if laya_guard.is_ready():
        try:
            _warn = await asyncio.to_thread(laya_guard.screen_input, question)
            prompt += laya_guard.warning_for(_warn) or ""
        except Exception as e:
            logger.warning("laya 护栏不可用，本轮跳过筛查：%s", e)

    # 子智能体共用一份模型配置：同一个 thread_id 的 prompt cache，5 份构造没必要
    sub_model = llm_node.get_model(thread_id, reasoning_effort)
    subagents = [{**spec, "model": sub_model} for spec in SUBAGENTS]

    mcp_tools =  get_mcp_tools_sync()
    agent = create_deep_agent(
        system_prompt=prompt,
        model=llm_node.get_model(thread_id, reasoning_effort),  # promptCacheKey 按会话隔离
        tools=[
            retriever_tool, get_knowledge_tool, get_task_info,
            upload_to_sandbox, download_from_sandbox,
            run_on_host,
            submit_answer, search, extract, crawl, map_site, search_memories,
            *mcp_tools, run_openwiki,
            # 经验知识库三件套（OpenWiki personal，按用户隔离，见 knowledge_wiki_tool 模块注释）
            wiki_search, wiki_save, wiki_sync
        ],
        backend=composite,
        store=store,
        interrupt_on={
            "run_on_host": True,
            "search": True,
            "extract": True,
            "crawl": True,
            "map_site": True,
            # 委派要拦：子智能体内部不再逐次弹卡（它们的 interrupt_on 是空的），
            # 所以"派谁去、去干什么"就是用户唯一一次把关的机会 —— 一委派一张卡。
            "task": True,
        },
        permissions=permissions,
        subagents=subagents,
        middleware=[
            # 让主智能体也能主动向用户提问（界面渲染成可点选项，靠 LangGraph interrupt 暂停）
            AskUserMiddleware(),
            # 「执行中追加」（09-23 二次定稿）：生成中用户补充的话不打断任务，
            # 在每次模型调用前拼进上下文 —— 机制见 supplement_inject 模块注释
            SupplementInjectionMiddleware(thread_id),
            # 「暂停」（2026-10-08）：停止按钮的软暂停落点 —— 每次模型调用前查暂停位，
            # 命中则 interrupt() 停在干净边界；resume 时由它原位接住续跑决定。
            # 必须放在 SupplementInjectionMiddleware 之后：两者都在模型调用边界工作。
            StopPauseMiddleware(thread_id),
            create_summarization_tool_middleware(model=llm_node.model, backend=composite),
            TodoListMiddleware()
        ],
    )

    res = await agent.ainvoke(
        {"messages": [*history, HumanMessage(content=question + attachments)]}, config)
    # 落进 state 的那条必须是干净提问：附件正文只给模型看这一次，
    # 否则会被 checkpoint 持久化，之后每轮历史重发都再烧一次 token
    end = time.perf_counter()
    return {
        "messages": round_messages(res["messages"], len(history), question, bool(attachments)),
        "response_time_ms": int((end - start) * 1000),
        "history_summary": history_summary,
        "history_covered": history_covered,
    }
