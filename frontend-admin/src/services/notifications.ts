import { ApiBusinessError, ensureApiSuccess, http, makeIdempotencyKey } from './http'
import { isMock, mockDelay } from '../stores/dataMode'
import {
  createMockNotification,
  deleteMockNotification,
  mockAdminNotifications,
} from '../mocks/data'
import type {
  AdminNotification,
  AdminNotificationCreatePayload,
  AdminNotificationCreateResult,
  AdminNotificationDeleteResult,
  ApiSuccess,
  Paged,
} from '../types/api'

/* ============================================================================
 * ⚠️ 预留接口 —— 后端未提供，本文件为契约占位（mock 是契约的第二实现）
 * ============================================================================
 *
 * 《校园事务智能助手后端接口文档》第 6.4 节只定义了**学生端**通知接口
 * （GET /users/me/notifications、unread-count、标记已读），没有任何管理端发布接口。
 * `notifications` 表本身已就绪（user_id / notification_type / title / content /
 * action_url / is_read / created_at / expires_at），真库现有数据全是任务类系统通知。
 *
 * 路径草案（接后端时全局搜索 RESERVED 找全部待确认点，详见《接口对接说明.md》2.7）：
 *   GET    /admin/notifications?page=&page_size=   广播通知列表（user_id IS NULL 的行）
 *   POST   /admin/notifications                    发布广播通知
 *   DELETE /admin/notifications/{id}               撤回（物理删广播行）
 *
 * 🔴 发布对象语义（用户 2026-10-09 拍板）：**没有 user_id 的通知 = 全员可见**。
 *    学生端 `GET /users/me/notifications` 必须查 `user_id = me OR user_id IS NULL`
 *    才能看到广播 —— 当前后端实现是 `eq(user_id, me)`，联调前要改（接口说明 2.7 已登记）。
 *
 * ⚠️ 已读语义缺口：广播行全员共享一行，`is_read` 无法按人记录 —— 后端要么对广播行
 *    忽略已读（永远算未读徽标不合适，建议学生端广播不进未读数），要么另建回执表。
 */

/** RESERVED · GET /admin/notifications */
export async function getAdminNotifications(
  params: { page?: number; page_size?: number } = {},
): Promise<ApiSuccess<Paged<AdminNotification>>> {
  const { page = 1, page_size = 8 } = params
  if (isMock()) {
    await mockDelay()
    const sorted = [...mockAdminNotifications].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    const start = (page - 1) * page_size
    const items = sorted.slice(start, start + page_size)
    return {
      code: 0,
      message: 'ok',
      data: {
        items,
        page,
        page_size,
        total: sorted.length,
        has_more: start + items.length < sorted.length,
      },
      request_id: 'mock_admin_notifications',
    }
  }
  return (await http.get<ApiSuccess<Paged<AdminNotification>>>('/admin/notifications', { params: { page, page_size } }))
    .data
}

/**
 * RESERVED · POST /admin/notifications —— 发布广播通知。
 * `created_at` 由服务端写入（与新闻发布 `published_at` 同纪律，前端不传发布时间）。
 */
export async function publishNotification(
  payload: AdminNotificationCreatePayload,
): Promise<ApiSuccess<AdminNotificationCreateResult>> {
  if (isMock()) {
    await mockDelay(320)
    return { code: 0, message: '通知已发布', data: createMockNotification(payload), request_id: 'mock_notification_create' }
  }
  return ensureApiSuccess(
    (
      await http.post<ApiSuccess<AdminNotificationCreateResult>>('/admin/notifications', payload, {
        headers: { 'Idempotency-Key': makeIdempotencyKey() },
      })
    ).data,
    '发布失败，请稍后重试',
  )
}

/** RESERVED · DELETE /admin/notifications/{id} —— 撤回广播（学生端立刻不可见）。 */
export async function revokeNotification(id: number | string): Promise<ApiSuccess<AdminNotificationDeleteResult>> {
  if (isMock()) {
    await mockDelay(280)
    const result = deleteMockNotification(Number(id))
    if (!result) throw new ApiBusinessError(404, `通知不存在（或已撤回）：${id}`)
    return { code: 0, message: '通知已撤回', data: result, request_id: 'mock_notification_delete' }
  }
  return ensureApiSuccess(
    (
      await http.delete<ApiSuccess<AdminNotificationDeleteResult>>(`/admin/notifications/${id}`, {
        headers: { 'Idempotency-Key': makeIdempotencyKey() },
      })
    ).data,
    '撤回失败，请稍后重试',
  )
}
