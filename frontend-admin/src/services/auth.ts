import axios from 'axios'
import { http, apiErrorMessage } from './http'
import { isMock, mockDelay } from '../stores/dataMode'
import { mockAdminUsers } from '../mocks/data'
import type { ApiErrorBody, ApiSuccess, AuthUser, LoginResponse } from '../types/api'

/**
 * 认证接口（文档第 6 章）。
 *
 * 管理端**没有独立登录入口** —— 文档 6.2 只有一套 `/auth/login`，
 * 是否放行由前端按 `user.role === 'admin'` 判定（文档第 19 章验收清单第 7 条：
 * 「普通用户不能访问知识库治理、新闻源治理、看板和审计接口」）。
 * 所以 service 层如实返回后端给的角色，**不在这里提前拒绝**，
 * 由 `stores/session.ts` 统一做角色闸门 —— 免得「登录失败」和「权限不足」两种语义混在一起。
 */

export interface LoginPayload {
  account: string
  password: string
  remember: boolean
}

/** 字段级错误可以直接挂到输入框上，不必只丢一条整体提示。 */
export type AuthErrorField = 'account' | 'password'

export class AuthError extends Error {
  code: number
  field?: AuthErrorField

  constructor(message: string, code = 0, field?: AuthErrorField) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.field = field
  }
}

/* ---------- mock 分支 ------------------------------------------------------ */

/**
 * Mock 模式下用于演示「非管理员账号被拒」的账号：`2022010834` 是
 * 《数据库设计.sql》里的真实学生测试账号（林晨 · 计算机科学与技术学院）。
 * 登录接口本身会成功，但角色不是 `admin`，正好用来验证管理端的角色闸门。
 */
const MOCK_STUDENT_ACCOUNT = '2022010834'

const MOCK_ACCESS_TOKEN = 'mock-admin-access-token'
const MOCK_REFRESH_TOKEN = 'mock-admin-refresh-token'
/** 记录 mock 登录使用的账号，供无参的 `getCurrentUser()` 还原资料。 */
const MOCK_ACCOUNT_KEY = 'campusflow_admin_mock_account'

/** Mock 权限集按 `mockAdminUsers.role_key` 派生，与真实后端的 `permissions` 字段同构。 */
const MOCK_PERMISSIONS_BY_ROLE: Record<string, string[]> = {
  super_admin: ['metrics:read', 'review:write', 'knowledge:govern', 'user:manage', 'audit:read', 'settings:write'],
  knowledge_governor: ['metrics:read', 'knowledge:govern', 'audit:read'],
  content_auditor: ['metrics:read', 'review:write', 'audit:read'],
  department_viewer: ['metrics:read'],
}

const invalidCredential = () => new AuthError('账号或密码错误', 40100)

/**
 * Mock 登录：**不校验密码内容**（演示数据不做安全声明，也不把密码写进前端源码），
 * 但账号存在性与账号状态如实校验 —— 停用 / 锁定 / 待激活三种状态在真实后端也存在，
 * 评审时要能看见对应文案。
 */
const mockLogin = async ({ account }: LoginPayload): Promise<LoginResponse> => {
  await mockDelay(420)
  const normalized = account.trim()

  const student: AuthUser = {
    id: 'b66bc72b-1111-4444-8888-96fcb8e7a251',
    account: normalized,
    name: '林晨',
    role: 'student',
    department: '计算机科学与技术学院',
    avatar_url: null,
  }
  if (normalized === MOCK_STUDENT_ACCOUNT) {
    sessionStorage.setItem(MOCK_ACCOUNT_KEY, normalized)
    return { access_token: MOCK_ACCESS_TOKEN, refresh_token: MOCK_REFRESH_TOKEN, expires_in: 7200, user: student }
  }

  const record = mockAdminUsers.find((user) => user.account === normalized)
  if (!record) throw invalidCredential()
  if (record.status === 'locked') throw new AuthError('该账号已被锁定，请联系信息与网络中心', 42301)
  if (record.status === 'disabled') throw new AuthError('该账号已停用，无法登录管理后台', 40300)
  if (record.status === 'pending') throw new AuthError('该账号尚未激活，请先完成身份核验', 40300)

  sessionStorage.setItem(MOCK_ACCOUNT_KEY, normalized)
  return {
    access_token: MOCK_ACCESS_TOKEN,
    refresh_token: MOCK_REFRESH_TOKEN,
    expires_in: 7200,
    user: {
      id: record.id,
      account: normalized,
      name: record.name,
      role: 'admin',
      department: record.department,
      avatar_url: null,
    },
  }
}

