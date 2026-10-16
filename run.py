import asyncio
import sys

if sys.platform == "win32":
    # psycopg 的异步连接要求 Selector 事件循环；
    # uvicorn 在 Windows 上不带 --reload 单 worker 时默认是 ProactorEventLoop，跑不了
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "src.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        # 只监听 src 目录的代码变化：默认会监视整个工作目录(含 .venv)，
        # 大量无关变化会导致子进程被高频杀掉重启，Windows 上偶发
        # "ImportError: cannot load module more than once per process"
        # (numpy C 扩展在 import 中途被杀/重启的竞态)
        reload_dirs=["src"],
    )
