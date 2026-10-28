/**
 * 通知中心（接口文档 §6.4 / A.1.8-A.1.11）。
 *
 * ⚠️ 后端 `NotificationsController` 截至 2026-10-09 仍是空壳（无任何端点），
 *    这里按契约文档先行把前端接好：接口 404 / 报错时由调用方（NotificationBell）
 *    降级为空态，不打断页面。后端落地后本层**零改动**。
 *
 * 归一化纪律（09-22 管理端审计五空白的教训）：mock 是「已归一化」的展示形状，
 * live 必须过同一层归一化 —— 直接 `as XxxDto` 的话，字段缺失时类型系统查不出，页面静默空白。
 */
import { http } from './http'
import type {
  ApiSuccess,
  NotificationItem,
  NotificationListData,
  NotificationReadAllResult,
  NotificationReadResult,
} from '../types/api'

const asStringOrNumber = (value: unknown): string | number =>
  typeof value === 'number' ? value : String(value ?? '')

/** 取字段：契约是 snake_case，但后端推送侧若直接塞 PO 实体会是驼峰 —— 两种都认。 */
const pick = (row: Record<string, unknown>, snake: string, camel: string) => {
  const a = row[snake]
  if (a !== undefined && a !== null) return a
  return row[camel]
}

/**
 * 单条通知的防御性归一化：字段缺失/类型不对时给安全默认值，绝不抛出。
 * 同时服务三处：HTTP 列表响应（A.1.8）、用户队列推送、/topic/notices 广播推送。
 * 兼容 snake_case（契约）与驼峰（后端直接推实体的兜底）。
 */
export const normalizeNotificationItem = (raw: unknown): NotificationItem | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  const id = row.id
  if (id === undefined || id === null || id === '') return null
  const type = pick(row, 'type', 'notificationType')
  const isRead = pick(row, 'is_read', 'isRead')
  const createdAt = pick(row, 'created_at', 'createdAt')
  const actionUrl = pick(row, 'action_url', 'actionUrl')
  const resourceType = pick(row, 'resource_type', 'resourceType')
  const resourceId = pick(row, 'resource_id', 'resourceId')
  const readAt = pick(row, 'read_at', 'readAt')
  return {
    id: asStringOrNumber(id),
    type: typeof type === 'string' && type ? type : 'system',
    title: typeof row.title === 'string' ? row.title : '',
    content: typeof row.content === 'string' ? row.content : null,
    is_read: isRead === true || isRead === 'true' || isRead === 1,
    created_at: typeof createdAt === 'string' ? createdAt : '',
    action_url: typeof actionUrl === 'string' && actionUrl ? actionUrl : null,
    resource_type: typeof resourceType === 'string' ? resourceType : null,
    resource_id: resourceId === undefined || resourceId === null ? null : asStringOrNumber(resourceId),
    read_at: typeof readAt === 'string' ? readAt : null,
  }
}

export interface NotificationQuery {
  unread_only?: boolean
  page?: number
  page_size?: number
}

/** 通知列表（A.1.8）。失败/形状不对时回空页，由调用方展示空态或错误行。 */
export const fetchNotifications = async (query: NotificationQuery = {}): Promise<NotificationListData> => {
  const { data } = await http.get<ApiSuccess<unknown>>('/users/me/notifications', {
    params: {
      unread_only: query.unread_only ? 'true' : 'false',
      page: query.page ?? 1,
      page_size: query.page_size ?? 20,
    },
  })
  const payload = (data.data ?? {}) as Record<string, unknown>
  const items = Array.isArray(payload.items)
    ? payload.items.map(normalizeNotificationItem).filter((item): item is NotificationItem => item !== null)
    : []
  return {
    items,
    page: typeof payload.page === 'number' ? payload.page : query.page ?? 1,
    page_size: typeof payload.page_size === 'number' ? payload.page_size : query.page_size ?? 20,
    total: typeof payload.total === 'number' ? payload.total : items.length,
    has_more: payload.has_more === true,
  }
}

/** 未读数量（A.1.9）。轮询用：任何异常都向上抛，由调用方静默吞掉。 */
export const fetchUnreadCount = async (): Promise<number> => {
  const { data } = await http.get<ApiSuccess<unknown>>('/users/me/notifications/unread-count')
  const payload = (data.data ?? {}) as Record<string, unknown>
  const count = payload.unread_count
  return typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
}

/** 标记单条已读（A.1.10）。 */
export const markNotificationRead = async (id: NotificationItem['id']): Promise<NotificationReadResult> => {
  const { data } = await http.patch<ApiSuccess<unknown>>(`/users/me/notifications/${id}/read`)
  const payload = (data.data ?? {}) as Record<string, unknown>
  return {
    id: payload.id !== undefined ? asStringOrNumber(payload.id) : id,
    is_read: payload.is_read === true,
    read_at: typeof payload.read_at === 'string' ? payload.read_at : null,
  }
}

/** 全部标记已读（A.1.11）。 */
export const markAllNotificationsRead = async (): Promise<NotificationReadAllResult> => {
  const { data } = await http.post<ApiSuccess<unknown>>('/users/me/notifications/read-all')
  const payload = (data.data ?? {}) as Record<string, unknown>
  return {
    updated_count: typeof payload.updated_count === 'number' ? payload.updated_count : 0,
  }
}
