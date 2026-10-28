import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AdminShell } from './AdminShell'
import { RequireAdmin } from './RequireAdmin'
import { LoginPage } from '../pages/LoginPage'
import { ObservatoryPage } from '../pages/ObservatoryPage'
import { KnowledgeGovernancePage } from '../pages/KnowledgeGovernancePage'
import { NewsPage } from '../pages/NewsPage'
import { ContentAuditPage } from '../pages/ContentAuditPage'
import { UsersRolesPage } from '../pages/UsersRolesPage'
import { AuditLogsPage } from '../pages/AuditLogsPage'
import { SystemSettingsPage } from '../pages/SystemSettingsPage'
import { NotificationsPage } from '../pages/NotificationsPage'
import { NotFoundPage } from '../pages/NotFoundPage'

/**
 * 页面与原型/接口文档的对应关系：
 *   _2 系统观察   → /observatory         文档第 14 章
 *   _6 知识治理   → /knowledge-governance 文档 11.2
 *   _4 内容审核   → /content-audit        文件审核台（2026-10-15 起改审文件，契约草案
 *                                          /admin/files*，见接口对接说明 2.2；原「答复复核」
 *                                          /admin/reviews 已从管理端撤除，后端闲置保留）
 *   _5 用户角色   → /users-roles          ✅ 2026-09-23 后端已落地（/admin/users*、/admin/roles*）
 *   _3 操作日志   → /audit-logs           文档第 15 章
 *   _1 系统设置   → /system-settings      后端未提供，预留
 *   新闻治理      → /news                 文档第 12 章（stich 原型无此页，按接口文档补齐）
 *   通知推送      → /notifications        契约草案（后端未提供，见接口对接说明 2.7；mock 预演）
 *
 * 业务路由全部套在 `RequireAdmin` 之下：未登录会被挡到 /login。
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAdmin />}>
          <Route element={<AdminShell />}>
            <Route index element={<Navigate to="/observatory" replace />} />
            <Route path="/observatory" element={<ObservatoryPage />} />
            <Route path="/knowledge-governance" element={<KnowledgeGovernancePage />} />
            <Route path="/news" element={<NewsPage />} />
            <Route path="/content-audit" element={<ContentAuditPage />} />
            <Route path="/users-roles" element={<UsersRolesPage />} />
            <Route path="/audit-logs" element={<AuditLogsPage />} />
            <Route path="/system-settings" element={<SystemSettingsPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
