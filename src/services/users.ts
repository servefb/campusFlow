import { ensureApiSuccess, http } from './http'
import { isMock, mockDelay } from '../stores/dataMode'
import { mockAdminUsers, mockRoles, mockUserStats } from '../mocks/data'
import type { AdminRole, AdminUser, ApiSuccess, Paged, RoleMatrix, UserStats } from '../types/api'

/* ============================================================================
 * ✅ 2026-09-23：管理端用户与角色接口后端已落地，本文件不再是契约占位
 * ============================================================================
 *
 * 落地情况（Java 服务 `service` 模块，见各方法上的说明）：
 *   GET    /admin/users                    用户列表（keyword / department / role_key + 分页）
 *   GET    /admin/users/stats              总数、今日活跃、后台席位、待核验身份
 *   POST   /admin/users                    新建 / 邀请管理员
 *   PATCH  /admin/users/{id}               调整角色、状态
 *   POST   /admin/users/batch              批量分配角色 / 批量冻结
 *   GET    /admin/users/export             导出 CSV（返回 MinIO 预签名地址）
 *   GET    /admin/roles                    角色体系与成员数
 *   GET    /admin/roles/matrix             权限矩阵（角色 × 权限）
 *   PATCH  /admin/roles/matrix             更新权限矩阵（**需要超级管理员**，否则 403）
 *
 * ⚠️ 三条与原型不同的地方，页面需要知道：
 *   1. `role_key` 是细粒度**管理端角色**（`roles.role_key`），与登录用的粗粒度
 *      `users.role`（student/teacher/admin）是两回事，不要互相顶替；
 *   2. 权限矩阵的写接口要求超级管理员（`user_roles.role_key='super_admin'`）——
 *      矩阵是「谁能干什么」的定义，让普通管理员改它等于把提权入口开在首页；
 *   3. 权限**只在矩阵里存着、本轮尚未真正参与鉴权**（后端常量 `NOT_ENFORCED_YET`），
 *      页面上如果有「已生效」之类的措辞需要改掉。
 *
 * 🔴 四个写接口的拒绝**全部是 `HTTP 200 + code≠0`**（实测 2026-09-23），原文照抄：
 *   缺字段   → 400 姓名、工号/学号、归属单位均为必填
 *   账号重复 → 409 该工号/学号已存在（可能属于一个已停用的历史账号）
 *   坏角色   → 400 角色不存在：<值>
 *   坏状态   → 400 不支持的状态：<值>（可选 disabled / locked / pending / active）
 *   空勾选   → 400 请选择要操作的账号
 *   空矩阵   → 400 权限矩阵为空：请提交至少一项权限的勾选状态
 *   ⛔ 所以每个写操作都要过 `ensureApiSuccess`，否则 `data: null` 会让页面
 *     把「角色不存在」报成一句没有信息量的「创建失败」。
 *   （`PATCH /admin/users/{id}` 是唯一例外：走 `NotFoundException`，真 404。）
 */

/** 已实现 2026-09-23 · GET /admin/users/stats */
export async function getUserStats(): Promise<ApiSuccess<UserStats>> {
  if (isMock()) {
    await mockDelay()
    return { code: 0, message: 'ok', data: mockUserStats, request_id: 'mock_user_stats' }
  }
  return (await http.get<ApiSuccess<UserStats>>('/admin/users/stats')).data
}

/** 已实现 2026-09-23 · GET /admin/users */
export async function getAdminUsers(params: {
  query?: string
  department?: string
  role_key?: string
  page?: number
  page_size?: number
} = {}): Promise<ApiSuccess<Paged<AdminUser>>> {
  const { query = '', department = 'all', role_key, page = 1, page_size = 8 } = params
  if (isMock()) {
    await mockDelay()
    const kw = query.trim().toLowerCase()
    const filtered = mockAdminUsers.filter((user) => {
      if (department !== 'all' && user.department !== department) return false
      if (role_key && role_key !== 'all' && user.role_key !== role_key) return false
      if (!kw) return true
      return (
        user.name.toLowerCase().includes(kw) ||
        user.account.toLowerCase().includes(kw) ||
        (user.email ?? '').toLowerCase().includes(kw)
      )
    })
    const start = (page - 1) * page_size
    const items = filtered.slice(start, start + page_size)
    return {
      code: 0,
      message: 'ok',
      data: { items, page, page_size, total: filtered.length, has_more: start + items.length < filtered.length },
      request_id: 'mock_admin_users',
    }
  }
  return (
    await http.get<ApiSuccess<Paged<AdminUser>>>('/admin/users', {
      params: { keyword: query || undefined, department: department === 'all' ? undefined : department, role_key, page, page_size },
    })
  ).data
}

