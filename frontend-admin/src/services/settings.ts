import { http } from './http'
import { isMock, mockDelay } from '../stores/dataMode'
import { mockSettings } from '../mocks/data'
import type { ApiSuccess, SystemSettings } from '../types/api'

/* ============================================================================
 * ⚠️ 预留接口 —— 后端未提供，本文件全部为契约占位
 * ============================================================================
 *
 * 《校园事务智能助手后端接口文档》没有「系统设置」章节：
 *   · 第 15 章只覆盖 `/health/live`、`/health/ready`、`/admin/audit-logs`；
 *   · 原型里的 RAG Engine 参数（模型、Top-K、相似度阈值、升级阈值）、
 *     安全合规开关（闲置登出、双因子、IP 白名单、不可变日志）、
 *     以及高危操作区（重置知识向量、强制全量索引）都没有对应接口。
 *
 * 路径草案（接后端时全局搜索 `RESERVED` 找全部待确认点）：
 *   GET   /admin/settings                 读取全部系统配置
 *   PATCH /admin/settings/security        更新安全与合规策略
 *   PATCH /admin/settings/rag             更新 RAG 引擎参数
 *   POST  /admin/maintenance/reset-vectors        高危：重置知识向量
 *   POST  /admin/maintenance/full-reindex         高危：强制全量索引
 *
 * 注意：原型这两类高危操作都要求「二次确认 + 输入管理员识别码」，
 * 接后端时这两个动作必须写审计日志（文档第 17 章要求）。
 */

/** RESERVED · GET /admin/settings */
export async function getSystemSettings(): Promise<ApiSuccess<SystemSettings>> {
  if (isMock()) {
    await mockDelay()
    return { code: 0, message: 'ok', data: mockSettings, request_id: 'mock_settings' }
  }
  return (await http.get<ApiSuccess<SystemSettings>>('/admin/settings')).data
}

/** RESERVED · PATCH /admin/settings/security */
export async function updateSecuritySettings(
  payload: Partial<SystemSettings['security']>,
): Promise<ApiSuccess<SystemSettings['security']>> {
  if (isMock()) {
    await mockDelay(400)
    return {
      code: 0,
      message: '安全策略已保存',
      data: { ...mockSettings.security, ...payload, updated_at: new Date().toISOString(), updated_by: '林宪成（系统超管）' },
      request_id: 'mock_security_update',
    }
  }
  return (await http.patch<ApiSuccess<SystemSettings['security']>>('/admin/settings/security', payload)).data
}

/** RESERVED · PATCH /admin/settings/rag */
export async function updateRagSettings(
  payload: Partial<SystemSettings['rag']>,
): Promise<ApiSuccess<SystemSettings['rag']>> {
  if (isMock()) {
    await mockDelay(400)
    return {
      code: 0,
      message: 'RAG 引擎参数已生效',
      data: { ...mockSettings.rag, ...payload, updated_at: new Date().toISOString(), updated_by: '林宪成（系统超管）' },
      request_id: 'mock_rag_update',
    }
  }
  return (await http.patch<ApiSuccess<SystemSettings['rag']>>('/admin/settings/rag', payload)).data
}

/** RESERVED · POST /admin/maintenance/reset-vectors（高危，必须带二次确认凭据） */
export async function resetKnowledgeVectors(
  confirmCode: string,
): Promise<ApiSuccess<{ job_id: number; accepted_at: string }>> {
  if (isMock()) {
    await mockDelay(500)
    return { code: 0, message: '重置任务已进入队列', data: { job_id: 98, accepted_at: new Date().toISOString() }, request_id: 'mock_reset_vectors' }
  }
  return (
    await http.post<ApiSuccess<{ job_id: number; accepted_at: string }>>('/admin/maintenance/reset-vectors', {
      confirm_code: confirmCode,
    })
  ).data
}

/** RESERVED · POST /admin/maintenance/full-reindex（高危，必须带二次确认凭据） */
export async function triggerFullReindex(
  confirmCode: string,
): Promise<ApiSuccess<{ job_id: number; accepted_at: string }>> {
  if (isMock()) {
    await mockDelay(500)
    return { code: 0, message: '全量索引任务已进入队列', data: { job_id: 99, accepted_at: new Date().toISOString() }, request_id: 'mock_full_reindex' }
  }
  return (
    await http.post<ApiSuccess<{ job_id: number; accepted_at: string }>>('/admin/maintenance/full-reindex', {
      confirm_code: confirmCode,
    })
  ).data
}

/** 文档第 15 章已有：`GET /health/live`、`GET /health/ready`。顶栏健康灯用它。 */
export async function getHealth(): Promise<ApiSuccess<{ status: string; components?: Record<string, unknown> }>> {
  if (isMock()) {
    await mockDelay(160)
    return {
      code: 0,
      message: 'ok',
      data: { status: 'healthy', components: { database: 'up', object_storage: 'up', model: 'up', vector_index: 'up' } },
      request_id: 'mock_health',
    }
  }
  return (await http.get<ApiSuccess<{ status: string; components?: Record<string, unknown> }>>('/health/ready')).data
}
