/**
 * 顶栏通知铃铛（2026-10-09 起，替代此前的死按钮）。
 *
 * 数据源：
 *   · 推送：WebSocket + STOMP（`services/notificationSocket.ts`，用户拍板的接收方式）
 *     —— 订阅 /user/queue/notifications（单播）与 /topic/notices（广播，全页 toast）；
 *   · 兜底：HTTP 轮询（`services/notifications.ts`，契约 §6.4 / A.1.8-A.1.11）
 *     —— 30s + 窗口回焦刷新；后端未实现时静默降级，绝不打断页面、绝不编数据。
 *
 * 已读模型（2026-10-10 更新）：广播型通知（user_id 为 NULL 的行）由后端
 * `user_notification_read` 表按用户记已读（readNotification/readAll 里 insert），
 * 列表和未读数接口已合并该表口径 —— 前端**纯服务端真相**：乐观更新 + 失败回滚，
 * 不再做本地已读兜底（那版已随本地表方案一起移除）。
 *
 * 交互：
 *   · 点铃铛开面板并拉列表；点条目 → 未读则标记已读（乐观更新），带内部 action_url 就跳转；
 *   · 「全部已读」：乐观清零，失败重拉列表恢复真相；
 *   · 点面板外 / Esc 关闭。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bell } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notifications'
import {
  connectNotificationSocket,
  type NotificationSocketHandle,
  type NotificationSource,
} from '../services/notificationSocket'
import type { NotificationItem } from '../types/api'

const POLL_INTERVAL_MS = 30_000
const LIST_PAGE_SIZE = 20
/** 广播 toast 停留时长：够了看清标题正文，又不至于挡内容。 */
const BROADCAST_TOAST_MS = 8_000
/** 同屏最多几张广播 toast（更早的挤掉，不叠一堵墙）。 */
const BROADCAST_TOAST_MAX = 3

