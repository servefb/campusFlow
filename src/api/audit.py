"""接口审计增强器 —— 一个装饰器，把「谁、什么时候、对什么、做了什么、成没成」写进 `audit_logs`。

为什么用装饰器而不是在每个端点里手写一段 insert：

- 审计是**横切**关注点。`knowledge_router` 里 5 个端点只有 2 个是会改数据的动作
  （`POST /ingest`、`POST /documents/{id}/remove`），在路由声明上挂一行 `@audited(...)`，
  「哪些端点被记了」一眼可见；反过来，读接口（尤其是被前端 2 秒轮询一次的
  `GET /ingest/{fileId}`）**必须不挂** —— 挂了就是往表里灌轮询噪音，所以自测里有守卫盯着。
- 端点自己的返回值和异常一律不动：审计写失败只 `warning`，绝不把业务请求带崩。

表是 Java 侧设计的（`WebstormProjects/campusflow/校园事务智能助手数据库设计.sql:625`），
Python 只是往里写，因此**不建 ORM 模型**，直接用参数化 SQL，列名与建表脚本逐字对齐。

⚠️ 这是**全角色**审计表（`operator_role enum('student','teacher','admin')`），不是「管理员操作记录」；
管理员只是「有权查那张表的人」（文档第 15 章 `GET /admin/audit-logs`）。
"""

from __future__ import annotations

import functools
import inspect
import json
import logging
import uuid
from typing import Any, Callable, Optional

from sqlalchemy import text

from src.db.basic_config import AsyncSessionLocal

logger = logging.getLogger(__name__)

SUCCESS = "success"
FAILURE = "failure"

# 与建表脚本逐字对齐；created_at 交给 DB 默认值（CURRENT_TIMESTAMP(3)），别在应用侧算时间。
# ⚠️ `result` 列有 CHECK (result IN ('success','failure'))，多一个字面量都会插入失败。
_INSERT = text(
    "INSERT INTO audit_logs "
    "    (request_id, operator_user_id, operator_role, action, resource_type, "
    "     resource_id, result, ip_address, user_agent, before_data, after_data, "
    "     error_message) "
    "VALUES "
    "    (:request_id, :operator_user_id, :operator_role, :action, :resource_type, "
    "     :resource_id, :result, :ip_address, :user_agent, :before_data, :after_data, "
    "     :error_message)"
)

_ROLE_SQL = text("SELECT role FROM users WHERE id = :uid AND deleted_at IS NULL")

# 列宽（建表脚本）：ip_address varchar(45)、request_id varchar(80)、user_agent text。
_MAX_IP = 45
_MAX_REQUEST_ID = 80
_MAX_UA = 512


# ---------------------------------------------------------------------------
# 取值助手：让装饰器参数写成「从哪儿取」，而不是在主流程里塞 if
# ---------------------------------------------------------------------------
def from_path(name: str) -> Callable[[dict, Optional[dict]], Any]:
    """从路径参数取（`kwargs[name]`），如 `POST /documents/{document_id}/remove`。"""
    return lambda kwargs, data: kwargs.get(name)


def from_data(key: str) -> Callable[[dict, Optional[dict]], Any]:
    """从成功响应的 `data` 里取，如 ingest 返回的 `documentId`。

    失败时 `data` 是 None，取值助手一律返回 None —— 别让装饰器自己猜。
    """
    return lambda kwargs, data: (data or {}).get(key) if isinstance(data, dict) else None


# ---------------------------------------------------------------------------
# 请求侧信息
# ---------------------------------------------------------------------------
def _client_ip(request) -> Optional[str]:
    """优先取 X-Forwarded-For 的**第一跳**（nginx 在最前面追加），没有才用直连地址。

    不这么做的话，前端经 nginx 进来时记到的是 127.0.0.1 —— 审计里最没用的那个值。
    """
    if request is None:
        return None
    xff = request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip")
    if xff:
        return xff.split(",")[0].strip()[:_MAX_IP] or None
    client = getattr(request, "client", None)
    return (getattr(client, "host", None) or None)


def _request_id(request) -> str:
    """沿用调用方带来的 requestId（网关/Java 都这么传），没有就自己生成一个。"""
    rid = (request.headers.get("x-request-id") if request is not None else None) or ""
    return rid.strip()[:_MAX_REQUEST_ID] or f"py-{uuid.uuid4().hex[:24]}"


def _user_agent(request) -> Optional[str]:
    if request is None:
        return None
    ua = request.headers.get("user-agent")
    return ua[:_MAX_UA] if ua else None


def _as_int(value) -> Optional[int]:
    """operator_user_id / resource_id 都是 bigint；JWT 里的 userId 是字符串，得转。

    转不了就给 None —— 宁可少一个字段，也不要写一个错的身份进审计表。
    """
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _json_or_none(value) -> Optional[str]:
    """JSON 列统一存字符串（与表里既有行一致，如 `{"taskNo": "..."}`）。"""
    if value is None:
        return None
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        logger.warning("审计 JSON 序列化失败，已丢弃: %r", value)
        return None


async def _resolve_role(session, user_id: Optional[int]) -> Optional[str]:
    """查 `users.role`。

    JWT 里只有 userId / username，没有角色（`zhixuehub/.../JwtUtil.java` 只签这两个 claim），
    所以按主键查一次。查不到就留 None，**不编造** —— 编成 'admin' 会让审计记录说谎，
    而这张表存在的意义就是别让记录说谎。
    """
    if user_id is None:
        return None
    try:
        row = (await session.execute(_ROLE_SQL, {"uid": user_id})).first()
    except Exception:
        logger.warning("审计：查用户角色失败 userId=%s", user_id, exc_info=True)
        return None
    return row[0] if row else None


