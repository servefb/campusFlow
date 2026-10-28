"""探针 v2：判别 resume 时内层 agent 到底是「checkpoint 续跑」还是「整个节点从头重放」。

v1 的漏洞：node_fn 每次执行都新建假模型响应序列，重放假设下模型也会再次产出工具调用，
与续跑假设观测相同。v2 用**共享响应序列**（整个进程只有 [工具调用, 最终回答] 两条）+
**工具执行计数**做判别：

  - checkpoint 续跑：run2 从打断点（第 2 次模型调用）继续 → 消费「最终回答」，
    echo 只执行 1 次（run1 那次），最终 state 有 4 条消息（Human/AI(tool)/Tool/AI(final)）。
  - 从头重放：run2 的第 1 次模型调用直接消费「最终回答」（无工具调用）→ 内层正常跑完，
    interrupt 的 resume 值永远没人接（resume_seen 为 None），echo 仍只执行 1 次，
    最终 state 只有 1 条 Human（节点返回的消息会落进 state，注意区分）。

环境补丁同 _stop_pause_probe.py。
"""
import os

os.environ["no_proxy"] = "localhost,127.0.0.1,::1"
os.environ["NO_PROXY"] = "localhost,127.0.0.1,::1"
for _k in ("http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY"):
    os.environ.pop(_k, None)

import asyncio  # noqa: E402

from langchain.agents import create_agent  # noqa: E402
from langchain.agents.middleware.types import AgentMiddleware  # noqa: E402
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel  # noqa: E402
from langchain_core.messages import AIMessage, HumanMessage  # noqa: E402
from langchain_core.tools import tool  # noqa: E402
from langgraph.checkpoint.memory import InMemorySaver  # noqa: E402
from langgraph.graph import END, START, StateGraph  # noqa: E402
from langgraph.types import Command, interrupt  # noqa: E402
from typing import ClassVar  # noqa: E402
from typing_extensions import TypedDict  # noqa: E402

THREAD = "probe2"
_PAUSE: set[str] = set()


def request_pause(tid: str) -> None:
    _PAUSE.add(tid)


def pause_requested(tid: str) -> bool:
    return tid in _PAUSE


def clear_pause(tid: str) -> None:
    _PAUSE.discard(tid)


class PauseMiddleware(AgentMiddleware):
    def __init__(self) -> None:
        self.resume_seen: object = None
        self.call_count = 0

    async def awrap_model_call(self, request, handler):
        self.call_count += 1
        if pause_requested(THREAD):
            value = interrupt({"type": "stop_pause"})
            self.resume_seen = value
            clear_pause(THREAD)
        return await handler(request)


class FakeModel(GenericFakeChatModel):
    def bind_tools(self, tools, **kwargs):
        return self


# 🔑 共享响应序列：全进程只有两条。重放假设下第二条会在 run2 开头被消费掉。
_RESPONSES = iter([
    AIMessage(content="", tool_calls=[
        {"name": "echo", "args": {"x": "1"}, "id": "call_1", "type": "tool_call"},
    ]),
    AIMessage(content="最终回答"),
])
EchoState = {"count": 0}


@tool
def echo(x: str) -> str:
    """回声工具；执行时模拟用户点了「停止」。"""
    EchoState["count"] += 1
    request_pause(THREAD)
    return f"echo:{x}"


class State(TypedDict):
    messages: list


async def node_fn(state: State, config):
    inner = create_agent(model=FakeModel(messages=_RESPONSES), tools=[echo],
                         middleware=[NODE_STATE["pm"]])
    res = await inner.ainvoke({"messages": [HumanMessage(content="问题")]}, config)
    return {"messages": res["messages"]}


NODE_STATE: dict = {}


async def main() -> int:
    pm = PauseMiddleware()
    NODE_STATE["pm"] = pm
    outer = StateGraph(State)
    outer.add_node("agent_node", node_fn)
    outer.add_edge(START, "agent_node")
    outer.add_edge("agent_node", END)
    app = outer.compile(checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": THREAD}}

    async for _m, _p in app.astream({"messages": [HumanMessage(content="问题")]},
                                    config, stream_mode=["values"]):
        pass
    print(f"run1: 暂停点模型调用数={pm.call_count} echo执行={EchoState['count']}")

    await app.astream(Command(resume={"action": "continue"}),
                      config, stream_mode=["values"]).__anext__() if False else None
    async for _m, _p in app.astream(Command(resume={"action": "continue"}),
                                    config, stream_mode=["values"]):
        pass

    snap = await app.aget_state(config)
    msgs = snap.values.get("messages") or []
    print(f"run2: resume_seen={pm.resume_seen!r} 模型调用总数={pm.call_count} "
          f"echo执行={EchoState['count']} state消息数={len(msgs)}")
    for m in msgs:
        print("  ", type(m).__name__, repr(getattr(m, "content", ""))[:40])

    resumed = pm.resume_seen is not None
    final_in_state = any(isinstance(m, AIMessage) and m.content == "最终回答" for m in msgs)
    print()
    if resumed and final_in_state and EchoState["count"] == 1:
        print("结论：内层从 checkpoint 续跑（无重放）—— interrupt 方案可直接落地")
        return 0
    if not resumed:
        print("结论：节点从头重放，interrupt 的 resume 值没人接 —— 方案需要重新设计")
        return 1
    print("结论：resume 值被接住但行为介于两者之间，需人工分析上方明细")
    return 2


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
