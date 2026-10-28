"""探针：TaskGroup 在「async generator 消费 SSE 队列」形态下的取消传播语义
（2026-10-08 代替裸 create_task 改造的行为守卫，形状 = 生产 create_conversation 同款）。

背景：create_conversation 把 produce_task + 暂停看门狗放进一个 TaskGroup。
生产里五条收口路径必须逐一实测（Python 3.13 真实行为）：

  [S1] 正常结束：produce 推完事件放 None 哨兵，消费循环 break → 干净收口。
  [S2] 强杀 produce（外部 cancel，生成器挂起在 yield）：
       实测 ✅ produce 的 finally 哨兵照常被消费，消费侧干净收口，
       CancelledError **不会**打进消费循环（等价旧版行为）。
  [S3] 客户端断开（aclose → GeneratorExit）：
       实测 ⚠️ TaskGroup 会把 GeneratorExit 包成 BaseExceptionGroup 抛出 ——
       生产版在生成器里拆包识别后安静 return（否则 aclose 炸给调用方）。
  [S4] produce 抛异常：以 ExceptionGroup 冒出 → 拆包记日志后干净收口。
  [S5] 暂停看门狗：截止时间已过 + 暂停位未落地 → 看门狗强杀 produce → 干净收口。

每条场景独立跑。生产实现见 conversations_repo.create_conversation。
"""
import asyncio

PASS = FAIL = 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  OK   %s" % label)
    else:
        FAIL += 1
        print("  FAIL %s" % label)


# ---- 生产同款的最小暂停状态 ----
_PAUSE_ARMED: dict[str, float] = {}
_PAUSED_THREADS: set[str] = set()
_PAUSE_REQUESTED: set[str] = set()
PAUSE_FORCE_CANCEL_S = 8


def make_stream(thread_id, produce_fn):
    """生产 create_conversation 的收口形状（逐行同构）。"""

    async def stream():
        queue: asyncio.Queue = asyncio.Queue()

        async def _pause_watchdog(produce_task: asyncio.Task) -> None:
            loop = asyncio.get_running_loop()
            while not produce_task.done():
                deadline = _PAUSE_ARMED.get(thread_id)
                if deadline is None:
                    await asyncio.wait({produce_task}, timeout=0.05)
                    continue
                remaining = deadline - loop.time()
                if remaining > 0:
                    await asyncio.wait({produce_task}, timeout=min(remaining, 0.05))
                    continue
                if not produce_task.done() and thread_id not in _PAUSED_THREADS \
                        and thread_id in _PAUSE_REQUESTED:
                    produce_task.cancel()
                return

        try:
            async with asyncio.TaskGroup() as tg:
                produce_task = tg.create_task(produce_fn(queue))
                tg.create_task(_pause_watchdog(produce_task))
                while True:
                    ev = await queue.get()
                    if ev is None:
                        break
                    yield ev
        except asyncio.CancelledError:
            raise
        except BaseExceptionGroup as eg:
            if all(isinstance(e, GeneratorExit) for e in eg.exceptions):
                return
            return  # 测试里没有 logger，直接安静收口

    return stream


async def s1_normal():
    print("[S1] 正常结束")

    async def produce(queue):
        await asyncio.sleep(0.01)
        queue.put_nowait("ev1")
        queue.put_nowait("ev2")
        queue.put_nowait(None)

    got, ended_cleanly = [], False
    try:
        async for ev in make_stream("s1", produce)():
            got.append(ev)
        ended_cleanly = True
    except BaseException as e:  # noqa: BLE001
        print("      异常:", repr(e))
    check(ended_cleanly and got == ["ev1", "ev2"], "干净收完事件 = %r" % got)


