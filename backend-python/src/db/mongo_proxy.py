"""让 pymongo 的 TCP 连接按需走本地 SOCKS5 代理。

背景（本机实测）
---------------
本机直连 ``*.mongodb.net:27017`` 会被链路中间的设备干扰：TCP 能建链，但 TLS
握手阶段立刻收到对端/中间盒注入的 ``tlsv1 alert internal error``。
已验证这与代码、凭据、证书都无关：

* 标准库 ``ssl`` 与 PyOpenSSL 两条路径报同一个错，强制 TLS1.2 / TLS1.3、
  关闭证书校验也一样；说明不是客户端 TLS 配置问题。
* 系统 DNS 解析出的 ``159.143.223.x`` 与代理内 Cloudflare DoH 的结果完全一致，
  说明不是 DNS 污染 —— 就是到该地址 27017 的连接被干扰。
* 同样三个节点改走本地代理（``127.0.0.1:7897``，Clash 的混合端口）后，
  TLS1.3 握手正常、certifi 校验证书链通过。

而 pymongo 4.18 自身已经没有代理能力：``proxyHost`` 虽然在
``uri_parser_shared.URI_OPTIONS`` 里残留，但 validator 会报 "Unknown option"，
包内也搜不到任何 socks 实现，PySocks 也未安装。所以只能在「创建 socket」这一层
做按需分流。

做法
----
包装 ``pymongo.pool_shared._create_connection`` / ``_async_create_connection``：
目标主机命中后缀白名单（默认 ``.mongodb.net``）时，先与本地 SOCKS5 代理建链，
再用 SOCKS5 CONNECT（域名形式，交给代理远端解析）连真实节点；其余连接
（Redis / MySQL / RabbitMQ / MinIO…）原样直连，不受影响。

因为是对原始 socket 做隧道，TLS 的 SNI 与主机名校验仍然使用真实主机名，
副本集发现、Atlas Vector Search 等行为与直连一致。

只在设置了 ``MONGODB_PROXY`` 时生效（默认关闭），其它环境零影响。
"""

from __future__ import annotations

import ipaddress
import logging
import os
import socket
import struct
from typing import Any
from urllib.parse import unquote, urlparse

logger = logging.getLogger(__name__)

PROXY_ENV = "MONGODB_PROXY"  # 例：socks5://127.0.0.1:7897
HOSTS_ENV = "MONGODB_PROXY_HOSTS"  # 逗号分隔的后缀白名单，默认 .mongodb.net
DEFAULT_SUFFIXES = (".mongodb.net",)

_SOCKS_VERSION = 5
_AUTH_NONE = 0x00
_AUTH_USERPASS = 0x02
_AUTH_REJECT = 0xFF
_CMD_CONNECT = 0x01
_ATYP_IPV4 = 0x01
_ATYP_DOMAIN = 0x03
_ATYP_IPV6 = 0x04

_REPLY_ERRORS = {
    0x01: "代理返回 general SOCKS server failure",
    0x02: "代理返回 connection not allowed by ruleset",
    0x03: "代理返回 network unreachable",
    0x04: "代理返回 host unreachable",
    0x05: "代理返回 connection refused",
    0x06: "代理返回 TTL expired",
    0x07: "代理返回 command not supported",
    0x08: "代理返回 address type not supported",
}

_installed = False


def _read_config() -> tuple[tuple[str, int, str | None, str | None], tuple[str, ...]] | None:
    """读取代理配置；未配置 MONGODB_PROXY 时返回 None。"""
    raw = (os.getenv(PROXY_ENV) or "").strip()
    if not raw:
        return None
    if "://" not in raw:
        raw = "socks5://" + raw
    parsed = urlparse(raw)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 1080
    user = unquote(parsed.username) if parsed.username else None
    password = unquote(parsed.password) if parsed.password else None
    suffixes = tuple(
        s.strip().lower() if s.strip().startswith(".") else "." + s.strip().lower()
        for s in (os.getenv(HOSTS_ENV) or "").split(",")
        if s.strip()
    ) or DEFAULT_SUFFIXES
    return (host, port, user, password), suffixes


def _recv_exact(sock: socket.socket, count: int) -> bytes:
    buf = b""
    while len(buf) < count:
        chunk = sock.recv(count - len(buf))
        if not chunk:
            raise OSError("SOCKS5 代理在建链过程中断开连接")
        buf += chunk
    return buf


