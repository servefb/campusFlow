import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useSessionStore } from '../stores/session'

/**
 * 业务路由的登录闸门。
 *
 * 之前没有这一层：未登录也能直接输 URL 进 `/observatory`，
 * 顶栏与各页面靠 `user?` 可选链降级成「管理员」兜底文案 ——
 * 也就是说登录页只是个装饰，谁都能绕过。文档第 19 章验收清单第 7 条
 * 「普通用户不能访问知识库治理、新闻源治理、看板和审计接口」要求的是真的闸门。
 *
 * 未登录时带 `redirect` 跳登录页，登录成功后回到原目标（含查询串）。
 */
export function RequireAdmin() {
  const user = useSessionStore((state) => state.user)
  const hydrated = useSessionStore((state) => state.hydrated)
  const location = useLocation()

  // hydrate 在 main.tsx 里是同步跑完的，正常不会走到这里；仅作兜底，避免闪一下登录页
  if (!hydrated) return null

  if (!user) {
    const redirect = `${location.pathname}${location.search}`
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
  }

  return <Outlet />
}
