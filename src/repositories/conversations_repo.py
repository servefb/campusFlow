import asyncio
import datetime
import json
import logging
import re
import uuid
from typing import Iterable

import aiofiles
from fastapi import HTTPException, UploadFile
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg.rows import dict_row
from sqlalchemy import select, update, func, delete, and_
from psycopg import AsyncConnection
from sqlalchemy.ext.asyncio import AsyncSession
from src.agent.llm.llm_node import model
from src.agent.prompt.chat_agent_prompt import chat_agent_prompt
from src.agent import approvals
from src.agent.tools.host_exec import blocked_reason, outside_notice
from src.agent.tools.knowledge_categories_tool import get_knowledge_tool
from src.repositories.workspace_browse_repo import resolve_workspace_path
from src.agent.tools.retriever_tool import retriever_tool
from src.agent.tools.task_info import get_task_info
from src.cache.redis_client import get_redis_client, close_redis_client
from src.db.db_conversation import conversation
from src.models.meassage import Message
from src.graph.create_Graph import get_app, DB_URI
from src.agent.state import common_state
from src.agent.supplement_inject import (
    clear_pause,
    clear_supplements,
    pause_requested,
    queue_supplement,
    request_pause,
)
from snowflake import SnowflakeGenerator
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage, SystemMessage
from src.db.db_message import messages as input_message
from src.models.page_query_res import page_query
from src.models.common_responce import result
from langgraph.types import Command, interrupt
from langchain.agents import create_agent

logger = logging.getLogger(__name__)


# 这些节点的 LLM token 需要 SSE 转发给前端（新增对话型节点后要加进来）。
# ⚠️ 节点名必须与 create_Graph.py 里 add_node 的名字逐字一致——09-18 实测：
# 图里把 campusflow_agent_node 改名 common_agent_node 后这里没跟上，消息块被
# 下面 `outer_node not in STREAMING_NODES` 的闸门静默 continue 滤光（不报错），
# 前端只剩 tool_result + done。改节点名时这两处必须一起改。
#
# 09-23：图里只剩主智能体一个节点（workflow_agent_node 已归档，见
# _legacy_multi_agent/README.md）。子智能体**不在这张表里** —— 它们由 deepagents
# 托管，token 走的是同一个外层节点，本来就放行。_graph_selftest.py 里有断言守着
# 「图里的节点名 ⊆ 这张表」。
STREAMING_NODES = {"common_agent_node"}

# 校本项目面向东八区用户，自然日边界按 UTC+8 计算；库里存 naive UTC(见 db 模型的 _utcnow)
TZ_OFFSET = datetime.timedelta(hours=8)

message_key = "campusflow:messages:"


def _local_midnight_utc(days_ago: int) -> datetime.datetime:
    """东八区「days_ago 天前当地 0 点」对应的 naive UTC 时间。"""
    local_now = datetime.datetime.now(datetime.timezone.utc) + TZ_OFFSET
    local_midnight = (local_now - datetime.timedelta(days=days_ago)).replace(hour=0, minute=0, second=0, microsecond=0)
    return local_midnight - TZ_OFFSET


def _echo(text: str) -> None:
    """控制台回显只是调试用。Windows 默认 GBK 控制台下，模型回复里的 emoji 会让
    print 抛 UnicodeEncodeError，而这一行在流式循环里 —— 它一炸，整轮请求(含后面的落库)
    就全没了，前端却已经看到完整回复。所以这里吞掉编码异常，绝不向外冒。"""
    try:
        print(text, end="", flush=True)
    except UnicodeEncodeError:
        pass


def _sse(event: str, data: dict) -> str:
    """把一帧 SSE 编码成「event/data + 空行分隔」的字符串。

    本模块所有事件都走这里，别再手写 f"event: x\\ndata: {json.dumps(...)}\\n\\n" ——
    那套写法要重复 4 次 `ensure_ascii=False, default=str`（里面含中文与 datetime/枚举，
    漏一个就是乱码或 TypeError）。收到 dict 是硬要求：SSE 载荷统一是 JSON 对象，
    传字符串进来说明调用方忘了包一层。
    """
    if not isinstance(data, dict):
        raise TypeError(f"_sse 的 data 必须是 dict，收到 {type(data).__name__}")
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


def _friendly_error(exc: BaseException) -> tuple[str, str]:
    """把上游/框架异常翻成用户能看懂的一句话（error 码 + 文案）。

    原始异常（422 的 JSON 原文、401、超时…）直接甩给前端没人看得懂，而且这类错误
    恰恰长得像"卡住" —— 09-20 那次就是服务端回了一句 unknown variant balance。
    载荷键名不变（error/message/detail），只换 error 码与文案，detail 仍留原文供排查。
    """
    name = type(exc).__name__
    text = str(exc)
    if "reasoning_effort" in text or "unknown variant" in text:
        return ("invalid_reasoning_effort",
                "模型的思考等级参数不被服务端接受，请把「深度思考」换成别的档位后重试。")
    if name in ("UnprocessableEntityError", "BadRequestError"):
        return "invalid_request", "请求参数被模型服务拒绝，请调整输入后重试。"
    if name in ("AuthenticationError", "PermissionDeniedError"):
        return "auth_error", "模型服务鉴权失败，请检查本机配置的 api_key。"
    if name == "RateLimitError":
        return "rate_limit", "模型服务限流了，稍等片刻再试。"
    if name in ("APITimeoutError", "APIConnectionError", "ConnectError", "ReadTimeout"):
        return "upstream_unreachable", "连不上模型服务，请检查网络后重试。"
    return "internal_error", "本轮处理出错，已中断。"


# ---------- 中断（interrupt）载荷 ----------
# 图里可能挂起的两种中断，载荷形状完全不同：
#   ask_user    {"type":"ask_user","questions":[...],"tool_call_id":...}
#   permission  {"action_requests":[...],"review_configs":[...]}   两种来源都会产出：
#               (a) 权限档位 ask/auto 时模型写 /user/** 被 HITL 拦下；
#               (b) 节点 interrupt_on 里登记的工具（如 search/extract）调用前被拦。
#               所以 action 的 name 不一定是文件工具，文案/图标必须按类别分派。
# 之前只按 ask_user 解析（直接取 value["questions"]），碰到权限中断就 KeyError 崩流。

# 视为「允许」的作答（前端卡片回传的是选项原文）
_APPROVE_ANSWERS = {"允许", "同意", "批准", "确认", "是", "approve", "allow", "yes", "y", "true"}


# 权限确认是「挂起」状态，作答回传的是 ask_user 形状的 answers，而 HITL 中间件
# 要的是 {"decisions":[...]}，且条数必须等于被拦截的工具调用数 —— 条数只有拦截
# 那一刻才知道，所以按会话记一份到 `src/agent/approvals.py`（那里同时负责**一次性
# 批准凭证**：记的是卡片上展示的那份参数，批准后换成凭证，工具执行前消费掉）。
# 用 Redis 存而不是进程内字典：多 worker / 重启后「批准」与「执行」还能对上。


def _is_approved(answers: list) -> bool:
    """作答是否等于「允许」（前端卡片回传的是选项原文）。"""
    return bool(answers) and str(answers[0]).strip().lower() in _APPROVE_ANSWERS


def _classify_interrupt(value) -> tuple[str, object]:
    """识别中断载荷 → ("stop_pause", value) / ("ask_user", questions) / ("permission", action_requests) / ("unknown", value)。"""
    if isinstance(value, dict):
        # 「暂停」（2026-10-08）：停止按钮的软暂停落地。必须排在最前 ——
        # 它的载荷是 {"type":"stop_pause"}，不能落进 unknown 当错误处理。
        if value.get("type") == "stop_pause":
            return "stop_pause", value
        questions = value.get("questions")
        if isinstance(questions, list):
            return "ask_user", questions
        actions = value.get("action_requests")
        if isinstance(actions, list):
            return "permission", actions
    return "unknown", value


# 权限确认卡片上的动作名（未收录的工具直接显示原名）。
#
# ⚠️ 被拦的**不只**是文件操作：节点 `interrupt_on` 登记的工具（search / extract / crawl /
# map_site）调用前同样会中断，和文件权限中断走同一条 SSE 分支。所以卡片标题只写中性的
# "要执行以下操作"，别写死"要修改你电脑上的文件"。新增需审批的工具时在这里登记中文名。
_TOOL_LABELS = {
    "write_file": "写入文件",
    "edit_file": "修改文件",
    "delete": "删除文件",
    "read_file": "读取文件",
    "ls": "列出目录",
    "glob": "查找文件",
    "grep": "搜索内容",
    "execute": "执行命令",
    # interrupt_on 拦下的联网工具（Tavily）
    "search": "联网搜索",
    "extract": "抓取网页",
    "crawl": "爬取网站",
    "map_site": "扫描站点",
    # interrupt_on 拦下的宿主机命令执行（沙箱外，见 tools/host_exec.py）
    "run_on_host": "在你电脑上执行命令",
    # interrupt_on 拦下的子代理委派（research 内部的搜索不经父级 HITL，门禁在 task 上）
    "task": "联网调研",
}

# 参数摘要：卡片上补一句"在搜什么 / 抓哪个页面"，否则非文件类动作只剩一个工具名，没法判断。
# 文件工具不吃这几个键（它们的路径走 path 字段），不会和 path 重复。
_SUMMARY_ARGS = ("query", "url", "urls", "pattern", "command", "description")


