import os

from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

# 自带一次 load_dotenv：不依赖别的模块的 import 顺序
load_dotenv()

DATABASE_URL = os.getenv(
    "MYSQL_DATABASE_URL",
    "mysql+aiomysql://root@127.0.0.1:3306/campus_flow",
)
engine_mysql = create_async_engine(DATABASE_URL, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(
    engine_mysql,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_session_mysql() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
