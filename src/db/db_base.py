"""全局唯一的 SQLAlchemy DeclarativeBase。

所有 ORM 模型都必须继承这里的 Base。不要在各自的 db_*.py 里再定义新的
DeclarativeBase —— 多个 Base 会产生多个互相隔离的 registry，导致
relationship() 跨文件解析失败（典型报错：
InvalidRequestError: expression 'XXX' failed to locate a name）。
"""
from datetime import datetime as _dt, timezone

from sqlalchemy.orm import DeclarativeBase


def utcnow() -> _dt:
    """Naive UTC now（datetime.utcnow 在 Python 3.12+ 已废弃）。"""
    return _dt.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass
