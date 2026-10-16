import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Megaphone,
  Newspaper,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Trash2,
} from 'lucide-react'
import {
  Badge,
  Card,
  Chip,
  Drawer,
  EmptyState,
  Notice,
  PageHead,
  Pager,
  Segmented,
  SkeletonRows,
} from '../components/ui'
import { useNewsCategories, useNewsList, useNewsSources } from '../hooks/queries'
import { apiBusinessCode, apiErrorMessage } from '../services/http'
import { createNewsItem, deleteNewsItem, syncNewsSource, updateNewsItem, updateNewsSource } from '../services/news'
import { NEWS_SOURCE_STATUS } from '../design/semantics'
import { formatNumber, formatRelative, formatShortDateTime } from '../utils/format'
import type {
  NewsAdminCreatePayload,
  NewsAdminUpdatePayload,
  NewsItem,
  NewsSource,
  NewsSourceUpdatePayload,
  NewsVisibility,
} from '../types/api'

/**
 * 新闻治理 —— 文档第 12 章。补齐管理端此前缺失的「新闻源治理」模块
 * （文档权限表里管理员权限明确包含这一项，但前端一直没有对应页面）。
 *
 * 两条硬约束：
 *  1. 指标卡的数字必须来自真实响应。live 下接口没回来就显示「—」，
 *     绝不能像之前那批卡片一样把写死的常量当成真实数据（见走查报告 P0-2）。
 *  2. 新闻源的 queryKey 只放稳定标量，别把每次渲染都变的值塞进参数（见走查报告 P0-1）。
 */

const PAGE_SIZE = 6

const SORT_OPTIONS: Array<{ value: 'asc' | 'desc'; label: string }> = [
  { value: 'desc', label: '最新优先' },
  { value: 'asc', label: '最早优先' },
]

interface SourceDraft {
  status: string
  interval: string
  category: string
  list: string
  title: string
  publishedAt: string
}

const draftFrom = (source: NewsSource): SourceDraft => ({
  status: source.status === 'paused' ? 'paused' : 'active',
  interval: source.sync_interval_minutes != null ? String(source.sync_interval_minutes) : '',
  category: source.category ?? '',
  list: source.selector?.list ?? '',
  title: source.selector?.title ?? '',
  publishedAt: source.selector?.published_at ?? '',
})

/** 人工录入源没有抓取地址，同步与选择器都不适用。 */
const isManualSource = (source: NewsSource) => source.source_type === 'manual' || !source.base_url

/** `campus_news.visibility` 的展示文案（后端 `ALLOWED_VISIBILITY` 闭合枚举，值必须原样发）。 */
const VISIBILITY_OPTIONS: Array<{ value: NewsVisibility; label: string }> = [
  { value: 'campus', label: '全校可见（默认）' },
  { value: 'public', label: '完全公开（含校外）' },
  { value: 'student', label: '仅学生可见' },
  { value: 'teacher', label: '仅教职工可见' },
  { value: 'department', label: '指定院系可见' },
  { value: 'admin', label: '仅管理端可见' },
]

/** 发布表单的受控草稿。deadline 存 datetime-local 原始值，提交前再转后端格式。 */
interface NewsFormDraft {
  title: string
  summary: string
  content: string
  category: string
  visibility: NewsVisibility
  spotlight: boolean
  deadline: string
  status: 'draft' | 'published'
}

const emptyNewsDraft = (): NewsFormDraft => ({
  title: '',
  summary: '',
  content: '',
  category: '',
  visibility: 'campus',
  spotlight: false,
  deadline: '',
  status: 'published',
})

/** datetime-local 值（`2026-10-12T17:00`）→ 后端契约 `yyyy-MM-dd HH:mm:ss`。 */
const deadlineToWire = (value: string) =>
  value ? `${value.replace('T', ' ')}${value.length === 16 ? ':00' : ''}` : ''

/** 后端时间（`2026-09-15 17:00:00` / ISO）→ datetime-local 值，编辑回显用。 */
const deadlineToLocalInput = (value: string) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

