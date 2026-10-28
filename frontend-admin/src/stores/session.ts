import { create } from 'zustand'
import {
  AuthError,
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  type AuthErrorField,
} from '../services/auth'
import type { AuthRole, AuthUser } from '../types/api'

export interface AdminSessionUser {
  id: string | number
  name: string
  account: string
  role: 'admin'
  role_label: string
  department: string
  avatar_url?: string | null
  permissions: string[]
}

/**
 * `GET /users/me` 只返回 `role` 枚举（student/teacher/admin），**没有角色中文名**。
 * 更细的管理员角色（超级管理员 / 知识库治理管理员…）目前只在 `/admin/users` 的用户列表里，
 * 而那个接口后端还没提供。所以顶栏这里先按枚举映射，等后端在 `/users/me` 补上再取。
 */
const ROLE_LABEL: Record<AuthRole, string> = {
  admin: '管理员',
  teacher: '教师',
  student: '学生',
}

const SESSION_KEY = 'campusflow_admin_session'
/** 「记住我」只记账号不记密码 —— 把密码留在浏览器里等于给自己埋雷。 */
const REMEMBERED_ACCOUNT_KEY = 'campusflow_admin_remembered_account'

export type LoginResult =
  | { ok: true; user: AdminSessionUser }
  | { ok: false; message: string; field?: AuthErrorField }

/** 拉取当前账号资料（含权限清单，只有 `GET /users/me` 返回）。 */
const fetchProfile = (fallback: AuthUser) =>
  getCurrentUser().catch(() => fallback)

const toSessionUser = (user: AuthUser): AdminSessionUser => ({
  id: user.id,
  name: user.name,
  account: user.account,
  role: 'admin',
  role_label: ROLE_LABEL[user.role],
  department: user.department || '—',
  avatar_url: user.avatar_url ?? null,
  permissions: user.permissions ?? [],
})

const clearTokens = () => {
  sessionStorage.removeItem('access_token')
  sessionStorage.removeItem('refresh_token')
}

const clearLocalSession = () => {
  clearTokens()
  sessionStorage.removeItem(SESSION_KEY)
}

/** 「记住我」勾选过的账号，登录页用来回填。 */
export const getRememberedAccount = () => {
  try {
    return localStorage.getItem(REMEMBERED_ACCOUNT_KEY) ?? ''
  } catch {
    return ''
  }
}

interface SessionState {
  user: AdminSessionUser | null
  hydrated: boolean
  /** 发起中：登录页据此禁用表单，防止重复提交。 */
  pending: boolean
  login: (account: string, password: string, remember: boolean) => Promise<LoginResult>
  logout: () => void
  hydrate: () => void
}

/**
 * 管理后台会话。
 *
 * 后端**没有管理端专用登录入口**，管理端复用 `POST /auth/login`
 * （与前端同一套令牌），放行条件在前端：`user.role === 'admin'`。
 * 对应文档第 19 章验收清单第 7 条「普通用户不能访问知识库治理、新闻源治理、看板和审计接口」。
 */
export const useSessionStore = create<SessionState>((set, get) => ({
  user: null,
  hydrated: false,
  pending: false,

  login: async (account, password, remember) => {
    set({ pending: true })
    try {
      const session = await loginRequest({ account, password, remember })

      // 令牌先落盘，`GET /users/me` 才带得上 Authorization 头
      sessionStorage.setItem('access_token', session.access_token)
      sessionStorage.setItem('refresh_token', session.refresh_token)

      /*
       * 角色闸门必须放在「拿到令牌之后、写入会话之前」：
       * 非管理员要把刚存下的令牌清掉。否则一个 student 的令牌会留在 sessionStorage 里，
       * 后续每个 http 请求都带着它 —— 界面虽未登录，令牌却已生效，是最难查的一种状态泄漏。
       */
      const profile = await fetchProfile(session.user)
      if (profile.role !== 'admin') {
        clearLocalSession()
        return {
          ok: false,
          field: 'account',
          message: `${profile.name}（${profile.account}）不是管理员账号，无法进入管理后台`,
        }
      }

      const user = toSessionUser(profile)
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(user))
      try {
        if (remember) localStorage.setItem(REMEMBERED_ACCOUNT_KEY, user.account)
        else localStorage.removeItem(REMEMBERED_ACCOUNT_KEY)
      } catch { /* 隐私模式下 localStorage 不可用，记住我失效但不影响登录 */ }

      set({ user, hydrated: true })
      return { ok: true, user }
    } catch (error) {
      clearLocalSession()
      const isAuthError = error instanceof AuthError
      return {
        ok: false,
        field: isAuthError ? error.field : undefined,
        message: isAuthError ? error.message : '登录失败，请稍后重试',
      }
    } finally {
      set({ pending: false })
    }
  },

  logout: () => {
    // 令牌先取出来交给 service（本地马上就要清掉，届时拦截器已经读不到它了）
    const refreshToken = sessionStorage.getItem('refresh_token')
    const accessToken = sessionStorage.getItem('access_token')
    clearLocalSession()
    set({ user: null, hydrated: true })
    void logoutRequest(refreshToken, accessToken).catch(() => { /* service 层已吞错 */ })
  },

  hydrate: () => {
    const raw = sessionStorage.getItem(SESSION_KEY)
    const token = sessionStorage.getItem('access_token')
    if (!raw || !token) {
      set({ hydrated: true })
      return
    }
    try {
      const user = JSON.parse(raw) as AdminSessionUser
      if (user.role !== 'admin') throw new Error('stored session is not an admin')
      set({ user, hydrated: true })
    } catch {
      clearLocalSession()
      set({ hydrated: true })
      return
    }

    /*
     * 本地缓存先上屏，再回源核对；不 await —— 首屏不该被一次网络往返卡住。
     * 回源还兼作「令牌是否还有效」的探测：被降权为普通用户、账号被停用，
     * 都会在下一个请求里暴露，而不是等到用户点开某个页面。
     */
    void (async () => {
      const before = get().user
      if (!before) return
      try {
        const profile = await getCurrentUser()
        const current = get().user
        // 期间已退出或换了账号：这个回包属于上一个会话，丢弃
        if (!current || current.account !== before.account) return
        if (profile.role !== 'admin') {
          get().logout()
          return
        }
        const next = toSessionUser(profile)
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(next))
        set({ user: next })
      } catch { /* 会话结论交给 http 拦截器与 campusflow:auth-expired 事件 */ }
    })()
  },
}))