def _action_detail(args: dict, limit: int | None = 120) -> str:
    """从工具参数里挑一句给用户看的摘要（列表取前 3 项）。

    `limit=None` 表示**不截断** —— 宿主机命令必须走这条路：用户是照着这句决定放不放行的，
    悄悄砍掉尾部（原来砍在 600 字符、连省略号都没有）等于让他在看不全的情况下批准，
    而命令尾部恰恰可以藏 `&& ...` 或第二处重定向。
    """
    for key in _SUMMARY_ARGS:
        value = args.get(key)
        if isinstance(value, (list, tuple)):
            value = "、".join(str(v) for v in list(value)[:3])
        if value:
            text = str(value).strip()
            if text:
                return text if limit is None else text[:limit]
    return ""


def _permission_actions(actions: list, user_folder: str | None = None) -> list[dict]:
    """把 HITL 的 action_requests 压成前端卡片要用的业务结构。

    字段：工具原名、中文动作名、目标路径、目的（purpose）、参数摘要（detail）、
    访问范围提示（warning + warning_level）、是否会被安全规则拒绝（blocked）。
    不下发内部结构（review_configs 之类）。

    `user_folder` 只给宿主机命令用：run_on_host 能读写工作文件夹之外（用户批准即授权），
    卡片必须**在用户点允许之前**把访问范围讲清楚（见 tools/host_exec.py 的 outside_notice）
    —— 否则批准就算不上知情同意。
    """
    out: list[dict] = []
    for action in actions:
        if not isinstance(action, dict):
            continue
        name = action.get("name") or ""
        args = action.get("args") if isinstance(action.get("args"), dict) else {}
        # purpose 是联网工具与宿主机命令的必填参数（见 tools/），一句话说明这次调用
        # 要干什么 —— 比只给一个搜索词更能让用户判断该不该放行。
        purpose = args.get("purpose")
        is_host = name == "run_on_host"
        level, notice = outside_notice(args, user_folder) if is_host else ("", "")
        command = args.get("command") if isinstance(args.get("command"), str) else ""
        out.append({
            "tool": name,
            "label": _TOOL_LABELS.get(name, name or "工具调用"),
            "path": args.get("file_path") or args.get("path") or "",
            "purpose": purpose.strip() if isinstance(purpose, str) else "",
            # 宿主机命令**完整**下发（用户得看清到底要跑什么才敢批）；其余摘要保持短
            "detail": _action_detail(args, limit=None if is_host else 120),
            "warning": notice,
            "warning_level": level,
            # 破坏性命令工具侧必拒。提前标出来，用户就不会点一个注定被拒的「允许」
            # （工具与卡片共用同一个判据，见 host_exec.blocked_reason）。
            "blocked": blocked_reason(command) if is_host else "",
        })
    return out or [{"tool": "", "label": "工具调用", "path": "", "purpose": "",
                    "detail": "", "warning": "", "warning_level": "", "blocked": ""}]


def _permission_question(actions: list) -> dict:
    """权限确认的兜底问题（老客户端没有专门的权限卡片时，用 ask_user 卡片渲染）。

    文案点名具体动作（"是否允许写入文件"），和卡片的标题口径保持一致 —— 被拦的
    可能是文件写操作，也可能是联网工具调用，笼统的"要修改文件"会张冠李戴。

    ⚠️ 形状必须和 ask_user 的问题一致（question/type/choices/required），
    作答回传的 answers[] 里就是 choices 的 value 原文。
    这里把长内容压到 200 字符：问题行是给老客户端兜底用的，命令全文在专门卡片上。
    """
    items = _permission_actions(actions)
    short = lambda text: text if len(text) <= 200 else f"{text[:200]}…"  # noqa: E731
    if len(items) == 1:
        target = short(items[0]["path"] or items[0]["detail"])
        question = f"是否允许{items[0]['label']}" + (f"：{target}" if target else "") + "？"
    else:
        detail = "、".join(
            f"「{a['label']}」{short(a['path'] or a['detail'])}".strip() for a in items
        )
        question = f"是否允许执行以下操作：{detail}？"
    if any(item.get("blocked") for item in items):
        question += "（注意：其中含会被安全规则拒绝的命令，点允许也不会执行）"
    return {
        "question": question,
        "type": "multiple_choice",
        "choices": [{"value": "允许"}, {"value": "拒绝"}],
        "required": True,
    }


def _permission_decisions(answers: list, count: int) -> list[dict]:
    """把卡片作答翻译成 HITL 的 decisions（条数必须与被拦截的调用数一致）。"""
    decision = {"type": "approve"} if _is_approved(answers) else {
        "type": "reject",
        # 被拒的不一定是文件改动（也可能是联网工具调用），文案别写死
        "message": "用户拒绝了这次操作",
    }
    return [dict(decision) for _ in range(max(count, 1))]


def _extract_answer_prefix(raw: str) -> tuple[str | None, bool]:
    """从（可能不完整的）submit_answer 参数 JSON 里提取 answer 字段的已到达前缀。

    参数是分片到达的，形如 '{"answer": "课程退' —— 每次调用都重新解析，
    返回"已完整到达"的解码前缀与值是否闭合。解码支持 \\n \\t \\" \\\\ \\uXXXX；
    截断在转义序列中间时停住，等下一个分片补齐。
    """
    m = re.search(r'"answer"\s*:\s*"', raw)
    if not m:
        return None, False
    i = m.end()
    out: list[str] = []
    while i < len(raw):
        ch = raw[i]
        if ch == "\\":
            if i + 1 >= len(raw):
                break  # 转义序列被截断，等下一个分片
            nxt = raw[i + 1]
            if nxt == "n":
                out.append("\n")
            elif nxt == "t":
                out.append("\t")
            elif nxt == "r":
                pass
            elif nxt == '"':
                out.append('"')
            elif nxt == "\\":
                out.append("\\")
            elif nxt == "u":
                if i + 5 >= len(raw):
                    break  # \uXXXX 不完整
                try:
                    out.append(chr(int(raw[i + 2:i + 6], 16)))
                except ValueError:
                    out.append(raw[i:i + 6])
                i += 6
                continue
            else:
                out.append(nxt)
            i += 2
            continue
        if ch == '"':
            return "".join(out), True  # 值闭合，answer 完整到达
        out.append(ch)
        i += 1
    return "".join(out), False


async def chat_create_conversation(messages: Message, session: AsyncSession, user_id: int):
    gen = SnowflakeGenerator(instance=1)
    # 客户端回传 conversation_id 则续接同一线程(多轮对话)，否则新开线程
    thread_id = messages.conversation_id or str(next(gen))
    config = {"configurable": {"thread_id": thread_id, "tags": ["internal"]}}
    agent = await _get_chat_agent()

    yield _sse("accepted", {"conversation_id": thread_id})
    # route 只发一次（放循环里的话每个 chunk 都会带一个 route + done，前端直接炸）
    yield _sse("route", {"agent_key": "campusflowChat", "agent_name": "campusflowChat"})

    # stream_mode="messages" 才是逐 token；默认的 updates 模式产出的是 update 字典
    async for chunk, _meta in agent.astream(
            {"messages": [HumanMessage(content=messages.content)]},
            config,
            stream_mode="messages",
    ):
        if not chunk.content:
            continue  # 思考/reasoning chunk，content 为空
        if "internal" in _meta.get("tags", []):
            continue
        yield _sse("token", {"node": "campusflowChat", "text": chunk.content})

    # done 也只发一次（循环结束后）
    yield _sse("done", {"message_id": thread_id, "grounded": True})


# ---------- chat 单 agent 的懒加载（checkpointer 连接只建一次，避免每请求泄漏连接） ----------
_chat_agent = None
_chat_init_lock = asyncio.Lock()


async def _get_chat_agent():
    global _chat_agent
    if _chat_agent is not None:
        return _chat_agent
    async with _chat_init_lock:
        if _chat_agent is None:
            conn = await AsyncConnection.connect(
                DB_URI, autocommit=True, prepare_threshold=0, row_factory=dict_row
            )
            checkpointer = AsyncPostgresSaver(conn)
            await checkpointer.setup()  # 幂等建表/迁移
            _chat_agent = create_agent(
                model=model,
                system_prompt=chat_agent_prompt,
                tools=[retriever_tool, get_knowledge_tool, get_task_info],
                checkpointer=checkpointer,
            )
    return _chat_agent


async def get_conversation_title(content: str):
    message = [
        SystemMessage("你是标题生成器。根据用户问题或生成的内容生成简洁中文标题，"
                      "不超过15字，不要标点、引号、解释，只输出标题本身。"),
        HumanMessage(content=content)
    ]
    return model.ainvoke(message)


# ---------- 运行中的流任务注册表（「停止执行」功能的落点） ----------
# key=thread_id，value=生产者 task。asyncio 单线程内 dict 读写无 await 间隙，无需加锁。
#
# 「停止」语义（2026-10-08 改版：软暂停优先，强杀兜底）：
#   第一次点击 → 置暂停位，StopPauseMiddleware 在下一次模型调用边界 interrupt() ——
#   图停在干净 superstep 边界（模型未响应，无悬空 tool_calls），前端把「停止」换成
#   「继续」；继续 = Command(resume={"action":"continue"})，从断点续跑（已由
#   _stop_pause_probe2.py 实测：内层 agent 从 checkpoint 续跑，工具不重复执行）。
#   暂停位迟迟不落地（卡在长工具/子代理里，中间件没有执行机会）→ 看门狗到点强杀；
#   连点第二次 → 立即强杀。强杀 = 旧版硬取消，不可续跑（前端没有「继续」按钮）。
_STREAM_TASKS: dict[str, asyncio.Task] = {}
_STOP_REQUESTED: set[str] = set()
# 软暂停已落地（图停在 stop_pause interrupt 上）。与 _STOP_REQUESTED 分开记：
# 看门狗靠它区分「暂停已落地（别杀）」和「暂停位还没消费（该杀了）」。
_PAUSED_THREADS: set[str] = set()
# 软暂停的强杀截止时间（stop_stream 登记，看门狗消费）。看门狗本身由流的
# TaskGroup 托管（见 create_conversation），这里只传"何时杀"，不另起裸 create_task
# —— 裸句柄没人强引用会被 GC（本项目在 laya 预热上踩过）。
_PAUSE_ARMED: dict[str, float] = {}
# 软暂停等待落地的时限：超时视为卡在长工具/子代理里，强杀兜底。
import os  # 本模块的 os 是后置 import（CHUNK_SIZE 一带），注册表段先用先引
PAUSE_FORCE_CANCEL_S = int(os.getenv("PAUSE_FORCE_CANCEL_S", "8"))


