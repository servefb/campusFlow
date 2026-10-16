import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import type { UserRole } from '../types/api'

export function ProtectedRoute({ roles }: { roles?: UserRole[] }) {
  const location = useLocation()
  const { user, hydrated } = useAuthStore()
  if (!hydrated) return <div className="app-loading">正在载入校园脉络…</div>
  if (!user) {
    if (location.pathname === '/') return <Navigate to="/welcome" replace />
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  if (roles && !roles.includes(user.role)) return <Navigate to="/workspace" replace />
  return <Outlet />
}
