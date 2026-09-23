from pydantic import BaseModel, Field
from langchain_core.tools import tool

from src.agent.vectorstore.chroma_vectorstore import VectorStore


class RetrieverInput(BaseModel):
    query: str = Field(description="用户的查询问题")
    kb_id: str = Field(description="知识库 ID，必须有效")


@tool
async def retriever_tool(input: RetrieverInput) -> str:
    """ 根据知识库 ID 和查询问题，从向量数据库中检索相关文档 """
    result = VectorStore.search_with_db(kb_id=input.kb_id, question=input.query)
    return result
