"""宿主机命令的一次性「批准凭证」—— 让工具自己验证「这次调用是否经过用户批准」。

**为什么需要**：`run_on_host` 的危险性此前完全依赖节点的 `interrupt_on` 配置 ——
工具自身看不出这次调用是不是被拦下来过、用户有没有点「允许」。一旦某个节点漏配、
重构时绕过、或工具被别的调用路径复用，它就退化成**无需确认的本机命令执行**。

这里把「批准」变成工具能自己验证的东西，三段式：

1. **登记** pending：下发确认卡片时，把被拦动作的名单（工具名 + 参数摘要）记在
   thread 上 —— 记的是**卡片上真正展示给用户的那份参数**，不是客户端后来声称的；
2. **发放** grant：用户点「允许」、服务端翻译 decisions 时，pending 转成一次性凭证；
3. **消费** consume：工具执行前按 (工具名, 参数摘要) 取走一份凭证，取不到就拒绝执行。

凭证是**单次**的（取走即失效）且带 TTL，于是三类问题都失败在 consume 上：
「批准一次反复执行」「批准 A 换成 B 执行」「根本没弹卡直接执行」。

**存储**：优先 Redis（多 worker 部署时「批准在 A 进程、执行在 B 进程」也能对上）；
Redis 不可用时退回进程内字典 —— 这不会削弱门禁（没凭证仍然拒绝），只是跨进程场景
需要 Redis 才完整。**任何情况下都 fail-closed**：查不到凭证就是不执行。
"""
import hashlib
import json
import logging
import time

from src.cache.redis_client import get_redis_client

logger = logging.getLogger(__name__)

PENDING_TTL = 15 * 60   # 卡片挂起等作答的容忍时长（秒）
GRANT_TTL = 5 * 60      # 批准到执行之间的窗口（秒）

# 每个工具的"身份参数"：只有这些参数参与摘要，其余（如 purpose 这种给人看的说明）
# 不参与 —— 措辞变一下不该让凭证对不上，而命令/目录变了必须对不上。
_IDENTITY_KEYS: dict[str, tuple[str, ...]] = {
    "run_on_host": ("command", "subdir"),
    # task 的身份 = 委派给谁 + 干什么；描述措辞变了视为新动作重新弹卡
    "task": ("subagent_type", "description"),
}

_pending_key = "perm:pending:{tid}"
_grant_key = "perm:grant:{tid}"

# Redis 不可用时的进程内回落存储（结构同 Redis：pending 一个、grant 一个列表）
_memory: dict[str, dict] = {}
_memory_ts: dict[str, float] = {}


def _prune_memory() -> None:
    now = time.monotonic()
    for tid, ts in list(_memory_ts.items()):
        if now - ts > PENDING_TTL:
            _memory.pop(tid, None)
            _memory_ts.pop(tid, None)


