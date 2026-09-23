from contextlib import asynccontextmanager

from fastapi import FastAPI

from src.api.agent_router import agent_router
from fastapi.middleware.cors import CORSMiddleware
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 知识库入库已改为 HTTP 异步接口（POST /knowledge/ingest），
    # 不再由 RabbitMQ 消费上传事件，因此启动时无需拉起任何消费者。
    yield
    # 共享连接池只在进程退出时关闭（请求路径里绝不能关，否则并发请求
    # 拿着已关闭的 transport 会挂死）
    from src.cache.redis_client import close_redis_client
    await close_redis_client()
    # 会话沙箱全量销毁（shutdown_sandboxes 内部用全局单例，别另建实例）
    from src.agent.sandbox.open_sandbox import shutdown_sandboxes
    shutdown_sandboxes()


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(agent_router)
app.include_router(conversation_router)
app.include_router(worker_space_router)
app.include_router(history_router)
app.include_router(task_router)
app.include_router(knowledge_router)

app.add_middleware(JWTAuthMiddleware)
