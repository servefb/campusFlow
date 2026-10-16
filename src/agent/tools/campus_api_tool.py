"""校园业务 API 工具（校园新闻 / 我的课程）。

调用链：本工具 → 业务网关（默认 `http://192.168.150.100:9080`，`/api/v1` 前缀）
→ Java 服务（`C:\\Users\\Lenovo\\IdeaProjects\\campusflow`，接口以此为准）。
网关负责剥掉 `/api/v1` 前缀，Java 侧路由本身不带版本号（`/news/**`、`/courses/**`）。

鉴权 = 纯转发用户令牌，**本模块不登录、不刷新**：Python 与 Java 用同一套 JWT
（同一把 `jwt_secret_key`、同样的 `userId` claim），把当前请求的 Bearer token
原样转发即可以该用户身份访问——「我的课程」返回的就是这个用户自己的课。
令牌的签发/刷新都是前端的事，本模块只透传。链路：
流端点（conversation_router）取 `Authorization` 头 → `bind_user_token()` 绑进
ContextVar → 随 asyncio 上下文传进图/子代理 → `_request` 取出当 Bearer 用。
没绑到令牌或 401 都返回可读文案（提示前端登录），不抛异常打断主流程。

外部依赖纪律（见项目备忘）：
- 模块顶层**禁止**真发请求的构造 —— httpx 客户端是惰性单例，只能经 `_get_client()`；
- 本机沙箱代理会劫持内网地址（10061 假死），客户端必须 `trust_env=False` 直连。

响应统一是 `Result{code, message, data}` 包装（code==0 成功，来自 common/response/Result.java），
`_unwrap` 负责拆包并压平错误。
"""

import json
import os
import logging
from contextvars import ContextVar
from typing import Optional

import httpx
from langchain_core.tools import tool

logger = logging.getLogger(__name__)

# 业务网关地址（含版本前缀）。Java 侧路由不带前缀，网关负责剥。
_DEFAULT_API_BASE = "http://192.168.150.100:9080/api/v1"
_TIMEOUT = httpx.Timeout(15.0)

# ---------- 用户令牌转发（唯一鉴权通道，本模块不做登录/刷新） ----------
# 流端点在请求入口 set，值随 asyncio 上下文流进图 → 节点 → 工具（含 deepagents
# 派生的子代理任务——它们继承创建时的上下文，比 LangGraph 的 context 参数可靠，
# 那个进不了子图）。
_user_token_var: ContextVar[str] = ContextVar("campus_user_token", default="")


def bind_user_token(token: str) -> None:
    """请求入口绑定当前用户的 access token（流端点每次请求调用一次）。"""
    if token:
        _user_token_var.set(token)


def _forwarded_token() -> str:
    return _user_token_var.get("")


# ---------- 惰性单例（纪律：只能经 getter，模块顶层不建客户端） ----------
_client: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        # trust_env=False：不读 http_proxy/NO_PROXY 等环境变量 —— 本机沙箱代理会
        # 劫持内网地址（表现为 10061 / 超时），内网直连必须关掉。
        _client = httpx.AsyncClient(trust_env=False, timeout=_TIMEOUT)
    return _client


def _api_base() -> str:
    return os.getenv("CAMPUSFLOW_API_BASE", _DEFAULT_API_BASE).rstrip("/")


async def _unwrap(resp: httpx.Response) -> str:
    """拆 Result{code, message, data} 包装，返回 data 的 JSON 文本或可读错误。"""
    body = resp.json()
    if resp.status_code != 200 or body.get("code") != 0:
        return f"接口调用失败：HTTP {resp.status_code} code={body.get('code')} {body.get('message')}"
    return json.dumps(body.get("data"), ensure_ascii=False)


async def _request(method: str, path: str, params: Optional[dict] = None) -> str:
    """转发当前用户令牌请求网关，拆 Result 包装后返回 data 的 JSON 文本。

    没绑到令牌 / 401 都返回可读文案，不抛异常（辅助步骤只降级不中断主流程）。
    """
    url = f"{_api_base()}{path}"
    forwarded = _forwarded_token()
    if not forwarded:
        return "当前请求没有可转发的用户令牌，无法访问校园业务接口。"
    try:
        resp = await _get_client().request(
            method, url, params=params,
            headers={"Authorization": f"Bearer {forwarded}"},
        )
        if resp.status_code == 401:
            return "你的登录状态已过期（业务系统拒绝了令牌），请重新登录后再试。"
        return await _unwrap(resp)
    except Exception as e:
        logger.warning("校园业务接口 %s %s 调用失败：%s", method, path, e)
        return f"校园业务接口（{url}）暂不可达：{e}"


def _clip(text: Optional[str], limit: int = 300) -> str:
    """列表场景截断长正文，保护上下文；详情接口不裁。"""
    if not text:
        return ""
    text = str(text)
    return text if len(text) <= limit else text[:limit] + "…"


# ============================================================
# 校园新闻（CampusNewsController：/news/**）
# ============================================================