def stop_stream(thread_id: str) -> bool:
    """请求停止某会话正在运行的流。True=停止已受理；False=没有在跑的流。"""
    task = _STREAM_TASKS.get(thread_id)
    if task is None or task.done():
        return False
    if thread_id in _STOP_REQUESTED:
        # 连点第二次：软暂停还没落地（或用户等不及）→ 立即强杀（不可续跑）
        if thread_id not in _PAUSED_THREADS:
            logger.info("[stop] 连点停止，强杀 thread=%s", thread_id)
            task.cancel()
        return True
    _STOP_REQUESTED.add(thread_id)
    request_pause(thread_id)
    # 只登记截止时间；到点强杀由流自己的看门狗执行（TaskGroup 托管，见
    # create_conversation._pause_watchdog），这里不 create_task。
    _PAUSE_ARMED[thread_id] = asyncio.get_running_loop().time() + PAUSE_FORCE_CANCEL_S
    return True


async def pending_stop_interrupt(graph_app, config: dict) -> bool:
    """该线程当前是否停在「暂停」中断上（前端此时发来新消息 = 隐式继续+补充）。"""
    try:
        snap = await graph_app.aget_state(config)
    except Exception:
        logger.exception("aget_state 失败，按「未暂停」处理 thread=%s",
                         (config.get("configurable") or {}).get("thread_id"))
        return False
    for t in (getattr(snap, "tasks", None) or []):
        for it in (getattr(t, "interrupts", None) or ()):
            v = getattr(it, "value", None)
            if isinstance(v, dict) and v.get("type") == "stop_pause":
                return True
    return False


CHUNK_SIZE = 1024 * 1024
from pathvalidate import sanitize_filename, validate_filename
from pathvalidate.error import ValidationError

import os
from pathlib import Path

# ---- 附件落盘配置（09-20 二次定稿）----
# 用户拍板：附件**一律落盘**，上下文里只给路径，模型需要时自己按路径读。
# 为什么不再把正文拼进提问：正文会随 checkpointer 持久化，之后每轮历史重发都要
# 再付一次 token；多个大文件还能把上下文窗口直接撑爆。路径只有几百字节，可长期保留。
UPLOAD_SUBDIR = os.getenv("ATTACH_SUBDIR", "uploads")
PROJECT_ROOT = Path(__file__).resolve().parents[2]  # src/repositories/x.py → 项目根
# 未选工作文件夹时的附件目录（开发阶段＝项目根下的 uploads/，用户拍板）。
# 它**同时充当 /user/ 路由的根**，所以模型只能看到附件目录本身，看不到项目源码。
DEFAULT_ATTACH_DIR = Path(
    os.getenv("ATTACH_DEFAULT_DIR") or (PROJECT_ROOT / UPLOAD_SUBDIR)
).expanduser()
# 单文件体积上限：HTTP 层没有限制，不拦的话一次上传就够把磁盘写满
MAX_ATTACH_BYTES = int(os.getenv("ATTACH_MAX_BYTES", str(200 * 1024 * 1024)))
# 能直接 read_file 当文本读的扩展名 —— 只用于给模型一个「走哪条通道」的提示，
# 不再解析内容（解析交给模型自己：文本直读，二进制 upload_to_sandbox 后跑代码）。
TEXT_EXTS = {".txt", ".log", ".md", ".markdown", ".csv", ".tsv", ".json",
             ".xml", ".yaml", ".yml", ".html", ".htm", ".py", ".java", ".js",
             ".ts", ".sql", ".ini", ".conf", ".srt", ".vtt"}


class _TooLarge(Exception):
    """单个附件超过 MAX_ATTACH_BYTES。"""

    def __init__(self, limit: int):
        human = (f"{limit / 1024 / 1024:.0f}MB" if limit >= 1024 * 1024
                 else f"{limit / 1024:.0f}KB" if limit >= 1024 else f"{limit}B")
        super().__init__(f"超过单文件上限 {human}，未保存")
        self.limit = limit


def attachment_plan(user_folder: str | None) -> tuple[Path, Path, bool]:
    """附件落点规划 → (附件目录, /user/ 路由根, 是否默认位置)。

    · 选了工作文件夹：附件放 `<工作文件夹>/uploads/` —— 附件是「输入材料」，
      与产物目录 ai_output/ 分开，也不跟用户自己的文件混在同一层；
    · 没选：放 DEFAULT_ATTACH_DIR，**它本身就是附件目录**（不再套一层 uploads），
      因为它的父目录是项目根，把项目根当 /user/ 会让模型能读写整个源码树。
    """
    if user_folder:
        root = Path(user_folder)
        return root / UPLOAD_SUBDIR, root, False
    return DEFAULT_ATTACH_DIR, DEFAULT_ATTACH_DIR, True


def _to_user_route(dest: Path, route_root: Path) -> str:
    """磁盘绝对路径 → 文件工具的虚拟路径（如 /user/uploads/成绩单.xlsx）。

    模型的内置文件工具只认 /user/ 前缀；算不出来就返回空串，调用方回落成绝对路径。
    """
    try:
        return "/user/" + dest.relative_to(route_root).as_posix()
    except ValueError:
        return ""


def _resolve_dest(dest_dir: str | os.PathLike, safe_name: str) -> str:
    root = os.path.realpath(dest_dir)
    dest = os.path.realpath(os.path.join(root, safe_name))
    if dest != root and not dest.startswith(root + os.sep):
        raise HTTPException(400, "非法路径")
    # 若已存在，追加 uuid 后缀避免覆盖
    if os.path.exists(dest):
        stem, ext = os.path.splitext(safe_name)
        safe_name = f"{stem}_{uuid.uuid4().hex[:8]}{ext}"
        dest = os.path.realpath(os.path.join(root, safe_name))
    return dest


def _safe_name(filename: str | None) -> str:
    """用 pathvalidate 校验并清理文件名。"""
    if not filename:
        raise HTTPException(400, "文件名为空")

    # 先尝试严格校验
    try:
        validate_filename(
            filename,
            platform="universal",  # 跨平台安全
            max_len=255,
            check_reserved=True,
        )
        return filename
    except ValidationError:
        pass

    # 校验失败则清理
    sanitized = sanitize_filename(
        filename,
        replacement_text="_",
        platform="universal",
        max_len=255,
        check_reserved=True,
    )

    # 清理后可能变成空字符串（比如全是非法字符）
    if not sanitized or sanitized in (".", ".."):
        raise HTTPException(400, "文件名非法，清理后为空或为保留名")

    return sanitized


def _is_textual(filename: str, content_type: str) -> bool:
    if os.path.splitext(filename)[1].lower() in TEXT_EXTS:
        return True
    ct = (content_type or "").lower()
    return ct.startswith("text/") or ct in ("application/json", "application/xml")


async def route_files(files: Iterable[UploadFile], user_folder: str | None):
    """把本轮附件**全部落盘**，只把路径交给模型（09-20 二次定稿）。

    落点见 attachment_plan：选了工作文件夹 → `<工作文件夹>/uploads/`；
    没选 → DEFAULT_ATTACH_DIR。所以"没选文件夹"不再等于"存不下"——
    这正是用户要的效果：上传附件不强制先选工作区。

    saved 每项：{filename, path, abs_path, size, kind}
      · path     —— /user/ 虚拟路径，给内置文件工具（read_file / glob）用；
      · abs_path —— 磁盘绝对路径，给 run_on_host 和"告诉用户文件在哪"用；
      · kind     —— text（可直接 read_file）/ binary（pdf、docx、xlsx 等文档需
                    upload_to_sandbox 后跑代码解析；图片可直接 read_file，模型有视觉）。
    rejected 每项：{filename, reason}，如实交给模型转述，**不整轮报错**
    （旧版一个文件失败会把整轮对话 413 杀掉）。

    ⚠️ 本函数跑在 SSE 流**已经开始**之后，异常绝不能裸抛出去 —— 会被生产者 task 吞掉，
    前端只看到"转了半天空洞"（见 _produce 的兜底）。所以逐个文件单独 catch。
    """
    dest_dir, route_root, _is_default = attachment_plan(user_folder)
    saved: list = []
    rejected: list = []

    try:
        dest_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.warning("附件目录不可用 dir=%s", dest_dir, exc_info=True)
        return [], [{"filename": None, "reason": f"附件目录不可用（{dest_dir}）：{exc}"}]

    for f in files:
        filename = getattr(f, "filename", None)
        if not filename:
            rejected.append({"filename": None, "reason": "文件名为空"})
            continue

        try:
            dest, size = await save_attachment(dest_dir, filename, f)
        except _TooLarge as exc:
            rejected.append({"filename": filename, "reason": str(exc)})
            continue
        except HTTPException as exc:
            rejected.append({"filename": filename, "reason": f"保存失败：{exc.detail}"})
            continue
        except Exception as exc:
            logger.warning("附件保存失败 filename=%s", filename, exc_info=True)
            rejected.append({"filename": filename, "reason": f"保存失败：{exc}"})
            continue

        saved.append({
            "filename": filename,
            "path": _to_user_route(Path(dest), route_root) or str(dest),
            "abs_path": str(dest),
            "size": size,
            "kind": "text" if _is_textual(filename, getattr(f, "content_type", "") or "")
            else "binary",
        })

    return saved, rejected


