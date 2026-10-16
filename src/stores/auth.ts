import { create } from 'zustand'
import { getCurrentUser } from '../services/auth'
import type { User } from '../types/api'

/**
 * 会话代次：登录、退出各 +1，用于丢弃「请求发出后会话已经变了」的过期回包。
 * 只认代次、不认令牌字符串 —— Refresh Token 换新令牌会改写 `access_token`，那不算换会话。
 */
let sessionEpoch = 0

interface AuthState {
  user: User | null
  hydrated: boolean
  setSession: (user: User, accessToken: string, refreshToken?: string) => void
  /** 仅更新用户资料（如设置页「重新拉取资料」、头像回写），不动令牌。 */
  setUser: (user: User) => void
  clearSession: () => void
  hydrate: () => void
}

export const useAuthStore = create<AuthState>((set, get) => {
  /**
   * 启动回源校验：`GET /users/me` 是角色、学院、头像的真相，本地缓存不能一直当准。
   * 转学院、被提权或降权之后，只在登录那一刻取一次资料会让界面停留在旧身份；
   * 令牌过期也能在这里被发现，而不是等到某个业务请求恰好 401。
   *
   * 失败处理分两类，都不在这里声张：
   * · 401 —— `services/http.ts` 的响应拦截器会先尝试 `/auth/refresh`（`/users/me` 不在 `/auth/` 前缀内，不会被跳过）；
   *   刷新失败则 `expireSession()` 派发 `campusflow:auth-expired`，由 `main.tsx` 接管 `clearSession()` 并跳登录。
   * · 其它异常（网络中断、5xx、超时）—— 不能当作登录失效，保持本地会话不动，下次启动再试。
   */
  const revalidateSession = async () => {
    const epoch = sessionEpoch
    try {
      const { data } = await getCurrentUser()
      // 期间已退出登录或换了账号：这个回包属于上一个会话，丢弃
      if (epoch !== sessionEpoch) return
      get().setUser(data.data)
    } catch { /* 见上方注释：会话状态由拦截器与 auth-expired 事件决定 */ }
  }

  return {
    user: null,
    hydrated: false,
    setSession: (user, accessToken, refreshToken) => {
      sessionEpoch += 1
      sessionStorage.setItem('access_token', accessToken)
      sessionStorage.setItem('campusflow_user', JSON.stringify(user))
      if (refreshToken) sessionStorage.setItem('refresh_token', refreshToken)
      set({ user, hydrated: true })
    },
    setUser: (user) => {
      sessionStorage.setItem('campusflow_user', JSON.stringify(user))
      set({ user })
    },
    clearSession: () => {
      sessionEpoch += 1
      sessionStorage.removeItem('access_token')
      sessionStorage.removeItem('refresh_token')
      sessionStorage.removeItem('campusflow_user')
      set({ user: null, hydrated: true })
    },
    hydrate: () => {
      const rawUser = sessionStorage.getItem('campusflow_user')
      const token = sessionStorage.getItem('access_token')
      if (rawUser && token) {
        try {
          const user = JSON.parse(rawUser) as User
          set({ user, hydrated: true })
          // 本地缓存先上屏，再回源核对；不 await —— 首屏不该被一次网络往返卡住
          void revalidateSession()
          return
        } catch { /* ignore malformed session */ }
      }
      set({ hydrated: true })
    },
  }
})
