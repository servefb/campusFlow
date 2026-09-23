"""OpenSandbox 沙箱接入：按 conversation 隔离的代码执行后端（同步方案）。

选型说明：
- `langchain_opensandbox.OpenSandboxBackend` 是 deepagents 的 BaseSandbox 适配器
  （实现了 execute/upload/download/id），create_deep_agent(backend=...) 直接可用；
- 它要求传入**同步版** `opensandbox.sync.SandboxSync`——同步客户端基于 httpx 的
  同步 transport，可从 deepagents 的线程池线程直接调用，不需要跨事件循环；
- 生命周期：沙箱**懒创建**（get_backend 只包一层代理，模型真的执行代码/摸文件
  时才 SandboxSync.create，建连+健康检查最多 ~30s），同会话复用；
  闲置 30 分钟由后台 reaper 线程销毁；进程退出时
  main.py lifespan 调 shutdown_sandboxes() 全量销毁。

不挂载宿主目录：沙箱内的代码执行只发生在容器自己的临时文件系统里，
宿主机的文件不进入沙箱。
"""
import os
import threading
import time

from langchain_opensandbox import OpenSandboxBackend
from opensandbox.config import ConnectionConfigSync
from opensandbox.sync import SandboxSync

IDLE_TIMEOUT_SECONDS = 1800  # 会话沙箱闲置 30 分钟后回收
REAP_INTERVAL_SECONDS = 60
import dotenv
dotenv.load_dotenv()

# 服务端部署目录（只用于读取 api_key，保持单一事实来源）
SERVER_CONFIG_PATH = r"D:\opensandbox\sandbox.toml"
SANDBOX_DOMAIN = "127.0.0.1:8090"


def _api_key_from_server_config() -> str | None:
    """直接从服务端的 sandbox.toml 读 api_key，保证客户端与服务端永远一致。"""
    try:
        import tomllib
        with open(SERVER_CONFIG_PATH, "rb") as fh:
            data = tomllib.load(fh)
        return (data.get("server") or {}).get("api_key")
    except Exception:  # noqa: BLE001 - 读不到就让 SDK 报 401，不掩盖问题
        return None


class ConversationSandboxManager:
    """按 conversation_id 管理 SandboxSync 的创建/复用/销毁。"""

    def __init__(self, idle_timeout_seconds: int = IDLE_TIMEOUT_SECONDS) -> None:
        self._sandboxes: dict[str, SandboxSync] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._registry_lock = threading.Lock()
        self._last_used: dict[str, float] = {}
        self._idle_timeout = idle_timeout_seconds
        self._reaper_started = False

    def _connection_config(self) -> ConnectionConfigSync:
        # api_key 单一事实来源 = 服务端自己的 sandbox.toml [server].api_key，
        # 以后服务端换 key 只改 toml，客户端不用动。OPEN_SANDBOX_API_KEY
        # 环境变量可临时覆盖。
        return ConnectionConfigSync(
            domain=SANDBOX_DOMAIN,
            protocol="http",
            api_key=os.getenv("OPEN_SANDBOX_API_KEY") or _api_key_from_server_config(),
        )

    def get(self, conversation_id: str) -> SandboxSync:
        """获取或创建指定会话的沙箱。

        同一会话并发请求时，后到的会等待首个创建完成（per-id 锁）；
        不同会话互不阻塞。创建含建连+健康检查，最长约 30s。
        """
        with self._registry_lock:
            lock = self._locks.setdefault(conversation_id, threading.Lock())
        with lock:
            sandbox = self._sandboxes.get(conversation_id)
            if sandbox is None:
                self._start_reaper()
                sandbox = SandboxSync.create(
                    "python:3.12",
                    connection_config=self._connection_config(),
                )
                self._sandboxes[conversation_id] = sandbox
            self._last_used[conversation_id] = time.monotonic()
            return sandbox

    def _destroy(self, conversation_id: str) -> None:
        with self._registry_lock:
            sandbox = self._sandboxes.pop(conversation_id, None)
        if sandbox:
            try:
                sandbox.destroy()
            except Exception:  # noqa: BLE001 - 回收失败不能拖垮主流程
                pass

    def _start_reaper(self) -> None:
        """闲置回收：定期销毁超时未用的会话沙箱（只启一个 daemon 线程）。"""
        if self._reaper_started:
            return
        self._reaper_started = True

        def _reap() -> None:
            while True:
                time.sleep(REAP_INTERVAL_SECONDS)
                now = time.monotonic()
                for conv_id in list(self._sandboxes):
                    if now - self._last_used.get(conv_id, now) > self._idle_timeout:
                        self._destroy(conv_id)

        threading.Thread(target=_reap, daemon=True, name="opensandbox-reaper").start()

    def shutdown(self) -> None:
        """进程退出时销毁所有沙箱（main.py 的 lifespan 里调用）。"""
        for conv_id in list(self._sandboxes):
            self._destroy(conv_id)


sandbox_manager = ConversationSandboxManager()


class _LazySandbox:
    """SandboxSync 的懒加载代理：首次真正被用到（执行命令/读写文件/读 id）才创建。

    此前 get_backend() 在节点入口就 SandboxSync.create()（首次约 30s）——
    纯知识库问答也被迫等沙箱。现在只有模型真的执行代码或摸文件时才付这个成本。
    """

    def __init__(self, factory) -> None:
        self._factory = factory
        self._real = None

    def _instance(self):
        if self._real is None:
            self._real = self._factory()
        return self._real

    def __getattr__(self, name: str):
        # _factory/_real 是正常实例属性，不会落到这里；其余全部转发给真实沙箱
        return getattr(self._instance(), name)


def get_backend(conversation_id: str) -> OpenSandboxBackend:
    """按会话返回 deepagents 后端；沙箱**懒创建**——模型真的用到才建。"""
    return OpenSandboxBackend(
        sandbox=_LazySandbox(lambda: sandbox_manager.get(conversation_id)),
        timeout=1800,
    )


def shutdown_sandboxes() -> None:
    """进程退出钩子（main.py 的 lifespan 调用）：销毁所有会话沙箱。"""
    sandbox_manager.shutdown()
