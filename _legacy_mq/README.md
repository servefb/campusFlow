# 已废弃：RabbitMQ 入库链路（2026-09-20 归档）

这三个文件原先是「Java 上传成功 → publish MQ → Python 消费入库」的实现。
现在入库改成由管理员在前端显式确认、直接调本服务的 HTTP 接口：

    POST /knowledge/ingest          （人工指定 categoryCode，异步返回）
    GET  /knowledge/ingest/{fileId} （轮询状态）

因此下面这条链路整体废弃，文件只是**归档保留**，不再被任何代码 import
（已 grep 确认：除彼此互相引用外，`src/` 下无引用点）。仓库当时还没有任何
commit，无法靠 git 回滚，所以用归档而非删除。

| 文件 | 原职责 | 现在由谁承担 |
|------|--------|--------------|
| `consumer.py` | RabbitMQ 消费者，解析 ADD/DELETE 消息、回执 CALLBACK_QUEUE | `src/api/knowledge_router.py` |
| `ingest.py` | 新建文档入库流程 `ingest_document` | `src/agent/rag_worker/ingest_service.py` |
| `reingest_document.py` | 版本更新流程 `reingest_document` | 同上（复用同一条 version 记录的重试逻辑） |

一并废弃的行为，别再引回来：

- **上传即入库**：上传只落 MinIO，入库必须由管理员显式确认。
- **LLM 猜分类**：分类改为接口参数 `categoryCode` 人工指定，不再有
  `meta["category_code"]` 与 `uncategorized` 兜底。
- **MQ 回执给 Java**：状态以本服务 MySQL 的
  `knowledge_documents.status` / `knowledge_document_versions.status` 为唯一事实来源。

保留下来仍在用的：`chunk.py`（解析分块）、`extractor.py`（LLM 抽元数据，
已去掉分类）、`minio_client.py`（下载）、`repository.py`（数据访问）。
