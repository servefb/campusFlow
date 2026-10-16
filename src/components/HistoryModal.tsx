import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, BadgeCheck, Clock, Download, History, Loader2, Pencil, Pin, Plus, Search, Share, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { bookmarkHistoryConversation, deleteHistoryConversation, getHistoryConversations, unbookmarkHistoryConversation, updateHistoryConversation } from '../services/history'
import { getWorkspaceSummary, MAIN_AGENT, type WorkspaceSummary } from '../services/workspace'
import type { ConversationSummary } from '../types/api'

type GroupKey = 'today' | 'yesterday' | 'earlier'

// 通用智能体没有后端领域定义，前端补一个兜底领域；未知 Agent 也归入这里。
const COMMON_DOMAIN = { key: 'common', hint: '自由问答', name: '通用咨询' }
// 会话记录里只有 agent_name，按后端路由的 Agent 映射回 workspace/summary 的领域 key。
// ⚠️ 09-23：全站只剩一个主智能体，列表里每条会话都显示它，所以下面这张表实际上只剩
// 兜底那一档在用（`domainOf` 恒返回 COMMON_DOMAIN.key）。留着是为了老会话数据的可读性。
const AGENT_DOMAIN: Record<string, string> = {
  '校规与奖助政策 Agent': 'reward',
  '学业事务 Agent': 'academic',
  '流程办理 Agent': 'campus',
  '通用代理 Agent': COMMON_DOMAIN.key,
}
const domainOf = (agent: string) => AGENT_DOMAIN[agent] ?? COMMON_DOMAIN.key

// 领域标签配色：奖助政策沿用设计稿的红色，其余领域用同明度的辅助色区分。
const DOMAIN_TONE: Record<string, string> = {
  reward: 'red',
  academic: 'blue',
  campus: 'amber',
  [COMMON_DOMAIN.key]: 'slate',
}
const toneOf = (agent: string) => DOMAIN_TONE[domainOf(agent)] ?? 'slate'

interface HistoryRecord {
  id: string | number
  group: GroupKey
  title: string
  agent: string
  time: string
  reply?: string
  /** 细则引用条数，来自 list 接口的 last_reply_citation_count；无引用时不显示标签。 */
  citations?: number
  bookmarked?: boolean
}

const TIME_TABS: Array<{ key: string; label: string; range: string }> = [
  { key: 'all', label: '全部', range: 'all' },
  { key: 'week', label: '近7天', range: 'week' },
  { key: 'month', label: '近30天', range: 'month' },
]

const GROUP_LABELS: Record<GroupKey, string> = {
  today: '今天 (TODAY)',
  yesterday: '昨天 (YESTERDAY)',
  earlier: '更早之前 (PREVIOUS)',
}

