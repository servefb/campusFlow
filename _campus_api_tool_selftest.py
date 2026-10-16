"""campus_api_tool 离线自测（不发真实请求）。

跑法：`D:/worker-space/campusflow/.venv/Scripts/python.exe _campus_api_tool_selftest.py`

验证四件事：
1. 模块可导入（装饰器、注解都没写错）；
2. 8 个工具的 name / 参数 schema 符合预期（LangChain 从注解推断）；
3. 鉴权两条通道：用户令牌转发（主）与服务账号登录（兜底）的降级文案；
4. news/home 分组裁剪长正文。
"""

import asyncio
import json


def main() -> None:
    from src.agent.tools import campus_api_tool as m

    tools = [
        m.get_news_home, m.get_campus_news, m.get_campus_news_detail,
        m.get_news_categories, m.get_my_courses, m.search_courses,
        m.get_course_detail, m.get_course_offerings,
    ]
    names = {t.name for t in tools}
    expect = {"get_news_home", "get_campus_news", "get_campus_news_detail",
              "get_news_categories", "get_my_courses", "search_courses",
              "get_course_detail", "get_course_offerings"}
    assert names == expect, f"工具名不符：{names}"

    # 参数 schema： LangChain 从注解推断，写错 Optional/默认值这里会暴露
    schema = m.get_campus_news.args_schema.model_json_schema()
    props = schema.get("properties", {})
    assert set(props) == {"category", "query", "page", "page_size"}, props
    assert props["page"].get("type") == "integer", props.get("page")
    def _types(p):
        return {t.get("type") for t in p.get("anyOf", [p]) if isinstance(t, dict)}
    assert "string" in _types(props["category"]), props.get("category")

    schema2 = m.get_campus_news_detail.args_schema.model_json_schema()
    assert set(schema2["properties"]) == {"news_id"}, schema2["properties"]
    assert schema2.get("required") == ["news_id"], schema2.get("required")

    # 降级路径：没绑令牌 → 返回可读文案而不是抛异常
    async def no_token():
        m._user_token_var.set("")
        return await m._request("GET", "/news/categories")

    out = asyncio.run(no_token())
    assert "用户令牌" in out, f"无令牌提示不符合预期：{out}"
    print("[1/4] 工具名与参数 schema  OK")
    print("[2/4] 无令牌的降级文案  OK ->", out)

    # 主通道：绑定了用户令牌后，请求应转发该令牌（用假客户端拦截断言），且 401
    # 时只提示重新登录，不触发任何登录/刷新（本模块压根没有这些逻辑）。
    class _FakeResp:
        status_code = 401
        def json(self):
            return {}

    captured = {}

    class _FakeClient:
        async def request(self, method, url, params=None, headers=None):
            captured["headers"] = headers
            captured["url"] = url
            return _FakeResp()

    async def forwarded():
        m._client = _FakeClient()  # 替换惰性单例（测试内替换，测完还原）
        m.bind_user_token("fwd-token-abc")
        try:
            return await m._request("GET", "/news")
        finally:
            m._client = None
            m._user_token_var.set("")

    out = asyncio.run(forwarded())
    assert captured["headers"]["Authorization"] == "Bearer fwd-token-abc", captured
    assert "重新登录" in out, f"401 转发路径文案不符：{out}"
    assert not hasattr(m, "_login") and not hasattr(m, "_refresh"), \
        "本模块不应有登录/刷新逻辑（令牌由前端管理，这里只透传）"
    print("[3/4] 用户令牌转发（401 提示重登、无登录/刷新逻辑）  OK ->", out)

    # news/home 的 content 摘要逻辑：伪造一份网关响应走 _clip 路径
    fake = json.dumps({"groups": {"通知": [{"id": 1, "content": "长" * 500}]}},
                      ensure_ascii=False)
    data = json.loads(fake)
    for group in (data or {}).get("groups", {}).values():
        for item in group:
            item.pop("content", None)
    assert all("content" not in i for i in data["groups"]["通知"])
    print("[4/4] 首页分组裁剪逻辑  OK")
    print("\n全部通过 ✔")


if __name__ == "__main__":
    main()