async def save_attachment(dest_dir: Path, filename: str, stream: UploadFile) -> tuple[str, int]:
    """流式写盘，返回 (绝对路径, 字节数)；超限或异常时清掉半截文件再抛。"""
    safe_name = _safe_name(filename)
    dest = _resolve_dest(dest_dir, safe_name)
    size = 0
    try:
        async with aiofiles.open(dest, "wb") as out:
            while True:
                chunk = await stream.read(CHUNK_SIZE)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_ATTACH_BYTES:
                    raise _TooLarge(MAX_ATTACH_BYTES)
                await out.write(chunk)
    except BaseException:
        # 半截文件不能留在磁盘上：下次同名上传会被它挤成 uuid 后缀，用户看到两个文件
        try:
            os.remove(dest)
        except OSError:
            pass
        raise
    return dest, size


def build_attachment_block(saved: list, rejected: list, is_default: bool = False,
                           reuse: bool = False) -> str:
    """把「附件在哪」拼成给模型的文本（附在用户问题末尾，由节点加进本轮消息）。

    只给路径、不给正文：正文进上下文会随 checkpointer 每轮重发（token 白烧），
    大文件还能把窗口撑爆。模型需要内容时自己按 path 读。
    """
    segs = []
    if saved:
        where = ("默认附件目录（用户未选工作文件夹）" if is_default
                 else "工作文件夹的 uploads/ 目录")
        # 不 dump JSON：Windows 路径在 JSON 里会变成 `C:\\dir\\a.xlsx`（反斜杠被转义），
        # 模型把这串照抄进命令就是坏的。改成逐条可读清单，路径原样出现。
        lines = []
        for i, it in enumerate(saved, 1):
            lines.append(f"{i}) {it.get('filename')}"
                         f"   大小 {it.get('size')} B，kind={it.get('kind')}\n"
                         f"   path（内置文件工具用）: {it.get('path')}\n"
                         f"   abs_path（宿主机命令 / 回答文件位置用）: {it.get('abs_path')}")
        if reuse:
            # 沿用轮次只给「位置索引」，措辞必须被动式：之前写成「可直接按路径读回」+ 全套
            # 读法说明，结果每轮都把附件重新喂到模型眼前，无关问题它也会去把图片读一遍
            # （2026-10-07 用户实测反馈），白烧 token 还拖慢响应。
            segs.append(
                f"\n\n历史附件记录（本会话此前上传，文件仍在本机），保存在{where}：\n"
                + "\n".join(lines)
                + "\n这只是位置索引，不是本轮任务的材料："
                  "仅当用户本轮的问题明确涉及这些附件（追问内容、要求处理等）时才按需读取"
                  "（图片可直接 read_file 读 path）；问题没有提到它们时，"
                  "不要读取、不要查看，也不要在回答里主动提及。"
            )
        else:
            segs.append(
                f"\n\n本轮上传的附件保存在{where}，**这里只给路径，内容需要时自己读**：\n"
                + "\n".join(lines)
                + "\n读法：kind=text 和**图片（png/jpg/webp/gif 等）**直接 read_file 读 path；"
                  "kind=binary 里的 pdf/docx/xlsx 等文档不要 read_file（读不出正文），"
                  "先 upload_to_sandbox 再用代码解析。"
                  "只回答「文件在哪」时直接用给到的路径，不必先读。不要凭文件名猜内容。"
            )
    if rejected:
        rej_lines = [f"{i}) {r.get('filename')} —— {r.get('reason')}"
                     for i, r in enumerate(rejected, 1)]
        segs.append("\n\n未能处理的附件（这些文件没有保存成功）:\n"
                    + "\n".join(rej_lines)
                    + "\n必须如实向用户说明原因，不得假装看到了内容。")
    return "".join(segs)


async def create_conversation(messages: Message, session: AsyncSession, user_id: int):
    """对路由仍暴露为 async generator（调用方式零改动）。内部拆成生产者/消费者：

    生产者 task 跑 _agent_stream，把 SSE 事件写进队列 —— 这个 task 就是停止注册表里
    可取消的「把手」；消费者（本 generator）从队列取事件转发给 SSE，退出时若生产者
    还活着就顺手取消（客户端断开 = 停止本轮执行的兜底路径）。
    队列不设上界：SSE 事件都很小，背压不值得用「取消落在 put 上、丢了优雅收尾」去换。
    """
    gen = SnowflakeGenerator(instance=1)
    # 客户端回传 conversation_id 则续接同一线程(多轮对话)，否则新开线程
    thread_id = messages.conversation_id or str(next(gen))

    # ---------- 「执行中追加」（09-23 二次定稿）：上一轮流还在跑时来了新消息 ----------
    # 语义 = **软注入**，不是停旧续新（用户拍板：追加的话是给正在执行任务的补充材料，
    # 旧任务不能丢）。补充走 POST /conversations/{id}/supplement（send_supplement）：
    # 用户消息即时落库 + 进补充队列，主智能体下一次调用模型前由 SupplementInjectionMiddleware
    # 拼进上下文，任务照常跑。
    # 本端点（流式）撞上执行中的流则一律拒绝 —— 两个 run 同时写一个 thread 会交错写
    # checkpoint（状态竞争），resume/空载荷/正文都一样，没有例外。
    prev_task = _STREAM_TASKS.get(thread_id)
    if prev_task is not None and not prev_task.done():
        yield _sse("error", {"error": "stream_running",
                             "message": "上一条消息还在执行中，请等它结束或先停止再操作。"})
        return

    queue: asyncio.Queue = asyncio.Queue()

    async def _produce() -> None:
        task = asyncio.current_task()
        _STREAM_TASKS[thread_id] = task
        try:
            async for ev in _agent_stream(messages, session, user_id, thread_id):
                queue.put_nowait(ev)
        except asyncio.CancelledError:
            # 「停止」按钮的取消语义要原样传下去，别被下面的兜底改写成"内部错误"
            raise
        except BaseException as exc:
            # ⚠️ 兜住一切：没有这层的话，异常只留在 task 里，而没人 await
            # produce_task.result()，消费者照样收到 None 正常收摊 ——
            # 前端表现就是"卡住且不报错"（09-20 定位的根因之一）。
            logger.exception("agent 流异常终止 thread=%s", thread_id)
            code, message = _friendly_error(exc)
            queue.put_nowait(_sse("error", {
                "error": code,
                "message": message,
                "detail": str(exc)[:300],
            }))
        finally:
            _STREAM_TASKS.pop(thread_id, None)
            _STOP_REQUESTED.discard(thread_id)
            _PAUSE_ARMED.pop(thread_id, None)  # 轮次结束，强杀截止时间作废
            # 「执行中追加」：轮次结束，补充队列作废（残留 = 模型已交卷没看到，见
            # supplement_inject 模块注释 —— 用户消息已落库，界面历史不丢）
            clear_supplements(thread_id)
            queue.put_nowait(None)  # 唤醒消费者收摊

    async def _pause_watchdog(produce_task: asyncio.Task) -> None:
        """软暂停落地看门狗（由下方 TaskGroup 托管，随流而生、随流而灭）。

        stop_stream 只往 _PAUSE_ARMED 里登记截止时间（不裸 create_task——裸句柄
        没人强引用会被 GC）。到截止时间暂停位还没落地（卡在长工具/子代理里，
        中间件没有执行机会）→ 强杀生产者（= 旧版硬取消，不可续跑）。
        """
        loop = asyncio.get_running_loop()
        while not produce_task.done():
            deadline = _PAUSE_ARMED.get(thread_id)
            if deadline is None:
                await asyncio.wait({produce_task}, timeout=0.5)
                continue
            remaining = deadline - loop.time()
            if remaining > 0:
                await asyncio.wait({produce_task}, timeout=min(remaining, 0.5))
                continue
            if not produce_task.done() and thread_id not in _PAUSED_THREADS \
                    and pause_requested(thread_id):
                logger.warning("[stop] 软暂停 %ss 未落地（长工具/子代理执行中），强杀 thread=%s",
                               PAUSE_FORCE_CANCEL_S, thread_id)
                produce_task.cancel()
            return

    # ---------- 流生命周期：TaskGroup 结构化托管（2026-10-08 代替裸 create_task） ----------
    # produce（SSE 生产者）+ 暂停看门狗 同组。语义已由 _taskgroup_stream_probe.py 实测：
    #  · 强杀 produce（外部 cancel）→ produce 的 finally 哨兵照常被消费，消费侧干净收口；
    #  · 客户端断开（aclose→GeneratorExit）→ 组自动 cancel 生产者（替代旧 finally 手动 cancel），
    #    但 TaskGroup 会把 GeneratorExit 包成 BaseExceptionGroup 抛出 —— 下方必须拆包安静收口；
    #  · produce 抛异常同理以 ExceptionGroup 冒出（生产里 _produce 已自兜 error 事件，此处兜底记日志）。
    try:
        async with asyncio.TaskGroup() as tg:
            produce_task = tg.create_task(_produce(), name=f"produce:{thread_id}")
            tg.create_task(_pause_watchdog(produce_task),
                           name=f"pause-watchdog:{thread_id}")
            while True:
                ev = await queue.get()
                if ev is None:
                    break
                yield ev
    except asyncio.CancelledError:
        raise  # 响应任务自身被取消（客户端断开走任务取消路径）——照常向上传播
    except BaseExceptionGroup as eg:
        if all(isinstance(e, GeneratorExit) for e in eg.exceptions):
            return  # aclose 收口：生成器正在关闭，子任务已被组取消，别把组炸回调用方
        for e in eg.exceptions:
            logger.error("SSE 流子任务异常终止 thread=%s", thread_id, exc_info=e)
        return


