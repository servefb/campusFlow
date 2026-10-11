
import os
from langgraph.store.mongodb import MongoDBStore, create_vector_index_config

from src.agent.embedding_model.embedding_alli_model import get_embeddings
from dotenv import load_dotenv
load_dotenv()


# ---------- 1. 连接配置 ----------
MONGODB_URI = os.getenv("MONGODB_URI")
DB_NAME = "langgraph"
COLLECTION_NAME = "memories"

# ---------- 3. 向量索引配置（手动嵌入） ----------
index_config = create_vector_index_config(
    embed=get_embeddings(),
    dims=1024,  # ⚠️ 与 voyage-3 输出维度一致
    fields=["content"],  # 对应 value 里的 "content"
    # filters=["user_id"],      # 需要元数据过滤时再加
)



# ---------- 4. 创建 Store ----------
def creat_store():
    return MongoDBStore.from_conn_string(
        conn_string=MONGODB_URI,
        db_name=DB_NAME,
        collection_name=COLLECTION_NAME,
        index_config=index_config,
    )


_store_ctx = creat_store()


store=_store_ctx.__enter__()


def store_exit():
     _store_ctx.__exit__(None, None, None)