import asyncio

from pydantic import BaseModel, Field
from langchain_core.tools import tool

from src.agent.tools.laya_guard import guard_retrieved
from src.agent.vectorstore.chroma_vectorstore import VectorStore


class RetrieverInput(BaseModel):
    query: str = Field(description="用户的查询问题")
    kb_id: str = Field(description="知识库 ID，必须有效")


@tool
async def retriever_tool(input: RetrieverInput) -> str:
    """ 根据知识库 ID 和查询问题，从向量数据库中检索相关文档 """
    result = VectorStore.search_with_db(kb_id=input.kb_id, question=input.query)
    # 检索结果进入提示词前筛查（同步推理放线程，不阻塞事件循环）
    return await asyncio.to_thread(guard_retrieved, f"kb:{input.kb_id}", result)