const mockCurrentUser = async (): Promise<AuthUser> => {
  await mockDelay(200)
  const account = sessionStorage.getItem(MOCK_ACCOUNT_KEY)
  if (!account) throw new AuthError('会话已失效，请重新登录', 40101)

  if (account === MOCK_STUDENT_ACCOUNT) {
    return {
      id: 'b66bc72b-1111-4444-8888-96fcb8e7a251',
      account,
      name: '林晨',
      role: 'student',
      department: '计算机科学与技术学院',
      avatar_url: null,
    }
  }

  const record = mockAdminUsers.find((user) => user.account === account)
  if (!record) throw invalidCredential()
  return {
    id: record.id,
    account,
    name: record.name,
    role: 'admin',
    department: record.department,
    avatar_url: null,
    permissions: MOCK_PERMISSIONS_BY_ROLE[record.role_key] ?? ['metrics:read'],
  }
}

/* ---------- 真实分支 ------------------------------------------------------- */

/** 把 axios 错误翻译成带语义的 `AuthError`，页面只认这一种。 */
const toAuthError = (error: unknown): AuthError => {
  if (error instanceof AuthError) return error
  if (!axios.isAxiosError<ApiErrorBody>(error)) return new AuthError('登录失败，请稍后重试')

  const status = error.response?.status
  const body = error.response?.data
  const message = body?.message

  if (!error.response) {
    // 后端没起来时最容易误判成「密码错了」，所以单独给一条可排查的文案
    return new AuthError('无法连接后端服务，请确认 /api/v1 已启动', 0)
  }
  if (status === 401) return new AuthError(message || '账号或密码错误', body?.code ?? 40100, 'password')
  if (status === 403) return new AuthError(message || '该账号无管理端访问权限', body?.code ?? 40300, 'account')
  if (status === 423) return new AuthError(message || '账号已被锁定，请联系信息与网络中心', body?.code ?? 42301, 'account')
  if (status === 429) return new AuthError(message || '尝试过于频繁，请稍后再试', body?.code ?? 42901)
  return new AuthError(apiErrorMessage(error, '登录失败，请稍后重试'), body?.code ?? status ?? 0)
}

/** `POST /auth/login`（文档 6.1 / A.1.1）。 */
export async function login(payload: LoginPayload): Promise<LoginResponse> {
  if (isMock()) return mockLogin(payload)
  try {
    const { data } = await http.post<ApiSuccess<LoginResponse>>('/auth/login', {
      account: payload.account.trim(),
      password: payload.password,
      remember: payload.remember,
    })
    return data.data
  } catch (error) {
    throw toAuthError(error)
  }
}

/** `GET /users/me`（文档 A.1.5）—— 权限清单只有这个接口返回。 */
export async function getCurrentUser(): Promise<AuthUser> {
  if (isMock()) return mockCurrentUser()
  try {
    const { data } = await http.get<ApiSuccess<AuthUser>>('/users/me')
    return data.data
  } catch (error) {
    throw toAuthError(error)
  }
}

/**
 * `POST /auth/logout`（文档 A.1.3）—— 退出当前设备，需要 Bearer + refresh_token。
 *
 * 两个令牌都由调用方显式传入，而不是让拦截器去 sessionStorage 里读：
 * 退出登录时本地会话通常已经清掉了，依赖「请求发出的那一刻存储里还有令牌」太脆弱。
 *
 * 不抛错：令牌过期时服务端本来就会拒绝，本地会话照样要清，
 * 让「退出登录」因为一个 401 失败是说不通的。
 */
export async function logout(refreshToken: string | null, accessToken: string | null): Promise<void> {
  if (isMock()) {
    await mockDelay(140)
    sessionStorage.removeItem(MOCK_ACCOUNT_KEY)
    return
  }
  if (!refreshToken) return
  try {
    await http.post<ApiSuccess<null>>(
      '/auth/logout',
      { refresh_token: refreshToken },
      { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} },
    )
  } catch { /* 见上方注释 */ }
}