def _socks5_connect(
    proxy: tuple[str, int, str | None, str | None],
    dest_host: str,
    dest_port: int,
    timeout: float | None,
) -> socket.socket:
    """连上 SOCKS5 代理并请求 CONNECT 到 dest_host:dest_port，返回已就绪的裸 socket。"""
    proxy_host, proxy_port, user, password = proxy
    sock = socket.create_connection((proxy_host, proxy_port), timeout)
    try:
        sock.settimeout(timeout)
        # --- 1. 方法协商 ---
        if user is not None:
            sock.sendall(bytes([_SOCKS_VERSION, 2, _AUTH_NONE, _AUTH_USERPASS]))
        else:
            sock.sendall(bytes([_SOCKS_VERSION, 1, _AUTH_NONE]))
        version, method = _recv_exact(sock, 2)
        if version != _SOCKS_VERSION:
            raise OSError(f"SOCKS5 代理响应版本异常：{version}")
        if method == _AUTH_REJECT:
            raise OSError("SOCKS5 代理拒绝了所有认证方式")
        if method == _AUTH_USERPASS:
            if user is None:
                raise OSError("SOCKS5 代理要求用户名/密码，但 URI 里没提供")
            u = user.encode("utf-8")
            p = (password or "").encode("utf-8")
            sock.sendall(b"\x01" + bytes([len(u)]) + u + bytes([len(p)]) + p)
            if _recv_exact(sock, 2) != b"\x01\x00":
                raise OSError("SOCKS5 代理用户名/密码认证失败")
        elif method != _AUTH_NONE:
            raise OSError(f"SOCKS5 代理返回了不支持的方法：{method}")

        # --- 2. CONNECT 请求：域名交给代理远端解析 ---
        try:
            ip = ipaddress.ip_address(dest_host)
        except ValueError:
            host_bytes = dest_host.encode("idna")
            addr = bytes([_ATYP_DOMAIN, len(host_bytes)]) + host_bytes
        else:
            if ip.version == 4:
                addr = bytes([_ATYP_IPV4]) + ip.packed
            else:
                addr = bytes([_ATYP_IPV6]) + ip.packed
        sock.sendall(bytes([_SOCKS_VERSION, _CMD_CONNECT, 0x00]) + addr + struct.pack(">H", dest_port))

        # --- 3. 解析应答（应答里的 BND.ADDR 长度可变，必须按 ATYP 读完） ---
        version, reply, _, atyp = _recv_exact(sock, 4)
        if version != _SOCKS_VERSION:
            raise OSError(f"SOCKS5 代理应答版本异常：{version}")
        if atyp == _ATYP_IPV4:
            _recv_exact(sock, 4)
        elif atyp == _ATYP_IPV6:
            _recv_exact(sock, 16)
        elif atyp == _ATYP_DOMAIN:
            _recv_exact(sock, _recv_exact(sock, 1)[0])
        _recv_exact(sock, 2)  # BND.PORT
        if reply != 0x00:
            raise OSError(_REPLY_ERRORS.get(reply, f"代理返回未知错误码 0x{reply:02x}"))
        return sock
    except BaseException:
        sock.close()
        raise


def install_mongo_proxy() -> bool:
    """安装分流补丁。返回是否处于「已启用代理」状态。

    幂等；未配置 MONGODB_PROXY 时直接返回 False，不做任何改动。
    """
    global _installed
    config = _read_config()
    if config is None:
        return False
    proxy, suffixes = config
    if _installed:
        return True

    from pymongo import _csot, pool_shared

    set_non_inheritable = getattr(pool_shared, "_set_non_inheritable_non_atomic", None)
    original_sync = pool_shared._create_connection
    original_async = getattr(pool_shared, "_async_create_connection", None)

    def _matches(host: str) -> bool:
        return host.lower().endswith(suffixes)

    def _connect_via_proxy(
        address: tuple[str, int], options: Any
    ) -> socket.socket:
        host, port = address
        timeout = _csot.remaining()
        if timeout is None:
            timeout = getattr(options, "connect_timeout", None) or 20.0
        elif timeout <= 0:
            raise socket.timeout("timed out")
        try:
            sock = _socks5_connect(proxy, host, port, timeout)
        except OSError as exc:
            logger.warning(
                "经 SOCKS5 代理 %s:%s 连接 %s:%s 失败（%s），回退直连",
                proxy[0], proxy[1], host, port, exc,
            )
            return original_sync(address, options)
        if set_non_inheritable is not None:
            set_non_inheritable(sock.fileno())
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, True)
        return sock

    def _create_connection(address: tuple[str, int], options: Any) -> socket.socket:
        if _matches(address[0]):
            return _connect_via_proxy(address, options)
        return original_sync(address, options)

    pool_shared._create_connection = _create_connection  # type: ignore[assignment]

    if original_async is not None:
        import asyncio

        async def _async_create_connection(
            address: tuple[str, int], options: Any
        ) -> socket.socket:
            if _matches(address[0]):
                # SOCKS5 握手是阻塞的，丢到线程里做，别卡住事件循环
                return await asyncio.to_thread(_connect_via_proxy, address, options)
            return await original_async(address, options)

        pool_shared._async_create_connection = _async_create_connection  # type: ignore[assignment]

    _installed = True
    logger.info(
        "MongoDB 连接分流已启用：%s -> SOCKS5 %s:%s",
        "/".join(suffixes), proxy[0], proxy[1],
    )
    return True
