import os

from langchain_community.embeddings import DashScopeEmbeddings

# 单请求送多少条文本。
# ⚠️ 2026-10-20 实测：v3 一次发 25 条**成功**（dim 1024），所以「单请求最多 10 条」
# 这个说法不成立。真正的风险是 token 总量（`add_sections` 一批 500 条 × 每块几百 token），
# 500 条没实测。10 是个保守值，不是硬性上限 —— 想快可以调大 EMBED_BATCH_SIZE。
EMBED_BATCH_SIZE = int(os.getenv("EMBED_BATCH_SIZE", "10"))


class _BatchedDashScopeEmbeddings(DashScopeEmbeddings):
    """按 EMBED_BATCH_SIZE 切片后再发请求，其余行为完全继承。

    只覆盖 embed_documents（入库侧）；查询侧 embed_query 本来就一条，不用管。
    顺序由切片循环保证：结果按原序拼接，不会和 texts 错位。
    """

    def embed_documents(self, texts):
        out = []
        for i in range(0, len(texts), EMBED_BATCH_SIZE):
            out.extend(super().embed_documents(texts[i:i + EMBED_BATCH_SIZE]))
        return out


def get_embeddings():
    return _BatchedDashScopeEmbeddings(model="text-embedding-v3")
