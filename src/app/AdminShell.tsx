import { useEffect, useRef, useState, type FormEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  BellRing,
  BookOpenCheck,
  CircleUser,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Menu,
  Newspaper,
  ReceiptText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useSessionStore } from '../stores/session'
import { useDataModeStore } from '../stores/dataMode'
import { useHealth } from '../hooks/useHealth'
import { useFileReviews } from '../hooks/queries'

/**
 * 管理后台外壳。
 *
 *   · 左侧 236px 浅色导航：品牌（产品名 + 学校）→ 分组导航 → 数据源 → 账户区。
 *     侧栏与画布同族，靠**一条 hairline + 一点明度差**分栏，不用深色色板；
 *     当前所在是"淡绿底 + 主色文字"，这也是全站唯一铺色的地方之一。
 *   · 顶栏 60px：只留全局检索（⌘K）、平台服务状态、通知。
 *     产品名、导航、主行动都不在这里 —— 顶栏越轻，页面标题越立得住。
 *   · 主舞台落在暖白画布上，内容用留白 + 细线组织，卡片只给需要独立强调的模块。
 *
 * 导航分组只是信息组织，路由与接口对接状态没变（悬浮提示里的 `api` 仍是评审要看的）。
 */

interface NavEntry {
  to: string
  label: string
  icon: LucideIcon
  /** 该模块对接状态，用于悬浮提示，评审时一眼能看出哪些是预留页 */
  api: string
}

interface NavGroup {
  label: string
  items: NavEntry[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: '运行监控',
    items: [
      { to: '/observatory', label: '工作台', icon: LayoutDashboard, api: '已对接 /admin/metrics/* 与 /admin/reviews' },
      { to: '/content-audit', label: '内容审核', icon: ShieldCheck, api: '文件审核台 · 契约草案 /admin/files（后端未提供，见接口对接说明 2.2）' },
    ],
  },
  {
    label: '知识资产',
    items: [
      { to: '/knowledge-governance', label: '知识治理', icon: BookOpenCheck, api: '已对接 /knowledge/admin/*' },
      { to: '/news', label: '新闻治理', icon: Newspaper, api: '已对接 /news 与 /news/admin/sources（管理员接口）' },
    ],
  },
  {
    label: '平台管理',
    items: [
      { to: '/users-roles', label: '用户角色', icon: CircleUser, api: '已对接 /admin/users* 与 /admin/roles*（管理员接口）' },
      { to: '/audit-logs', label: '操作日志', icon: ReceiptText, api: '已对接 /admin/audit-logs' },
      { to: '/system-settings', label: '系统设置', icon: SlidersHorizontal, api: '接口预留 · 后端未提供 /admin/settings' },
      { to: '/notifications', label: '通知推送', icon: BellRing, api: '契约草案 · 后端未提供 /admin/notifications（见接口对接说明 2.7）' },
    ],
  },
]