@tool
async def get_news_home() -> str:
    """获取校园新闻首页信息流：置顶要闻（spotlight）、推荐新闻（recommendations）、
    按分类分组（groups）和分类统计（categories）。用户想「看看最近校园有什么新闻/
    动态/通知」时调用。

    Returns:
        JSON：spotlight（含 title/published_at/recommendation_reason）、
        recommendations 列表、groups 分类分组、categories 分类与条数。
    """
    raw = await _request("GET", "/news/home")
    try:
        data = json.loads(raw)
        # 只留首页需要的摘要字段，content 全文不留（详情接口再看）
        for group in (data or {}).get("groups", {}).values() if isinstance(data, dict) else []:
            for item in group:
                if isinstance(item, dict):
                    item.pop("content", None)
    except Exception:
        return raw
    return json.dumps(data, ensure_ascii=False)


@tool
async def get_campus_news(
    category: Optional[str] = None,
    query: Optional[str] = None,
    page: int = 1,
    page_size: int = 10,
) -> str:
    """分页检索校园新闻列表，可按分类过滤、按关键词搜索。用户想找某类新闻
    （如「讲座」「通知」「活动」）或按关键词搜新闻时调用。

    Args:
        category: 新闻分类（可先调 get_news_categories 拿到合法值），不传=全部。
        query: 关键词，匹配标题/内容，不传=不过滤。
        page: 页码，从 1 开始。
        page_size: 每页条数，默认 10。

    Returns:
        JSON：新闻列表（id/title/summary/category/published_at 等字段，
        正文截断到 300 字）。
    """
    params = {"page": page, "page_size": page_size}
    if category:
        params["category"] = category
    if query:
        params["query"] = query
    raw = await _request("GET", "/news", params=params)
    try:
        data = json.loads(raw)
        items = data.get("items") or data.get("list") or (data if isinstance(data, list) else [])
        for item in items:
            if isinstance(item, dict):
                if "content" in item:
                    item["content"] = _clip(item.get("content"))
                if "summary" in item:
                    item["summary"] = _clip(item.get("summary"), 200)
    except Exception:
        return raw
    return json.dumps(data, ensure_ascii=False)


@tool
async def get_campus_news_detail(news_id: int) -> str:
    """按 id 获取单条校园新闻的完整内容（标题、正文全文、来源、发布时间等）。
    用户想读某条新闻的正文，或列表里找到了目标新闻需要展开时调用。

    Args:
        news_id: 新闻 id（从 get_news_home / get_campus_news 的结果里拿）。
    """
    return await _request("GET", f"/news/{news_id}")


@tool
async def get_news_categories() -> str:
    """获取校园新闻的分类列表（key、名称、条数）。调 get_campus_news 前想确认
    有哪些合法分类，或用户问「新闻有哪些板块/分类」时调用。
    """
    return await _request("GET", "/news/categories")


# ============================================================
# 课程（CoursesController：/courses/**）
# ============================================================

@tool
async def get_my_courses(term_id: Optional[int] = None, page: int = 1, page_size: int = 20) -> str:
    """查询「我的课程」：当前登录账号已选的课程列表。用户问「我这学期有哪些课/
    我的课表/我选了什么课」时调用。

    Args:
        term_id: 学期 id（不传=当前学期）。
        page: 页码，从 1 开始。
        page_size: 每页条数，默认 20。
    """
    params = {"page": page, "page_size": page_size}
    if term_id:
        params["term_id"] = term_id
    return await _request("GET", "/courses/my", params=params)


@tool
async def search_courses(
    keyword: Optional[str] = None,
    course_type: Optional[str] = None,
    page: int = 1,
    page_size: int = 10,
) -> str:
    """检索全校课程目录（开课信息），可按关键词、课程类型过滤。用户想选课、
    查某门课有没有开设、了解课程介绍时调用。

    Args:
        keyword: 关键词，匹配课程名等，不传=全部。
        course_type: 课程类型过滤（如通识/专业等，以系统实际枚举为准），不传=全部。
        page: 页码，从 1 开始。
        page_size: 每页条数，默认 10。
    """
    params = {"page": page, "page_size": page_size}
    if keyword:
        params["keyword"] = keyword
    if course_type:
        params["course_type"] = course_type
    return await _request("GET", "/courses", params=params)


@tool
async def get_course_detail(course_id: int) -> str:
    """按 id 获取单门课程的详细信息（介绍、学分、开课单位等）。用户想深入了解
    某门课时调用。

    Args:
        course_id: 课程 id（从 search_courses / get_my_courses 的结果里拿）。
    """
    return await _request("GET", f"/courses/{course_id}")


@tool
async def get_course_offerings(course_id: int, term_id: Optional[int] = None) -> str:
    """查询某门课程在某学期的开课班次（offerings：上课时间地点、容量、剩余名额等）。
    用户想选课/换班、问某门课什么时间上、还有没有名额时调用。

    Args:
        course_id: 课程 id。
        term_id: 学期 id（不传=全部/当前学期，以系统为准）。
    """
    params = {"term_id": term_id} if term_id else None
    return await _request("GET", f"/courses/{course_id}/offerings", params=params)
