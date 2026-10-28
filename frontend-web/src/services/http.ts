import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type { ApiErrorBody, ApiSuccess } from '../types/api'

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api/v1'
/** AI 服务与业务 API 使用不同的版本前缀，默认请求 `/api/v2`。 */
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

/** 安全生成 UUIDv4：非安全上下文（HTTP 局域网访问等）下 `crypto.randomUUID` 不可用，回退到 Math.random。 */
const createUuid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

/** 生成 `Idempotency-Key`：创建任务、提交任务、生成导出文件等请求必须携带该头以便幂等重试。 */
export const makeIdempotencyKey = () => createUuid()

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean }

/** 独立于拦截器的实例，用于换取新令牌，避免刷新请求自身再次进入响应拦截器。 */
const refreshClient = axios.create({
  baseURL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
})

interface RefreshData { access_token: string; refresh_token?: string }

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
    // Refresh Token 失效（40101）：清理会话并返回登录页
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

export const apiErrorMessage = (error: unknown, fallback = '请求失败，请稍后重试') => {
  if (axios.isAxiosError<ApiErrorBody & { detail?: string }>(error)) {
    return error.response?.data?.message || error.response?.data?.detail || fallback
  }
  return fallback
}