async def s2_force_kill():
    print("[S2] 外部强杀 produce（生成器挂起在 yield 期间）")
    state = {"finally_ran": False}

    async def produce(queue):
        try:
            queue.put_nowait("ev1")
            await asyncio.sleep(10)
            queue.put_nowait(None)
        finally:
            state["finally_ran"] = True
            queue.put_nowait(None)  # 模拟 _produce 的 finally 哨兵

    got, outcome = [], None
    gen = make_stream("s2", produce)().__aiter__()
    try:
        while True:
            try:
                ev = await gen.__anext__()
            except StopAsyncIteration:
                outcome = "clean-end"
                break
            got.append(ev)
            if ev == "ev1":
                for t in asyncio.all_tasks():
                    if t is not asyncio.current_task() and not t.done() \
                            and t.get_coro() is not None and "produce" in str(t):
                        t.cancel()
    except asyncio.CancelledError:
        outcome = "cancelled-into-consumer"
    except BaseException as e:  # noqa: BLE001
        outcome = repr(e)
    check(outcome == "clean-end", "消费侧收口 = %r（events=%r）" % (outcome, got))
    check(state["finally_ran"], "produce 的 finally（哨兵/清场）确实执行")


async def s3_client_disconnect():
    print("[S3] 客户端断开（aclose → GeneratorExit）")
    state = {"produce_cancelled": None, "finally_ran": False}

    async def produce(queue):
        try:
            queue.put_nowait("ev1")
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            state["produce_cancelled"] = True
            raise
        finally:
            state["finally_ran"] = True

    got, close_ok = [], True
    gen = make_stream("s3", produce)()
    async for ev in gen:
        got.append(ev)
        break
    try:
        await gen.aclose()
    except BaseException as e:  # noqa: BLE001
        close_ok = False
        print("      aclose 异常:", repr(e))
    check(got == ["ev1"], "断开前事件已收到")
    check(close_ok, "aclose 不炸（GeneratorExit 被拆包安静收口）")
    check(state["produce_cancelled"] is True and state["finally_ran"],
          "组自动 cancel produce（等价旧版 finally 手动 cancel）")


async def s4_produce_raises():
    print("[S4] produce 抛异常（穿透 _produce 自身兜底的兜底路径）")

    async def produce(queue):
        queue.put_nowait("ev1")
        raise RuntimeError("boom")

    got, outcome = [], None
    try:
        async for ev in make_stream("s4", produce)():
            got.append(ev)
        outcome = "clean-end"
    except BaseException as e:  # noqa: BLE001
        outcome = type(e).__name__
    check(outcome == "clean-end" and got == ["ev1"],
          "异常被拆包吞掉、已发事件保留（收口 = %r，events=%r）" % (outcome, got))


async def s5_watchdog_kills():
    print("[S5] 暂停看门狗：截止时间过 + 暂停位未落地 → 强杀")
    state = {"finally_ran": False}

    async def produce(queue):
        try:
            queue.put_nowait("ev1")
            await asyncio.sleep(10)
            queue.put_nowait(None)
        finally:
            state["finally_ran"] = True
            queue.put_nowait(None)

    got, outcome = [], None
    _PAUSE_REQUESTED.add("s5")
    _PAUSE_ARMED["s5"] = asyncio.get_running_loop().time() - 1  # 截止时间已过
    try:
        async for ev in make_stream("s5", produce)():
            got.append(ev)
        outcome = "clean-end"
    except BaseException as e:  # noqa: BLE001
        outcome = type(e).__name__
    check(outcome == "clean-end" and got == ["ev1"],
          "看门狗强杀后干净收口（收口 = %r，events=%r）" % (outcome, got))
    check(state["finally_ran"], "被强杀的 produce 仍走完 finally")
    _PAUSE_REQUESTED.discard("s5")
    _PAUSE_ARMED.pop("s5", None)


async def main() -> int:
    await s1_normal()
    await s2_force_kill()
    await s3_client_disconnect()
    await s4_produce_raises()
    await s5_watchdog_kills()
    print("\n==== %d passed, %d failed ====" % (PASS, FAIL))
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
