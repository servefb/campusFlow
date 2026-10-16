"""「执行中追加」补充队列 + 注入中间件（09-23 二次定稿：软注入，不打断任务）。

语义（用户拍板）：agent 正在执行时用户发来的新消息**不是新问题**，而是给当前任务的
**补充材料** —— 任务不停止、不重开，补充内容在主智能体**下一次调用模型之前**拼进消息列表。

为什么只能这样注入：LangGraph 没有「往运行中的 superstep 注入输入」的 API，
`update_state` 写的是 checkpoint，运行中的节点读的是 superstep 开始时的快照，写进去也看不见。
唯一可行的读取点是模型调用间隙 —— 用 langchain 中间件的 `wrap_model_call` 钩子实现。
注意子智能体跑长任务时主智能体没有模型调用，注入会等到它返回后的下一次主智能体模型调用
（「工具调用间隙轮询」的既定边界）。

生命周期：`queue_supplement` 入队（send_supplement 端点）→ 中间件在每次模型调用前读取 →
流收尾时 `clear_supplements`（conversations_repo._produce 的 finally）。
收尾后仍留在队列里的补充 = 模型已提交回答、没来得及看 —— 只能丢弃（用户消息已即时落库
MySQL，界面历史不丢；模型侧看不见属于已知边界，不为此引入自动续跑的复杂度）。

🔴 本模块必须保持零内部依赖（只依赖 langchain / langchain_core）：
conversations_repo 和 campusflow_agent_node 都要 import 它，倒灌任何一方的依赖就是循环导入。
"""

from collections.abc import Awaitable, Callable

from langchain.agents.middleware.types import AgentMiddleware, ModelRequest, ModelResponse
from langchain_core.messages import HumanMessage
from langgraph.types import interrupt

# 补充队列：thread_id -> 依到达顺序排列的补充文本。只在单事件循环内读写，无需加锁。
_PENDING_SUPPLEMENTS: dict[str, list[str]] = {}


def queue_supplement(thread_id: str, content: str) -> None:
    """入队一条补充。调用方（send_supplement）必须先确认该线程确有在跑的流。"""
    _PENDING_SUPPLEMENTS.setdefault(thread_id, []).append(content)


def pending_supplements(thread_id: str) -> list[str]:
    """当前待注入的补充（快照拷贝）。**不出队** —— 见模块注释「为什么重复注入」。"""
    return list(_PENDING_SUPPLEMENTS.get(thread_id) or ())


def clear_supplements(thread_id: str) -> None:
    """轮次收尾时清队。残留未消费的补充只能丢弃（见模块注释）。"""
    _PENDING_SUPPLEMENTS.pop(thread_id, None)


def _supplement_message(supplements: list[str]) -> HumanMessage:
    joined = "\n\n".join(f"【用户补充】{item}" for item in supplements)
    return HumanMessage(content=(
        f"{joined}\n\n"
        "（以上是用户在本任务执行过程中补充的内容，已纳入本轮上下文。"
        "请把它考虑进后续的判断与最终答复；如果它改变了任务方向，"
        "以补充后的要求为准，必要时重新委派子智能体。）"
    ))


class SupplementInjectionMiddleware(AgentMiddleware):
    """把执行中收到的用户补充拼进主智能体的每一次模型调用。

    按请求构造（节点里每轮现建 agent），thread_id 走闭包 —— 不去 request.runtime
    里翻配置，少一层对框架内部形状的依赖。同步/异步两个钩子都实现：本项目走
    ainvoke（异步钩子生效），但补上同步版防框架在某些路径回退到同步调用时静默失效。
    """

    def __init__(self, thread_id: str) -> None:
        self._thread_id = thread_id

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        supplements = pending_supplements(self._thread_id)
        if supplements:
            request = request.override(messages=[*request.messages, _supplement_message(supplements)])
        return handler(request)

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        supplements = pending_supplements(self._thread_id)
        if supplements:
            request = request.override(messages=[*request.messages, _supplement_message(supplements)])
        return await handler(request)


# ---------- 「暂停」（2026-10-08）：停止按钮的软暂停位 ----------
# 停止不再直接 task.cancel()（落点随机、半截回答、checkpoint 脏），改为：
# 置暂停位 → StopPauseMiddleware 在下一次模型调用边界 interrupt() —— 图停在干净的
# superstep 边界（模型还没响应，state 里不会有悬空 tool_calls）。前端收到 paused
# 事件后把「停止」按钮换成「继续」；继续 = Command(resume={"action":"continue"})，
# 暂停中用户直接输入新消息 = 隐式继续 + supplement（一并由本中间件消费）。
# 可行性已由 _stop_pause_probe2.py 实测：外层图 resume 时内层 agent 从 checkpoint
# 断点续跑（工具不重复执行），resume 值由本中间件的 interrupt() 原位接住。
# 🔴 与补充队列同理：本段必须零内部依赖（conversations_repo 与节点都要 import）。

_PAUSE_REQUESTED: set[str] = set()


def request_pause(thread_id: str) -> None:
    """置暂停位（停止按钮第一次点击）。由 conversations_repo.stop_stream 调用。"""
    _PAUSE_REQUESTED.add(thread_id)


def pause_requested(thread_id: str) -> bool:
    return thread_id in _PAUSE_REQUESTED


def clear_pause(thread_id: str) -> None:
    """消费/作废暂停位。注意：暂停已落地时**不能**在轮末清掉 —— resume 后要靠
    它让中间件重新走到 interrupt() 才能接到 resume 值（由中间件自己清）。"""
    _PAUSE_REQUESTED.discard(thread_id)


class StopPauseMiddleware(AgentMiddleware):
    """停止按钮的落点：每次模型调用前查暂停位，命中则 interrupt() 干净暂停。

    resume 后 LangGraph 把当前 superstep 重放到 interrupt() 处（实测不重放更早的
    模型调用/工具），interrupt() 返回 resume 值：
      {"action": "continue"}                    —— 用户点了「继续」；
      {"action": "continue", "supplement": str} —— 暂停中用户直接输入了新消息，
                                                   作为【用户补充】拼进这次调用。
    同步/异步双钩子，理由同 SupplementInjectionMiddleware。
    """

    def __init__(self, thread_id: str) -> None:
        self._thread_id = thread_id

    def _apply(self, request: ModelRequest) -> ModelRequest:
        if not pause_requested(self._thread_id):
            return request
        value = interrupt({"type": "stop_pause"})
        clear_pause(self._thread_id)
        supplement = value.get("supplement") if isinstance(value, dict) else None
        if supplement:
            request = request.override(messages=[
                *request.messages,
                HumanMessage(content=(
                    f"【用户补充】{supplement}\n\n"
                    "（这是任务暂停期间用户发来的新消息，已纳入本轮上下文；"
                    "如果它改变了任务方向，以它为准。）"
                )),
            ])
        return request

    def wrap_model_call(self, request, handler):
        return handler(self._apply(request))

    async def awrap_model_call(self, request, handler):
        return await handler(self._apply(request))
