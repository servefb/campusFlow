from fastapi import APIRouter

from src.models.common_responce import result

health_router = APIRouter(tags=["health"])


@health_router.get("/health")
async def health():
    """
    健康探针（**免鉴权**）。

    存在的理由：Java 侧 `/health/ready` 里有一项 `agent_gateway`，要判"模型网关能不能干活"。
    而 `JWTAuthMiddleware` 的白名单原本只有 `/login` 与 `/register`，
    连 `/docs` 都要 token（实测 `GET /` → 401 `{"detail":"缺少 Authorization 头"}`），
    于是 Java 那边只能退化成"TCP 连得上就算活"——401 也判 up。

    有了这个端点，那一项才真正是"健康"而不是"可达"。

    ⚠️ 三个约束：

    1. **路径必须与 `JWTAuthMiddleware.WHITELIST` 里的字面量逐字一致**。
       那边是 `request.url.path in WHITELIST` 的**精确匹配**，不是前缀匹配 ——
       写成 `/health/`（多一个斜杠）或改成 `/healthz` 都会静默回到 401。
    2. **响应体里不要放任何内部信息**（版本号、模型名、依赖地址、连接串）。
       它免鉴权，谁能访问网络谁就能读到。
    3. 这里刻意**不探数据库 / 向量库 / 消息队列**。这是"进程活着"的存活语义；
       依赖是否就绪由 Java 侧的 `/health/ready` 负责聚合并对外表达，
       两边各探一次只会让排查时看到两个互相矛盾的结论。
    """
    return result.success(data={
        "status": "ok",
        "service": "campus-flow-ai",
    })