def _read_envelope(response) -> tuple[bool, Optional[dict], Optional[str]]:
    """读本项目统一信封 `{"code":0|4xx|5xx,"message":...,"data":{...}}`。

    `code != 0` 也算一次**失败记录**：管理员点了入库、被「分类不存在」挡回来，
    这件事同样该留痕（否则只看成功记录会以为没人试过）。
    """
    if not isinstance(response, dict) or "code" not in response:
        return True, None, None  # 不是信封（理论到不了），不评判成败
    ok = response.get("code") == 0
    data = response.get("data") if isinstance(response.get("data"), dict) else None
    if ok:
        return True, data, None
    reason = (data or {}).get("reason")
    msg = str(response.get("message") or f"code={response.get('code')}")
    return False, None, f"{msg}（reason={reason}）" if reason else msg


# ---------------------------------------------------------------------------
# 增强器本体
# ---------------------------------------------------------------------------
def audited(
    *,
    action: str,
    resource_type: str,
    resource_id: Any = None,
    detail: Optional[Callable[[dict, Optional[dict]], Any]] = None,
):
    """把被装饰的路由调用记进 `audit_logs`。

    :param action: 动作名，点分风格（与表里既有行 `user.login` / `task.create` 一致）
    :param resource_type: 资源类型，同样点分风格
    :param resource_id: 资源 id，或取值助手（`from_path(...)` / `from_data(...)`）
    :param detail: 由 `(kwargs, data)` 产出 `after_data` 的可调用对象；
                   失败路径 `data` 为 None，此时应按 kwargs 里的入参构造（记「试了什么」）

    ⚠️ 被装饰的函数**必须**声明 `request: Request`（FastAPI 会注入），
    否则拿不到 IP / UA / requestId。缺了只是少几个字段，不会报错。
    """

    def decorator(func):
        # FastAPI 一律按关键字调用端点，但别依赖这个细节：把位置参数按签名归位，
        # 取值助手（from_path/from_data 与 detail）就永远只看 kwargs 一处。
        # 踩过：detail 里写 kwargs["req"].fileId，测试按位置传参时静默 KeyError →
        # after_data 变 None（还被 except 吞成 warning），看着像「JSON 挂了」。
        signature = inspect.signature(func)

        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # 先把位置参数按签名归位，**后面所有取值都只看这一份** ——
            # 只归位一半（比如 request/user_id 仍读原始 kwargs）就会在位置调用时丢掉 IP。
            try:
                call = dict(signature.bind_partial(*args, **kwargs).arguments)
            except TypeError:  # 签名对不上（不该发生）：退回原始 kwargs，别把请求带崩
                call = kwargs

            request = call.get("request")
            operator_user_id = _as_int(call.get("user_id"))

            response = None
            error: Optional[BaseException] = None
            try:
                response = await func(*args, **kwargs)
            except BaseException as exc:  # 包括被取消：失败事实要留下，异常照旧往上抛
                error = exc

            try:
                await _record(
                    request=request,
                    action=action,
                    resource_type=resource_type,
                    resource_id=resource_id,
                    detail=detail,
                    kwargs=call,
                    response=response,
                    error=error,
                    operator_user_id=operator_user_id,
                )
            except Exception:
                # 审计是旁路：它挂了不能让业务请求挂
                logger.warning("写审计日志失败 action=%s", action, exc_info=True)

            if error is not None:
                raise error
            return response

        return wrapper

    return decorator


async def _record(
    *,
    request,
    action: str,
    resource_type: str,
    resource_id,
    detail,
    kwargs: dict,
    response,
    error: Optional[BaseException],
    operator_user_id: Optional[int],
):
    if error is not None:
        ok, data, message = False, None, f"{type(error).__name__}: {error}"
    else:
        ok, data, message = _read_envelope(response)

    if callable(resource_id):
        try:
            resolved_id = _as_int(resource_id(kwargs, data))
        except Exception:
            logger.warning("审计：resource_id 取值失败 action=%s", action, exc_info=True)
            resolved_id = None
    else:
        resolved_id = _as_int(resource_id)

    after = None
    if detail is not None:
        try:
            after = _json_or_none(detail(kwargs, data))
        except Exception:
            logger.warning("审计：detail 构造失败 action=%s", action, exc_info=True)

    params = {
        "request_id": _request_id(request),
        "operator_user_id": operator_user_id,
        "operator_role": None,
        "action": action,
        "resource_type": resource_type,
        "resource_id": resolved_id,
        "result": SUCCESS if ok else FAILURE,
        "ip_address": _client_ip(request),
        "user_agent": _user_agent(request),
        "before_data": None,
        "after_data": after,
        "error_message": None if ok else message,
    }

    # 单独一条会话/事务：审计落库与业务事务互相不牵连（业务回滚不该带走审计，
    # 审计失败也不该把业务改动一起回滚）。
    async with AsyncSessionLocal() as session:
        params["operator_role"] = await _resolve_role(session, operator_user_id)
        await session.execute(_INSERT, params)
        await session.commit()

    logger.info(
        "[audit] %s %s/%s result=%s operator=%s",
        action, resource_type, resolved_id, params["result"], operator_user_id,
    )