// 历史会话全部来自 /history/conversations 接口；失败或为空时展示对应状态，不使用本地假数据。
export function HistoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [items, setItems] = useState<HistoryRecord[]>([])
  const [query, setQuery] = useState('')
  const [timeTab, setTimeTab] = useState('all')
  const [domain, setDomain] = useState('')
  const [syncedAt, setSyncedAt] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [domains, setDomains] = useState<Array<{ key: string; name: string; hint?: string }>>([])
  const searchRef = useRef<HTMLInputElement>(null)
  // 批量管理模式：勾选会话后逐条走 DELETE /history/conversations/{id}
  const [batchMode, setBatchMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchBusy, setBatchBusy] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)

  // 关闭弹窗时退出批量模式并清空选择。
  useEffect(() => {
    if (!open) {
      setBatchMode(false)
      setSelected(new Set())
    }
  }, [open])

  // 领域定义来自 /workspace/summary；加载失败时仍可用通用领域兜底。
  useEffect(() => {
    if (!open) return
    getWorkspaceSummary()
      .then(({ data }) => setDomains((data.data as WorkspaceSummary | undefined)?.domains ?? []))
      .catch(() => {})
  }, [open])

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    const range = TIME_TABS.find((tab) => tab.key === timeTab)?.range ?? 'all'
    getHistoryConversations({ keyword: query.trim() || undefined, range, page: 1, page_size: 50 })
      .then(({ data }) => {
        // 预览文字与引用数直接读 list 自带字段（2026-09-12 后端补字段后，逐条 detail GET 全部移除）。
        setItems(mapToRecords(data.data.items ?? []))
        setSyncedAt(Date.now())
        setLoading(false)
      })
      .catch((requestError) => {
        setError(requestError?.message || '历史会话加载失败，请稍后重试')
        setLoading(false)
      })
  }, [query, timeTab])

  useEffect(() => {
    if (!open) return
    // 搜索词 300ms 防抖，避免每次按键都请求接口。
    const timer = window.setTimeout(load, 300)
    return () => window.clearTimeout(timer)
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      // ⌘K / Ctrl+K 快速聚焦搜索框，与搜索框右侧的快捷键提示对应。
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // 领域 chips：定义取自 workspace/summary（通用智能体用前端设计的兜底领域），计数取自当前已加载列表。
  const domainChips = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) {
      const key = domainOf(item.agent)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const known = new Set(domains.map((entry) => entry.key))
    const all = [...domains.map((entry) => ({ key: entry.key, name: entry.name, hint: entry.hint })), ...(known.has(COMMON_DOMAIN.key) ? [] : [{ ...COMMON_DOMAIN }])]
    return all
      .map((entry) => ({ ...entry, count: counts.get(entry.key) ?? 0 }))
      .filter((entry) => entry.count > 0)
  }, [items, domains])

  const filtered = useMemo(() => (domain ? items.filter((item) => domainOf(item.agent) === domain) : items), [items, domain])

  const groups = useMemo<Array<{ key: GroupKey; records: HistoryRecord[] }>>(() => {
    const result: Array<{ key: GroupKey; records: HistoryRecord[] }> = []
    for (const key of ['today', 'yesterday', 'earlier'] as GroupKey[]) {
      const records = filtered.filter((item) => item.group === key)
      if (records.length) result.push({ key, records })
    }
    return result
  }, [filtered])

  const syncLabel = syncedAt ? `${Math.max(1, Math.round((Date.now() - syncedAt) / 60000))}m 前` : '刚刚'

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allSelected = items.length > 0 && items.every((item) => selected.has(String(item.id)))

  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(items.map((item) => String(item.id))))

  const batchDelete = async () => {
    if (!selected.size || batchBusy) return
    if (!window.confirm(`确定删除选中的 ${selected.size} 条会话吗？删除后不可恢复。`)) return
    setBatchBusy(true)
    // 批量选中逐条走删除接口，全部结束后刷新列表
    const results = await Promise.allSettled([...selected].map((id) => deleteHistoryConversation(id)))
    setBatchBusy(false)
    const failed = results.filter((item) => item.status === 'rejected').length
    setSelected(new Set())
    if (failed) setError(`有 ${failed} 条删除失败，请稍后重试`)
    load()
  }

  const rename = async (item: HistoryRecord) => {
    const nextTitle = window.prompt('修改会话标题', item.title)?.trim()
    if (!nextTitle || nextTitle === item.title) return
    try {
      await updateHistoryConversation(item.id, { title: nextTitle })
      setItems((prev) => prev.map((record) => String(record.id) === String(item.id) ? { ...record, title: nextTitle } : record))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '会话标题修改失败，请稍后重试')
    }
  }

  // 置顶即收藏：先乐观更新图标，接口失败再回滚，避免状态与后端不一致。
  const toggleBookmark = async (item: HistoryRecord) => {
    const next = !item.bookmarked
    setItems((prev) => prev.map((record) => String(record.id) === String(item.id) ? { ...record, bookmarked: next } : record))
    try {
      if (next) await bookmarkHistoryConversation(item.id)
      else await unbookmarkHistoryConversation(item.id)
    } catch (requestError) {
      setItems((prev) => prev.map((record) => String(record.id) === String(item.id) ? { ...record, bookmarked: !next } : record))
      setError(requestError instanceof Error ? requestError.message : '会话置顶状态更新失败，请稍后重试')
    }
  }

  const removeOne = async (item: HistoryRecord) => {
    if (!window.confirm(`确定删除“${item.title}”吗？删除后不可恢复。`)) return
    try {
      await deleteHistoryConversation(item.id)
      setItems((prev) => prev.filter((record) => String(record.id) !== String(item.id)))
      setSelected((prev) => { const next = new Set(prev); next.delete(String(item.id)); return next })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '会话删除失败，请稍后重试')
    }
  }

  if (!open) return null

  return (
    <div className="history-modal-layer">
      <div className="history-modal-backdrop" onClick={onClose} />
      <div className="history-modal" role="dialog" aria-modal="true" aria-label="历史会话回溯">
        <header className="history-modal-head">
          <div className="history-modal-title">
            <span className="history-modal-icon">
              <History size={16} />
            </span>
            <div>
              <h2>
                历史会话回溯 {items.length > 0 && <b>{items.length} 条</b>}
              </h2>
              <p>全流程办事记录与校本政策规章多维溯源检索</p>
            </div>
          </div>
          <div className="history-modal-tools">
            <button type="button" aria-label="导出归档" title="导出归档" onClick={() => { navigate('/history'); onClose() }}>
              <Download size={15} />
            </button>
            <button
              type="button"
              aria-label="批量管理"
              title="批量管理"
              className={batchMode ? 'active' : ''}
              onClick={() => { setBatchMode((prev) => !prev); setSelected(new Set()) }}
            >
              <SlidersHorizontal size={15} />
            </button>
            <button type="button" onClick={onClose} aria-label="关闭">
              <X size={15} />
            </button>
            <kbd>ESC</kbd>
          </div>
        </header>

        <div className="history-search">
          <Search size={15} />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索对话问题、规章条文或办事关键词..."
            aria-label="搜索历史会话"
          />
          <kbd>⌘K</kbd>
        </div>

        <div className="history-filter">
          <div className="history-filter-row">
            <span className="history-filter-label">时间段：</span>
            <div className="history-tabs">
              {TIME_TABS.map((tab) => (
                <button type="button" key={tab.key} className={timeTab === tab.key ? 'active' : ''} onClick={() => setTimeTab(tab.key)}>
                  {tab.label}
                </button>
              ))}
            </div>
            <span className="history-sync">已同步 {syncLabel}</span>
          </div>
          {domainChips.length > 0 && (
            <div className="history-filter-row">
              <span className="history-filter-label">领域：</span>
              <div className="history-tabs domains">
                <button type="button" className={domain === '' ? 'active' : ''} onClick={() => setDomain('')}>
                  全部 <em>({items.length})</em>
                </button>
                {domainChips.map((chip) => (
                  <button type="button" key={chip.key} title={chip.hint} className={domain === chip.key ? 'active' : ''} onClick={() => setDomain(domain === chip.key ? '' : chip.key)}>
                    {chip.name} <em>({chip.count})</em>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {batchMode && (
          <div className="history-batch-bar">
            <label className="history-batch-all">
              <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
              全选
            </label>
            <span className="history-batch-count">已选 {selected.size} 条</span>
            <button type="button" className="history-batch-delete" disabled={!selected.size || batchBusy} onClick={() => void batchDelete()}>
              <Trash2 size={13} />
              删除所选
            </button>
          </div>
        )}

        <div className="history-modal-body">
          {loading && (
            <p className="history-modal-empty">
              <Loader2 size={15} className="history-loading-spin" /> 正在加载历史会话…
            </p>
          )}
          {!loading && error && <p className="history-modal-empty">{error}</p>}
          {!loading && !error && groups.map((group) => (
            <section className="history-group" key={group.key}>
              <header className="history-group-head">
                <span>{GROUP_LABELS[group.key]}</span>
                <small>{group.records.length} 条会话</small>
              </header>
              <div className="history-group-list">
                {group.records.map((item) => {
                  const id = String(item.id)
                  const checked = batchMode && selected.has(id)
                  // 选中态：批量勾选或当前打开的会话，都套用设计稿的红色竖条高亮卡片。
                  const cls = ['history-item', checked ? 'batch-selected' : '', activeId === id ? 'selected' : ''].filter(Boolean).join(' ')
                  return (
                  <article
                    className={cls}
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={batchMode ? checked : undefined}
                    onClick={() => {
                      if (batchMode) {
                        toggleSelect(id)
                        return
                      }
                      setActiveId(id)
                      navigate(`/conversations/${item.id}`)
                      onClose()
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        if (batchMode) {
                          toggleSelect(id)
                          return
                        }
                        setActiveId(id)
                        navigate(`/conversations/${item.id}`)
                        onClose()
                      }
                    }}
                  >
                    {batchMode && (
                      <input
                        type="checkbox"
                        className="history-item-check"
                        checked={checked}
                        onChange={() => toggleSelect(id)}
                        onClick={(event) => event.stopPropagation()}
                      />
                    )}
                    <span className="history-item-tone gray">
                      <Clock size={14} />
                    </span>
                    {/* 正文列：标题、预览、分隔线、标签与操作行共用同一左边界，与标题对齐 */}
                    <div className="history-item-body">
                      <div className="history-item-main">
                        <div className="history-item-top">
                          <h3>{item.title}</h3>
                          <time>{item.time}</time>
                        </div>
                        {item.reply && <p>{item.reply}</p>}
                      </div>
                      {/* 分隔线下方的一行：左侧领域/引用标签，右侧操作图标 */}
                      <div className="history-item-foot">
                        <div className="history-item-tags">
                          <span className={`history-tag-agent ${toneOf(item.agent)}`}>{item.agent}</span>
                          {item.citations ? (
                            <span className="history-tag-cite">
                              <BadgeCheck size={12} />
                              引用 {item.citations} 份细则
                            </span>
                          ) : null}
                        </div>
                        <div className="history-item-actions" aria-label="会话操作">
                          <button type="button" className={item.bookmarked ? 'active' : ''} aria-label="置顶会话" aria-pressed={Boolean(item.bookmarked)} title="置顶" onClick={(event) => { event.stopPropagation(); void toggleBookmark(item) }}><Pin size={14} /></button>
                          <button type="button" aria-label="分享会话" title="分享" onClick={(event) => { event.stopPropagation(); void navigator.clipboard?.writeText(`${window.location.origin}/conversations/${item.id}`) }}><Share size={14} /></button>
                          <button type="button" aria-label="修改标题" title="修改标题" onClick={(event) => { event.stopPropagation(); void rename(item) }}><Pencil size={14} /></button>
                          <button type="button" aria-label="删除会话" title="删除" onClick={(event) => { event.stopPropagation(); void removeOne(item) }}><Trash2 size={14} /></button>
                          <button type="button" className="history-item-open" aria-label="打开会话" title="打开" onClick={(event) => { event.stopPropagation(); navigate(`/conversations/${item.id}`); onClose() }}><ArrowRight size={15} /></button>
                        </div>
                      </div>
                    </div>
                  </article>
                  )
                })}
              </div>
            </section>
          ))}
          {!loading && !error && !groups.length && <p className="history-modal-empty">没有匹配的历史会话</p>}
        </div>

        <footer className="history-modal-foot">
          <span className="history-modal-hint">
            便于 <kbd>↓</kbd> 快捷切换，Enter 打开
          </span>
          <div className="history-modal-actions">
            <button type="button" onClick={() => { navigate('/history'); onClose() }}>
              完整档案库
            </button>
            <button type="button" className="history-modal-new" onClick={() => { navigate('/workspace'); onClose() }}>
              <Plus size={14} />
              新建会话
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function mapToRecords(list: ConversationSummary[]): HistoryRecord[] {
  // 按自然日分组（当地 0 点边界），不用"距现在 24 小时"的滚动窗口，否则昨晚的记录会被算进今天
  const startToday = new Date()
  startToday.setHours(0, 0, 0, 0)
  const startYesterday = new Date(startToday)
  startYesterday.setDate(startYesterday.getDate() - 1)
  return list.map((item) => {
    const date = new Date(item.updated_at)
    const time = date.getTime()
    const group: GroupKey = time >= startToday.getTime() ? 'today' : time >= startYesterday.getTime() ? 'yesterday' : 'earlier'
    const clock = date.toTimeString().slice(0, 5)
    const label = group === 'today' ? clock : group === 'yesterday' ? `昨天 ${clock}` : `${date.getMonth() + 1}月${date.getDate()}日`
    return {
      id: item.id,
      group,
      title: item.title,
      // 09-23：不再逐条透传后端 agent_name（那是「智能调度 / 各领域 Agent」的历史口径），
      // 统一显示唯一主智能体的名字。
      agent: MAIN_AGENT.name,
      time: label,
      bookmarked: Boolean(item.is_bookmarked),
      // 预览与引用数已经由 list 接口算好，不再逐条拉详情。
      reply: item.last_reply_preview || undefined,
      citations: item.last_reply_citation_count ?? 0,
    }
  })
}
