
from langchain_mcp_adapters.client import MultiServerMCPClient

mcp_config = {
    # Context7：直接使用官方包
    "context7": {
        "transport": "stdio",
        "command": "cmd",
        "args": ["/c", "npx", "-y", "@upstash/context7-mcp"],
    },
    "playwright": {
        "transport": "stdio",
        "command": "cmd",
        "args": ["/c", "npx", "-y", "@playwright/mcp@latest"],
    },
}

_client: MultiServerMCPClient | None = None
_tools_cache: list | None = None


async def init_mcp() -> None:
    """在 lifespan 启动阶段调用一次。"""
    global _client, _tools_cache
    _client = MultiServerMCPClient(mcp_config)
    _tools_cache = await _client.get_tools()
    # 可选：打印一下加载了哪些工具，方便排查
    print(f"[MCP] loaded {len(_tools_cache)} tools: "
          f"{[t.name for t in _tools_cache]}")


async def close_mcp() -> None:
    """在 lifespan 关闭阶段调用，释放子进程。"""
    global _client, _tools_cache
    _tools_cache = None
    _client = None
    # langchain-mcp-adapters 没有显式 close API 时，
    # 依赖子进程随进程退出；如需精确清理可在这里扩展


def get_mcp_tools_sync() -> list:
    """给 node 用的同步获取（工具已在启动时加载好）。"""
    if _tools_cache is None:
        raise RuntimeError("MCP not initialized. Call init_mcp() in lifespan first.")
    return _tools_cache