/**
 * 通知推送通道：WebSocket + STOMP 1.2 最小客户端（零依赖，原生 WebSocket）。
 *
 * 为什么不用 @stomp/stompjs：本仓是 pnpm 符号链接式 node_modules，沙箱里动依赖树风险大；
 * 且通知订阅只用到 CONNECT/SUBSCRIBE/MESSAGE 三个帧，子集极小，自实现可控可换 ——
 * 后端若将来统一用标准库，把本文件换成 @stomp/stompjs 包装即可（导出签名保持不变）。
 *
 * 后端约定（**尚未实现**，2026-10-09 核实后端无任何 WS 痕迹）：
 *   · 端点：`/api/v1/ws/notifications`（Spring `@EnableWebSocketMessageBroker` + `/ws/notifications`
 *     注册；nginx `/api/v1/` 已有转发，需补 `proxy_http_version 1.1` + Upgrade/Connection 头）；
 *   · 鉴权：CONNECT 帧头 `Authorization: Bearer <access_token>`（与 HTTP 同一套 JWT）；
 *   · 订阅两个目的地：`/user/queue/notifications`（用户单播，Spring 用户队列惯例）
 *     与 `/topic/notices`（全员广播，10-09 用户确认有此形态）—— MESSAGE 走同一个回调；
 *   · 消息体：与 A.1.8 列表条目同构的 JSON（NotificationItem）。
 *
 * 降级：连不上 / 中途断开 → 指数退避重连；调用方（NotificationBell）始终保留
 * 30s HTTP 轮询兜底，推送只是「让徽标快一拍」的增强通道 —— 本文件任何异常都不影响页面。
 */
import { normalizeNotificationItem } from './notifications'
import type { NotificationItem } from '../types/api'

export type NotificationSocketStatus = 'connecting' | 'open' | 'closed' | 'error'

/** 推送来源：user = 用户队列单播；broadcast = /topic/notices 全员广播（页面级 toast 提示）。 */
export type NotificationSource = 'user' | 'broadcast'

export interface NotificationSocketOptions {
  /** CONNECT 帧携带的 Bearer token（与 http.ts 同源：sessionStorage.access_token）。 */
  token: string
  /** 收到一条通知推送（body 已过归一化；解析失败静默丢弃）。source 供调用方区分提示形态。 */
  onNotification: (item: NotificationItem, source: NotificationSource) => void
  /** 连接状态变化（调用方据此显示/隐藏降级提示，或暂停轮询）。 */
  onStatus?: (status: NotificationSocketStatus) => void
}

export interface NotificationSocketHandle {
  close: () => void
  isOpen: () => boolean
}

