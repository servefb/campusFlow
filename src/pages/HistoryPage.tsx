import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, BadgeCheck, Bookmark, BookOpenCheck, Bot, Clock, Download, FileText, Link2, Loader2, MessagesSquare, MoreHorizontal, Search, SearchX, Share2, ShieldCheck, Trash2, User, Workflow } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { StatusBadge } from '../components/ui'
import { MarkdownText } from '../components/MarkdownText'
import { ReasoningBlock } from '../components/ReasoningBlock'
import { apiErrorMessage } from '../services/http'
import { bookmarkHistoryConversation, deleteHistoryConversation, exportHistoryConversation, exportHistoryConversationsBatch, getHistoryConversation, getHistoryConversations, unbookmarkHistoryConversation } from '../services/history'
import type { ConversationSummary, HistoryConversationDetail } from '../types/api'

type Range = 'all' | 'week' | 'month'
type GroupKey = 'today' | 'yesterday' | 'earlier'

const RANGE_TABS: Array<{ key: Range; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'week', label: '近7天' },
  { key: 'month', label: '近30天' },
]

const GROUP_LABELS: Record<GroupKey, string> = { today: '今天', yesterday: '昨天', earlier: '更早记录' }

interface CardPreview { reply?: string; citations: number }

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const shortAgent = (name: string) => name.replace(/\s*Agent$/, '')

const statusMeta = (status: string): { tone: 'success' | 'warning' | 'neutral'; label: string } => {
  if (status === 'in_progress') return { tone: 'warning', label: '任务推进中' }
  if (status === 'completed' || status === 'done') return { tone: 'success', label: '已办结' }
  if (status === 'pending') return { tone: 'neutral', label: '待处理' }
  return { tone: 'neutral', label: status || '状态未知' }
}

/** 调度智能体 chips 的彩色圆点，按名称哈希取色保证顺序稳定。 */
const AGENT_DOTS = ['#e0564c', '#10b981', '#3b82f6', '#f59e0b', '#64748b', '#8b5cf6']
const dotOf = (name: string) => AGENT_DOTS[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % AGENT_DOTS.length]

