from langchain_community.embeddings import DashScopeEmbeddings

def get_embeddings():
    return DashScopeEmbeddings(model="text-embedding-v3")
