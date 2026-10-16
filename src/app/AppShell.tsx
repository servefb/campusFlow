import { FormEvent, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { BookOpen, CheckSquare, History, Home, Library, MessageSquareText, Newspaper, PanelLeft, PanelTop, Search, Settings } from 'lucide-react'
import { useAuthStore } from '../stores/auth'
import { NotificationBell } from '../components/NotificationBell'

type NavLinkItem = { to: string; label: string; icon: typeof MessageSquareText; match?: string[] }

const links: NavLinkItem[] = [
  // 问助手：对话页（/conversations/:id）是从问助手发起会话后的落地页，高亮一并算它。
  { to: '/workspace', label: '问助手', icon: MessageSquareText, match: ['/workspace', '/conversations'] },
  { to: '/news', label: '校园新闻', icon: Newspaper },
  { to: '/courses', label: '课程', icon: BookOpen },
  { to: '/tasks', label: '我的任务', icon: CheckSquare },
  { to: '/knowledge', label: '知识库', icon: Library },
  { to: '/history', label: '历史', icon: History },
]

const settingsLink: NavLinkItem = { to: '/settings', label: '设置', icon: Settings }
/* 首页（`/`）已于 2026-09-15 按新版参考图重做并**恢复为独立页面**（见 pages/HomePage.tsx）。
   它与内容页一起摆在主导航里，位置放最后（内容页在前、首页殿后 —— 与移动端底栏一致）。 */
const homeLink: NavLinkItem = { to: '/', label: '首页', icon: Home }

/* 高亮：首页是 index 路由（路径就是 `/`），既不能用 NavLink 自带的前缀判断
   （`/` 会前缀匹配上每一条），也不能与其它项共用「前缀」口径 —— 单独精确判断。
   `extra` 是该项的附加匹配前缀（如问助手的 /conversations）。 */
const isActivePath = (current: string, target: string, extra: string[] = []) =>
  target === '/'
    ? current === '/'
    : current === target ||
      current.startsWith(`${target}/`) ||
      extra.some((prefix) => current === prefix || current.startsWith(`${prefix}/`))

/* 侧栏双形态：'left' = 固定左侧竖栏（默认），'top' = 固定顶部横栏。
   选择持久化到 localStorage，刷新 / 切页不丢；样式开关是根节点上的 `nav-mode-top`。 */
type NavMode = 'left' | 'top'
const NAV_MODE_KEY = 'campusflow:nav-mode'

export function AppShell() {
  const user = useAuthStore((state) => state.user)
  const avatarUrl = user?.avatar_url ?? null
  const navigate = useNavigate()
  // 高亮不再用 NavLink 自带的 `isActive`：它按「路径前缀」判断，`/` 与 `/tasks` 是两条
  // 独立路径，所以停在 `/`（index 路由）时 `/tasks` 那条不会亮。这里统一走归一化比较。
  const { pathname } = useLocation()
  const searchRef = useRef<HTMLInputElement>(null)
  const [globalSearch, setGlobalSearch] = useState('')
  const [navMode, setNavMode] = useState<NavMode>(() =>
    window.localStorage.getItem(NAV_MODE_KEY) === 'top' ? 'top' : 'left',
  )

  useEffect(() => {
    window.localStorage.setItem(NAV_MODE_KEY, navMode)
  }, [navMode])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    const keyword = globalSearch.trim()
    if (keyword) navigate(`/knowledge?query=${encodeURIComponent(keyword)}`)
  }

  /* 导航项内容在两种形态下共用一份：左侧形态装进 <aside.nav-rail>（竖排），
     顶部形态装进 <nav.topbar-nav>（嵌进顶栏、横排，样式见 shell.css）。 */
  const renderNavItems = () => (
    <>
      {links.map(({ to, label, icon: Icon, match }) => (
        <NavLink key={to} to={to} className={() => `nav-item${isActivePath(pathname, to, match) ? ' active' : ''}`}>
          <Icon size={22} strokeWidth={1.8} /><span>{label}</span>
        </NavLink>
      ))}
      <div className="nav-settings-group"><NavLink to={homeLink.to} className={() => `nav-item${isActivePath(pathname, homeLink.to) ? ' active' : ''}`}><Home size={22} strokeWidth={1.8} /><span>{homeLink.label}</span></NavLink><NavLink to={settingsLink.to} className={() => `nav-item nav-settings${isActivePath(pathname, settingsLink.to) ? ' active' : ''}`}><Settings size={22} strokeWidth={1.8} /><span>{settingsLink.label}</span></NavLink></div>
    </>
  )

  return (
    <div className={`app-shell${navMode === 'top' ? ' nav-mode-top' : ''}`}>
      <header className="topbar">
        <Link to="/welcome" className="brand-home-link" aria-label="打开校园脉络介绍页"><div className="brand-mark"><img src="/assets/campus-flow-logo-v4.png" alt="校园脉络 Logo" /></div><div className="brand-copy"><strong>校园脉络</strong><small>校园事务多智能体助手</small></div></Link>
        {navMode === 'top' && <nav className="topbar-nav" aria-label="主导航">{renderNavItems()}</nav>}
        <form className="global-search" role="search" onSubmit={submitSearch}><Search size={16} /><input ref={searchRef} value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="输入事项、办事材料或政策关键词…" aria-label="全局搜索" /><kbd>⌘ K</kbd></form>
        <div className="topbar-spacer" />
        <button
          className="icon-button"
          aria-label={navMode === 'top' ? '切换为左侧导航' : '切换为顶部导航'}
          title={navMode === 'top' ? '切换为左侧导航' : '切换为顶部导航'}
          onClick={() => setNavMode((mode) => (mode === 'top' ? 'left' : 'top'))}
        >
          {navMode === 'top' ? <PanelLeft size={18} /> : <PanelTop size={18} />}
        </button>
        <NotificationBell />
        <div className="user-chip"><span className="avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : user?.name?.slice(0, 1) || '—'}</span><span>{user?.name || '未登录'}</span></div>
      </header>
      <div className="shell-body">
        {navMode === 'left' && (
          <aside className="nav-rail">{renderNavItems()}</aside>
        )}
        <main className="main-canvas"><Outlet /></main>
      </div>
      <nav className="mobile-nav">
        {[...links, homeLink, settingsLink].map(({ to, label, icon: Icon, match }) => <NavLink key={to} to={to} className={() => isActivePath(pathname, to, match) ? 'active' : ''}><Icon size={18} strokeWidth={1.8} /><span>{label}</span></NavLink>)}
      </nav>
    </div>
  )
}