/** 时间显示：12 分钟前 / 昨天 / 3 天前（口径同 TaskCreateModal；解析失败不显示）。 */
const relative = (value?: string) => {
  if (!value) return ''
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return ''
  const minutes = Math.floor((Date.now() - time) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  return `${Math.floor(days / 30)} 个月前`
}

/** 外链/协议型 action_url 一律不跳（通知只做站内路由跳转）。 */
const isInternalUrl = (url?: string | null) => !!url && url.startsWith('/') && !url.startsWith('//')

export function NotificationBell() {
  const user = useAuthStore((state) => state.user)
  const navigate = useNavigate()
  const wrapRef = useRef<HTMLDivElement>(null)

  const [open, setOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  /** 全页广播 toast（仅 /topic/notices 的推送；单播只进面板，不弹全页）。 */
  const [broadcastToasts, setBroadcastToasts] = useState<(NotificationItem & { toastKey: string })[]>([])

  /** 未读数刷新：轮询/回焦用的静默版 —— 后端未实现（404）时保持安静。 */
  const refreshCount = useCallback(() => {
    fetchUnreadCount()
      .then(setUnreadCount)
      .catch(() => {})
  }, [])

  const socketRef = useRef<NotificationSocketHandle | null>(null)

  const dismissToast = useCallback((toastKey: string) => {
    setBroadcastToasts((prev) => prev.filter((toast) => toast.toastKey !== toastKey))
  }, [])

  /** 广播推送 → 顶栏下方弹出全页 toast，8s 自动消失；点正文跳 action_url。 */
  const pushToast = useCallback(
    (item: NotificationItem) => {
      const toastKey = `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      setBroadcastToasts((prev) => [...prev.slice(-(BROADCAST_TOAST_MAX - 1)), { ...item, toastKey }])
      window.setTimeout(() => dismissToast(toastKey), BROADCAST_TOAST_MS)
    },
    [dismissToast],
  )

  /** 登录后才轮询 / 建推送通道；未登录清零并断开。 */
  useEffect(() => {
    if (!user) {
      setUnreadCount(0)
      socketRef.current?.close()
      socketRef.current = null
      return
    }
    refreshCount()
    const timer = window.setInterval(refreshCount, POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshCount()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    // WebSocket + STOMP 推送通道（即时）：连不上/后端未实现会自动退避重连，
    // 30s 轮询始终保留作兜底 —— 推送只负责「让徽标快一拍」。
    socketRef.current = connectNotificationSocket({
      token: sessionStorage.getItem('access_token') || '',
      onNotification: (item, source: NotificationSource) => {
        setItems((prev) => [item, ...prev.filter((row) => String(row.id) !== String(item.id))])
        // 广播型（/topic/notices）= 面向全员的公告 → 全页 toast 突出提示；单播只进面板
        if (source === 'broadcast') pushToast(item)
        refreshCount()
      },
    })

    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [user, refreshCount, pushToast])

  const loadList = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const data = await fetchNotifications({ page: 1, page_size: LIST_PAGE_SIZE })
      setItems(data.items)
      // 列表里的未读数顺带校正徽标（比 30s 轮询更及时）
      setUnreadCount(data.items.filter((item) => !item.is_read).length)
    } catch {
      setItems([])
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  const openPanel = useCallback(() => {
    setOpen(true)
    void loadList()
  }, [loadList])

  /** 点面板外 / Esc 关闭。 */
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const onItemClick = (item: NotificationItem) => {
    if (!item.is_read) {
      // 乐观更新，失败回滚并重拉计数（真相以服务端为准；
      // 广播型已由后端 user_notification_read 表接管，这里不再有「服务端不可寻址」的分支）
      setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, is_read: true } : row)))
      setUnreadCount((count) => Math.max(0, count - 1))
      markNotificationRead(item.id)
        .then(refreshCount)
        .catch(() => {
          setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, is_read: false } : row)))
          refreshCount()
        })
    }
    setOpen(false)
    if (isInternalUrl(item.action_url)) navigate(item.action_url as string)
  }

  const onMarkAll = () => {
    setItems((prev) => prev.map((row) => ({ ...row, is_read: true })))
    setUnreadCount(0)
    markAllNotificationsRead()
      .then(refreshCount)
      .catch(() => {
        // 失败恢复真相：重拉列表 + 计数
        void loadList()
        refreshCount()
      })
  }

  const hasUnread = items.some((item) => !item.is_read)

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        className="icon-button notif-bell"
        aria-label={`通知${unreadCount > 0 ? `（${unreadCount} 条未读）` : ''}`}
        title="通知"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="通知列表">
          <header className="notif-head">
            <strong>通知</strong>
            {hasUnread && (
              <button type="button" className="notif-mark-all" onClick={onMarkAll}>
                全部已读
              </button>
            )}
          </header>
          <div className="notif-list">
            {loading ? (
              <div className="notif-state">加载中…</div>
            ) : loadError ? (
              <div className="notif-state notif-state-error">
                <span>通知拉取失败</span>
                <button type="button" onClick={() => void loadList()}>重试</button>
              </div>
            ) : items.length === 0 ? (
              <div className="notif-state">暂无通知</div>
            ) : (
              items.map((item) => (
                <button
                  key={String(item.id)}
                  type="button"
                  className={`notif-item${item.is_read ? '' : ' unread'}`}
                  onClick={() => onItemClick(item)}
                >
                  <span className="notif-dot" aria-hidden="true" />
                  <span className="notif-item-body">
                    <span className="notif-item-title">{item.title || '（无标题通知）'}</span>
                    {item.content && <span className="notif-item-content">{item.content}</span>}
                    <span className="notif-item-time">{relative(item.created_at) || '时间未知'}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
      {/* 广播 toast 必须走 portal 挂到 body：.topbar 有 backdrop-filter，会让 fixed 后代
          以顶栏为包含块（toast 被压扁在顶栏里），挂 body 才是真正的视口定位。 */}
      {createPortal(
        <div className="notif-broadcast-layer" aria-live="polite">
          {broadcastToasts.map((toast) => (
            <div key={toast.toastKey} className="notif-broadcast-toast" role="alert">
              <span className="notif-broadcast-tag">公告</span>
              <span
                className="notif-broadcast-body"
                onClick={() => {
                  dismissToast(toast.toastKey)
                  if (isInternalUrl(toast.action_url)) navigate(toast.action_url as string)
                }}
              >
                <strong>{toast.title}</strong>
                {toast.content && <span>{toast.content}</span>}
              </span>
              <button
                type="button"
                className="notif-broadcast-close"
                aria-label="关闭公告提示"
                onClick={() => dismissToast(toast.toastKey)}
              >
                ×
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