async def send_supplement(messages: Message, session: AsyncSession, user_id: int) -> dict:
    """「执行中追加」端点的实现：把补充内容递给**正在执行**的轮次（不打断、不重开）。

    09-23 二次定稿：追加 = 给当前任务的补充材料，不是新问题。链路：
    本函数（即时落库 + 入队）→ SupplementInjectionMiddleware 在主智能体下一次
    调用模型前把队列里的补充拼进上下文 → 轮次收尾时清队。

    - 该会话没有在跑的流 → queued=False（流刚好自己结束了的竞态由前端提示兜住）；
    - 有 → 用户消息**即时**落库：正在跑的那轮收尾时只落它自己 state 里的消息，
      补充不自己插队的话，界面历史里就永远没有这条。
    """
    thread_id = str(messages.conversation_id or "")
    content = (messages.content or "").strip()
    if not thread_id or not content:
        return {"queued": False, "reason": "bad_request", "conversation_id": thread_id}
    prev_task = _STREAM_TASKS.get(thread_id)
    if prev_task is None or prev_task.done():
        return {"queued": False, "reason": "not_running", "conversation_id": thread_id}
    ims = input_message()
    ims.conversation_id = thread_id
    ims.content = content
    ims.role = "user"
    ims.status = "completed"
    session.add(ims)
    await session.commit()
    queue_supplement(thread_id, content)
    return {"queued": True, "conversation_id": thread_id}


_WS_CACHE_TTL = 7 * 86400  # 工作区绑定缓存 7 天


async def _bound_workspace(redis_client, thread_id: str) -> str:
    """读会话绑定的工作区（仅 Redis；09-19 按用户拍板去掉 DB 兜底查询）。

    前端约定每轮请求（含 resume/权限卡作答）都携带 workspace_path， Redis 命中
    不了的场景由前端补发兜住。两边都没有时 agent 引导用户重新选文件夹即可。
    """
    try:
        cached = await redis_client.get(f"conv:{thread_id}:ws")
    except Exception:
        return ""
    return str(cached) if cached else ""


