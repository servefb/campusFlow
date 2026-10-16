from langchain.tools import tool, ToolRuntime


def _current_user_id(runtime: ToolRuntime) -> str:
    """当前用户的 id（字符串），取不到用 "default"。

    ⚠️ user_id 在 **context** 里，不在 config.configurable 里 ——
    conversations_repo._agent_stream 是 `astream(..., context={"user_id": ...}, config=...)`
    这样传的，configurable 里只有 thread_id/permission_mode 那几样。
    从 configurable 取会永远拿到兜底值，搜的都是 ("memories","default_user") 空命名空间。
    StoreBackend 的 namespace 工厂读的也是同一个 context（见 file_backend.py），两边必须一致。
    """
    ctx = runtime.context or {}
    uid = ctx.get("user_id")
    if not uid:
        uid = (runtime.config.get("configurable") or {}).get("user_id")
    return str(uid or "default")


@tool
def search_memories(query: str, runtime: ToolRuntime) -> str:
    """语义搜索长期记忆。回答涉及用户背景、偏好、历史告知的信息时先调它。"""
    user_id = _current_user_id(runtime)
    results = runtime.store.search(
        ("memories", user_id),
        query=query,
        limit=5,
    )
    return "\n".join([r.value["content"] for r in results]) or "无相关记忆。"
