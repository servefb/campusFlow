import os

from dotenv import load_dotenv

from langchain_redis import RedisCache
from langchain_core.globals import set_llm_cache

load_dotenv()

# 创建 Redis 缓存实例，设置 TTL 为 1 小时 (3600秒)
# ⚠️ 用户名位置必须留空：这台 Redis 上只有 `default` 用户，没有 `root`
#    （`AUTH root <任意密码>` 一律 WRONGPASS，`AUTH default <密码>` 才通）。
#    写成 root:… 时**跟密码对不对无关**，永远连不上。
redis_url = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
redis_cache = RedisCache(redis_url=redis_url, ttl=3600)
set_llm_cache(redis_cache)