export function NewsPage() {
  const queryClient = useQueryClient()
  const [category, setCategory] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [debounced, setDebounced] = useState('')
  const [sortAsc, setSortAsc] = useState(false)
  const [page, setPage] = useState(1)

  const [feedback, setFeedback] = useState('')
  const [feedbackTone, setFeedbackTone] = useState<'emerald' | 'amber' | 'coral'>('amber')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const [editing, setEditing] = useState<NewsSource | null>(null)
  const [draft, setDraft] = useState<SourceDraft | null>(null)
  const [saving, setSaving] = useState(false)

  // 检索防抖，避免每敲一个字打一次接口
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(keyword)
      setPage(1)
    }, 320)
    return () => clearTimeout(timer)
  }, [keyword])

  const news = useNewsList({ category, query: debounced, page, page_size: PAGE_SIZE, sort: sortAsc })
  const categories = useNewsCategories()
  const sources = useNewsSources({ page: 1, page_size: 20 })

  const sourceItems = sources.data?.items ?? []
  const activeCount = sourceItems.filter((item) => item.status === 'active').length
  const pausedCount = sourceItems.filter((item) => item.status === 'paused').length

  const latestSync = sourceItems.reduce<string | null>((acc, item) => {
    if (!item.last_synced_at) return acc
    if (!acc) return item.last_synced_at
    return Date.parse(item.last_synced_at) > Date.parse(acc) ? item.last_synced_at : acc
  }, null)
  const latestSyncSource = sourceItems.find((item) => item.last_synced_at === latestSync)

  const refreshAll = async () => {
    setRefreshing(true)
    try {
      await Promise.all([news.refetch(), sources.refetch(), categories.refetch()])
    } finally {
      setRefreshing(false)
    }
  }

  const pickCategory = (value: string) => {
    setCategory(value)
    setPage(1)
  }

  const handleSync = async (source: NewsSource) => {
    setBusyId(source.id)
    try {
      const result = await syncNewsSource(source.id)
      setFeedbackTone('emerald')
      setFeedback(
        `新闻源「${source.name}」同步任务已创建（sync_job_id ${result.data.sync_job_id}，状态 ${result.data.status}）。` +
          '抓取在后台进行，完成后自动进入新闻流。',
      )
      await sources.refetch()
    } catch (error) {
      /*
       * 501 / 409 是后端「如实拒绝」，不是系统故障，所以走 amber 而不是 coral ——
       * 染红会引导管理员反复重试，而这两件事重试都不会变（一个是没有执行器，一个是源被停用）。
       * 文案直接用后端原文，别自己编一句笼统的「同步失败」把原因吃掉。
       */
      const code = apiBusinessCode(error)
      const reason = apiErrorMessage(error, `「${source.name}」同步任务创建失败`)
      if (code === 501) {
        setFeedbackTone('amber')
        setFeedback(
          `「${source.name}」未创建同步任务 —— ${reason}` +
            '这是后端当前的能力边界（不是本次操作出错），要触发抓取得先落地抓取作业。',
        )
      } else if (code === 409) {
        setFeedbackTone('amber')
        setFeedback(`「${source.name}」未创建同步任务 —— ${reason}`)
      } else {
        setFeedbackTone('coral')
        setFeedback(reason)
      }
    } finally {
      setBusyId(null)
    }
  }

  const openEdit = (source: NewsSource) => {
    setEditing(source)
    setDraft(draftFrom(source))
    setFeedback('')
  }

  const closeEdit = () => {
    setEditing(null)
    setDraft(null)
  }

  const saveEdit = async () => {
    if (!editing || !draft) return

    const intervalText = draft.interval.trim()
    if (intervalText) {
      const interval = Number(intervalText)
      if (!Number.isInteger(interval) || interval <= 0) {
        setFeedbackTone('coral')
        setFeedback('抓取间隔必须是大于 0 的整数分钟。')
        return
      }
    }

    // 只提交真正改过的字段：整对象回写会把没动的 selector、category 一起覆盖掉
    const payload: NewsSourceUpdatePayload = {}
    if (draft.status !== (editing.status === 'paused' ? 'paused' : 'active')) payload.status = draft.status
    if (intervalText) {
      const interval = Number(intervalText)
      if (interval !== editing.sync_interval_minutes) payload.sync_interval_minutes = interval
    }
    if (draft.category !== (editing.category ?? '')) payload.category = draft.category

    const nextSelector = {
      list: draft.list.trim(),
      title: draft.title.trim(),
      published_at: draft.publishedAt.trim(),
    }
    const currentSelector = {
      list: editing.selector?.list ?? '',
      title: editing.selector?.title ?? '',
      published_at: editing.selector?.published_at ?? '',
    }
    if (JSON.stringify(nextSelector) !== JSON.stringify(currentSelector)) payload.selector = nextSelector

    if (!Object.keys(payload).length) {
      setFeedbackTone('amber')
      setFeedback('没有任何改动，未发起请求。')
      return
    }

    setSaving(true)
    try {
      const result = await updateNewsSource(editing.id, payload)
      setFeedbackTone('emerald')
      setFeedback(
        `新闻源「${editing.name}」规则已保存（${Object.keys(payload).join('、')}）。` +
          `后端返回 updated_at ${formatShortDateTime(result.data.updated_at)}。`,
      )
      closeEdit()
      await sources.refetch()
    } catch (error) {
      setFeedbackTone('coral')
      setFeedback(apiErrorMessage(error, '新闻源更新失败'))
    } finally {
      setSaving(false)
    }
  }

  const queryError = news.isError ? news.error : sources.isError ? sources.error : null

  /* ---------- 发布通知（POST/PATCH/DELETE /news/admin/news，2026-09-23 后端落地） ---------- */

  const [newsTarget, setNewsTarget] = useState<NewsItem | null>(null)
  const [newsForm, setNewsForm] = useState<NewsFormDraft | null>(null)
  const [savingNews, setSavingNews] = useState(false)
  const [newsBusyId, setNewsBusyId] = useState<number | null>(null)

  const openCreate = () => {
    setNewsTarget(null)
    setNewsForm(emptyNewsDraft())
    setFeedback('')
  }

  const openEditNews = (item: NewsItem) => {
    setNewsTarget(item)
    setNewsForm({
      title: item.title,
      summary: item.summary ?? '',
      // 列表接口 mock 下未回传正文 —— 留空 = 不修改正文（见字段下方的 field-hint）
      content: item.content ?? '',
      category: item.category,
      visibility: (item.visibility as NewsVisibility) ?? 'campus',
      spotlight: !!item.is_spotlight,
      deadline: item.deadline_at ? deadlineToLocalInput(item.deadline_at) : '',
      status: 'published',
    })
    setFeedback('')
  }

  const closeNewsForm = () => {
    setNewsTarget(null)
    setNewsForm(null)
  }

  const patchNews = async (id: number, payload: NewsAdminUpdatePayload, successNote: string) => {
    setNewsBusyId(id)
    setFeedback('')
    try {
      await updateNewsItem(id, payload)
      setFeedbackTone('emerald')
      setFeedback(successNote)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['news-list'] }),
        queryClient.invalidateQueries({ queryKey: ['news-categories'] }),
      ])
    } catch (error) {
      setFeedbackTone('coral')
      setFeedback(apiErrorMessage(error, '稿件更新失败'))
    } finally {
      setNewsBusyId(null)
    }
  }

  const toggleSpotlight = (item: NewsItem) => {
    const next = !item.is_spotlight
    void patchNews(
      item.id,
      { is_spotlight: next },
      next
        ? `「${item.title}」已设为首页轮播置顶。`
        : `「${item.title}」已取消轮播置顶。`,
    )
  }

  const offlineNews = (item: NewsItem) => {
    void patchNews(
      item.id,
      { status: 'offline' },
      `「${item.title}」已下线，新闻流不再展示。⚠️ 后端目前没有管理端稿件清单接口，` +
        '重新上线需要等该接口补齐（已登记《接口对接说明》2.4）。',
    )
  }

  const removeNews = async (item: NewsItem) => {
    if (!window.confirm(`确定删除「${item.title}」？\n删除是软删除（数据库保留记录），但新闻流会立刻移除，且当前没有恢复入口。`)) return
    setNewsBusyId(item.id)
    setFeedback('')
    try {
      await deleteNewsItem(item.id)
      setFeedbackTone('emerald')
      setFeedback(`「${item.title}」已删除（软删除，deleted_at 已写入）。`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['news-list'] }),
        queryClient.invalidateQueries({ queryKey: ['news-categories'] }),
      ])
    } catch (error) {
      setFeedbackTone('coral')
      setFeedback(apiErrorMessage(error, '删除失败'))
    } finally {
      setNewsBusyId(null)
    }
  }

  const submitNews = async () => {
    if (!newsForm) return
    const title = newsForm.title.trim()
    const content = newsForm.content.trim()
    const category = newsForm.category.trim()
    // 与后端 requireText 同口径：三项必填，缺一按 400 拒收 —— 前端先挡一道
    if (!title || !content || !category) {
      setFeedbackTone('coral')
      setFeedback('标题、正文、分类都是必填项，请补齐后再提交。')
      return
    }

    setSavingNews(true)
    setFeedback('')
    try {
      if (newsTarget) {
        // PATCH 只提交真正改过的字段 —— 整对象回写会把没动过的字段一起覆盖（与编辑抓取规则同一纪律）
        const payload: NewsAdminUpdatePayload = {}
        if (title !== newsTarget.title) payload.title = title
        if (newsForm.summary.trim() !== (newsTarget.summary ?? '')) payload.summary = newsForm.summary.trim()
        const nextContent = content
        if (nextContent && nextContent !== (newsTarget.content ?? '')) payload.content = nextContent
        if (category !== newsTarget.category) payload.category = category
        if (newsForm.visibility !== (newsTarget.visibility ?? 'campus')) payload.visibility = newsForm.visibility
        if (newsForm.spotlight !== !!newsTarget.is_spotlight) payload.is_spotlight = newsForm.spotlight
        const nextDeadline = newsForm.deadline ? deadlineToWire(newsForm.deadline) : ''
        const currentDeadline = newsTarget.deadline_at ?? ''
        const sameDeadline =
          (!nextDeadline && !currentDeadline) ||
          (nextDeadline && currentDeadline && Date.parse(nextDeadline) === Date.parse(currentDeadline))
        // 空串语义 = 清空截止时间（后端 parseTime 对空串返回 null）；null 才是「不修改」
        if (!sameDeadline) payload.deadline_at = nextDeadline

        if (!Object.keys(payload).length) {
          setFeedbackTone('amber')
          setFeedback('没有任何改动，未发起请求。')
          setSavingNews(false)
          return
        }

        const result = await updateNewsItem(newsTarget.id, payload)
        setFeedbackTone('emerald')
        setFeedback(
          `稿件「${title}」已保存（${Object.keys(payload).join('、')}）。后端返回 status ${result.data.status}` +
            `${result.data.published_at ? `，发布时间 ${formatShortDateTime(result.data.published_at)}` : ''}。`,
        )
        closeNewsForm()
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['news-list'] }),
          queryClient.invalidateQueries({ queryKey: ['news-categories'] }),
        ])
      } else {
        const payload: NewsAdminCreatePayload = {
          title,
          content,
          category,
          summary: newsForm.summary.trim() || undefined,
          visibility: newsForm.visibility,
          is_spotlight: newsForm.spotlight,
          deadline_at: newsForm.deadline ? deadlineToWire(newsForm.deadline) : undefined,
          status: newsForm.status,
        }
        const result = await createNewsItem(payload)
        setFeedbackTone('emerald')
        setFeedback(
          result.data.status === 'published'
            ? `通知「${title}」已发布（id ${result.data.id}），发布时间 ${formatShortDateTime(result.data.published_at)} 由服务端写入，已进入新闻流。`
            : `通知「${title}」已存为草稿（id ${result.data.id}）。⚠️ 新闻流只展示已发布稿件，` +
              '草稿重新上线需后端补「稿件清单」接口（已登记《接口对接说明》2.4）。',
        )
        closeNewsForm()
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['news-list'] }),
          queryClient.invalidateQueries({ queryKey: ['news-categories'] }),
        ])
      }
    } catch (error) {
      const code = apiBusinessCode(error)
      // 400 = 必填缺失/取值不合法/没有变更，属于表单问题，amber 引导修正；其余（409 封面未过扫描等）coral
      setFeedbackTone(code === 400 ? 'amber' : 'coral')
      setFeedback(apiErrorMessage(error, newsTarget ? '稿件保存失败' : '发布失败'))
    } finally {
      setSavingNews(false)
    }
  }

  return (
    <>
      <PageHead
        crumb="知识资产"
        title="新闻治理"
        lede="管理校园新闻源的抓取规则与同步任务，并查看已入库的新闻流。"
        tools={
          <>
            <button className="btn btn-primary btn-sm" onClick={openCreate}>
              <Plus size={14} /> 发布新闻
            </button>
            <button className="btn btn-ghost btn-sm" onClick={refreshAll} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? 'spin' : ''} /> {refreshing ? '刷新中…' : '刷新'}
            </button>
          </>
        }
      />

      {/*
        新闻治理走一条 stat-brief 概览行（全站统一语汇）：
        采集源 / 已入库 / 分类 / 最近同步四个事实格。数字都很小（5 / 7 / 5），
        概览行的高度预算刚好 —— 状态明细（抓取中 x · 已暂停 y）收进小注。
      */}
      <section className="stat-brief">
        <div className="brief-cell">
          <span className="brief-label">新闻采集源</span>
          <span className="brief-num">
            {sources.data ? formatNumber(sources.data.total) : '—'}
            <small>个源</small>
          </span>
          <span className="brief-sub">
            {sources.data ? `抓取中 ${activeCount} · 已暂停 ${pausedCount}` : '等待 /news/admin/sources'}
          </span>
        </div>
        <div className="brief-cell">
          <span className="brief-label">已入库新闻</span>
          <span className="brief-num">
            {formatNumber(news.data?.total)}
            <small>条</small>
          </span>
          {/* `news.data ?` 只保证包络在，不保证里面有 `items`；
              成功的空响应（`data: {}`）下 `.items.length` 会把整棵树掀掉。 */}
          <span className="brief-sub">
            {news.data?.items ? `当前筛选命中 ${news.data.items.length} 条` : '等待 /news'}
          </span>
        </div>
        <div className="brief-cell">
          <span className="brief-label">新闻分类</span>
          <span className="brief-num">
            {categories.data ? formatNumber(categories.data.length) : '—'}
            <small>个分类</small>
          </span>
          <span className="brief-sub">
            {categories.data?.length
              ? categories.data
                  .map((item) => item.name)
                  .slice(0, 3)
                  .join(' / ')
              : '等待 /news/categories'}
          </span>
        </div>
        <div className="brief-cell">
          <span className="brief-label">最近一次同步</span>
          <span className="brief-num">{latestSync ? formatRelative(latestSync) : '—'}</span>
          <span className="brief-sub">{latestSyncSource ? latestSyncSource.name : '暂无同步记录'}</span>
        </div>
      </section>

      {feedback && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone={feedbackTone}>{feedback}</Notice>
        </div>
      )}

      {queryError && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="coral">
            {apiErrorMessage(queryError, '新闻接口请求失败')}
            ：新闻源接口为管理员接口，若返回 403 请确认当前令牌具备「新闻源治理」权限。
          </Notice>
        </div>
      )}

      {/* 新闻源治理：管理员的写操作都在这张表里 */}
      <Card
        title={
          <>
            <Rss size={15} /> 新闻源治理
          </>
        }
        sub="规则变更按 sync_interval_minutes 生效；「立即同步」只创建任务，抓取在后台进行，返回 sync_job_id 不代表已完成。"
        extra={
          sources.data?.total != null ? (
            <span className="hint mono">
              本页 {sourceItems.length} / 共 {sources.data.total} 个源
            </span>
          ) : (
            <span className="api-tag">
              <b>GET</b> /news/admin/sources
            </span>
          )
        }
        pad={false}
      >
        {sources.isLoading && <SkeletonRows rows={4} />}
        {sources.isSuccess && !sourceItems.length && (
          <EmptyState
            title="后端未返回任何新闻源"
            desc="GET /news/admin/sources 返回空列表。新增新闻源的接口文档尚未提供，所以本页只支持编辑已有源与触发同步。"
          />
        )}
        {!!sourceItems.length && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 34 }} />
                  <th>新闻源</th>
                  <th>抓取地址</th>
                  <th>归属分类</th>
                  <th>状态</th>
                  <th>抓取间隔</th>
                  <th>最近同步</th>
                  <th className="num">操作</th>
                </tr>
              </thead>
              <tbody>
                {sourceItems.map((source) => {
                  const meta = NEWS_SOURCE_STATUS[source.status] ?? { tone: 'slate' as const, label: source.status }
                  const manual = isManualSource(source)
                  return (
                    <tr key={source.id}>
                      <td>
                        <span className="row-icon">
                          <Rss size={13} />
                        </span>
                      </td>
                      <td>
                        <div className="cell-stack">
                          <span className="t-title">{source.name}</span>
                          <span className="mono hint">
                            #{source.id} · {source.source_type ?? '未标注类型'}
                          </span>
                        </div>
                      </td>
                      <td>
                        {source.base_url ? (
                          <span className="mono hint">{source.base_url}</span>
                        ) : (
                          <span className="hint">人工录入，无抓取地址</span>
                        )}
                      </td>
                      <td>
                        <Badge tone="slate">{source.category ?? '未指定'}</Badge>
                      </td>
                      <td>
                        <Badge tone={meta.tone} dot={source.status === 'active'}>
                          {meta.label}
                        </Badge>
                      </td>
                      <td className="mono">
                        {source.sync_interval_minutes ? `${source.sync_interval_minutes} 分钟` : '—'}
                      </td>
                      <td>
                        {source.last_synced_at ? (
                          <div className="cell-stack">
                            <span>{formatRelative(source.last_synced_at)}</span>
                            <span className="mono hint">{formatShortDateTime(source.last_synced_at)}</span>
                          </div>
                        ) : (
                          <span className="hint">从未同步</span>
                        )}
                      </td>
                      <td className="actions">
                        <button
                          className="act"
                          disabled={busyId === source.id || manual}
                          title={manual ? '人工录入源不参与抓取同步' : '创建同步任务'}
                          onClick={() => handleSync(source)}
                        >
                          <RefreshCw size={13} /> {busyId === source.id ? '提交中…' : '立即同步'}
                        </button>
                        <button className="act primary" onClick={() => openEdit(source)}>
                          <Pencil size={13} /> 编辑规则
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ height: 16 }} />

      {/* 已入库新闻流 */}
      <div className="chip-row" style={{ marginBottom: 12 }}>
        <Chip on={category === 'all'} onClick={() => pickCategory('all')}>
          全部分类
        </Chip>
        {(categories.data ?? []).map((item) => (
          <Chip key={item.key} on={category === item.name} count={item.count} onClick={() => pickCategory(item.name)}>
            {item.name}
          </Chip>
        ))}
      </div>

      <Card pad={false}>
        <div className="filter-bar">
          <div className="search-input" style={{ flex: 1, minWidth: 240 }}>
            <Search size={15} />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="按标题、摘要或发文单位检索新闻…"
              aria-label="检索新闻"
            />
          </div>
          <Segmented
            value={sortAsc ? 'asc' : 'desc'}
            options={SORT_OPTIONS}
            onChange={(value) => {
              setSortAsc(value === 'asc')
              setPage(1)
            }}
          />
        </div>

        {news.isLoading && <SkeletonRows rows={6} />}
        {news.isSuccess && !news.data?.items?.length && (
          <EmptyState
            title={debounced ? `没有匹配「${debounced}」的新闻` : '该分类下没有新闻'}
            desc="新闻流来自已启用的新闻源抓取结果，也可能是分类参数与后端取值不一致导致的空结果 —— 分类要传分类名称，不是 categories[].key。"
            tone={debounced ? 'warning' : 'neutral'}
          />
        )}
        {!!news.data?.items?.length && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 34 }} />
                  <th>新闻标题 / 摘要</th>
                  <th>分类</th>
                  <th>发文单位</th>
                  <th>发布时间</th>
                  <th>截止时间</th>
                  <th className="num">操作</th>
                </tr>
              </thead>
              <tbody>
                {news.data.items.map((item) => {
                  const expired = !!item.deadline_at && Date.parse(item.deadline_at) < Date.now()
                  return (
                    <tr key={item.id}>
                      <td>
                        <span className="row-icon">
                          <Newspaper size={13} />
                        </span>
                      </td>
                      <td>
                        <div className="cell-stack">
                          <span className="news-title">
                            <span className="t-title">{item.title}</span>
                            {item.is_spotlight && (
                              <Badge tone="ink">
                                <Pin size={11} /> 置顶
                              </Badge>
                            )}
                            {item.is_bookmarked && <Badge tone="slate">已关注</Badge>}
                          </span>
                          <span className="hint">{item.summary ?? '无摘要'}</span>
                        </div>
                      </td>
                      <td>
                        <Badge tone="slate">{item.category}</Badge>
                      </td>
                      <td>
                        <span className="hint">{item.department ?? '—'}</span>
                      </td>
                      <td>
                        <span className="mono">{formatShortDateTime(item.published_at)}</span>
                      </td>
                      <td>
                        {item.deadline_at ? (
                          <div className="cell-stack">
                            <span className="mono">{formatShortDateTime(item.deadline_at)}</span>
                            <span className="hint">{expired ? '已截止' : '进行中'}</span>
                          </div>
                        ) : (
                          <span className="hint">无截止时间</span>
                        )}
                      </td>
                      <td className="actions">
                        <button
                          className="act"
                          disabled={newsBusyId === item.id}
                          title={item.is_spotlight ? '取消首页轮播置顶' : '设为首页轮播置顶'}
                          onClick={() => toggleSpotlight(item)}
                        >
                          {item.is_spotlight ? <PinOff size={13} /> : <Pin size={13} />}
                          {item.is_spotlight ? '取消置顶' : '置顶'}
                        </button>
                        <button
                          className="act"
                          disabled={newsBusyId === item.id}
                          title="下线后新闻流不再展示"
                          onClick={() => offlineNews(item)}
                        >
                          <Megaphone size={13} /> 下线
                        </button>
                        <button className="act" disabled={newsBusyId === item.id} onClick={() => openEditNews(item)}>
                          <Pencil size={13} /> 编辑
                        </button>
                        <button
                          className="act"
                          disabled={newsBusyId === item.id}
                          title="软删除，新闻流立刻移除"
                          onClick={() => void removeNews(item)}
                        >
                          <Trash2 size={13} /> 删除
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="table-foot">
          <span>
            显示第 {news.data?.items?.length ? (page - 1) * PAGE_SIZE + 1 : 0} –{' '}
            {(page - 1) * PAGE_SIZE + (news.data?.items?.length ?? 0)} 条，共 {news.data?.total ?? 0} 条记录
          </span>
          <Pager page={page} pageSize={PAGE_SIZE} total={news.data?.total ?? 0} onChange={setPage} />
        </div>
      </Card>

      <div style={{ marginTop: 16 }}>
        <Notice tone="slate" icon={<AlertTriangle size={15} />}>
          <div>
            <b>接口约定与已知边界</b>
          </div>
          <div>
            1. 分类筛选要传 <span className="mono">campus_news.category</span> 的分类名称，不是{' '}
            <span className="mono">/news/categories</span> 的 <span className="mono">key</span>（文档 12.1 明确要求）。
            示例数据里两者同值，所以传错在 mock 下看不出差别，接真实后端会静默筛空。
          </div>
          <div>
            2. <span className="mono">sort</span> 是布尔值：<span className="mono">true</span> 发布时间正序、
            <span className="mono">false</span> 倒序，未传默认倒序。不要传 <span className="mono">desc</span> 这类字符串。
          </div>
          <div>
            3. 新闻源三个接口都是管理员接口，普通令牌调用返回 403，属预期而非故障。
          </div>
          <div>
            4. 数据表 <span className="mono">news_sources</span> 有 <span className="mono">is_enabled</span>、
            <span className="mono">last_sync_status</span> 等字段，而接口给的是{' '}
            <span className="mono">status</span> / <span className="mono">sync_interval_minutes</span> —— 字段名以接口文档为准，
            若后端改按表名返回需要同步改这里。
          </div>
          <div>
            5. <span className="mono">paused</span> 是新增登记的状态值，文档只示例过{' '}
            <span className="mono">active</span>，需后端确认后写回文档。
          </div>
          <div>
            6. <span className="mono">POST …/sync</span> 目前<b>故意返回 501</b>（后端没有抓取执行器，见{' '}
            <span className="mono">NewsSourcesServiceImpl#syncSource</span>），
            且以 <span className="mono">HTTP 200 + code 501</span> 的形式回来 ——
            业务失败都走 200，所以页面必须看 <span className="mono">code</span> 而不是看有没有抛异常。
            抓取作业落地后这个按钮不用改就能用。
          </div>
          <div>
            7. 手动发布走 <span className="mono">POST /news/admin/news</span>，
            <span className="mono">published_at</span> 由服务端在首次发布时写入 ——
            让客户端决定「什么时候发的」等于允许伪造发布时间，所以前端不传发布时间。
          </div>
          <div>
            8. 新闻流 <span className="mono">GET /news</span> 只回 <span className="mono">status=published</span>：
            草稿与已下线的稿件目前<b>无处可见</b>（后端没有管理端稿件清单接口，已登记 2.4 待补）；
            封面要等后端登记 <span className="mono">news_cover</span> 用途后才能上传，表单暂不含封面。
          </div>
        </Notice>
      </div>

      {editing && draft && (
        <Drawer
          open
          wide
          title={
            <>
              <Pencil size={15} /> 编辑抓取规则
            </>
          }
          sub={`${editing.name} · #${editing.id}`}
          onClose={closeEdit}
          footer={
            <>
              <span className="api-tag">
                <b>PATCH</b> /news/admin/sources/{editing.id}
              </span>
              <div className="toolbar-spacer" />
              <button className="btn btn-ghost btn-sm" onClick={closeEdit} disabled={saving}>
                取消
              </button>
              <button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={saving}>
                {saving ? '保存中…' : '保存规则'}
              </button>
            </>
          }
        >
          <div className="form-grid">
            <label>
              <span className="label-sm">状态</span>
              <Segmented
                value={draft.status === 'paused' ? 'paused' : 'active'}
                options={[
                  { value: 'active', label: '抓取中' },
                  { value: 'paused', label: '已暂停' },
                ]}
                onChange={(value) => setDraft({ ...draft, status: value })}
              />
              <span className="field-hint">
                文档只示例过 <span className="mono">active</span>；<span className="mono">paused</span> 为新登记值，待后端确认。
              </span>
            </label>

            <label>
              <span className="label-sm">抓取间隔（分钟）</span>
              <input
                className="field"
                inputMode="numeric"
                value={draft.interval}
                disabled={isManualSource(editing)}
                placeholder="例如 30"
                onChange={(event) => setDraft({ ...draft, interval: event.target.value })}
              />
              <span className="field-hint">
                {isManualSource(editing) ? '人工录入源没有抓取周期。' : '留空表示本次不修改该字段。'}
              </span>
            </label>

            <label>
              <span className="label-sm">归属分类</span>
              <select
                className="field"
                value={draft.category}
                onChange={(event) => setDraft({ ...draft, category: event.target.value })}
              >
                <option value="">暂不指定</option>
                {(categories.data ?? []).map((item) => (
                  <option key={item.key} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
              <span className="field-hint">抓取到的新条目会带上这个分类，筛选时才找得到。</span>
            </label>

            <div className="span-2">
              <span className="label-sm">抓取选择器（selector）</span>
              <div className="form-grid" style={{ marginTop: 10 }}>
                <label>
                  <span className="label-sm">列表条目</span>
                  <input
                    className="field"
                    value={draft.list}
                    disabled={isManualSource(editing)}
                    placeholder=".notice-list li"
                    onChange={(event) => setDraft({ ...draft, list: event.target.value })}
                  />
                </label>
                <label>
                  <span className="label-sm">标题</span>
                  <input
                    className="field"
                    value={draft.title}
                    disabled={isManualSource(editing)}
                    placeholder="a"
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  />
                </label>
                <label className="span-2">
                  <span className="label-sm">发布时间</span>
                  <input
                    className="field"
                    value={draft.publishedAt}
                    disabled={isManualSource(editing)}
                    placeholder=".date"
                    onChange={(event) => setDraft({ ...draft, publishedAt: event.target.value })}
                  />
                </label>
              </div>
              <span className="field-hint">
                仅 <span className="mono">source_type</span> 为 <span className="mono">rss</span> /{' '}
                <span className="mono">html</span> 的源需要选择器；留空等于清空该字段，请谨慎。
              </span>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <Notice tone="slate">
              只提交你改过的字段。后端按字段做局部更新，整对象回写容易把没动过的选择器覆盖成空值。
            </Notice>
          </div>
        </Drawer>
      )}
      {newsForm && (
        <Drawer
          open
          wide
          title={
            newsTarget ? (
              <>
                <Pencil size={15} /> 编辑稿件
              </>
            ) : (
              <>
                <Megaphone size={15} /> 发布通知
              </>
            )
          }
          sub={
            newsTarget
              ? `#${newsTarget.id} · ${newsTarget.title}`
              : '手动发布的稿件进入校园新闻流（campus_news 表「人工录入」路径），与学生端同源。'
          }
          onClose={closeNewsForm}
          footer={
            <>
              <span className="api-tag">
                <b>{newsTarget ? 'PATCH' : 'POST'}</b> /news/admin/news{newsTarget ? `/${newsTarget.id}` : ''}
              </span>
              <div className="toolbar-spacer" />
              <button className="btn btn-ghost btn-sm" onClick={closeNewsForm} disabled={savingNews}>
                取消
              </button>
              <button className="btn btn-primary btn-sm" onClick={submitNews} disabled={savingNews}>
                {savingNews ? '提交中…' : newsTarget ? '保存修改' : newsForm.status === 'published' ? '立即发布' : '存为草稿'}
              </button>
            </>
          }
        >
          <div className="form-grid">
            <label className="span-2">
              <span className="label-sm">标题 *</span>
              <input
                className="field"
                value={newsForm.title}
                placeholder="例如：关于 2026 年秋季学期期末考试安排的通知"
                onChange={(event) => setNewsForm({ ...newsForm, title: event.target.value })}
              />
            </label>

            <label>
              <span className="label-sm">分类 *</span>
              <input
                className="field"
                list="news-category-options"
                value={newsForm.category}
                placeholder="选择已有分类或输入新分类"
                onChange={(event) => setNewsForm({ ...newsForm, category: event.target.value })}
              />
              <datalist id="news-category-options">
                {(categories.data ?? []).map((item) => (
                  <option key={item.key} value={item.name} />
                ))}
              </datalist>
              <span className="field-hint">
                新闻流的分类页签按 <span className="mono">campus_news.category</span> 名称筛选，新分类会在发布后出现。
              </span>
            </label>

            <label>
              <span className="label-sm">可见范围</span>
              <select
                className="field"
                value={newsForm.visibility}
                onChange={(event) => setNewsForm({ ...newsForm, visibility: event.target.value as NewsVisibility })}
              >
                {VISIBILITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="field-hint">下拉发出的就是后端枚举原值（campus / public / student…），不是中文标签。</span>
            </label>

            <label>
              <span className="label-sm">截止时间</span>
              <input
                className="field"
                type="datetime-local"
                value={newsForm.deadline}
                onChange={(event) => setNewsForm({ ...newsForm, deadline: event.target.value })}
              />
              <span className="field-hint">报名 / 办事截止时间，可空；编辑时清空即撤销截止时间。</span>
            </label>

            <div>
              <span className="label-sm">首页轮播</span>
              <label className="field-hint" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={newsForm.spotlight}
                  onChange={(event) => setNewsForm({ ...newsForm, spotlight: event.target.checked })}
                />
                设为首页轮播位（置顶展示）
              </label>
            </div>

            {newsTarget ? null : (
              <label>
                <span className="label-sm">发布方式</span>
                <Segmented
                  value={newsForm.status}
                  options={[
                    { value: 'published', label: '立即发布' },
                    { value: 'draft', label: '存为草稿' },
                  ]}
                  onChange={(value) => setNewsForm({ ...newsForm, status: value as 'draft' | 'published' })}
                />
                <span className="field-hint">发布时间由服务端在首次发布时写入，草稿上线时同理。</span>
              </label>
            )}

            <label className="span-2">
              <span className="label-sm">摘要</span>
              <textarea
                className="field"
                rows={2}
                value={newsForm.summary}
                placeholder="列表与详情页展示的摘要文案，可空"
                onChange={(event) => setNewsForm({ ...newsForm, summary: event.target.value })}
              />
            </label>

            <label className="span-2">
              <span className="label-sm">正文 *</span>
              <textarea
                className="field"
                rows={8}
                value={newsForm.content}
                placeholder="通知正文（必填）"
                onChange={(event) => setNewsForm({ ...newsForm, content: event.target.value })}
              />
              {newsTarget && (
                <span className="field-hint">
                  {newsTarget.content
                    ? '已回显当前正文；清空后保存不会清掉正文（后端正文为必填项）。'
                    : '列表接口未回传正文，无法回显 —— 留空 = 不修改正文，填入内容则整体替换。'}
                </span>
              )}
            </label>
          </div>

          {!newsTarget && (
            <div style={{ marginTop: 16 }}>
              <Notice tone="slate">
                发布即进入新闻流（学生端 <span className="mono">GET /news</span> 同源）；
                发布后仍可在下方列表「编辑 / 置顶 / 下线 / 删除」。封面待后端登记{' '}
                <span className="mono">news_cover</span> 上传用途后开放，本表单暂不含。
              </Notice>
            </div>
          )}
        </Drawer>
      )}
    </>
  )
}
