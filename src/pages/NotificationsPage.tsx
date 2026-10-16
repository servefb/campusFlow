import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BellRing, Clock, FlaskConical, Megaphone, Undo2 } from 'lucide-react'
import {
  Badge,
  Card,
  Drawer,
  EmptyState,
  Notice,
  PageHead,
  Pager,
  SkeletonRows,
} from '../components/ui'
import { useAdminNotifications } from '../hooks/queries'
import { apiErrorMessage } from '../services/http'
import { publishNotification, revokeNotification } from '../services/notifications'
import { formatNumber, formatRelative, formatShortDateTime } from '../utils/format'
import type { AdminNotification, AdminNotificationType } from '../types/api'

/**
 * 通知推送 —— 管理端向全校发布站内广播通知。
 *
 * 🔴 与「新闻治理」的发布是两回事：
 *   · 新闻治理发的是校园新闻流（campus_news，学生端首页可见）；
 *   · 本页发的是**站内通知**（notifications 表广播行），落进每个学生的通知中心。
 *
 * ⚠️ 后端目前没有 /admin/notifications 接口（学生端读取也是 2026-10-09 刚在补），
 * 本页为契约占位：mock 模式下全功能可评审；live 模式接口未落地前请求会如实失败，
 * 顶部有预留说明。契约草案见《接口对接说明.md》2.7。
 *
 * 发布对象语义（用户拍板）：**没有 user_id 的通知 = 全员可见**，不做按人 fan-out。
 */

const PAGE_SIZE = 8

const TYPE_OPTIONS: Array<{ value: AdminNotificationType; label: string }> = [
  { value: 'announcement', label: '公告（发给全校）' },
  { value: 'system', label: '系统通知（维护/升级）' },
]

const typeLabel = (type: string) =>
  TYPE_OPTIONS.find((option) => option.value === type)?.label ?? (type || '—')

interface NotificationFormDraft {
  title: string
  content: string
  type: AdminNotificationType
  actionUrl: string
  expiresAt: string
}

const emptyDraft = (): NotificationFormDraft => ({
  title: '',
  content: '',
  type: 'announcement',
  actionUrl: '',
  expiresAt: '',
})

/** datetime-local 值 → 契约 `yyyy-MM-dd HH:mm:ss`。 */
const expiresToWire = (value: string) =>
  value ? `${value.replace('T', ' ')}${value.length === 16 ? ':00' : ''}` : ''

