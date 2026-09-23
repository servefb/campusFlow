import redis.asyncio as aioredis

_redis_client: aioredis.Redis | None = None

def get_redis_client() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.Redis(
            host='192.168.150.101',
            port=6379,
            password='123321',
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