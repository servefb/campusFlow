from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from jose import JWTError, jwt
from dotenv import load_dotenv
import os

load_dotenv()

# ========== 配置 ==========
SECRET_KEY = os.getenv("jwt_secret_key")
ALGORITHM = "HS256"

# 白名单路径（无需认证）
# ⚠️ 这里是【精确匹配】（下面用 `request.url.path in WHITELIST`），不是前缀匹配 ——
#    写 "/health/"（多一个斜杠）或 "/health/**" 都不生效，会静默回到 401。
# 🔴 "/health" 是给 Java 侧 `/health/ready` 的 agent_gateway 探针用的（见 api/health_router.py）。
#    删掉它不会影响业务功能，但会让 Java 的就绪检查永远不 ready —— 那种"业务一切正常、
#    探针一直报红"的故障最难查，改动前先看一眼那边。
WHITELIST = ["/login", "/register", "/health"]

# ========== 自定义中间件 ==========
class JWTAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path in WHITELIST:
            return await call_next(request)

        auth_header = request.headers.get("Authorization")
        if not auth_header:
            return JSONResponse(status_code=401, content={"detail": "缺少 Authorization 头"})

        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return JSONResponse(status_code=401, content={"detail": "格式错误"})

        token = parts[1]
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            user_id = payload.get("userId")
            if user_id is None:
                raise JWTError("缺少 userId")
            request.state.user_id = user_id
            # 原始令牌留给需要「转发用户身份」的场景（如 campus_api_tool 转发给
            # Java 业务系统——两边同一套 JWT，同一把密钥）。
            request.state.user_token = token
        except JWTError as e:
            return JSONResponse(status_code=401, content={"detail": f"Token 无效: {str(e)}"})

        response = await call_next(request)
        return response

async def get_current_user_id(request: Request) -> str:
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(status_code=401, detail="未认证")
    return user_id

async def get_user_token(request: Request) -> str:
    """当前请求的原始 access token（转发用户身份用；白名单路径上为空串）。"""
    return getattr(request.state, "user_token", "")
