from typing import Optional

from pydantic import BaseModel


class TaskMatchRequest(BaseModel):
    """任务模板/文档匹配接口的请求体。

    注意：不要命名为 Request —— 会和 fastapi.Request 撞名，
    导致同名类在同一个模块里遮蔽，很难排查。
    """
    title: Optional[str] = None
    query: Optional[str] = None