async def _agent_stream(messages: Message, session: AsyncSession, user_id: int, thread_id: str):
    redis_client = get_redis_client()  # 同步函数，返回共享单例，不要 await
    yield _sse("accepted", {"conversation_id": thread_id})

    config = {"configurable": {
        "thread_id": thread_id,
        # user_id 兜底通道：主智能体的工具从 astream(context=...) 读到它，但 deepagents
        # 的 task 工具起子图时不带 context，子智能体的 wiki_* 工具只能从 configurable
        # 拿 —— 与 knowledge_wiki_tool._current_user_id 成对，去掉一边就查错用户库。
        "user_id": str(user_id),
        # 权限档位（ask/auto/full）：节点据此生成 deepagents 的文件权限规则
        "permission_mode": messages.permission_mode or "ask",
        # 思考等级：**原值透传**（前端约定 off/low/high/max，见 src/models/meassage.py）。
        # 收敛成网关认识的枚举只由 llm_node.normalize_reasoning_effort 一处负责 ——
        # 之前这里写死 `or "off"`，而网关不认 off，于是每一轮都 422（见 llm_node 模块注释）。
        "reasoning_effort": messages.thinking_level,
        "answer_style": messages.answer_style or "balanced",
    }}

    # 工作区绑定（09-19 定稿）：前端每轮（含 resume）都带 workspace_path，Redis 作服务端
    # 缓存；本轮带了就以本轮为准并写穿（用户换绑即时生效），没带则回源 Redis。
    ws_path = messages.workspace_path
    if not ws_path and messages.conversation_id:
        ws_path = await _bound_workspace(redis_client, thread_id)
    if ws_path:
        # 前端传的是文件夹选择器里选中的位置，格式 `<root_key>:<相对路径>`
        # （如 `desktop:材料`、`d:exam`）。浏览器拿不到本机绝对路径，
        # 绝对路径统一由后端解析，并作为文件工具的读写边界。
        try:
            folder = resolve_workspace_path(ws_path)
        except ValueError as exc:
            msg = f"工作文件夹无效：{ws_path}（{exc}）"
            yield _sse("error", {"error": "bad_request", "message": msg})
            return
        config["configurable"]["user_folder"] = str(folder)
        # 写穿缓存（回填值重设一次无害，顺带续期）；Redis 挂了不影响主流程
        try:
            await redis_client.set(f"conv:{thread_id}:ws", ws_path, ex=_WS_CACHE_TTL)
        except Exception:
            pass
    elif messages.files or DEFAULT_ATTACH_DIR.is_dir():
        # 没选工作文件夹也不再"存不下"（09-20 二次定稿）：附件有默认落点，
        # 并且把它当成 /user/ 路由的根，模型才读得回附件（只喂路径的前提是读得到）。
        # 只在「本轮真有附件」或「之前建过」时创建，免得每开一个会话就往磁盘塞目录。
        try:
            DEFAULT_ATTACH_DIR.mkdir(parents=True, exist_ok=True)
            config["configurable"]["user_folder"] = str(DEFAULT_ATTACH_DIR)
            config["configurable"]["user_folder_is_default"] = True
        except OSError as exc:
            logger.warning("默认附件目录不可用 dir=%s err=%s", DEFAULT_ATTACH_DIR, exc)

    # ---------- 本轮附件（09-20 二次定稿：一律落盘，只给路径）----------
    # 附件块走 config 传给节点，**不拼进 messages.content 正文**。
    # 原因：question 会被节点写成 HumanMessage 并持久化（checkpointer + 消息表），
    # 附件正文一旦进去就留在 thread 里 —— 此后每轮历史重发都要再付一次 token，
    # 标题生成 / 历史回放 / 消息表也全被这几万字污染。
    # 节点侧负责「本轮拼上、落 state 前换回干净提问」，见 history_utils.round_messages。
    raw_content = messages.content or ""  # 标题生成用原始提问，不带附件
    user_folder = config["configurable"].get("user_folder")
    is_default = bool(config["configurable"].get("user_folder_is_default"))
    if messages.files:
        try:
            saved_files, rejected_files = await route_files(messages.files, user_folder)
        except Exception as exc:
            # route_files 内部已逐文件兜错，这是最后一道：附件再出问题也不能毁掉整轮
            logger.exception("附件处理失败 thread=%s", thread_id)
            saved_files, rejected_files = [], [{"filename": None,
                                                "reason": f"附件处理异常：{exc}"}]
        block = build_attachment_block(saved_files, rejected_files, is_default)
        # 记住这一轮的路径清单（几百字节）：后面轮次没带新附件时复用，
        # 用户追问「刚才那个文件」、以及 ask_user 作答续跑（resume）都能读到，
        # 不必让他重传。存 Redis 不进 state/checkpoint，所以不会被每轮重发。
        if saved_files:
            try:
                await redis_client.set(
                    f"conv:{thread_id}:attach",
                    json.dumps({"saved": saved_files, "is_default": is_default}),
                    ex=_WS_CACHE_TTL)
            except Exception:
                pass
    else:
        block = ""
        try:
            cached = await redis_client.get(f"conv:{thread_id}:attach")
            last = json.loads(cached) if cached else None
        except Exception:
            last = None
        if isinstance(last, dict) and last.get("saved"):
            block = build_attachment_block(last["saved"], [], bool(last.get("is_default")),
                                           reuse=True)
    config["configurable"]["attachments"] = block

    graph_app = await get_app()  # 首次调用时会连 Postgres 并建表(幂等)

    graph_input = None
    if messages.resume:
        try:
            resume_payload = json.loads(messages.resume)
        except json.JSONDecodeError:
            resume_payload = {"status": "error", "error": "invalid resume payload"}
        if not isinstance(resume_payload, dict):
            resume_payload = {"status": "error", "error": "invalid resume payload"}
        # ⚠️ 客户端**不得**直传 HITL 的 decisions：`{"type":"edit","edited_action":{…}}`
        # 能把参数甚至工具名整个换掉，而 HITL 会照单执行 —— 即"不弹卡片也能跑任意命令"。
        # 所以只认 answers，decisions 一律由服务端翻译（见下），其余形状直接拒绝。
        if "decisions" in resume_payload or "edited_action" in resume_payload:
            logger.warning("[audit] 拒绝客户端直传 decisions thread=%s", thread_id)
            yield _sse("error", {"error": "invalid_resume",
                                 "message": "resume 载荷不合法：不接受客户端直传的 decisions，请改用 answers。"})
            return
        # 「暂停续跑」（2026-10-08）：停止按钮的「继续」。与权限确认互斥 ——
        # 若此刻还挂着权限卡，说明状态错乱，拒绝而不是把控制类载荷喂给 HITL。
        if resume_payload.get("action") == "continue":
            pending = await approvals.pop_pending(thread_id)
            if pending is not None:
                yield _sse("error", {"error": "invalid_resume",
                                     "message": "该会话还挂着待确认的操作，请先处理确认卡片。"})
                return
            graph_input = Command(resume=resume_payload)
        else:
            # 挂起的是「权限确认」时，前端回传的仍是 ask_user 形状的 answers，
            # 而 HITL 中间件要的是 {"decisions":[...]}（条数须等于被拦截的调用数）——
            # 在这里翻译。pending 来自下发卡片时的登记，取到即清，避免串轮。
            # 用户点「允许」时同时发放**一次性凭证**（approvals.grant_digests）：
            # 那是 run_on_host 执行前唯一认的东西。
            pending = await approvals.pop_pending(thread_id)
            if pending is None:
                graph_input = Command(resume=resume_payload)
            elif "answers" not in resume_payload:
                # 卡片还挂着却没带 answers：别把畸形载荷丢给 HITL（它会 KeyError 崩流）
                yield _sse("error", {"error": "invalid_resume",
                                     "message": "这条确认还没有作答，请重新提交允许或拒绝。"})
                return
            else:
                answers = resume_payload.get("answers") or []
                count = int(pending.get("count") or 1)
                if _is_approved(answers):
                    granted = await approvals.grant_digests(
                        thread_id, [a.get("digest") for a in (pending.get("actions") or [])]
                    )
                    logger.info("[audit] 用户批准 thread=%s 动作=%s 凭证=%s",
                                thread_id, count, granted)
                else:
                    logger.info("[audit] 用户拒绝 thread=%s 动作=%s", thread_id, count)
                resume_payload = {"decisions": _permission_decisions(answers, count)}
                graph_input = Command(resume=resume_payload)
    elif messages.content is not None:
        # 用户直接开了新话题（不是作答）：上一轮挂起的权限确认已作废，
        # 清掉登记与未消费的凭证，免得后面某次 ask_user 作答被误当成权限确认翻译成 decisions
        await approvals.clear_pending(thread_id)
        if await pending_stop_interrupt(graph_app, config):
            # 暂停中用户直接输入 = 隐式「继续」+ 把新消息当【用户补充】喂给断点后
            # 的模型调用（由 StopPauseMiddleware 消费 resume 值时注入）。
            # 用户消息即时落库（同 send_supplement：暂停轮自己的落库已经结束，
            # 不在这里补一条，界面历史里就永远没有这条）。
            ims = input_message()
            ims.conversation_id = thread_id
            ims.content = messages.content
            ims.role = "user"
            ims.status = "completed"
            session.add(ims)
            await session.commit()
            graph_input = Command(resume={"action": "continue", "supplement": messages.content})
        else:
            # 注意：右侧必须用 messages.content，不能用 graph_input——
            # 赋值语句右侧读到的是旧值(None)，question 就成了 None
            graph_input = common_state.MultiAgentState(question=messages.content, agent_mode=messages.agent_mode)

    con = conversation(title=messages.title, user_id=user_id, source=messages.source, id=thread_id,
                       last_message_at=datetime.datetime.now(datetime.timezone.utc))
    if ws_path:
        con.work_space = ws_path
    count = await redis_client.incr(f"conv:{thread_id}:msg_count")
    if count is not None:
        await redis_client.set(f"conv:{thread_id}:msg_count", 0, ex=86400)
    title_task = None
    title_sent = False

    if not messages.conversation_id and raw_content.strip():
        title_task = asyncio.create_task(get_conversation_title(raw_content))
    final_state = None
    last_route = None
    base_count = None
    reasoning_parts = []

    # 两个分支都没命中（content 为空且无 resume）——别让 None 进 astream
    if graph_input is None:
        yield _sse("error", {"error": "bad_request", "message": "消息内容为空，无法开始对话"})
        return

    # ---------- 回答 / 工作过程的分流（结构性方案：submit_answer） ----------
    # 此前"给用户的话"和"干活的话"走同一条消息流，只能靠"有没有工具调用、
    # 是不是最后一条"去猜（窗口、撤回、回放……），猜错的边角修不完。
    # 现在提示词要求模型：**给用户的回答必须通过 submit_answer 工具提交**
    # （return_direct=True，调用即收尾）。分类因此变成确定性的：
    #   · 一切普通文本 = 工作过程 → 「工作过程」面板，永不进正文区（天然零闪烁）；
    #   · submit_answer 的 answer 参数 = 给用户的回答 → 边流边推（真打字机）。
    cur_msg_id = None
    step_text: dict[str, str] = {}  # msg_id -> 本条消息的文本（全部属于工作过程）
    step_node: dict[str, str] = {}
    # msg_id -> {index: {"name","args","node","answer_sent"}}（answer_sent 仅 submit_answer 用）
    tool_buffer: dict[str, dict] = {}
    submit_seen = False  # 本轮是否出现过 submit_answer（决定流末尾走哪条路径）
    # 已在流中实时推过 tool_result 的 call_id：流末尾从 state 补发时按它去重，
    # 同一个结果绝不发两遍（工具在子图里执行时消息可能跨命名空间重复出现，也一并挡掉）。
    results_sent: set[str] = set()

    def _drain_tool_events(msg_id: str) -> list[str]:
        """把某条消息累积的工具调用结算成 event: tool 事件。

        submit_answer 例外：它的参数就是回答本身，已经按 token 实时推出，
        再显示一行工具调用纯属噪音。
        """
        return [
            _sse("tool", {"node": call.get("node"), "tool": call["name"],
                          "args": call.get("args") or "", "call_id": call.get("id")})
            for call in (tool_buffer.pop(msg_id, {}) or {}).values()
            if call.get("name") and call["name"] != "submit_answer"
        ]

    def _flush_step_text(mid: str) -> list[str]:
        """结算某条消息攒下的正文文本为 step（一条消息只发一次，避免碎成多行）。"""
        text = step_text.pop(mid, "")
        if not text:
            return []
        return [_sse("step", {"node": step_node.pop(mid, None), "text": text})]

    def _submit_answer_deltas(msg_id: str, outer_node) -> list[str]:
        """从 submit_answer 的流式参数里解析 answer 字段，把新增部分作为 token 发出。
        参数 JSON 是碎片化到达的（如 '{"answer": "课程退'），这里每次都尝试
        提取"已完整到达"的前缀（处理转义与截断），只把新增的解码文本发出去。
        """
        events = []
        for call in (tool_buffer.get(msg_id, {}) or {}).values():
            if call.get("name") != "submit_answer":
                continue
            prefix, _closed = _extract_answer_prefix(call.get("args") or "")
            sent = call.get("answer_sent", 0)
            if prefix and len(prefix) > sent:
                call["answer_sent"] = len(prefix)
                events.append(_sse("token", {"node": call.get("node") or outer_node,
                                             "msg_id": msg_id, "text": prefix[sent:]}))
        return events

    stopped = False
    _aiter = graph_app.astream(graph_input, config=config,context={"user_id": str(user_id)}, stream_mode=["messages", "values"],
                               subgraphs=True).__aiter__()
    while True:
        try:
            ns, mode, payload = await _aiter.__anext__()
        except StopAsyncIteration:
            break
        except asyncio.CancelledError:
            stopped = True
            break
        # 标题异步生成：完成即随流下发一次。⚠️ title_task 只在新会话才有
        # （resume / 无 content 的轮次是 None，直接跳过 —— 之前在这里对 None 调
        # .done() 导致续跑轮次整个流崩掉）；done() 之前不置位，完成得晚也能发出去。
        if title_task is not None and not title_sent and title_task.done():
            title_sent = True
            try:
                title = title_task.result()
                if title:
                    title = await title
                    con.title = title.content
                    yield _sse("title", {"title": title.content})
            except Exception:
                logger.warning("会话标题生成失败 thread=%s", thread_id, exc_info=True)
        if mode == "values" and isinstance(payload, dict):
            if not ns:
                if base_count is None:
                    base_count = len(payload.get("messages") or [])

                final_state = payload
                agent_key = final_state.get("agent_mode")
                # 路由决策变化时才发 route 事件(第一条快照是初始输入，agent_mode 可能还是 auto)
                if agent_key and agent_key != "auto" and agent_key != last_route:
                    last_route = agent_key
                    con.agent_mode = agent_key
                    yield _sse("route", {"agent_key": agent_key,
                                         "agent_name": AGENT_NAME.get(agent_key, agent_key)})
                interrupt_data = payload.get("__interrupt__")
                if interrupt_data:
                    kind, info = _classify_interrupt(interrupt_data[0].value)
                    if kind == "stop_pause":
                        # 「暂停」落地（2026-10-08）：图已停在干净的模型调用边界，
                        # 状态可续。前端收到 paused 事件后把「停止」按钮换成「继续」；
                        # 继续 = resume={"action":"continue"}，暂停中输入新消息 =
                        # 隐式继续 + supplement（见本文件输入分支）。
                        _PAUSED_THREADS.add(thread_id)
                        yield _sse("paused", {"type": "stop_pause"})
                    elif kind == "ask_user":
                        # 追问：推 questions，然后结束这条流（前端作答后带 resume 续跑）
                        yield _sse("question", {"type": "ask_user", "questions": info})
                    elif kind == "permission":
                        # 权限确认：type=permission 交给前端专门的确认卡片渲染；
                        # 同时带上 questions（形状同 ask_user）作为老客户端兜底。
                        # 登记被拦的调用（数量 + 每个动作的参数摘要）—— 注意记的是
                        # **卡片即将展示的这份参数**，不是客户端将来声称的东西：
                        # 用户点「允许」时按它发放一次性凭证，工具执行前必须消费掉。
                        # 被拦的不一定是文件操作（interrupt_on 也会拦联网工具），
                        # 卡片文案保持中性，别在卡片上写死"修改文件"。
                        await approvals.remember_pending(thread_id, info)
                        # 宿主机命令的访问范围提示要在下发前算好：run_on_host 能读写工作
                        # 文件夹之外（用户批准即授权），所以卡片得先把检出的位置讲清楚。
                        user_folder = (config.get("configurable") or {}).get("user_folder")
                        yield _sse("question", {"type": "permission",
                                                "actions": _permission_actions(info, user_folder),
                                                "questions": [_permission_question(info)]})
                    else:
                        # 未知形状：绝不能崩（流一崩整轮就没了），明确告知而不是静默
                        logger.warning("未识别的中断载荷 keys=%s",
                                       list(info) if isinstance(info, dict) else type(info).__name__)
                        yield _sse("error", {"error": "unsupported_interrupt",
                                             "message": "本轮需要人工确认，但当前版本还不支持该类型的确认。"
                                                        "请把「批准方式」切换为「帮我批准」或「完全访问」后重试。"})

                    for ev in _flush_step_text(cur_msg_id or ""):
                        yield ev
                    for ev in _drain_tool_events(cur_msg_id or ""):
                        yield ev

                    if not messages.conversation_id:
                        session.add(con)
                        try:
                            await session.commit()
                        except Exception:
                            await session.rollback()
                            logger.exception("中断轮落库会话行失败 thread=%s", thread_id)
                    return  # 关键：直接结束生成器，不再等前端
            continue

        chunk, meta = payload

        outer_node = (meta.get("checkpoint_ns") or "").split(":")[0]
        # 所有对话型节点都要转发 token（漏一个 = 那个节点的答复静默不显示，只留 tool_result）
        if outer_node not in STREAMING_NODES:
            continue
        # 工具内部的辅助 LLM 调用（如模板匹配器）会打进 messages 流，
        # 那不是给用户的回答（它的输出是 JSON）——打了 internal 标签的一律跳过。
        # 注意 tags 可能为 None，必须先兜底再判断。
        if "internal" in (meta.get("tags") or []):
            continue

        msg_id = getattr(chunk, "id", None) or ""
        tool_chunks = getattr(chunk, "tool_call_chunks", None) or []

        # 切换到新消息：上一条消息的全部文本都是工作过程，结算为 step
        if msg_id and msg_id != cur_msg_id:
            if cur_msg_id:
                for ev in _flush_step_text(cur_msg_id):
                    yield ev
                for ev in _drain_tool_events(cur_msg_id):
                    yield ev
            cur_msg_id = msg_id

        if not chunk.content and not tool_chunks:
            # 思考阶段(reasoning) chunk：content 为空。reasoning_content 不在
            # AIMessageChunk 的字段上，存在 additional_kwargs 里，用 .get 安全取。
            reasoning = (chunk.additional_kwargs or {}).get("reasoning_content") or ""
            if reasoning:
                reasoning_parts.append(reasoning)
                yield _sse("think", {"node": outer_node, "text": reasoning})
            continue

        if tool_chunks:
            # 工具调用帧：累积参数。若出现 submit_answer，其 answer 参数就是
            # 给用户的回答 —— 边流边推（真打字机），正文区从头到尾没有别的文字。
            bucket = tool_buffer.setdefault(msg_id, {})
            saw_submit = False
            for tc in tool_chunks:
                idx = tc.get("index", 0)
                entry = bucket.setdefault(idx, {"name": "", "args": "", "node": outer_node, "answer_sent": 0})
                if tc.get("name"):
                    entry["name"] = tc["name"]
                if tc.get("args"):
                    entry["args"] += tc["args"]
                # tool_call_id：和流末尾补发的 tool_result 按键配对（09-17 契约化）。
                # 没有它，前端只能按顺序猜——并行工具调用一旦出现就会串组。
                if tc.get("id"):
                    entry["id"] = tc["id"]
                if entry["name"] == "submit_answer":
                    saw_submit = True
                    submit_seen = True
            if saw_submit:
                for ev in _submit_answer_deltas(msg_id, outer_node):
                    yield ev
            continue

        if isinstance(chunk, ToolMessage):
            # 工具执行完，ToolMessage 会从 messages 流里整个掉出来 —— 这正是
            # 实时推 tool_result 的时机（旧版只在流末尾从 state 快照补发，
            # 结果等到整轮跑完才一次性涌出来，前端全程显示「执行中」被用户投诉）。
            call_id = getattr(chunk, "tool_call_id", None) or ""
            if not call_id or call_id in results_sent:
                continue  # 拿不到 id 的旧数据仍走流末尾按时序兜底；重复帧去重
            # submit_answer 的 ToolMessage 不在过程区展示（它的参数/返回就是回答本身，
            # 已按 token 实时推出）。按 name 判定而不是查 tool_buffer：ToolMessage
            # 带自己的 msg_id，到达时上面 1202 行的消息切换早就把 buffer 里这条
            # submit 登记清掉了，查 buffer 永远落空 → 回答原文会漏进过程区，
            # 前端按 call_id 配不到调用，兜底挂到上一张工具卡上（10-08 用户实测）。
            if getattr(chunk, "name", None) == "submit_answer":
                continue
            submit_ids = {call.get("id") for calls in tool_buffer.values()
                          for call in calls.values() if call.get("name") == "submit_answer"}
            if call_id in submit_ids:
                continue
            # 前端时间线要求「前言 → 工具 → 结果」按序到达，而 ToolMessage 早于
            # 下一条 AIMessage 出现 —— 此时这条消息攒的 step / event: tool 可能还没
            # 结算，先结它们再发结果，顺序才不会倒。
            for ev in _flush_step_text(cur_msg_id or ""):
                yield ev
            for ev in _drain_tool_events(cur_msg_id or ""):
                yield ev
            results_sent.add(call_id)
            preview = chunk.content if isinstance(chunk.content, str) else str(chunk.content)
            yield _sse("tool_result", {"tool": getattr(chunk, "name", None),
                                       "content": preview[:500],
                                       "call_id": call_id})
            continue
        if chunk.content:
            step_text[msg_id] = step_text.get(msg_id, "") + chunk.content
            step_node[msg_id] = outer_node

    # 流结束：若模型走了 submit_answer，回答已在生成时实时推出（真打字机），
    # 这里只补最后一条消息的前言（step）与工具行。
    # 兜底：模型没走 submit_answer 时，把最后一条消息的文本当回答（一次发出）——
    # 这条路径不该被走到，但绝不能让用户什么都收不到。

    if cur_msg_id:
        for ev in _drain_tool_events(cur_msg_id):
            yield ev
        tail_text = step_text.pop(cur_msg_id, "")
        if submit_seen:
            for ev in _flush_step_text(cur_msg_id):
                yield ev
        elif tail_text:
            _echo(tail_text)
            yield _sse("token", {"node": step_node.pop(cur_msg_id, None),
                                 "msg_id": cur_msg_id, "text": tail_text})

    stopped_values = None
    if stopped:
        half_answer = ""
        for calls in tool_buffer.values():
            for call in calls.values():
                if call.get("name") != "submit_answer":
                    continue
                # 与 _submit_answer_deltas 同一来源：取"已完整到达"的 answer 前缀，
                # 前端正文区推的就是它，存库保持一致（多段取最长，return_direct 下通常只有一段）
                prefix, _closed = _extract_answer_prefix(call.get("args") or "")
                if prefix and len(prefix) > len(half_answer):
                    half_answer = prefix
        stopped_msgs: list = [HumanMessage(content=messages.content or "")]
        if half_answer.strip():
            stopped_msgs.append(AIMessage(content=half_answer))
        stopped_values = {"messages": stopped_msgs}
        base_count = 0  # 让下方循环恰好只处理这两条，不碰历史消息
        # checkpointer 同步补上这一轮：下轮节点读到的历史 = 用户在界面上看到的历史，
        # 模型才知道"这题问过、答了一半被停了"。messages 通道挂 add_messages reducer，追加语义。
        try:
            await graph_app.aupdate_state(config, {"messages": stopped_msgs})
        except Exception:
            # 回补失败只影响下轮上下文，不能让本轮落库跟着失败
            logger.exception("停止轮 checkpoint 回补失败 thread=%s", thread_id)
        # 新会话首轮就被停止：流循环里 947 行那段标题检查没跑到（或 task 未完成），
        # 在这里把 title_task 等完，别让侧栏出现无标题会话
        if not messages.conversation_id and not con.title and title_task is not None and not title_sent:
            try:
                generated = await title_task
                if generated and (generated.content or "").strip():
                    con.title = generated.content
                    title_sent = True
                    yield _sse("title", {"title": con.title})
            except Exception:
                logger.warning("停止轮标题生成失败 thread=%s", thread_id, exc_info=True)

    # 注意：这一段跑在 token 已经推给前端之后。任何异常(编码、连接被中断、
    # 上一轮遗留的坏数据……)都会让消息静默消失 —— 前端刷新后新消息就"不见了"。
    # 所以整体兜住：打完整堆栈 + 给前端一个 error 事件，绝不再悄悄丢数据。
    try:
        # 配置 checkpointer 后可随时按 thread_id 取回线程的完整 state。
        # 停止轮不读快照（checkpoint 里没有本轮消息），用上面抢救出的消息代替。
        snapshot = None if stopped else await graph_app.aget_state(config)
        values = stopped_values if stopped else (
            snapshot.values if snapshot and snapshot.values else (final_state or {}))
        # 不要把整个 state 打到控制台：values 里含本轮所有 ToolMessage（execute 的
        # ls/mount 输出之类），一打就是一大坨，还容易被误当成"回答里混进了工具输出"。
        logger.debug("本轮结束 thread_id=%s 消息数=%s", thread_id, len(values.get("messages") or []))
        if base_count is None:  # 兜底：拿不到本轮起点就一条都不插，宁可少写也不重复写
            base_count = len(values.get("messages") or [])

        # 把本轮的工具执行结果也推给前端（只在流里补发，同样不落库），
        # 让"工作过程"能看到调了哪个工具、拿到什么。
        # ⚠️ 只补「流中没实时推到」的：停轮/中断等异常路径漏掉的，以及
        # 拿不到 call_id 的旧数据 —— 正常路径 results_sent 已全覆盖，这里全是空跑。
        for m in values.get("messages", [])[base_count:]:
            if isinstance(m, ToolMessage):
                # submit_answer 的返回就是回答本身，已按 token 推过，绝不进过程区
                if getattr(m, "name", None) == "submit_answer":
                    continue
                _cid = getattr(m, "tool_call_id", None)
                if _cid and _cid in results_sent:
                    continue
                preview = m.content if isinstance(m.content, str) else str(m.content)
                # call_id 与 event: tool 按键配对（09-17 契约化）；旧数据拿不到就是 null，前端按时序兜底
                yield _sse("tool_result", {"tool": getattr(m, "name", None),
                                           "content": preview[:500],
                                           "call_id": _cid})

        # token 消耗直接取 state 里最后一条 AIMessage 的 usage_metadata(随 checkpoint 持久化)
        message_list = []
        for m in values.get("messages", [])[base_count:]:
            elapsed_ms=values.get("response_time_ms")
            if not isinstance(m, (AIMessage, HumanMessage)):
                continue
            if isinstance(m, AIMessage):
                # agent 循环里模型可能多次调用工具，每次都会产生一条 AIMessage。
                # 凡带 tool_calls 的都是"中间帧"（哪怕 content 里有前言，如
                # "我来帮您查询…"），不是给用户的回答 —— 落库会变成一题多条
                # assistant 气泡。只保留最后那条真正的回答。
                if getattr(m, "tool_calls", None):
                    # 例外：submit_answer 是回答的唯一出口（return_direct 收尾），
                    # 它的 answer 参数就是给用户的回答 —— 从这里取，别跳过。
                    for call in m.tool_calls:
                        if call.get("name") == "submit_answer" and (call.get("args") or {}).get("answer"):
                            m = type(m)(content=call["args"]["answer"],
                                        additional_kwargs=getattr(m, "additional_kwargs", {}) or {},
                                        usage_metadata=getattr(m, "usage_metadata", None))
                            break
                    else:
                        continue
                # 防御：content 为空的帧也不落库
                if not (m.content or "").strip():
                    continue
            ims = input_message()
            ims.elapsed_ms = elapsed_ms
            ims.content = m.content
            ims.role = "assistant" if isinstance(m, AIMessage) else "user"
            if ims.role == "assistant":
                con.last_reply_preview = m.content
                # 落库前的兜底标题：必须 await 拿到字符串再赋值/下发。
                # （此前直接把 create_task 的 Task 对象塞进 con.title 并 yield，
                # JSON 序列化和 SQLAlchemy 落库都会炸。）
                if count == 2 and not con.title:
                    try:
                        con.title = await get_conversation_title(m.content)
                        yield _sse("title", {"title": con.title})
                    except Exception:
                        logger.warning("会话标题生成失败（落库前）thread=%s", thread_id, exc_info=True)
                ims.reasoning_content = "".join(reasoning_parts) or None

            ims.status = "completed"
            if getattr(m, "usage_metadata", None):
                ims.token_usage = {
                    "input_tokens": m.usage_metadata.get("input_tokens", 0),
                    "output_tokens": m.usage_metadata.get("output_tokens", 0),
                    "total_tokens": m.usage_metadata.get("total_tokens", 0)
                }
            ims.conversation_id = thread_id
            message_list.append(ims)

        if stopped:
            # 库里 status 枚举自带 cancelled（db_message.py）：半截回答标 cancelled，
            # 与正常完成的回答区分。列表接口不筛 status，只影响语义与后续排查。
            for ims in message_list:
                if ims.role == "assistant":
                    ims.status = "cancelled"

        if messages.conversation_id:
            if con.agent_mode:
                await session.execute(
                    update(conversation).where(conversation.id == thread_id).values(agent_mode=con.agent_mode)
                )
        else:  # 新线程才插会话行
            session.add(con)
        session.add_all(message_list)

        if await redis_client.exists(message_key + thread_id):
            await redis_client.delete(message_key + thread_id)
        await session.commit()
    except Exception as e:
        logger.exception("消息落库失败 conversation_id=%s", thread_id)
        # 前端的 SSE 解析读的是 data.message，这里带上，别让它只显示通用兜底文案
        yield _sse("error", {"message_id": thread_id, "error": "save_failed",
                             "message": "回答已生成，但保存到会话失败，请重试", "detail": str(e)})
        return
    if stopped:
        # 用户主动停止：半截回答已尽力落库（见上），明确告知前端本条作废
        yield _sse("stopped", {"message_id": thread_id})
        return
    yield _sse("done", {"message_id": thread_id, "grounded": True})


