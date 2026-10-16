import { http } from './http'
import type { ApiSuccess, LoginResponse, User } from '../types/api'

export const login = (payload: { account: string; password: string; remember: boolean }) =>
  http.post<ApiSuccess<LoginResponse>>('/auth/login', payload)

export const getCurrentUser = () => http.get<ApiSuccess<User>>('/users/me')

export const refreshToken = (refresh_token: string) =>
  http.post<ApiSuccess<Pick<LoginResponse, 'access_token' | 'refresh_token' | 'expires_in'>>>('/auth/refresh', { refresh_token })

export const logout = (refresh_token: string) =>
  http.post<ApiSuccess<null>>('/auth/logout', { refresh_token })

export const logoutAll = () =>
  http.post<ApiSuccess<{ revoked_session_count: number }>>('/auth/logout-all', {})

export interface UserPreferences {
  default_agent_mode: string
  /** 取值受数据库 CHECK 约束：brief | balanced | detailed（见 数据库设计.sql:96） */
  answer_length: 'brief' | 'balanced' | 'detailed'
  show_citations: boolean
  task_notifications: boolean
  knowledge_notifications: boolean
  /** NULL = 永久保留；否则 1..3650 天（见 数据库设计.sql:100） */
  history_retention_days: number | null
}

/**
 * 回写当前用户头像（接口文档 A.1.12 / 6.5）。
 * `avatar_file_id` 来自 `services/files.ts` 的 `uploadFile(file, 'avatar')`；传 null 表示清除头像。
 * ⚠️ 后端尚未实现该端点：失败时设置页只报错，不做任何本地兜底（头像只认服务端）。
 */
export const updateMyAvatar = (payload: { avatar_file_id: number | string | null }) =>
  http.patch<ApiSuccess<User>>('/users/me', payload)

export const getUserPreferences = () => http.get<ApiSuccess<UserPreferences>>('/users/me/preferences')
export const updateUserPreferences = (payload: Partial<UserPreferences>) => http.patch<ApiSuccess<UserPreferences>>('/users/me/preferences', payload)
