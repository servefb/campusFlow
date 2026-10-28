import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type { ApiErrorBody, ApiSuccess } from '../types/api'

/**
 * 双实例对应文档 5.1 的服务划分，别把同一个功能在两个服务里各实现一份：
 *   http   → /api/v1（业务服务）：认证、用户、文件、任务、知识库、校园新闻、管理看板
 *   aiHttp → /api/v2（AI 服务）：工作台、问答、对话（含 SSE）、历史
 * 管理后台用到的接口（看板 / 复核 / 审计 / 知识治理）全部在业务服务。
 */
const baseURL = import.meta.env.VITE_API_BASE_URL || '/api/v1'
const aiBaseURL = import.meta.env.VITE_AI_API_BASE_URL || '/api/v2'

export const http = axios.create({
  baseURL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
})

export const aiHttp = axios.create({
  baseURL: aiBaseURL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
})

const createUuid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16)
  })
}

/** 创建任务、提交任务、生成导出文件以及复核处理都必须带这个头做幂等。 */
export const makeIdempotencyKey = () => createUuid()

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean }

const refreshClient = axios.create({
  baseURL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
})

interface RefreshData {
  access_token: string
  refresh_token?: string
}

const expireSession = () => {
  sessionStorage.removeItem('access_token')
  sessionStorage.removeItem('refresh_token')
  window.dispatchEvent(new Event('campusflow:auth-expired'))
}

const refreshAccessToken = async (): Promise<string | null> => {
  const refreshToken = sessionStorage.getItem('refresh_token')
  if (!refreshToken) return null
  try {
    const { data } = await refreshClient.post<ApiSuccess<RefreshData>>('/auth/refresh', { refresh_token: refreshToken })
    sessionStorage.setItem('access_token', data.data.access_token)
    if (data.data.refresh_token) sessionStorage.setItem('refresh_token', data.data.refresh_token)
    return data.data.access_token
  } catch {
    // 40101 Refresh Token 失效 → 清会话回登录页
    expireSession()
    return null
  }
}

let refreshing: Promise<string | null> | null = null
const refreshOnce = () => {
  if (!refreshing) refreshing = refreshAccessToken().finally(() => { refreshing = null })
  return refreshing
}

const attachInterceptors = (client: typeof http) => {
  client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = sessionStorage.getItem('access_token')
    if (token) config.headers.Authorization = `Bearer ${token}`
    config.headers['X-Request-Id'] = createUuid()
    return config
  })

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError<ApiErrorBody>) => {
      const config = error.config as RetriableConfig | undefined
      const isAuthCall = !!config?.url?.includes('/auth/')
      if (error.response?.status === 401 && config && !config._retried && !isAuthCall) {
        config._retried = true
        const token = await refreshOnce()
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
          return client(config)
        }
      }
      return Promise.reject(error)
    },
  )
}

attachInterceptors(http)
attachInterceptors(aiHttp)

/**
 * 🔴 后端业务失败是 **HTTP 200 + 非 0 `code`**，不是 HTTP 4xx/5xx。
 *
 * <p>`GlobalExceptionHandler#handleBusinessException` 没有 `@ResponseStatus`，方法直接返回
 * `Result.failure(code, msg)` —— 于是 HTTP 状态码就是默认的 200，body 是
 * `{ code: 501, message: '…', data: null }`。axios 拦截器只处理 401 续期，**不会 reject**。
 *
 * <p>因此「没抛异常」≠「成功」。直接读 `res.data.data.xxx` 的代码会：
 *   <br>① `data` 为 `null` → `TypeError` → 被 catch 兜成一句与真实原因无关的「操作失败」；
 *   <br>② 或更糟：把失败当成功渲染出去。
 *
 * <p>⚠️ <b>实测口径（2026-09-23，8081 真库，逐条 curl 对过）</b>：
 * <pre>
 *   POST   /news/admin/sources/{id}/sync   200 / code 501   同步执行器未部署
 *   POST   /news/admin/sources/{id}/sync   200 / code 409   该新闻源已停用
 *   POST   /news/admin/sources/{id}/sync   200 / code 400   没有配置源地址
 *   GET    /admin/reviews/999999           200 / code 404   复核工单不存在
 *   POST   /admin/users（缺字段）           200 / code 400   姓名、工号/学号、归属单位均为必填
 *   POST   /admin/users（账号重复）         200 / code 409   该工号/学号已存在
 *   POST   /admin/users（非法 role_key）    200 / code 400   角色不存在：not_a_role
 *   POST   /admin/users/batch（空 ids）     200 / code 400   请选择要操作的账号
 *   PATCH  /admin/roles/matrix（空体）      200 / code 400   权限矩阵为空…
 *   PATCH  /admin/users/999999             404 / code 404   用户不存在：999999   ← 唯一拿到真状态码的写接口
 * </pre>
 *
 * <p>📌 <b>只有两条能拿到真状态码，其余全部是 200</b>：
 *   <br>① `NotFoundException` 带 `@ResponseStatus(NOT_FOUND)` → 真 404（`PATCH /admin/users/{id}` 走的这条）；
 *   <br>② `@Valid` 校验失败 400 / 未捕获异常 500。
 *   <br>而 `BusinessException`（**本工程绝大多数错误**）没有 `@ResponseStatus` → 200。
 *   <br>⛔ 所以**不能按「有没有 4xx」判断成功**，也不能靠 axios 的 reject 兜底。
 *
 * <p>📌 正确的自查口诀：**看 `code`，不看 `status`**。
 */
export class ApiBusinessError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'ApiBusinessError'
    this.code = code
  }
}

/**
 * 把「HTTP 200 + 非 0 code」的响应转成异常，让既有 `catch` 分支统一接住。
 *
 * <p>刻意做成**逐个调用点显式包裹**，而不是在 axios 拦截器里全局 reject —— 因为确有
 * 需要容忍业务码的地方：`GET /admin/audit-logs` 空结果返回 `404 No records found`
 * 且 `data: null`，那在语义上是「这一页没有记录」，必须继续当空页渲染（见 `services/audit.ts`）。
 * 全局改判会把这种「有意义的空」一起打成错误。
 *
 * <p>类型注释：`ApiSuccess<T>` 把 `code` 窄化成了字面量 `0`，只描述成功包络；
 * 失败包络的 `data` 为 `null`，所以这里按宽松形状收参，再断言回 `ApiSuccess<T>`。
 */
export const ensureApiSuccess = <T,>(
  body: { code: number; message?: string; data?: T } | null | undefined,
  fallback = '请求失败，请稍后重试',
): ApiSuccess<T> => {
  if (!body) throw new ApiBusinessError(-1, fallback)
  if (body.code !== 0) throw new ApiBusinessError(body.code, body.message?.trim() || fallback)
  return body as ApiSuccess<T>
}

/** 统一取错误文案：业务错误码 → 业务 message，其次 details，最后兜底。 */
export const apiErrorMessage = (error: unknown, fallback = '请求失败，请稍后重试') => {
  if (error instanceof ApiBusinessError) return error.message || fallback
  if (axios.isAxiosError<ApiErrorBody & { detail?: string }>(error)) {
    const body = error.response?.data
    if (body?.details?.length) return body.details.map((d) => (d.field ? `${d.field}：${d.reason}` : d.reason)).join('；')
    return body?.message || body?.detail || fallback
  }
  return fallback
}

/** 业务码取用（页面需要按码分叉文案时用，例如新闻同步的 501）。 */
export const apiBusinessCode = (error: unknown): number | null =>
  error instanceof ApiBusinessError ? error.code : null