async def get_conversations_service(page: page_query, session: AsyncSession, user_id: int):
    range_days = {"all": None, "week": 6, "month": 30}

    conditions = [conversation.user_id == user_id]
    days = range_days.get(page.range)
    if page.range == "today":
        conditions.append(conversation.last_message_at >= _local_midnight_utc(0))
    elif page.range == "yesterday":
        conditions.append(conversation.last_message_at >= _local_midnight_utc(1))
        conditions.append(conversation.last_message_at < _local_midnight_utc(0))
    elif days is not None:
        # 库里存 naive UTC，边界也用 UTC 算，避免本地时区偏差
        since = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) - datetime.timedelta(days=days)
        conditions.append(conversation.last_message_at >= since)
    if page.keyword:
        conditions.append(conversation.title.like(f"%{page.keyword}%"))

    total = (await session.execute(
        select(func.count()).select_from(conversation).where(*conditions)
    )).scalar_one()
    rows = (await session.execute(
        select(conversation.id, conversation.status, conversation.title, conversation.agent_mode,
               conversation.updated_at, conversation.last_reply_preview, conversation.work_space)
        .where(and_(*conditions, conversation.deleted_at == None))
        .order_by(conversation.last_message_at.desc())
        .offset((page.page - 1) * page.page_size)  # SQLAlchemy 没有 LIMIT offset,count 双参写法
        .limit(page.page_size)
    )).all()
    items = [dict(r._mapping) for r in rows]

    if items:
        ids = [item["id"] for item in items]
        count_rows = (await session.execute(
            select(input_message.conversation_id, func.count().label("message_count"))
            .where(input_message.conversation_id.in_(ids))  # 注意是 .in_()，不是 Python 的 in
            .group_by(input_message.conversation_id)
        )).all()
        counts = {cid: cnt for cid, cnt in count_rows}
        for item in items:
            item["id"] = str(item["id"])
            # 库里是 naive UTC，补上时区再交给 FastAPI 序列化，前端才能转成正确的本地时间
            if item.get("updated_at") is not None:
                item["updated_at"] = item["updated_at"].replace(tzinfo=datetime.timezone.utc)
            item["message_count"] = counts.get(int(item["id"]), 0)

    return result.success(data={
        "items": items,
        "page": page.page,
        "page_size": page.page_size,
        "total": total,
        "has_more": page.page * page.page_size < total,
    })