/** WS 地址：默认同源 + nginx 已转发的前缀；可用 VITE_NOTIF_WS_URL 整体覆盖。 */
const resolveSocketUrl = () => {
  const override = import.meta.env.VITE_NOTIF_WS_URL as string | undefined
  if (override) return override
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${window.location.host}/api/v1/ws/notifications`
}

// ---------- STOMP 1.2 帧编解码（子集：CONNECT / CONNECTED / SUBSCRIBE / MESSAGE / ERROR） ----------

/** STOMP 1.2 头部值转义：`\` → `\\`、`:` → `\c`、`\n` → `\n`、`\r` → `\r`。 */
const encodeHeaderValue = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/:/g, '\\c').replace(/\n/g, '\\n').replace(/\r/g, '\\r')

const decodeHeaderValue = (value: string) =>
  value.replace(/\\r/g, '\r').replace(/\\n/g, '\n').replace(/\\c/g, ':').replace(/\\\\/g, '\\')

interface StompFrame {
  command: string
  headers: Record<string, string>
  body: string
}

const encodeFrame = (command: string, headers: Record<string, string>, body = '') => {
  const head = Object.entries(headers)
    .map(([name, value]) => `${name}:${encodeHeaderValue(value)}`)
    .join('\n')
  // 帧以 \0 结束；行结束用 LF（Spring 与各主流实现都接受；解析侧兼容 CRLF）
  return `${command}\n${head}\n\n${body}\0`
}

/**
 * 从累计字节流里拆出完整帧（以 \0 为帧尾；多条帧一次性到达时逐条产出）。
 * 解析失败（无命令行等）直接丢掉这段 —— 通道是增强路径，宁可少收不可崩。
 */
const extractFrames = (buffer: string): { frames: StompFrame[]; rest: string } => {
  const frames: StompFrame[] = []
  let rest = buffer
  let end = rest.indexOf('\0')
  while (end >= 0) {
    const raw = rest.slice(0, end)
    rest = rest.slice(end + 1)
    // 兼容 CRLF：先把行尾 \r 统一掉（STOMP 1.2 服务器理论上只发 LF，宽容处理）
    const [commandLine, ...headerLines] = raw.split('\n').map((line) => line.replace(/\r$/, ''))
    const separator = headerLines.indexOf('')
    const headerLinesOnly = separator >= 0 ? headerLines.slice(0, separator) : headerLines
    const body = separator >= 0 ? headerLines.slice(separator + 1).join('\n') : ''
    const headers: Record<string, string> = {}
    for (const line of headerLinesOnly) {
      const colon = line.indexOf(':')
      if (colon > 0) headers[decodeHeaderValue(line.slice(0, colon))] = decodeHeaderValue(line.slice(colon + 1))
    }
    if (commandLine) frames.push({ command: commandLine, headers, body })
    end = rest.indexOf('\0')
  }
  return { frames, rest }
}

// ---------- 连接管理 ----------

const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000]
/** 单播：契约 §6.4 用户队列（后端 convertAndSendToUser(userId, "/queue/notifications")）。 */
const SUBSCRIBE_DESTINATION = '/user/queue/notifications'
/** 广播：全员通知（后端 convertAndSend("/topic/notices")，10-09 用户确认有此形态）。 */
const BROADCAST_DESTINATION = '/topic/notices'

export const connectNotificationSocket = (options: NotificationSocketOptions): NotificationSocketHandle => {
  const { token, onNotification, onStatus } = options
  let socket: WebSocket | null = null
  let stopped = false
  let attempt = 0
  let reconnectTimer: number | undefined
  let buffer = ''
  let subscribed = false

  const setStatus = (status: NotificationSocketStatus) => {
    try {
      onStatus?.(status)
    } catch {
      // 状态回调异常不影响通道本身
    }
  }

  const handleMessageFrame = (frame: StompFrame) => {
    if (!frame.body) return
    // 来源判定：SUBSCRIBE 时登记的 id 会原样回到 MESSAGE 帧头的 subscription；
    // 兜底看 destination（个别 broker 实现可能不带 subscription 头）。
    const source: NotificationSource =
      frame.headers.subscription === 'sub-broadcast' || frame.headers.destination === BROADCAST_DESTINATION
        ? 'broadcast'
        : 'user'
    try {
      const parsed: unknown = JSON.parse(frame.body)
      const item = normalizeNotificationItem(parsed)
      if (item) onNotification(item, source)
    } catch {
      // 非 JSON / 形状不对：丢帧不崩（推送只是增强路径）
    }
  }

  const handleFrame = (frame: StompFrame) => {
    if (frame.command === 'CONNECTED') {
      attempt = 0
      setStatus('open')
      // 收到 CONNECTED 才订阅；断线重连后要重订（服务端会话是新的）。
      // 两个目的地：用户队列（单播）+ /topic/notices（广播）—— 广播帧和单播帧走同一个回调。
      subscribed = true
      socket?.send(encodeFrame('SUBSCRIBE', {
        id: 'sub-notifications',
        destination: SUBSCRIBE_DESTINATION,
        ack: 'auto',
      }))
      socket?.send(encodeFrame('SUBSCRIBE', {
        id: 'sub-broadcast',
        destination: BROADCAST_DESTINATION,
        ack: 'auto',
      }))
      return
    }
    if (frame.command === 'MESSAGE') {
      handleMessageFrame(frame)
      return
    }
    if (frame.command === 'ERROR') {
      // 服务端明确拒绝（常见：鉴权失败）。不重试轰炸 —— 按 closed 处理，走轮询兜底。
      setStatus('error')
      socket?.close()
    }
  }

  const clearReconnect = () => {
    if (reconnectTimer !== undefined) {
      window.clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
  }

  const scheduleReconnect = () => {
    if (stopped) return
    setStatus('closed')
    const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]
    attempt += 1
    clearReconnect()
    reconnectTimer = window.setTimeout(connect, delay)
  }

  const connect = () => {
    if (stopped || socket) return
    setStatus('connecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(resolveSocketUrl())
      // STOMP 走文本帧；二进制一律当协议错误关掉
      ws.binaryType = 'arraybuffer'
    } catch {
      scheduleReconnect()
      return
    }
    socket = ws

    ws.onopen = () => {
      buffer = ''
      subscribed = false
      // token 每次连接现读：断线重连时可能已经 refresh 过
      const bearer = sessionStorage.getItem('access_token') || token
      ws.send(encodeFrame('CONNECT', {
        'accept-version': '1.2',
        host: window.location.host,
        'heart-beat': '0,25000',
        Authorization: `Bearer ${bearer}`,
      }))
    }

    ws.onmessage = (event) => {
      const chunk = typeof event.data === 'string' ? event.data : ''
      if (!chunk) return
      buffer += chunk
      const { frames, rest } = extractFrames(buffer)
      buffer = rest
      for (const frame of frames) handleFrame(frame)
    }

    ws.onerror = () => {
      // onclose 紧随其后，统一在那里收尾
      setStatus('error')
    }

    ws.onclose = () => {
      socket = null
      subscribed = false
      if (stopped) {
        setStatus('closed')
        return
      }
      scheduleReconnect()
    }
  }

  connect()

  return {
    close: () => {
      stopped = true
      clearReconnect()
      // 主动关闭就不发 STOMP DISCONNECT 了 —— 直接断开，服务端按会话失效清理
      try {
        socket?.close()
      } catch {
        // 已关闭
      }
      socket = null
    },
    isOpen: () => !!socket && socket.readyState === WebSocket.OPEN && subscribed,
  }
}
