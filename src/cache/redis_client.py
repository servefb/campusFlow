import os

import redis.asyncio as aioredis
from dotenv import load_dotenv

# 自带一次 load_dotenv：本模块可能先于 llm_node 被导入，
# 不能依赖别人的 import 顺序才读到 .env
load_dotenv()

_redis_client: aioredis.Redis | None = None

def get_redis_client() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.Redis(
            host=os.getenv("REDIS_HOST", "127.0.0.1"),
            port=int(os.getenv("REDIS_PORT", "6379")),
            password=os.getenv("REDIS_PASSWORD") or None,
            decode_responses=True,
            max_connections=50,            # 连接池上限
            socket_connect_timeout=5,      # 建连超时
            socket_timeout=5,              # 读写超时
            health_check_interval=30,      # 健康检查，自动重连
            retry_on_timeout=True,
        )
    return _redis_client


async def close_redis_client():
    global _redis_client
    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None