async def get_conversation_detail_service(conversation_id: str, session: AsyncSession, user_id: int):
    redis_client = get_redis_client()
    if await redis_client.exists(message_key + str(conversation_id)):
        return result.success(
            data=json.loads(await redis_client.get(message_key + str(conversation_id))) or {})
    res = (await session.execute(
        select(conversation.id, conversation.title, conversation.is_bookmarked, conversation.agent_mode)
        .where(conversation.id == conversation_id, conversation.user_id == user_id)
    )).first()
    if not res:
        # error 是实例方法，必须先构造 result 实例再调用
        return result(code=404, message="Conversation not found").error()
    # 多列 select 返回的是 Row(标量序列)，取 _mapping 才能转 dict，与列表接口写法一致
    re_dict = dict(res._mapping)
    # 雪花ID转字符串，避免前端 JS 解析丢精度
    re_dict["id"] = str(re_dict["id"])
    rows = (await session.execute(
        select(input_message.id, input_message.role, input_message.content, input_message.created_at,
               input_message.reasoning_content)
        .where(input_message.conversation_id == conversation_id)
        .order_by(input_message.created_at.asc(), input_message.id.asc())
    )).all()
    # 消息按 A.8.2 的形状返回普通 dict；message_to_dict 是给 LangChain 消息对象用的，Row 传进去会炸
    re_dict["messages"] = [
        {
            "id": r.id,
            "role": r.role,
            "content": r.content,
            "created_at": r.created_at.replace(tzinfo=datetime.timezone.utc).isoformat() if r.created_at else None,
            "reasoning_content": r.reasoning_content,
        }
        for r in rows
    ]

    # 缓存必须带 TTL，否则详情变更(如补发的消息)永远不会失效
    await redis_client.set(message_key + str(conversation_id),
                           json.dumps(re_dict, ensure_ascii=False), ex=600)
    # 注意：绝不能在这里 close_redis_client()！那是全局共享的连接池单例，
    # 关掉后所有拿着旧引用的请求(并发的/后续的)往已关闭的 transport 写
    # PING 会直接挂死。连接池跟随进程生命周期，在 main.py 的 lifespan 里关闭。
    return result.success(data=re_dict)


async def delete_conversation_service(ids: list[int], session: AsyncSession, user_id: int):
    time = datetime.datetime.now(datetime.timezone.utc)
    await session.execute(
        update(conversation).where(conversation.id.in_(ids), conversation.user_id == user_id).values(
            deleted_at=time))
    await session.execute(update(input_message).where(input_message.conversation_id.in_(ids)).values(
        deleted_at=time))
    await session.commit()

    graph_app = await get_app()
    checkpointer = graph_app.checkpointer
    for id in ids:
        await checkpointer.adelete_thread(str(id))
    graph_app.checkpointer

    return result.success(data={
        "id": ids,
        "deleted_at": time.isoformat()
    })
