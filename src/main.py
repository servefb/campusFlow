import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from fastapi.middleware.cors import CORSMiddleware

from src.agent.store.mongdb_store import store_exit
from src.agent.tools.mcp_tool import init_mcp, close_mcp
from src.api.health_router import health_router
from src.api.conversation_router import conversation_router
from src.api.knowledge_router import knowledge_router
from src.api.task_temp_agent import task_router
from src.jwt.JWTAuthMiddleware import JWTAuthMiddleware
from src.api.worker_space import worker_space_router
from src.api.history_router import history_router

origins = [
    # 浏览器直连本服务时的来源清单（走 vite proxy / nginx 转发属于同源，不经这里）。
    # 管理后台新增的入库接口是前端直连的，所以它的两个来源必须在内：
    # 开发期 vite dev server（strictPort 固定 5180）、生产期 nginx（conf 里 listen 90）。
    "http://localhost:80",
    "http://127.0.0.1:80",
    "http://localhost:90",
    "http://127.0.0.1:90",
    "http://localhost:5180",
    "http://127.0.0.1:5180",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 知识库入库已改为 HTTP 异步接口（POST /knowledge/ingest），
    # 不再由 RabbitMQ 消费上传事件，因此启动时无需拉起任何消费者。

    # laya 输入护栏预热：冷加载实测 79~131 s（CPU），必须挪到启动期后台，
    # 否则第一个提问的用户会撞上它。两条硬约束：
    #   · 后台 + 吞异常 —— 护栏不可用不等于服务不可启动，绝不做成启动依赖；
    #     预热没成功时 `laya_guard.is_ready()` 恒为 False，节点侧自动跳过筛查。
    #   · 任务句柄必须被引用（挂到 app.state）—— 裸 `create_task` 的返回值没人持有，
    #     可能在跑完前被 GC 回收（CPython 文档明写的坑）。
    async def _warm_laya_guard():
        try:
            from src.agent.tools.laya_guard import warm_laya_guard
            await asyncio.to_thread(warm_laya_guard)
        except Exception:
            logger.exception("laya 护栏预热失败：本轮护栏不生效，服务照常运行")

    app.state.laya_guard_task = asyncio.create_task(_warm_laya_guard())

    await init_mcp()

    yield
    await close_mcp()
    # 共享连接池只在进程退出时关闭（请求路径里绝不能关，否则并发请求
    # 拿着已关闭的 transport 会挂死）
    from src.cache.redis_client import close_redis_client
    await close_redis_client()
    # 会话沙箱全量销毁（shutdown_sandboxes 内部用全局单例，别另建实例）
    from src.agent.sandbox.open_sandbox import shutdown_sandboxes
    shutdown_sandboxes()
    store_exit()


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(conversation_router)
app.include_router(worker_space_router)
app.include_router(history_router)
app.include_router(task_router)
app.include_router(knowledge_router)

app.add_middleware(JWTAuthMiddleware)
