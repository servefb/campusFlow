import json
import logging
import os

import aio_pika

from src.agent.rag_worker.reingest_document import reingest_document
from src.agent.vectorstore.chroma_vectorstore import VectorStore

logger = logging.getLogger(__name__)


class RabbitConsumer:
    def __init__(self, vector_store: VectorStore, llm_client):
        self.vector_store = vector_store
        self.llm_client = llm_client
        self.connection = None
        self.channel = None

    async def start(self):
        self.connection = await aio_pika.connect_robust(
            host=os.getenv("RABBITMQ_HOST"),
            port=int(os.getenv("RABBITMQ_PORT")),
            login=os.getenv("RABBITMQ_USER"),
            password=os.getenv("RABBITMQ_PASSWORD"),
            virtualhost=os.getenv("RABBITMQ_VHOST"),
        )
        self.channel = await self.connection.channel()
        await self.channel.set_qos(prefetch_count=1)

        queue = await self.channel.declare_queue(os.getenv("QUEUE_NAME"), durable=True)
        await queue.consume(self._on_message)
        logger.info(f"[*] 开始消费队列 {os.getenv('QUEUE_NAME')}")

    async def stop(self):
        if self.connection and not self.connection.is_closed:
            await self.connection.close()

    async def _on_message(self, message: aio_pika.IncomingMessage):
        # async with message.process() 等价于自动 ack
        async with message.process(requeue=False):
            try:
                body = json.loads(message.body.decode("utf-8"))
                logger.info(f"收到消息: {body}")
                await self._process(body)
            except Exception as e:
                logger.exception(f"消息处理失败: {e}")

    async def _process(self, body: dict):
        file_id = body["fileId"]
        action = body.get("action", "ADD")

        if action == "DELETE":
            self.vector_store.delete_document(body["kbId"], body["documentId"])
            await self._notify(body["fileId"], "DELETED")
            return

        try:
            doc_id, ver_id, count = await reingest_document(
                file_id=file_id,
                bucket=body["bucket"],
                object_key=body["objectKey"],
                file_name=body.get("fileName") or body["objectKey"].split("/")[-1],
                user_id=body.get("userId"),
                vector_store=self.vector_store,
                llm_client=self.llm_client,
            )
            await self._notify(file_id, "READY", {
                "documentId": doc_id, "versionId": ver_id, "chunkCount": count,
            })
        except Exception as e:
            await self._notify(file_id, "FAILED", {"error": str(e)})

    async def _notify(self, file_id, status, extra=None):
        payload = {"fileId": file_id, "status": status}
        if extra:
            payload.update(extra)
        await self.channel.default_exchange.publish(
            aio_pika.Message(
                body=json.dumps(payload, ensure_ascii=False).encode(),
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            ),
            routing_key= os.getenv("CALLBACK_QUEUE"),
        )
