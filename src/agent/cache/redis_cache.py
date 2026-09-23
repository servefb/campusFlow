from langchain_redis import RedisCache
from langchain_core.globals import set_llm_cache

# 创建 Redis 缓存实例，设置 TTL 为 1 小时 (3600秒)
redis_url="redis://root:123321@192.168.150.101:6379/0"
redis_cache = RedisCache(redis_url=redis_url, ttl=3600)
set_llm_cache(redis_cache)