/** 已实现 2026-09-23 · GET /admin/roles */
export async function getRoles(): Promise<ApiSuccess<{ items: AdminRole[]; policy_version: string; updated_at: string }>> {
  if (isMock()) {
    await mockDelay()
    return {
      code: 0,
      message: 'ok',
      data: { items: mockRoles, policy_version: 'RBAC-POLICY-V4', updated_at: new Date().toISOString() },
      request_id: 'mock_roles',
    }
  }
  return (await http.get<ApiSuccess<{ items: AdminRole[]; policy_version: string; updated_at: string }>>('/admin/roles')).data
}

/** 已实现 2026-09-23 · GET /admin/roles/matrix */
export async function getRoleMatrix(): Promise<ApiSuccess<RoleMatrix>> {
  if (isMock()) {
    await mockDelay()
    return {
      code: 0,
      message: 'ok',
      data: { updated_at: new Date().toISOString(), policy_version: 'RBAC-POLICY-V4', permissions: [] },
      request_id: 'mock_role_matrix',
    }
  }
  return (await http.get<ApiSuccess<RoleMatrix>>('/admin/roles/matrix')).data
}

/** 已实现 2026-09-23 · POST /admin/users */
export async function createAdminUser(payload: {
  name: string
  account: string
  email: string
  department: string
  role_key: string
}): Promise<ApiSuccess<AdminUser>> {
  if (isMock()) {
    await mockDelay(350)
    return {
      code: 0,
      message: '邀请已发送',
      data: {
        id: Date.now(),
        name: payload.name,
        account: payload.account,
        email: payload.email,
        department: payload.department,
        role_key: payload.role_key,
        role_name: mockRoles.find((role) => role.key === payload.role_key)?.name ?? payload.role_key,
        status: 'pending',
        identity_note: '待激活 · 邀请邮件已发送',
      },
      request_id: 'mock_create_admin_user',
    }
  }
  return ensureApiSuccess((await http.post<ApiSuccess<AdminUser>>('/admin/users', payload)).data, '创建失败')
}

/** 已实现 2026-09-23 · PATCH /admin/users/{id} */
export async function updateAdminUser(
  id: number,
  payload: Partial<Pick<AdminUser, 'role_key' | 'status'>>,
): Promise<ApiSuccess<AdminUser>> {
  if (isMock()) {
    await mockDelay(300)
    const existing = mockAdminUsers.find((user) => user.id === id)
    if (!existing) throw new Error('用户不存在')
    return { code: 0, message: '已更新', data: { ...existing, ...payload }, request_id: 'mock_update_admin_user' }
  }
  return ensureApiSuccess(
    (await http.patch<ApiSuccess<AdminUser>>(`/admin/users/${id}`, payload)).data,
    '更新失败',
  )
}

/** 已实现 2026-09-23 · POST /admin/users/batch */
export async function batchAssignRole(
  userIds: number[],
  payload: { role_key?: string; status?: string },
): Promise<ApiSuccess<{ affected: number }>> {
  if (isMock()) {
    await mockDelay(400)
    return { code: 0, message: '批量操作已完成', data: { affected: userIds.length }, request_id: 'mock_batch_assign' }
  }
  return ensureApiSuccess(
    (
      await http.post<ApiSuccess<{ affected: number }>>('/admin/users/batch', { user_ids: userIds, ...payload })
    ).data,
    '批量操作失败',
  )
}

/** 已实现 2026-09-23 · PATCH /admin/roles/matrix */
export async function updateRoleMatrix(payload: RoleMatrix): Promise<ApiSuccess<{ updated_at: string }>> {
  if (isMock()) {
    await mockDelay(400)
    return { code: 0, message: '权限矩阵已更新', data: { updated_at: new Date().toISOString() }, request_id: 'mock_role_matrix_update' }
  }
  return ensureApiSuccess(
    (await http.patch<ApiSuccess<{ updated_at: string }>>('/admin/roles/matrix', payload)).data,
    '权限矩阵更新失败',
  )
}

/** 已实现 2026-09-23 · GET /admin/users/export */
export async function exportAdminUsers(): Promise<ApiSuccess<{ file_url: string }>> {
  if (isMock()) {
    await mockDelay(400)
    return { code: 0, message: '导出任务已创建', data: { file_url: '' }, request_id: 'mock_user_export' }
  }
  return (await http.get<ApiSuccess<{ file_url: string }>>('/admin/users/export')).data
}