export function NotificationsPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [form, setForm] = useState<NotificationFormDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [feedback, setFeedback] = useState('')
  const [feedbackTone, setFeedbackTone] = useState<'emerald' | 'amber' | 'coral'>('amber')

  const list = useAdminNotifications({ page, page_size: PAGE_SIZE })
  const items = list.data?.items ?? []

  // 概览读数只从列表真数据算（契约第 5 条：不许有接口外的数字）
  const total = list.data?.total
  const activeCount = items.filter((item) => !item.expires_at || Date.parse(item.expires_at) > Date.now()).length
  const expiredCount = items.filter((item) => !!item.expires_at && Date.parse(item.expires_at) <= Date.now()).length
  const latest = items[0]

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-notifications'] })

  const submit = async () => {
    if (!form) return
    const title = form.title.trim()
    const content = form.content.trim()
    if (!title || !content) {
      setFeedbackTone('coral')
      setFeedback('标题和正文都是必填项。')
      return
    }
    setSaving(true)
    setFeedback('')
    try {
      const result = await publishNotification({
        title,
        content,
        notification_type: form.type,
        action_url: form.actionUrl.trim() || undefined,
        expires_at: form.expiresAt ? expiresToWire(form.expiresAt) : undefined,
      })
      setFeedbackTone('emerald')
      setFeedback(
        `通知「${title}」已发布（id ${result.data.id}），全员广播行已生成，学生端通知中心可见` +
          `${result.data.expires_at ? `，过期时间 ${formatShortDateTime(result.data.expires_at)}` : '，长期有效'}。`,
      )
      setForm(null)
      await refresh()
    } catch (error) {
      setFeedbackTone('coral')
      setFeedback(apiErrorMessage(error, '发布失败'))
    } finally {
      setSaving(false)
    }
  }

  const revoke = async (item: AdminNotification) => {
    if (!window.confirm(`确定撤回「${item.title}」？撤回后学生端立即不可见。`)) return
    setBusyId(item.id)
    setFeedback('')
    try {
      await revokeNotification(item.id)
      setFeedbackTone('emerald')
      setFeedback(`「${item.title}」已撤回。`)
      await refresh()
    } catch (error) {
      setFeedbackTone('coral')
      setFeedback(apiErrorMessage(error, '撤回失败'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <PageHead
        crumb="平台管理"
        title="通知推送"
        lede="向全校发布站内广播通知，学生在通知中心查看。与「新闻治理」的校园新闻流是两条通道：新闻上首页，通知进收件箱。"
        tools={
          <button className="btn btn-primary btn-sm" onClick={() => { setForm(emptyDraft()); setFeedback('') }}>
            <Megaphone size={14} /> 发布通知
          </button>
        }
      />

      {/*
        后端接口未提供（学生端通知模块 2026-10-09 正在补），按系统设置页同款「预留」处理：
        mock 模式全功能可评审，live 模式请求会如实失败 —— 明写预留，不发点下去才 404 的实心按钮。
      */}
      <Notice tone="amber" icon={<FlaskConical size={15} />}>
        <b>后端接口未提供，本页按契约草案预演</b> ——{' '}
        <code className="mono">GET/POST/DELETE /admin/notifications</code> 已登记《接口对接说明》2.7 待后端实现。
        Mock 模式下全功能可评审；真实接口模式下发布/撤回会如实失败。广播语义：<b>没有 user_id 的通知 = 全员可见</b>。
      </Notice>

      <section className="stat-brief">
        <div className="brief-cell">
          <span className="brief-label">累计广播</span>
          <span className="brief-num">
            {formatNumber(total)}
            <small>条</small>
          </span>
          <span className="brief-sub">{list.data ? '全员可见的站内通知' : '等待 /admin/notifications'}</span>
        </div>
        <div className="brief-cell">
          <span className="brief-label">进行中</span>
          <span className="brief-num">
            {list.data ? formatNumber(activeCount) : '—'}
            <small>条</small>
          </span>
          <span className="brief-sub">未过期、学生端可见</span>
        </div>
        <div className="brief-cell">
          <span className="brief-label">已过期</span>
          <span className="brief-num">
            {list.data ? formatNumber(expiredCount) : '—'}
            <small>条</small>
          </span>
          <span className="brief-sub">超过过期时间，不再展示</span>
        </div>
        <div className="brief-cell">
          <span className="brief-label">最近发布</span>
          <span className="brief-num">{latest ? formatRelative(latest.created_at) : '—'}</span>
          <span className="brief-sub">{latest ? latest.title : '暂无广播'}</span>
        </div>
      </section>

      {feedback && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone={feedbackTone}>{feedback}</Notice>
        </div>
      )}

      <Card
        pad={false}
        title={
          <>
            <BellRing size={15} /> 已发布的广播
          </>
        }
        sub="按发布时间倒序；撤回是物理删除，学生端立即不可见。"
        extra={
          <span className="api-tag">
            <b>GET</b> /admin/notifications
          </span>
        }
      >
        {list.isLoading && <SkeletonRows rows={4} />}
        {list.isSuccess && !items.length && (
          <EmptyState
            title="还没有发布过广播通知"
            desc="点右上角「发布通知」发出第一条全校通知。"
          />
        )}
        {list.isError && (
          <div style={{ padding: '16px 20px' }}>
            <Notice tone="coral">
              {apiErrorMessage(list.error, '通知接口请求失败')}
              ：管理端通知接口后端尚未实现（契约见《接口对接说明》2.7），属于预留功能而非故障。
            </Notice>
          </div>
        )}
        {!!items.length && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 34 }} />
                  <th>标题 / 正文</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>发布时间</th>
                  <th>过期时间</th>
                  <th className="num">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const expired = !!item.expires_at && Date.parse(item.expires_at) <= Date.now()
                  return (
                    <tr key={item.id}>
                      <td>
                        <span className="row-icon">
                          <BellRing size={13} />
                        </span>
                      </td>
                      <td>
                        <div className="cell-stack">
                          <span className="t-title">{item.title}</span>
                          <span className="hint">{item.content}</span>
                        </div>
                      </td>
                      <td>
                        <Badge tone={item.notification_type === 'system' ? 'slate' : 'emerald'}>
                          {typeLabel(item.notification_type)}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone={expired ? 'slate' : 'ink'} dot={!expired}>
                          {expired ? '已过期' : '进行中'}
                        </Badge>
                      </td>
                      <td>
                        <div className="cell-stack">
                          <span className="mono">{formatShortDateTime(item.created_at)}</span>
                          <span className="mono hint">#{item.id}</span>
                        </div>
                      </td>
                      <td>
                        {item.expires_at ? (
                          <div className="cell-stack">
                            <span className="mono">{formatShortDateTime(item.expires_at)}</span>
                            <span className="hint">
                              <Clock size={11} style={{ verticalAlign: -1 }} /> {expired ? '已截止展示' : '此前可见'}
                            </span>
                          </div>
                        ) : (
                          <span className="hint">长期有效</span>
                        )}
                      </td>
                      <td className="actions">
                        <button
                          className="act"
                          disabled={busyId === item.id}
                          title="撤回后学生端立即不可见"
                          onClick={() => void revoke(item)}
                        >
                          <Undo2 size={13} /> {busyId === item.id ? '撤回中…' : '撤回'}
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
            显示第 {items.length ? (page - 1) * PAGE_SIZE + 1 : 0} –{' '}
            {(page - 1) * PAGE_SIZE + items.length} 条，共 {total ?? 0} 条广播
          </span>
          <Pager page={page} pageSize={PAGE_SIZE} total={total ?? 0} onChange={setPage} />
        </div>
      </Card>

      {form && (
        <Drawer
          open
          wide
          title={
            <>
              <Megaphone size={15} /> 发布通知
            </>
          }
          sub="全员广播：生成一条不归属具体用户的 notifications 行，学生端通知中心可见。"
          onClose={() => setForm(null)}
          footer={
            <>
              <span className="api-tag">
                <b>POST</b> /admin/notifications
              </span>
              <div className="toolbar-spacer" />
              <button className="btn btn-ghost btn-sm" onClick={() => setForm(null)} disabled={saving}>
                取消
              </button>
              <button className="btn btn-primary btn-sm" onClick={submit} disabled={saving}>
                {saving ? '发布中…' : '发布'}
              </button>
            </>
          }
        >
          <div className="form-grid">
            <label className="span-2">
              <span className="label-sm">标题 *</span>
              <input
                className="field"
                value={form.title}
                placeholder="例如：关于校园网升级维护的通知"
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>

            <label>
              <span className="label-sm">通知类型</span>
              <select
                className="field"
                value={form.type}
                onChange={(event) => setForm({ ...form, type: event.target.value as AdminNotificationType })}
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="field-hint">两个取值已登记契约草案，待后端确认后写进枚举表。</span>
            </label>

            <label>
              <span className="label-sm">过期时间</span>
              <input
                className="field"
                type="datetime-local"
                value={form.expiresAt}
                onChange={(event) => setForm({ ...form, expiresAt: event.target.value })}
              />
              <span className="field-hint">过期后学生端不再展示；留空 = 长期有效。</span>
            </label>

            <label className="span-2">
              <span className="label-sm">正文 *</span>
              <textarea
                className="field"
                rows={6}
                value={form.content}
                placeholder="通知正文（必填）"
                onChange={(event) => setForm({ ...form, content: event.target.value })}
              />
            </label>

            <label className="span-2">
              <span className="label-sm">跳转地址</span>
              <input
                className="field"
                value={form.actionUrl}
                placeholder="例如 /service-hall，点击通知后跳转；可空"
                onChange={(event) => setForm({ ...form, actionUrl: event.target.value })}
              />
              <span className="field-hint">落 notifications.action_url，学生端点击通知时使用。</span>
            </label>
          </div>

          <div style={{ marginTop: 16 }}>
            <Notice tone="slate">
              发布时间由服务端写入（<span className="mono">created_at</span>），前端不传；
              广播行全员共享，<span className="mono">is_read</span> 无法按人记录 —— 已读语义待后端定（见 2.7）。
            </Notice>
          </div>
        </Drawer>
      )}
    </>
  )
}