export function AdminShell() {
  const user = useSessionStore((state) => state.user)
  const logout = useSessionStore((state) => state.logout)
  const mode = useDataModeStore((state) => state.mode)
  const setMode = useDataModeStore((state) => state.setMode)
  const navigate = useNavigate()
  const location = useLocation()
  const searchRef = useRef<HTMLInputElement>(null)
  const [keyword, setKeyword] = useState('')
  const [railOpen, setRailOpen] = useState(false)
  const health = useHealth()

  /**
   * 待办角标：内容审核页「转人工」的文件数（契约草案 /admin/files，mock 第二实现）。
   * 刻意和内容审核页用同一组参数，两边共享 react-query 缓存，不为角标多打一次重请求。
   * 接口没给出数字时（live 下接口未落地、请求失败）角标整个不渲染 —— 不填 0，也不填常量。
   */
  const pendingFileReviews = useFileReviews({ state: 'manual', page: 1, page_size: 1 })
  const pendingCount = pendingFileReviews.data?.total

  // ⌘K / Ctrl+K 聚焦全局检索（学生端已有同一套肌肉记忆）
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 路由切换后收起移动端抽屉
  useEffect(() => {
    setRailOpen(false)
  }, [location.pathname])

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = keyword.trim()
    if (trimmed) navigate(`/knowledge-governance?query=${encodeURIComponent(trimmed)}`)
  }

  // 健康灯三态：healthy / degraded / offline。
  // 2026-09-22 评审：标明这是「平台服务」整体状态（数据库/对象存储/模型/向量索引四件套），
  // 和单个业务页里的组件级状态（如知识页的「向量索引」）是两回事，避免「顶栏说不可用、
  // 页内说正常」各说各话。
  // 2026-09-23：顶栏改用「一枚小圆点 + 一句人话」，不再做成彩色胶囊 ——
  // 顶栏的颜色越少，页面里的风险标记才越显眼。
  const healthTone = health.status === 'healthy' ? '' : health.status === 'degraded' ? 'is-degraded' : 'is-offline'
  const healthLabel =
    health.status === 'healthy'
      ? 'CampusFlow 运行正常'
      : health.status === 'degraded'
        ? 'CampusFlow 部分降级'
        : 'CampusFlow 暂不可用'

  const badgeFor = (to: string) =>
    to === '/content-audit' && typeof pendingCount === 'number' && pendingCount > 0 ? pendingCount : null

  return (
    <div className="shell">
      <div className={`rail-veil${railOpen ? ' on' : ''}`} onClick={() => setRailOpen(false)} />

      <aside className={`shell-rail${railOpen ? ' open' : ''}`}>
        <div className="rail-brand">
          <img src="/campus-flow-logo-v3.png" alt="" />
          <div className="rail-brand-text">
            <b>CampusFlow</b>
            <small>厚德大学 · 管理控制台</small>
          </div>
          <button className="rail-close" onClick={() => setRailOpen(false)} aria-label="收起导航">
            <X size={16} />
          </button>
        </div>

        <nav className="rail-nav rail-scroll">
          {NAV_GROUPS.map((group) => (
            <div className="rail-group" key={group.label}>
              <span className="rail-group-label">{group.label}</span>
              {group.items.map(({ to, label, icon: Icon, api }) => {
                const badge = badgeFor(to)
                return (
                  <NavLink
                    key={to}
                    to={to}
                    title={`${label} · ${api}`}
                    className={({ isActive }) => `rail-item${isActive ? ' active' : ''}`}
                  >
                    <Icon size={17} strokeWidth={1.75} />
                    <span className="rail-item-label">{label}</span>
                    {badge !== null && <b className="rail-badge">{badge}</b>}
                  </NavLink>
                )
              })}
            </div>
          ))}

          <div className="rail-group">
            <span className="rail-group-label">数据源</span>
            <div className="rail-mode">
              <button className={mode === 'mock' ? 'on' : ''} onClick={() => setMode('mock')} title="展示内置 Mock 数据（与设计稿一致）">
                Mock
              </button>
              <button className={mode === 'live' ? 'on' : ''} onClick={() => setMode('live')} title="请求真实后端接口 /api/v1、/api/v2">
                真实接口
              </button>
            </div>
            <p className="rail-mode-hint">
              {mode === 'mock' ? '当前为演示数据，不请求后端' : '已连真实后端，失败不回落到 Mock'}
            </p>
          </div>
        </nav>

        <div className="rail-foot">
          <a className="rail-foot-link" href="/welcome" title="返回学生端">
            <ExternalLink size={15} strokeWidth={1.9} />
            <span>返回学生端</span>
          </a>

          <div className="rail-account">
            <span className="rail-avatar">
              {user?.avatar_url ? <img src={user.avatar_url} alt="" /> : (user?.name ?? '管').slice(0, 1)}
            </span>
            <div className="rail-account-meta">
              <b>{user?.name ?? '管理员'}</b>
              <small>{user?.role_label ?? '系统超管'}</small>
            </div>
            {/*
              退出只调 logout()，不在这里 navigate：
              会话清空后 `RequireAdmin` 会把用户挡到登录页并带上 redirect，
              两边同时跳会互相覆盖，反而落点不确定。
            */}
            <button className="rail-logout" onClick={logout} title="退出登录" aria-label="退出登录">
              <LogOut size={15} strokeWidth={1.9} />
            </button>
          </div>
        </div>
      </aside>

      <header className="shell-header">
        <button className="header-burger" onClick={() => setRailOpen(true)} aria-label="展开导航">
          <Menu size={18} />
        </button>

        <form className="header-search" role="search" onSubmit={submitSearch}>
          <Search size={15} />
          <input
            ref={searchRef}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="检索用户、知识文档、审核记录…"
            aria-label="全局检索"
          />
          <kbd className="kbd">⌘K</kbd>
        </form>

        <div className="header-spacer" />

        <span className={`topbar-status ${healthTone}`} title={health.detail}>
          <i className="pulse-dot" />
          {healthLabel}
        </span>

        {/*
          通知角标原先写死「3」。后端没有任何通知接口，这个数字是凭空来的 ——
          与项目「指标上只允许出现接口真给了的数字」同一条约定，所以先撤掉角标只留入口。
        */}
        <button className="header-icon-btn" aria-label="通知" title="通知">
          <Bell size={17} />
        </button>
      </header>

      <div className="shell-main">
        <main className="stage">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