def action_digest(tool: str, args: dict) -> str:
    """动作摘要：同一工具 + 同一关键参数 → 同一摘要。

    关键参数由 `_IDENTITY_KEYS` 决定（未登记的工具用全部参数名排序后参与）。
    值统一按字符串处理并 strip：卡片那侧拿到的是模型原始参数、工具这侧拿到的是
    规范化后的值（`command.strip()`），不归一化会出现"明明批准了却对不上"。
    """
    keys = _IDENTITY_KEYS.get(tool) or tuple(sorted(args))
    pairs = [
        (k, str(args.get(k) if args.get(k) is not None else "").strip())
        for k in keys
    ]
    raw = json.dumps([tool, pairs], ensure_ascii=False, sort_keys=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _actions_payload(actions: list) -> list[dict]:
    """把 action_requests 归一成 `[{tool, digest}]`（只留验证需要的最小信息）。"""
    out: list[dict] = []
    for action in actions or []:
        if not isinstance(action, dict):
            continue
        tool = action.get("name") or ""
        args = action.get("args") if isinstance(action.get("args"), dict) else {}
        out.append({"tool": tool, "digest": action_digest(tool, args)})
    return out


async def _redis():
    """拿到可用连接；不可用/未配置时返回 None（调用方回落到进程内存储）。"""
    try:
        client = get_redis_client()
        if client is None:
            return None
        return client
    except Exception:  # noqa: BLE001 - 配置缺失或连接池构造失败都不该让工具崩
        logger.warning("批准凭证：Redis 不可用，回落到进程内存储", exc_info=True)
        return None


async def remember_pending(thread_id: str, actions: list) -> None:
    """登记「这轮被拦下了哪些动作」等用户作答（记的是卡片展示的那份参数）。"""
    payload = {"count": len(actions or []), "actions": _actions_payload(actions)}
    client = await _redis()
    if client is not None:
        try:
            await client.set(_pending_key.format(tid=thread_id),
                             json.dumps(payload, ensure_ascii=False), ex=PENDING_TTL)
            return
        except Exception:  # noqa: BLE001
            logger.warning("批准凭证：pending 写入 Redis 失败，回落进程内", exc_info=True)
    _prune_memory()
    _memory.setdefault(thread_id, {})["pending"] = payload
    _memory_ts[thread_id] = time.monotonic()


async def pop_pending(thread_id: str) -> dict | None:
    """取出并清除 pending（取到即清，避免作答串到下一轮）。

    优先用 Redis 6.2+ 的 GETDEL（读+删一步完成，杜绝并发下同一份 pending 被消费两次）；
    老版本或异常时退回 GET + DELETE。
    """
    key = _pending_key.format(tid=thread_id)
    client = await _redis()
    if client is not None:
        raw = None
        try:
            raw = await client.getdel(key)
        except Exception:  # noqa: BLE001 - 老版本 Redis 没有 GETDEL
            try:
                raw = await client.get(key)
                if raw:
                    await client.delete(key)
            except Exception:  # noqa: BLE001
                logger.warning("批准凭证：pending 读取 Redis 失败", exc_info=True)
        if raw:
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("批准凭证：pending 载荷不是合法 JSON，已丢弃")
                return None
    _prune_memory()
    return (_memory.get(thread_id) or {}).pop("pending", None)


async def clear_pending(thread_id: str) -> None:
    """作废 pending 与已发放但未消费的凭证（用户开了新话题 / 已作答）。"""
    client = await _redis()
    if client is not None:
        try:
            await client.delete(_pending_key.format(tid=thread_id))
            return
        except Exception:  # noqa: BLE001
            logger.warning("批准凭证：pending 清除 Redis 失败", exc_info=True)
    _prune_memory()
    (_memory.get(thread_id) or {}).pop("pending", None)


async def grant(thread_id: str, actions: list) -> int:
    """从 action_requests 直接发放凭证（不经过 pending 的场景）。返回发放条数。"""
    return await grant_digests(thread_id, [a["digest"] for a in _actions_payload(actions)])


async def grant_digests(thread_id: str, digests: list) -> int:
    """按摘要发放一次性凭证（用户点了「允许」之后调用）。返回发放条数。

    pending 记录里存的已经是摘要，所以「作答 → 发放」这一步走这里，避免二次计算
    —— 万一两处算法不一致，就会出现"批准了却执行不了"。
    """
    items = [d for d in digests if d]
    if not items:
        await clear_pending(thread_id)
        return 0
    await clear_pending(thread_id)

    client = await _redis()
    if client is not None:
        try:
            key = _grant_key.format(tid=thread_id)
            pipe = client.pipeline()
            for digest in items:
                pipe.rpush(key, digest)
            pipe.expire(key, GRANT_TTL)
            await pipe.execute()
            logger.info("[audit] 批准凭证已发放 thread=%s 条数=%s", thread_id, len(items))
            return len(items)
        except Exception:  # noqa: BLE001
            logger.warning("批准凭证：grant 写入 Redis 失败，回落进程内", exc_info=True)

    _prune_memory()
    bucket = _memory.setdefault(thread_id, {})
    bucket["grants"] = list(bucket.get("grants") or []) + items
    _memory_ts[thread_id] = time.monotonic()
    logger.info("[audit] 批准凭证已发放（进程内）thread=%s 条数=%s", thread_id, len(items))
    return len(items)


async def consume(thread_id: str, tool: str, args: dict) -> bool:
    """取走一份与本次调用匹配的凭证；取不到返回 False（调用方必须拒绝执行）。

    单次消费靠原子操作保证：Redis 用 `LREM key 1 <digest>`（返回 1 才算拿到），
    进程内用 list.remove —— 两者都只会让一份凭证消失。
    """
    digest = action_digest(tool, args)
    client = await _redis()
    if client is not None:
        try:
            removed = await client.lrem(_grant_key.format(tid=thread_id), 1, digest)
            if removed:
                logger.info("[audit] 批准凭证已消费 thread=%s tool=%s", thread_id, tool)
                return True
        except Exception:  # noqa: BLE001
            logger.warning("批准凭证：consume 访问 Redis 失败", exc_info=True)

    _prune_memory()
    grants: list[str] = (_memory.get(thread_id) or {}).get("grants") or []
    if digest in grants:
        grants.remove(digest)
        _memory_ts[thread_id] = time.monotonic()
        logger.info("[audit] 批准凭证已消费（进程内）thread=%s tool=%s", thread_id, tool)
        return True
    logger.warning("[audit] 批准凭证缺失，拒绝执行 thread=%s tool=%s digest=%s",
                   thread_id, tool, digest[:12])
    return False


def seed_memory(thread_id: str, actions: list) -> None:
    """仅供离线自测：直接往进程内存储追加凭证（不碰 Redis）。"""
    bucket = _memory.setdefault(thread_id, {})
    bucket["grants"] = list(bucket.get("grants") or []) + [
        a["digest"] for a in _actions_payload(actions)
    ]
    _memory_ts[thread_id] = time.monotonic()
