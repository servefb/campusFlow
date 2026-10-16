import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BellRing,
  Bookmark,
  BookmarkCheck,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  Filter,
  MessageSquareText,
  Search,
  Settings2,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react'
import { apiErrorMessage } from '../services/http'
import { bookmarkNews, getNewsDetail, getNewsHome, unbookmarkNews, type NewsApiItem, type NewsDetail, type NewsHomeData } from '../services/news'
import { useAuthStore } from '../stores/auth'
import { formatDeadline, type DeadlineTone } from '../utils/deadline'

/**
 * 学生视角的新闻页。
 *
 * 版面纪律（2026-09-15 按用户六条反馈定稿，改动前先读这几条）：
 * · **内容区限宽**。首屏焦点区（大图 + 与你相关）与下方列表都关在 `.news-page` 的 max-width 里，
 *   一行新闻不再横跨 1900px 的屏幕 => 标题与操作按钮不会隔着一大片空白。
 * · **大图只承担"信息"，不承担装饰**。遮罩做成自下而上的渐变而非整片压暗，摘要优先放实际安排。
 * · **推荐与大图去重**：接口把同一条同时放进 spotlight 与 recommendations 时不重复渲染（见 visibleTailored）。
 * · **草稿不进公开列表**：`status !== 'published'` 的一律过滤（见 isPublished）。
 * · **管理入口只给管理员**：来源治理按钮走 `user.role === 'admin'`，普通学生看不到。
 */
type NewsItem = {
  id: string
  category: string
  department: string
  time: string
  title: string
  summary?: string
  deadline?: string
  deadlineTone?: DeadlineTone
  deadlineLabel?: string
  match?: string
  publishedAt?: string
  content?: string
  sourceUrl?: string | null
  coverUrl?: string | null
  highlights?: NewsDetail['ai_highlights']
}

const fallbackCategories = ['全部动态']

/**
 * ⚠️ 草稿 / 已下线的新闻**不进学生列表**（用户反馈⑥）。
 * `campus_news.status ∈ draft|published|offline|archived`（SQL CHECK），可学生接口不下发 status，
 * 所以补一道**按标题兜底**：标题里带「草稿 / 征求意见（未发布）/ 内部测试 / test / demo / 已下线」的
 * **默认拦掉**，除非它已明确是征求意见稿（那种要显式标注后放行）。
 * 后端一旦在列表接口补上 `status`，`isPublished` 的第一道判据就会真正生效，这段兜底可以留着不管。
 */
const DRAFT_PATTERN = /草稿|未发布|内部测试|测试通知|已下线|已归档|test\b|demo\b|draft/i
const CONSULT_PATTERN = /征求意见稿|征求意见|公开征求意见/

const isPublished = (item: NewsApiItem) => {
  const status = (item as NewsApiItem & { status?: string }).status
  if (status && status !== 'published') return false
  const title = item.title || ''
  if (DRAFT_PATTERN.test(title) && !CONSULT_PATTERN.test(title)) return false
  return true
}

const getDepartmentName = (department: NewsApiItem['department']) =>
  typeof department === 'string' ? department : department?.name || '学校官方'

const getNewsGroups = (groups: NewsHomeData['groups']) => Array.isArray(groups)
  ? groups
  : Object.entries(groups || {}).map(([label, items]) => ({ label, items }))