const formatDateTime = (value?: string) => (value ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

/** 预览摘要只压平空白；截断交给 CSS 两行省略按容器宽度自然收，避免按字符数切早了。 */
const summarize = (content: string) => content.replace(/\s+/g, ' ').trim()

export function HistoryPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [range, setRange] = useState<Range>('all')
  const [agent, setAgent] = useState('')
  const [items, setItems] = useState<ConversationSummary[]>([])
  const [total, setTotal] = useState(0)
  const [previews, setPreviews] = useState<Record<string, CardPreview>>({})
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<HistoryConversationDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [followUp, setFollowUp] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // 「更多」菜单：删除是危险操作，收进次级菜单而不是红色按钮常驻页头。
  const [moreOpen, setMoreOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  // 卡片摘要与引用数需要读详情接口，按会话缓存避免筛选切换时重复请求。
  const previewCache = useRef(new Map<string, CardPreview>())

  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice((current) => (current === message ? '' : current)), 3200) }

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    getHistoryConversations({ keyword: query.trim() || undefined, range, page: 1, page_size: 50 })
      .then(({ data }) => {
        const list = data.data.items ?? []
        setItems(list)
        setTotal(data.data.total ?? list.length)
        setLoading(false)
        // 默认展示第一条：仅当没有有效选中项（首次进 page，或原选中项已不在当前筛选结果）时回落到 list[0]。
        // 注意不批量拉详情 —— 一页最多发 1 个 detail（选中的那条），用户点其它卡片才再发。
        setSelectedId((current) => (list.some((item) => String(item.id) === current) ? current : String(list[0]?.id ?? '')))
        // 卡片预览直接读 list 自带字段（2026-09-12 后端补字段后，去除 N+1 详情 GET）。
        // 缺字段时退化：reply 不显示，徽标因为 `preview?.citations ?` 短路不渲染。
        const next: Record<string, CardPreview> = {}
        for (const item of list) {
          next[String(item.id)] = {
            reply: item.last_reply_preview ?? undefined,
            citations: item.last_reply_citation_count ?? 0,
          }
        }
        setPreviews(next)
      })
      .catch((requestError) => { setItems([]); setTotal(0); setSelectedId(''); setError(apiErrorMessage(requestError, '历史记录加载失败，请稍后重试')); setLoading(false) })
  }, [query, range])

  useEffect(() => {
    const timer = window.setTimeout(load, 250)
    return () => window.clearTimeout(timer)
  }, [load])

  // 列表变化后选中第一条；切筛选时保留仍在结果中的当前会话。
  const selected = useMemo(() => items.find((item) => String(item.id) === selectedId) ?? null, [items, selectedId])

  useEffect(() => {
    if (!selectedId) { setDetail(null); return }
    let cancelled = false
    setDetailLoading(true)
    getHistoryConversation(selectedId)
      .then(({ data }) => { if (!cancelled) setDetail((data.data ?? null) as unknown as HistoryConversationDetail | null) })
      .catch(() => { if (!cancelled) setDetail(null) })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [selectedId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 「更多」菜单：点击菜单外或按 Esc 关闭；选中会话变化（含删除后刷新）时一并收起。
  useEffect(() => {
    if (!moreOpen) return
    const onPointerDown = (event: MouseEvent) => { if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false) }
    const onEsc = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreOpen(false) }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onEsc)
    return () => { window.removeEventListener('mousedown', onPointerDown); window.removeEventListener('keydown', onEsc) }
  }, [moreOpen])

  useEffect(() => { setMoreOpen(false) }, [selectedId])

  // 调度智能体 chips：名称与计数全部来自当前列表数据。
  const agentChips = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) { const key = item.agent_name || '未命名 Agent'; counts.set(key, (counts.get(key) ?? 0) + 1) }
    return [...counts.entries()].map(([name, count]) => ({ name, count }))
  }, [items])

  const filtered = useMemo(() => (agent ? items.filter((item) => (item.agent_name || '未命名 Agent') === agent) : items), [items, agent])

  // 副标题那一行统计的取值：全部取自当前筛选结果，保证「看到的数字」与「看到的列表」一致。
  // 消息数只在每条记录都返回 message_count 时才展示（漏字段时求和必偏小，反而让人疑惑
  // 「为什么消息比会话还少」）；有值时用「累计」写明这是跨会话求和的范围。
  const messagesKnown = filtered.length > 0 && filtered.every((item) => typeof item.message_count === 'number')
  const overview = useMemo(() => ({
    messages: filtered.reduce((sum, item) => sum + (item.message_count ?? 0), 0),
    citations: filtered.reduce((sum, item) => sum + (previews[String(item.id)]?.citations ?? 0), 0),
    tasks: filtered.reduce((sum, item) => sum + (item.related_task_count ?? 0), 0),
    bookmarks: filtered.filter((item) => item.is_bookmarked).length,
  }), [filtered, previews])

  const groups = useMemo(() => {
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0)
    const startYesterday = new Date(startToday); startYesterday.setDate(startYesterday.getDate() - 1)
    const records = filtered.map((item) => {
      const date = new Date(item.updated_at)
      const time = date.getTime()
      const key: GroupKey = time >= startToday.getTime() ? 'today' : time >= startYesterday.getTime() ? 'yesterday' : 'earlier'
      const clock = date.toTimeString().slice(0, 5)
      const day = `${date.getMonth() + 1}月${date.getDate()}日`
      return { item, key, label: key === 'today' ? clock : key === 'yesterday' ? `昨天 ${clock}` : day }
    })
    return (['today', 'yesterday', 'earlier'] as GroupKey[])
      .map((key) => ({
        key,
        records: records.filter((record) => record.key === key),
        dateLabel: key === 'today' ? `${startToday.getMonth() + 1}月${startToday.getDate()}日 ${WEEKDAYS[startToday.getDay()]}` : key === 'yesterday' ? `${startYesterday.getMonth() + 1}月${startYesterday.getDate()}日 ${WEEKDAYS[startYesterday.getDay()]}` : '',
      }))
      .filter((group) => group.records.length)
  }, [filtered])

  const toggleBookmark = async (item: ConversationSummary) => {
    const next = !item.is_bookmarked
    setItems((prev) => prev.map((record) => String(record.id) === String(item.id) ? { ...record, is_bookmarked: next } : record))
    try {
      if (next) await bookmarkHistoryConversation(item.id)
      else await unbookmarkHistoryConversation(item.id)
    } catch (requestError) {
      setItems((prev) => prev.map((record) => String(record.id) === String(item.id) ? { ...record, is_bookmarked: !next } : record))
      setError(apiErrorMessage(requestError, '收藏状态更新失败，请稍后重试'))
    }
  }

  const removeCurrent = async () => {
    if (!selected) return
    if (!window.confirm(`确定删除“${selected.title}”吗？删除后不可恢复。`)) return
    await deleteHistoryConversation(selected.id)
    previewCache.current.delete(String(selected.id))
    flash('会话记录已删除')
    load()
  }

  const exportAll = async () => {
    if (!filtered.length) return
    try {
      await exportHistoryConversationsBatch(filtered.map((item) => item.id))
      flash(`已创建 ${filtered.length} 条会话的批量导出任务`)
    } catch (requestError) { setError(apiErrorMessage(requestError, '批量导出创建失败，请稍后重试')) }
  }

  const exportOne = async () => {
    if (!selected) return
    try {
      await exportHistoryConversation(selected.id)
      flash('纪要导出任务已创建')
    } catch (requestError) { setError(apiErrorMessage(requestError, '导出创建失败，请稍后重试')) }
  }

  const share = async () => {
    if (!selected) return
    await navigator.clipboard?.writeText(`${window.location.origin}/conversations/${selected.id}`).catch(() => {})
    flash('会话链接已复制')
  }

  const detailMessages = (detail?.messages ?? []).filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content?.trim())
  const firstUserMessage = detailMessages.find((message) => message.role === 'user')
  const citationTotal = detail?.citations?.length ?? (selected ? previews[String(selected.id)]?.citations ?? 0 : 0)
  // 回放只渲染该轮最终回答（同对话页口径）：后端中间态 assistant 消息（「我来帮您查询…」）落库了但不是答案。
  const visibleDetailMessages = useMemo(
    () => detailMessages.filter((message, index) => message.role === 'user' || detailMessages[index + 1]?.role !== 'assistant'),
    [detailMessages],
  )
  // 思考条只挂该轮最后一条回答：后端把整轮同一份思考写到了本轮每一条 assistant 上（实测同 MD5×3），
  // 不收敛的话回放里会出现多条重复的「已深度思考 · N 字」。
  const reasoningOwnerIds = useMemo(() => {
    const owners = new Set<string | number>()
    detailMessages.forEach((message, index) => {
      if (message.role !== 'assistant' || !message.reasoning_content) return
      if (detailMessages[index + 1]?.role === 'assistant') return
      owners.add(message.id)
    })
    return owners
  }, [detailMessages])

  return <section className="page wide-page history-page">
    <header className="history-page-header"><div>
      <p className="eyebrow">CONVERSATION ARCHIVE</p>
      <div className="history-title-line"><h1>历史会话回溯</h1><span><i />云端同步已完成</span></div>
      <p className="history-summary">全流程记录与多维度追溯 · {total} 场会话{messagesKnown ? ` · 累计 ${overview.messages} 条消息` : ''} · {overview.citations} 份引用 · {overview.bookmarks} 条收藏</p>
    </div>
    <div className="history-header-actions">
      <label className="history-search">
        <Search size={15} />
        <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索会话标题、提问关键词、涉及规章或 Agent……" aria-label="搜索历史会话" />
        <kbd>⌘K</kbd>
      </label>
      <button type="button" className="soft-button" disabled={!filtered.length} onClick={() => void exportAll()}><Download size={15} />导出全部</button>
      <div className="history-more" ref={moreRef}>
        <button type="button" className="soft-button" aria-haspopup="menu" aria-expanded={moreOpen} disabled={!selected} onClick={() => setMoreOpen((open) => !open)}>
          <MoreHorizontal size={15} />更多
        </button>
        {moreOpen && <div className="history-more-menu" role="menu">
          <button type="button" role="menuitem" className="danger" onClick={() => { setMoreOpen(false); void removeCurrent() }}>
            <Trash2 size={14} />删除当前记录
          </button>
          <p>删除前会再次确认，删除后不可恢复。</p>
        </div>}
      </div>
    </div></header>

    <div className="history-filter-row">
      <div className="history-range-tabs">{RANGE_TABS.map((tab) => <button type="button" key={tab.key} className={range === tab.key ? 'active' : ''} onClick={() => setRange(tab.key)}>{tab.label}</button>)}</div>
      {agentChips.length > 0 && <div className="history-agent-chips"><span className="history-agent-label">调度智能体：</span>
        <button type="button" className={agent === '' ? 'active' : ''} onClick={() => setAgent('')}>全部 <em>({items.length})</em></button>
        {agentChips.map((chip) => <button type="button" key={chip.name} className={agent === chip.name ? 'active' : ''} onClick={() => setAgent(agent === chip.name ? '' : chip.name)}><i style={{ background: dotOf(chip.name) }} />{shortAgent(chip.name)} <em>({chip.count})</em></button>)}
      </div>}
    </div>

    {notice && <p className="history-flash"><BadgeCheck size={13} />{notice}</p>}
    {error && !loading && <p className="history-flash error"><SearchX size={13} />{error}</p>}

    {loading ? <div className="history-empty"><Loader2 size={26} className="history-loading-spin" /><p>正在读取历史记录...</p></div>
      : !filtered.length ? <div className="history-empty"><SearchX size={34} /><h2>{items.length ? '没有匹配的会话' : '没有历史问答记录'}</h2><p>{items.length ? '换个关键词或切换筛选条件试试。' : '去工作台发起第一场咨询，记录会自动同步到这里。'}</p><Link className="primary-button" to="/workspace">进入工作台</Link></div>
      : <div className="history-layout">
        <div className="history-timeline">{groups.map((group) => <section className="history-group" key={group.key}>
          <header><i /><strong>{GROUP_LABELS[group.key]}</strong><span>{group.records.length} 场对话</span>{group.dateLabel && <time>{group.dateLabel}</time>}</header>
          <div className="history-group-list">{group.records.map(({ item, label }) => {
            const preview = previews[String(item.id)]
            return <article key={item.id} className={`history-card${String(item.id) === selectedId ? ' selected' : ''}`} onClick={() => setSelectedId(String(item.id))}>
              <div className="history-meta">
                <StatusBadge tone="neutral">{item.agent_name || 'Agent 未返回'}</StatusBadge>
                <span title={new Date(item.updated_at).toLocaleString('zh-CN')}>{label}</span>
                <button type="button" className={item.is_bookmarked ? 'saved' : ''} aria-label={item.is_bookmarked ? '取消收藏' : '收藏会话'} aria-pressed={Boolean(item.is_bookmarked)} onClick={(event) => { event.stopPropagation(); void toggleBookmark(item) }}>
                  <Bookmark size={14} fill={item.is_bookmarked ? 'currentColor' : 'none'} />
                </button>
              </div>
              <h2>{item.title}</h2>
              <p>{preview?.reply ? summarize(preview.reply) : `消息 ${item.message_count ?? '—'} 条 · 关联任务 ${item.related_task_count ?? 0} 个`}</p>
              {(preview?.citations || item.related_task_count) ? <div className="history-tags">
                {preview?.citations ? <span className="cite"><BadgeCheck size={12} />引用 {preview.citations} 份细则</span> : null}
                {item.related_task_count ? <span><Workflow size={12} />关联任务 {item.related_task_count} 个</span> : null}
              </div> : null}
            </article>
          })}</div>
        </section>)}</div>

        <aside className="history-detail-rich">{selected ? <>
          <div className="history-detail-head">
            <div>
              <h2 className="history-detail-title">{selected.title}</h2>
              <p><StatusBadge tone="neutral">{selected.agent_name || 'Agent 未返回'}</StatusBadge><span>最近更新 {formatDateTime(selected.updated_at)}</span></p>
            </div>
            <div className="history-detail-actions">
              <button type="button" className="soft-button" aria-label="复制会话链接" title="复制会话链接" onClick={() => void share()}><Share2 size={14} /></button>
              <button type="button" className="soft-button" disabled={detailLoading} aria-label="导出纪要" title="导出纪要" onClick={() => void exportOne()}><Download size={14} /><span>导出纪要</span></button>
              <Link className="primary-button" to={`/conversations/${selected.id}`} aria-label="打开会话" title="打开会话"><span>打开会话</span><ArrowRight size={14} /></Link>
            </div>
          </div>

          <div className="history-detail-meta">
            <span className="history-meta-id" title={`会话编号 #${selected.id}`}><FileText size={11} />会话编号 #{selected.id}</span>
            <span><Clock size={11} />发起时间 {formatDateTime(firstUserMessage?.created_at || selected.updated_at)}</span>
            <span><MessagesSquare size={11} />消息 {detail?.messages?.length ?? selected.message_count ?? 0} 条</span>
            {citationTotal > 0 && <span><BookOpenCheck size={11} />引用 {citationTotal} 份</span>}
            {(detail?.related_tasks?.length ?? selected.related_task_count ?? 0) > 0 && <span><Link2 size={11} />关联任务 {detail?.related_tasks?.length ?? selected.related_task_count ?? 0} 个</span>}
          </div>

          {detailLoading && !detail ? <div className="history-detail-body"><p className="history-modal-empty"><Loader2 size={15} className="history-loading-spin" /> 正在读取会话详情…</p></div>
            : !detail ? <div className="history-detail-body"><p className="history-modal-empty">会话详情加载失败，请稍后重试</p></div> : <>
              <div className="history-detail-body">
                {visibleDetailMessages.length > 0 && <div className="history-detail-section"><h3><MessagesSquare size={13} />会话回放</h3>
                  {visibleDetailMessages.map((message) => message.role === 'user'
                    ? <div className="history-chat-row user" key={message.id}><span className="history-avatar"><User size={13} /></span><p>{message.content}</p></div>
                    : <div className="history-chat-row" key={message.id}><span className="history-bot"><Bot size={13} /></span>
                      <div className="history-answer"><strong><BadgeCheck size={13} />{detail.agent_name || '问助手'} · 官方依据可溯源</strong>{message.reasoning_content && reasoningOwnerIds.has(message.id) ? <ReasoningBlock reasoning={message.reasoning_content} thinking={false} /> : null}<MarkdownText className="whole" content={message.content} /></div>
                    </div>)}
                </div>}

                {!!detail.citations?.length && <section className="history-source-rich">
                  <header><span><BookOpenCheck size={14} />引用文件与制度出处</span><small>{detail.citations.length} 份</small></header>
                  <div>{detail.citations.map((citation) => <div className="history-citation-item" key={citation.id}>
                    <FileText size={13} />
                    <div><strong>{citation.title}</strong>{citation.section_label && <small>{citation.section_label}</small>}</div>
                  </div>)}</div>
                </section>}

                {!!detail.related_tasks?.length && <div className="history-detail-section"><h3><Workflow size={13} />衍生办理事务</h3>
                  {detail.related_tasks.map((task) => { const meta = statusMeta(task.status); return <div className="history-linked-task" key={task.id}>
                    <Workflow size={15} />
                    <div><strong>{task.title}</strong><small>由本会话派生的办理任务</small></div>
                    <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                  </div> })}
                </div>}
              </div>

              <div className="history-followup">
                <input value={followUp} onChange={(event) => setFollowUp(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && followUp.trim()) navigate(`/conversations/${selected.id}`) }} placeholder="在此基础上继续提问，将回到会话窗口..." aria-label="继续提问" />
                <button type="button" onClick={() => navigate(`/conversations/${selected.id}`)}><ArrowRight size={13} />发送追问</button>
              </div>
            </>}
        </> : <p className="history-modal-empty">请在左侧选择一场会话</p>}</aside>
      </div>}

    {!loading && !!filtered.length && <footer className="history-page-footer"><span>所有问答自动同步至任务记录与学籍档案</span><span><ShieldCheck size={12} />历史记录仅本人可见</span></footer>}
  </section>
}
