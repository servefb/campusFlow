import logging
import os
import tempfile

import dotenv

dotenv.load_dotenv()

from minio import Minio, S3Error

logger = logging.getLogger(__name__)

_client: Minio | None = None

# 建客户端必需的配置。缺了就报出来，别等 Minio() 抛一句看不出所以然的错。
_REQUIRED_ENV = ("MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY")

# 真值集合：.env 里大小写、带不带引号都写得出来，别只认 "True"
_TRUE_VALUES = {"1", "true", "yes", "on"}


def _use_tls() -> bool:
    return (os.getenv("MINIO_SECURE") or "").strip().lower() in _TRUE_VALUES


def get_minio_client() -> Minio:
    """惰性单例。构造失败不写回 _client —— 配置修好后不必重启进程。"""
    global _client
    if _client is None:
        missing = [k for k in _REQUIRED_ENV if not os.getenv(k)]
        if missing:
            raise RuntimeError(f"MinIO 配置缺失: {', '.join(missing)}（检查 .env）")
        endpoint = os.getenv("MINIO_ENDPOINT")
        _client = Minio(
            endpoint,
            access_key=os.getenv("MINIO_ACCESS_KEY"),
            secret_key=os.getenv("MINIO_SECRET_KEY"),
            secure=_use_tls(),
        )
        logger.info("MinIO 客户端初始化: %s (secure=%s)", endpoint, _use_tls())
    return _client


def ensure_bucket(bucket_name: str):
    bucket = bucket_name or os.getenv("MINIO_BUCKET_NAME")
    client = get_minio_client()
    if not client.bucket_exists(bucket):
        client.make_bucket(bucket)
        logger.info("创建 MinIO 桶: %s", bucket)
    return bucket


def download(bucket: str, object_key: str) -> str:
    # 🔴 必须先 get_minio_client()：_client 是模块级 None，直接用它就是
    #    AttributeError: 'NoneType' object has no attribute 'fget_object'。
    client = get_minio_client()

    suffix = os.path.splitext(object_key)[1]
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp_path = tmp.name
    tmp.close()
    try:
        client.fget_object(bucket, object_key, tmp_path)
    except Exception as e:
        # 任何失败都要清掉残留的空文件，不然临时目录里全是 0 字节壳
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                logger.warning("临时文件清理失败: %s", tmp_path)
        if isinstance(e, S3Error):
            logger.error("MinIO 下载失败 %s/%s: %s", bucket, object_key, e)
        else:
            # 连不上 / 认证失败 / 网络被劫持：栈信息比 message 有用得多
            logger.error("MinIO 下载异常 %s/%s", bucket, object_key, exc_info=True)
        raise

    size = os.path.getsize(tmp_path)
    logger.info("下载完成 %s/%s -> %s (%s bytes)", bucket, object_key, tmp_path, size)
    return tmp_path
