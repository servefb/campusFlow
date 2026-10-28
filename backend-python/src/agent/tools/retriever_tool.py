import re
import asyncio

from pydantic import BaseModel, Field
from langchain_core.tools import tool

from src.agent.tools.laya_guard import guard_retrieved
from src.agent.vectorstore.chroma_vectorstore import VectorStore


class RetrieverInput(BaseModel):
    query: str = Field(description="用户的查询问题，写成完整的一句话效果最好")
    kb_id: str = Field(
        default="",
        description="分类 code，**一般留空**（留空 = 跨所有分类检索）。"
                    "只有你确定问题只属于某一类、且想缩小范围时才填，"
                    "值取 get_knowledge_tool 返回里箭头右边的部分")


# 尾部括号说明，如 "scholarship（奖学金）"
_TRAILING_PAREN_RE = re.compile(r"\s*[（(][^）)]*[）)]\s*$")


def _normalize_kb_id(raw: str) -> str:
    """把模型可能抄错的分类串还原成纯 code。

    `get_knowledge_tool` 回的是「分类名 → code」，模型偶尔会把整串、或带括号的
    名称一起塞进 kb_id（"奖学金 → scholarship" / "scholarship（奖学金）"）。
    分类名是给人看的，kb_id 只认 code —— 抄错就是次次检索空手而归，而且
    现象是「什么都没查到」而不是报错，很难归因。这里只做最朴素的两刀。
    """
    s = (raw or "").strip()
    if "→" in s:
        s = s.split("→")[-1].strip()
    return _TRAILING_PAREN_RE.sub("", s).strip()


@tool
async def retriever_tool(input: RetrieverInput) -> str:
    """ 在知识库里检索相关资料。默认跨所有分类检索，不要自己先猜一个分类。 """
    kb_id = _normalize_kb_id(input.kb_id)
    if kb_id:
        result = VectorStore.search_with_db(kb_id=kb_id, question=input.query)
        source = f"kb:{kb_id}"
    else:
        # 不传分类 = 跨分类检索：向量只算一次，各分类各取若干块，合并排序后裁剪。
        # 原来让模型先挑一个 code 再查，挑错就打空 collection（返回「未检索到」，
        # 日志里也看不出是分类错），比现在这种按距离筛稳得多。
        result = VectorStore.search_across(question=input.query)
        source = "kb:all"
    # 检索结果进入提示词前筛查（同步推理放线程，不阻塞事件循环）
    return await asyncio.to_thread(guard_retrieved, source, result)