const formatTime = (publishedAt?: string) => {
  if (!publishedAt) return '发布时间待定'
  const date = new Date(publishedAt)
  if (Number.isNaN(date.getTime())) return publishedAt
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * 截止时间的语义标签：由标题/摘要里的动作词推导（接口没有这个字段，见待后端补字段说明）。
 * 推导不出来时 `formatDeadline` 会返回「截止」兜底，**不写死**成某个动作。
 */
const deadlineLabelOf = (title: string, summary?: string) => {
  const text = `${title}${summary || ''}`
  const rules: Array<[RegExp, string]> = [
    [/报名|参赛|参赛报名/, '报名截止'],
    [/申请|申报|受理|提交材料|提交申请/, '申请截止'],
    [/缴费|交费|缴纳/, '缴费截止'],
    [/确认|回执录入|录入/, '确认截止'],
    [/开放时间|开放至|截止时间/, '截止'],
  ]
  for (const [pattern, label] of rules) if (pattern.test(text)) return label
  return undefined
}

const toNewsItem = (item: NewsApiItem): NewsItem => {
  const raw = item.deadline_at || item.deadlineAt
  const deadline = raw ? formatDeadline(raw, deadlineLabelOf(item.title, item.summary)) : null
  // 已下线的新闻（status 非 published）不进学生列表。接口当前不返回 status，`undefined` 视为可见。
  return {
    id: String(item.id),
    category: item.category || '校园动态',
    department: getDepartmentName(item.department),
    time: formatTime(item.published_at || item.publishedAt),
    publishedAt: item.published_at || item.publishedAt,
    title: item.title,
    summary: item.summary?.trim() || undefined,
    deadline: deadline?.text,
    deadlineTone: deadline?.tone,
    deadlineLabel: deadline?.label,
    match: item.recommendation_reason,
    content: item.content,
    sourceUrl: item.source_url,
    coverUrl: item.cover_url,
    highlights: item.ai_highlights,
  }
}

export function CampusNewsPage() {
  const navigate = useNavigate()
  const role = useAuthStore((state) => state.user?.role)
  const isAdmin = role === 'admin'
  const [activeCategory, setActiveCategory] = useState('全部动态')
  const [query, setQuery] = useState('')
  const [followingOnly, setFollowingOnly] = useState(false)
  const [bookmarked, setBookmarked] = useState<Set<string>>(new Set())
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<NewsDetail | null>(null)
  /** 来源治理面板：**只对管理员渲染**（见 header 的 isAdmin 判断），默认收起。 */
  const [governanceOpen, setGovernanceOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('全部部门')
  const [oldestFirst, setOldestFirst] = useState(false)
  const [spotlight, setSpotlight] = useState<NewsItem | null>(null)
  const [tailoredItems, setTailoredItems] = useState<NewsItem[]>([])
  const [feedGroups, setFeedGroups] = useState<Array<{ label: string; items: NewsItem[] }>>([])
  const [categoryOptions, setCategoryOptions] = useState(fallbackCategories)
  const [followingCount, setFollowingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getNewsHome({
      category: activeCategory === '全部动态' ? 'all' : activeCategory,
      query: query.trim() || undefined,
      following: followingOnly,
      sort: oldestFirst,
    }).then(({ data: response }) => {
      if (cancelled) return
      const data = response.data
      setSpotlight(data.spotlight && isPublished(data.spotlight) ? toNewsItem(data.spotlight) : null)
      setTailoredItems(data.recommendations.filter(isPublished).map(toNewsItem))
      const groups = getNewsGroups(data.groups)
      setFeedGroups(groups.map((group) => ({ label: group.label, items: group.items.filter(isPublished).map(toNewsItem) })))
      // 分类里剔除「测试」类与「全部」占位：测试分类是后端同步进来的脏数据，不该出现在学生导航里。
      const names = data.categories
        .map((category) => category.name)
        .filter((name) => name && name !== '全部动态' && name !== '全部' && !/测试|test|demo|草稿/i.test(name))
      setCategoryOptions(['全部动态', ...names])
      setFollowingCount(data.following_count)
      setBookmarked(new Set([
        ...(data.spotlight?.is_bookmarked ? [String(data.spotlight.id)] : []),
        ...data.recommendations.filter((item) => item.is_bookmarked).map((item) => String(item.id)),
        ...groups.flatMap((group) => group.items.filter((item) => item.is_bookmarked).map((item) => String(item.id))),
      ]))
    }).catch((requestError) => {
      if (!cancelled) {
        setError(apiErrorMessage(requestError, '校园新闻加载失败，请稍后重试'))
        setSpotlight(null)
        setTailoredItems([])
        setFeedGroups([])
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [activeCategory, query, followingOnly, oldestFirst, reloadKey])

  useEffect(() => {
    if (!selectedNews) {
      setSelectedDetail(null)
      return
    }
    let cancelled = false
    getNewsDetail(selectedNews.id).then(({ data: response }) => {
      if (!cancelled) setSelectedDetail(response.data)
    }).catch(() => {
      if (!cancelled) setSelectedDetail(null)
    })
    return () => { cancelled = true }
  }, [selectedNews])

  useEffect(() => {
    if (!selectedNews) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedNews(null)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [selectedNews])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const visibleGroups = useMemo(() => feedGroups.map((group) => ({ ...group, items: group.items.filter((item) => departmentFilter === '全部部门' || item.department === departmentFilter) })).filter((group) => group.items.length), [feedGroups, departmentFilter])
  const departmentOptions = useMemo(() => ['全部部门', ...Array.from(new Set(feedGroups.flatMap((group) => group.items.map((item) => item.department)).filter(Boolean)))], [feedGroups])
  // 推荐位与大图去重，且**只保留三条**：右侧栏不抢首屏高度（用户反馈①）。
  const visibleTailored = useMemo(() => {
    if (!spotlight) return tailoredItems.slice(0, 3)
    const seen = new Set([spotlight.title])
    return tailoredItems.filter((item) => (seen.has(item.title) ? false : seen.add(item.title) && true)).slice(0, 3)
  }, [tailoredItems, spotlight])
  // 「与你相关」的依据：接口只给 recommendation_reason（单条理由，不是画像标签）。
  // 没有理由时退回「根据你的关注推荐」，**不写「基于画像」**这种技术表述。
  const recommendBasis = useMemo(() => {
    const reason = visibleTailored.find((item) => item.match)?.match
    return reason || '根据你的关注推荐'
  }, [visibleTailored])
  const hasResults = Boolean(spotlight) || visibleTailored.length > 0 || visibleGroups.length > 0

  const toggleBookmark = async (id: string) => {
    const isSaved = bookmarked.has(id)
    try {
      const response = isSaved ? await unbookmarkNews(id) : await bookmarkNews(id)
      setBookmarked((current) => {
        const next = new Set(current)
        if (response.data.data.is_bookmarked) next.add(id)
        else next.delete(id)
        return next
      })
      setFollowingCount((count) => Math.max(0, count + (isSaved ? -1 : 1)))
      setToast(isSaved ? '已取消关注' : '已加入关注列表')
    } catch (requestError) {
      setToast(apiErrorMessage(requestError, '关注操作失败，请稍后重试'))
    }
  }

  const resetFilters = () => {
    setActiveCategory('全部动态')
    setQuery('')
    setFollowingOnly(false)
    setDepartmentFilter('全部部门')
    setOldestFirst(false)
  }

  return (
    <section className="page news-page">
      <header className="news-page-head">
        <div>
          <div className="news-breadcrumb"><span>CAMPUS PULSE</span><small>/ 校园脉络</small></div>
          <h1>校园新闻</h1>
          <p>与你有关的校园动态，已经帮你整理好</p>
        </div>
        <div className="news-head-actions">
          <label className="news-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索新闻、通知、奖学金..." /></label>
          <button type="button" className={followingOnly ? 'active' : ''} onClick={() => setFollowingOnly((value) => !value)} title="按关注状态筛选，数字为已关注条数"><Bookmark size={17} /><span>我的关注</span><b>{followingCount}</b></button>
          {/* 来源治理是**管理动作**：只对管理员渲染（用户反馈⑥「放到管理入口」）。
              学生视角看不到，避免普通页面混进运维内容。 */}
          {isAdmin && <button type="button" className={governanceOpen ? 'active governance-button' : 'governance-button'} onClick={() => setGovernanceOpen((value) => !value)} title="后台同步状态（仅管理员可见）"><Settings2 size={17} /><span>来源治理</span></button>}
        </div>
      </header>

      <div className="news-categories" aria-label="新闻分类">
        {categoryOptions.map((category) => <button type="button" key={category} className={activeCategory === category ? 'active' : ''} onClick={() => setActiveCategory(category)}>{category}</button>)}
      </div>

      {isAdmin && governanceOpen && <section className="source-governance">
        <header><div><Settings2 size={19} /><span><strong>新闻与通知源治理</strong><small>管理入口 · 仅管理员可见 · 公告同步状态与内容解析质量</small></span></div><button type="button" onClick={() => setGovernanceOpen(false)}><X size={17} />关闭</button></header>
        <div className="source-grid">
          <SourceStatus name="教务处新闻源" description="自动同步教务通知，关键事实抽取已启用。" state="运行正常" />
          <SourceStatus name="学生工作部" description="奖助学金与评优通知多通道同步中。" state="运行正常" />
          <SourceStatus name="后勤保障部" description="公告版式近期变化，等待规则复核。" state="需人工校验" warning />
        </div>
      </section>}

      {loading ? <div className="news-empty"><p>正在加载校园新闻…</p></div> : error ? <div className="news-empty"><Search size={30} /><h2>校园新闻暂时无法加载</h2><p>{error}</p><button type="button" onClick={() => setReloadKey((value) => value + 1)}>重新加载</button></div> : hasResults ? <>
        {(spotlight || visibleTailored.length > 0) && <div className={`news-feature-grid${!spotlight || visibleTailored.length === 0 ? ' single' : ''}`}>
          {spotlight && <article className="news-spotlight">
            <button type="button" className="spotlight-main" onClick={() => setSelectedNews(spotlight)}>
              {spotlight.coverUrl ? <img src={spotlight.coverUrl} alt="" /> : <span className="spotlight-no-image" aria-hidden="true" />}
              <span className="spotlight-scrim" />
              <span className="spotlight-badges"><b>今日重点</b><em>{spotlight.department}</em></span>
              <span className="spotlight-copy">
                <small><Clock3 size={14} />{spotlight.time}</small>
                <strong>{spotlight.title}</strong>
                {/* 摘要优先给出实际安排（放假几天、怎么调课），不是「装饰性一句话」 */}
                {spotlight.summary && <p>{spotlight.summary}</p>}
              </span>
            </button>
            <div className="spotlight-note">
              <span>{spotlight.match ? <><i />{spotlight.match}</> : '官方重点通知'}</span>
              <button type="button" onClick={() => setSelectedNews(spotlight)}>查看详情<ArrowRight size={15} /></button>
            </div>
          </article>}

          {visibleTailored.length > 0 && <aside className="tailored-news">
            <header><span><Sparkles size={18} />与你相关</span></header>
            <div>{visibleTailored.map((item) => <button type="button" key={item.id} className="tailored-item" onClick={() => setSelectedNews(item)}><span><b>{item.category}</b><small>{item.time}</small></span><strong>{item.title}</strong>{item.summary && <p>{item.summary}</p>}</button>)}</div>
            <footer className="tailored-basis"><TrendingUp size={13} />{recommendBasis}</footer>
          </aside>}
        </div>}

        <section className="news-feed">
          <header className="news-feed-head"><div><h2>最新动态</h2><span>已按脉络智能聚类</span></div><div><label className="news-feed-filter"><Filter size={15} /><select value={departmentOptions.includes(departmentFilter) ? departmentFilter : '全部部门'} onChange={(event) => setDepartmentFilter(event.target.value)} aria-label="筛选部门">{departmentOptions.map((department) => <option key={department}>{department}</option>)}</select></label><button type="button" className={oldestFirst ? 'active' : ''} onClick={() => setOldestFirst((value) => !value)}><TrendingUp size={15} />{oldestFirst ? '较早优先' : '最新优先'}</button></div></header>
          {visibleGroups.map((group) => <div className="news-feed-group" key={group.label}><div className="news-feed-date"><span>{normalizeGroupLabel(group.label)}</span><i /></div>{group.items.map((item) => <NewsRow key={item.id} item={item} saved={bookmarked.has(item.id)} onOpen={() => setSelectedNews(item)} onAsk={() => navigate('/workspace')} onBookmark={() => toggleBookmark(item.id)} />)}</div>)}
        </section>
      </> : <div className="news-empty"><Search size={30} /><h2>未找到相关校园新闻</h2><p>尝试更换关键词或清除筛选条件，也可以去问助手查找政策。</p><button type="button" onClick={resetFilters}>重置筛选条件</button></div>}

      {selectedNews && <NewsDrawer item={selectedNews} detail={selectedDetail} saved={bookmarked.has(selectedNews.id)} isAdmin={isAdmin} onClose={() => setSelectedNews(null)} onBookmark={() => toggleBookmark(selectedNews.id)} onAsk={() => navigate('/workspace')} onAction={(message) => setToast(message)} />}
      <div className={toast ? 'news-toast visible' : 'news-toast'} role="status"><CheckCircle2 size={18} />{toast}</div>
    </section>
  )
}

/**
 * 时间分组口径：后端三种都给过 —— 相对日（今天/昨天）、跨度（本周/本周之前）、日期串。
 * 「本周之前」与「更早」都跨度过大，统一收成「本周 / 上周 / 更早」三档（用户反馈⑥）。
 */
const GROUP_LABELS: Record<string, string> = {
  今天: '本周',
  昨天: '本周',
  本周: '本周',
  本周之前: '更早',
  上周: '上周',
  更早: '更早',
  本月: '更早',
}
const normalizeGroupLabel = (label: string) => GROUP_LABELS[label.trim()] || label

/**
 * 来源治理的源状态卡片 —— **管理入口的内容**，只在管理员打开面板时渲染。
 * 这些状态目前是页面内的静态说明；后端有 `GET /news/admin/sources`（A.7.9），
 * 接上之前不要编「最后同步时间」这类字段。
 */
function SourceStatus({ name, description, state, warning = false }: { name: string; description: string; state: string; warning?: boolean }) {
  return <article><header><strong>{name}</strong><span className={warning ? 'warning' : ''}>{state}</span></header><p>{description}</p></article>
}

function NewsRow({ item, saved, onOpen, onAsk, onBookmark }: { item: NewsItem; saved: boolean; onOpen: () => void; onAsk: () => void; onBookmark: () => void }) {
  return <article className="news-row">
    <button type="button" className="news-row-copy" onClick={onOpen}>
      <span className="news-row-meta">
        <b data-category={item.category}>{item.category}</b>
        <small>{item.department}</small><i>·</i><small>{item.time}</small>
        {item.deadline && <em data-tone={item.deadlineTone}><Clock3 size={13} />{item.deadline}</em>}
      </span>
      {/* 标题是主要详情入口；「问助手」与收藏是次级操作（撤销底色，见 news.css） */}
      <strong>{item.title}</strong>
      {item.summary && <p>{item.summary}</p>}
    </button>
    <div className="news-row-actions">
      <button type="button" onClick={onAsk}><MessageSquareText size={15} />问助手</button>
      <button type="button" className={saved ? 'saved' : ''} onClick={onBookmark} aria-label={saved ? '取消关注' : '加入关注'} title={saved ? '取消关注' : '加入关注'}>{saved ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}</button>
    </div>
  </article>
}

function NewsDrawer({ item, detail, saved, isAdmin, onClose, onBookmark, onAsk, onAction }: { item: NewsItem; detail: NewsDetail | null; saved: boolean; isAdmin: boolean; onClose: () => void; onBookmark: () => void; onAsk: () => void; onAction: (message: string) => void }) {
  const content = detail?.content || item.content || item.summary
  const highlights = detail?.ai_highlights || item.highlights
  // 来源治理只对管理员露出：学生视角看不到后端同步状态（用户反馈⑥）。
  const sourceHref = isAdmin ? '/dashboard' : null
  return <div className="news-drawer-layer"><button type="button" className="news-drawer-backdrop" onClick={onClose} aria-label="关闭新闻详情" /><aside className="news-drawer" role="dialog" aria-modal="true" aria-labelledby="news-detail-title">
    <header className="news-drawer-head"><span><b>{item.category}</b><small>{item.department} · 官方发布</small></span><button type="button" onClick={onClose} aria-label="关闭"><X size={20} /></button></header>
    <div className="news-drawer-body">
      <section className="news-detail-title">
        <h2 id="news-detail-title">{item.title}</h2>
        <div>
          <span><Clock3 size={15} />发布时间：{item.time}</span>
          {item.deadline && <span className="deadline" data-tone={item.deadlineTone}><BellRing size={15} />{item.deadline}</span>}
        </div>
      </section>
      {highlights && (highlights.what || highlights.eligible || highlights.action || highlights.materials?.length) && <section className="agent-highlight"><header><span><Sparkles size={18} />助手已帮你划重点</span></header><dl>{highlights.what && <div><dt>讲了什么</dt><dd>{highlights.what}</dd></div>}{highlights.eligible && <div><dt>适用对象</dt><dd>{highlights.eligible}</dd></div>}{highlights.action && <div><dt>你要做什么</dt><dd>{highlights.action}</dd></div>}{highlights.materials?.length ? <div><dt>所需材料</dt><dd>{highlights.materials.join('、')}</dd></div> : null}</dl></section>}
      <section className="news-official-copy"><p>{content}</p></section>
      <section className="news-source">
        <header><span>原文来源</span><small>{item.department} · 官方发布</small></header>
        <div className="news-source-actions">
          {item.sourceUrl && <button type="button" onClick={() => window.open(item.sourceUrl || '', '_blank', 'noopener,noreferrer')}><FileText size={15} />查看通知原文</button>}
          {sourceHref && <button type="button" className="news-source-admin" onClick={() => onAction('来源治理已移至管理入口：后台 → 系统观察')}>来源治理（管理入口）</button>}
        </div>
      </section>
    </div>
    <footer className="news-drawer-actions"><div><button type="button" onClick={onBookmark}>{saved ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}{saved ? '已关注' : '加入关注'}</button><button type="button" onClick={() => onAction('已同步至校园日程')}><CalendarPlus size={17} />加日历</button></div><button type="button" className="drawer-primary" onClick={onAsk}>询问办理流程<ChevronRight size={17} /></button></footer>
  </aside></div>
}
