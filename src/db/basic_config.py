from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

DATABASE_URL = "mysql+aiomysql://root:123@192.168.150.101:3306/campus_flow"
engine_mysql = create_async_engine(DATABASE_URL, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(
    engine_mysql,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_session_mysql() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
