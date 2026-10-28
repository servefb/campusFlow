import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  X,
} from 'lucide-react'
import { Badge, Card, Drawer, EmptyState, Notice, PageHead, Pager, SkeletonRows, useCountUp } from '../components/ui'
import { useFileReviews } from '../hooks/queries'
import { apiBusinessCode, apiErrorMessage, makeIdempotencyKey } from '../services/http'
import { fileReviewStateOf, resolveFileReview, rescanFile } from '../services/fileReview'
import {
  FILE_REASON_CODE,
  FILE_REVIEW_STATE,
  MODERATION_LABEL,
  UPLOAD_PURPOSE,
  VIRUS_VERDICT,
} from '../design/semantics'
import { formatDuration, formatNumber, formatRelative, formatShortDateTime, humanFileSize } from '../utils/format'
import type {
  FileReviewAction,
  FileReviewItem,
  FileReviewState,
} from '../types/api'

/**
 * 内容审核 = **文件审核台**（用户 2026-10-15 拍板：审的是上传文件，不是智能体答复）。
 *
 * 数据是 `files` 表 + `files.scan_result`（json）：上传 → MIME 校验 → ClamAV 病毒扫描
 * → TMS 内容审核，审核器判不出结论的（needs_review / content_truncated）保持
 * scanning **转人工** —— 这页就是承接它们的管理台。原来的「答复复核」队列
 * （/admin/reviews）已从管理端撤除，后端接口闲置保留，见《接口对接说明.md》2.2。
 *
 * ⚠️ 后端还没有 /admin/files* 管理端接口（现只有 GET /files/{fileId} 单条查询），
 * 本页为契约草案预演：mock 全功能可评审，live 模式列表与处置会如实失败，
 * 顶部常驻预留说明 —— 明写预留，不发点下去才 404 的实心按钮。
 */

const PAGE_SIZE = 8

/** 概览行四态顺序：转人工排最前（唯一需要干预的格）。 */
const STATE_TABS: FileReviewState[] = ['manual', 'scanning', 'ready', 'rejected']

const STATE_SUB: Record<FileReviewState, string> = {
  manual: '审核器无定论 · 等待处置',
  scanning: '链路进行中 / 等补偿重投',
  ready: '链路放行或人工通过',
  rejected: '机审拦截或人工驳回',
}

const PURPOSE_OPTIONS = [
  { value: 'all', label: '全部用途' },
  { value: 'knowledge_doc', label: '知识库文档' },
  { value: 'task_material', label: '办事材料' },
  { value: 'avatar', label: '用户头像' },
]

/** 扩展名 → 行首图标。未登记的扩展名退回通用文档符号，不猜语义。 */
const fileIcon = (name: string) => {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return FileImage
  if (['xls', 'xlsx', 'csv'].includes(ext)) return FileSpreadsheet
  return FileText
}

const purposeLabel = (purpose: string) => UPLOAD_PURPOSE[purpose] ?? purpose

const reasonLabel = (code?: string) => (code ? (FILE_REASON_CODE[code]?.label ?? code) : null)

export function ContentAuditPage() {
  const queryClient = useQueryClient()
  const [state, setState] = useState<FileReviewState>('manual')
  const [purpose, setPurpose] = useState('all')
  const [page, setPage] = useState(1)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [feedbackTone, setFeedbackTone] = useState<'emerald' | 'amber' | 'coral'>('emerald')

  const list = useFileReviews({ state, purpose, page, page_size: PAGE_SIZE })

  /**
   * 概览行的四个读数：各开一个 `page_size: 1` 的查询，只取分页信封上的 total，
   * 不拉列表。与工作台读数带同一路数 —— 数字只能来自接口，四态没有汇总口径，
   * 就逐态问（两个请求都是轻请求，且与下方列表共享 ['file-reviews'] 失效前缀）。
   */
  const totals: Record<FileReviewState, number | undefined> = {
    manual: useFileReviews({ state: 'manual', page: 1, page_size: 1 }).data?.total,
    scanning: useFileReviews({ state: 'scanning', page: 1, page_size: 1 }).data?.total,
    ready: useFileReviews({ state: 'ready', page: 1, page_size: 1 }).data?.total,
    rejected: useFileReviews({ state: 'rejected', page: 1, page_size: 1 }).data?.total,
  }
  const anims = {
    manual: useCountUp(totals.manual ?? null),
    scanning: useCountUp(totals.scanning ?? null),
    ready: useCountUp(totals.ready ?? null),
    rejected: useCountUp(totals.rejected ?? null),
  }

  const items = list.data?.items ?? []
  // 详情直接取列表项（scan_result 随列表返回，不需要第二个接口）
  const active = activeId === null ? undefined : items.find((item) => item.id === activeId)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['file-reviews'] })

  const closeDrawer = () => setActiveId(null)

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true)
    setFeedback('')
    try {
      await action()
    } catch (error) {
      // 处置类写操作的报错分级沿用户页纪律：400（参数/状态不合法）走 amber，
      // 409（他人已处置 / 已放行）与 404 走 coral。
      setFeedbackTone(apiBusinessCode(error) === 400 ? 'amber' : 'coral')
      setFeedback(apiErrorMessage(error, '操作失败，请稍后重试'))
    } finally {
      setBusy(false)
    }
  }

  const handleResolve = (item: FileReviewItem, action: FileReviewAction) => {
    if (
      action === 'reject' &&
      !window.confirm(`确定驳回「${item.original_name}」？该文件将被阻断，用户侧不可引用。`)
    ) {
      return
    }
    void runAction(async () => {
      const result = await resolveFileReview(item.id, { action }, makeIdempotencyKey())
      setFeedbackTone('emerald')
      setFeedback(
        action === 'approve'
          ? `「${item.original_name}」已通过人工复核（状态 ${result.data.status}），处置留痕已写入。`
          : `「${item.original_name}」已驳回（状态 ${result.data.status}），用户侧不可再引用该文件。`,
      )
      await refresh()
      closeDrawer()
    })
  }

  const handleRescan = (item: FileReviewItem) => {
    void runAction(async () => {
      await rescanFile(item.id, makeIdempotencyKey())
      setFeedbackTone('emerald')
      setFeedback(`「${item.original_name}」已重新加入扫描队列，旧结论作废，完成后状态自动更新。`)
      await refresh()
      closeDrawer()
    })
  }

  return (
    <>
      <PageHead
        crumb="运行监控"
        title="内容审核"
        lede="上传文件的内容审核台：MIME 校验、病毒扫描与内容审核自动链路的结论与转人工处置队列，审核器判不出的件在这里等人裁决。"
        tools={
          <button className="btn btn-ghost btn-sm" onClick={refresh}>
            <RefreshCw size={14} /> 刷新队列
          </button>
        }
      />

      <Notice tone="amber" icon={<FlaskConical size={15} />}>
        <b>后端接口未提供，本页按契约草案预演</b> ——{' '}
        <code className="mono">GET /admin/files</code>、
        <code className="mono">POST /admin/files/&#123;id&#125;/resolve|rescan</code>{' '}
        已登记《接口对接说明》2.2 待后端实现。Mock 模式下全功能可评审；真实接口模式下列表与处置会如实失败。
      </Notice>

      {/*
        概览行四格本身就是页签 —— 点它就是切下方工作区的筛选（与知识治理同一语汇）。
        「转人工」是唯一需要干预的格子：非零时染风险色。
      */}
      <section className="stat-brief">
        {STATE_TABS.map((tab) => {
          const anim = anims[tab]
          const meta = FILE_REVIEW_STATE[tab]
          return (
            <button
              type="button"
              key={tab}
              className={`brief-cell${state === tab ? ' on' : ''}${
                tab === 'manual' && (totals.manual ?? 0) > 0 ? ' tone-coral' : ''
              }`}
              onClick={() => {
                setState(tab)
                setPage(1)
              }}
            >
              <span className="brief-label">{meta.label}</span>
              <span className="brief-num">
                {anim === null ? '—' : formatNumber(Math.round(anim))}
                <small>件</small>
              </span>
              <span className="brief-sub">{STATE_SUB[tab]}</span>
            </button>
          )
        })}
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
            <ShieldCheck size={15} /> 文件审核队列
          </>
        }
        sub={`当前：${FILE_REVIEW_STATE[state].label} · 按上传时间倒序`}
        extra={
          <span className="api-tag">
            <b>GET</b> /admin/files
          </span>
        }
      >
        <div className="filter-bar">
          <span className="hint">
            {state === 'manual'
              ? '这些文件自动链路给不出结论，补偿重投会跳过它们 —— 出路是人。'
              : state === 'ready'
                ? '已通过的文件为只读留档：链路放行或人工通过的记录都在这里。'
                : '按用途过滤；已驳回的文件可重新扫描，未决的件可直接处置。'}
          </span>
          <div className="toolbar-spacer" />
          <label className="inline-field">
            <span className="label-sm">文件用途</span>
            <select
              className="field"
              value={purpose}
              onChange={(event) => {
                setPurpose(event.target.value)
                setPage(1)
              }}
            >
              {PURPOSE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {list.isLoading && <SkeletonRows rows={5} />}
        {list.isSuccess && !items.length && (
          <EmptyState
            title={`暂无「${FILE_REVIEW_STATE[state].label}」的文件`}
            desc={
              state === 'manual'
                ? '自动审核链路没有积压待人工的件 —— 这通常说明一切正常，而不是列表坏了。'
                : '换一个状态页签或用途筛选后重试。'
            }
          />
        )}
        {list.isError && (
          <div style={{ padding: '16px 20px' }}>
            <Notice tone="coral">
              {apiErrorMessage(list.error, '文件审核列表请求失败')}
              ：文件审核接口后端尚未实现（契约见《接口对接说明》2.2），属于预留功能而非故障。
            </Notice>
          </div>
        )}

        {!!items.length && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>文件</th>
                  <th>用途</th>
                  <th className="num">大小</th>
                  <th>状态</th>
                  <th>审核结论</th>
                  <th>上传时间</th>
                  <th className="num">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const itemState = fileReviewStateOf(item)
                  const Icon = fileIcon(item.original_name)
                  return (
                    <tr key={item.id} onClick={() => setActiveId(item.id)} style={{ cursor: 'pointer' }}>
                      <td>
                        <div className="cell-file">
                          <span className="file-icon">
                            <Icon size={15} />
                          </span>
                          <div className="cell-stack">
                            <span className="t-title">{item.original_name}</span>
                            <span className="mono hint">#{item.id}</span>
                          </div>
                        </div>
                      </td>
                      <td>{purposeLabel(item.purpose)}</td>
                      <td className="num mono">{humanFileSize(item.size_bytes)}</td>
                      <td>
                        <Badge tone={FILE_REVIEW_STATE[itemState].tone} dot={itemState === 'manual'}>
                          {FILE_REVIEW_STATE[itemState].label}
                        </Badge>
                      </td>
                      <td>
                        <div className="cell-stack">
                          <span>{reasonLabel(item.scan_result?.reason_code) ?? '—'}</span>
                          {item.scan_result?.reason && <span className="hint">{item.scan_result.reason}</span>}
                        </div>
                      </td>
                      <td>
                        <div className="cell-stack">
                          <span className="mono">{formatShortDateTime(item.uploaded_at)}</span>
                          <span className="hint">{formatRelative(item.uploaded_at)}</span>
                        </div>
                      </td>
                      <td className="actions">
                        <button
                          className="act"
                          onClick={(event) => {
                            event.stopPropagation()
                            setActiveId(item.id)
                          }}
                        >
                          详情
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
            显示第 {items.length ? (page - 1) * PAGE_SIZE + 1 : 0} – {(page - 1) * PAGE_SIZE + items.length} 条，共{' '}
            {list.data?.total ?? 0} 条
          </span>
          <Pager page={page} pageSize={PAGE_SIZE} total={list.data?.total ?? 0} onChange={setPage} />
        </div>
      </Card>

      {active && (
        <Drawer
          open
          wide
          onClose={closeDrawer}
          title={
            <>
              <ScanSearch size={16} /> {active.original_name}
            </>
          }
          sub={`#${active.id} · ${purposeLabel(active.purpose)} · ${humanFileSize(active.size_bytes)}`}
          footer={<DrawerActions item={active} busy={busy} onResolve={handleResolve} onRescan={handleRescan} />}
        >
          <FileAuditDetail item={active} />
        </Drawer>
      )}
    </>
  )
}

/* ========================================================================== */
/* 详情抽屉                                                                    */
/* ========================================================================== */

type ScanResult = NonNullable<FileReviewItem['scan_result']>
type ModerationField = ScanResult['moderation']

function FileAuditDetail({ item }: { item: FileReviewItem }) {
  const scan = item.scan_result
  const itemState = fileReviewStateOf(item)
  return (
    <div className="file-detail">
      {/* 1. 基本档案 */}
      <section>
        <h3 className="detail-h3">
          <FileText size={14} /> 文件档案
        </h3>
        <dl className="spec-rows">
          <div>
            <dt>文件 ID</dt>
            <dd className="mono">#{item.id}</dd>
          </div>
          <div>
            <dt>声明类型 / 探测类型</dt>
            <dd className="mono">
              {scan?.mime ? `${scan.mime.declared || '—'} → ${scan.mime.detected || '—'}` : item.content_type}
            </dd>
          </div>
          <div>
            <dt>SHA-256</dt>
            <dd className="mono" title={item.sha256}>
              {item.sha256 ? `${item.sha256.slice(0, 24)}…` : '—'}
            </dd>
          </div>
          <div>
            <dt>上传时间</dt>
            <dd className="mono">{formatShortDateTime(item.uploaded_at)}</dd>
          </div>
        </dl>
      </section>

      {/* 2. 当前结论 */}
      <section>
        <h3 className="detail-h3">
          <ShieldCheck size={14} /> 当前结论
        </h3>
        <div className={`conclusion-block${item.status === 'rejected' ? ' is-bad' : ''}`}>
          <div className="conclusion-head">
            <Badge tone={FILE_REVIEW_STATE[itemState].tone}>{FILE_REVIEW_STATE[itemState].label}</Badge>
            {reasonLabel(scan?.reason_code) && <b className="mono">{reasonLabel(scan?.reason_code)}</b>}
          </div>
          <p>
            {scan?.reason ??
              (item.status === 'ready'
                ? '链路各段全部通过，自动放行（ready 不写结论码，属正常）。'
                : '扫描结论未回传。')}
          </p>
          {(scan?.scanned_at || scan?.compensation) && (
            <p className="hint">
              {scan?.scanned_at && <>最近扫描 {formatShortDateTime(scan.scanned_at)}</>}
              {scan?.duration_ms != null && <> · 耗时 {formatDuration(scan.duration_ms)}</>}
              {scan?.compensation && (
                <>
                  {' '}
                  · 已补偿重投 {scan.compensation.attempts} 次（最近{' '}
                  {formatRelative(scan.compensation.last_attempt_at)}）
                </>
              )}
            </p>
          )}
          {scan?.manual && (
            <p className="hint">
              人工处置：{scan.manual.action === 'approve' ? '通过' : '驳回'} · {scan.manual.by} ·{' '}
              {formatShortDateTime(scan.manual.at)}
              {scan.manual.comment ? ` · ${scan.manual.comment}` : ''}
            </p>
          )}
        </div>
      </section>

      {/* 3. 扫描链路三段 */}
      <section>
        <h3 className="detail-h3">
          <ScanSearch size={14} /> 扫描链路明细
        </h3>
        {!scan ? (
          <Notice tone="amber">
            <b>scan_result 未回传</b>
            <p style={{ margin: '6px 0 0' }}>该文件还没有任何扫描记录（可能尚未进入扫描队列）。</p>
          </Notice>
        ) : (
          <div className="scan-steps">
            <ScanStep
              title="① MIME 校验"
              badge={
                scan.mime ? (
                  <Badge tone={scan.mime.matched ? 'emerald' : 'coral'}>
                    {scan.mime.matched ? '命中白名单' : '不符'}
                  </Badge>
                ) : (
                  <Badge tone="slate">未回传</Badge>
                )
              }
              body={
                scan.mime
                  ? `声明 ${scan.mime.declared || '—'} · 探测 ${scan.mime.detected || '—'}`
                  : '本段记录未回传'
              }
            />
            <ScanStep
              title="② 病毒扫描"
              badge={
                <Badge tone={VIRUS_VERDICT[scan.virus?.verdict ?? '']?.tone ?? 'slate'}>
                  {VIRUS_VERDICT[scan.virus?.verdict ?? '']?.label ?? scan.virus?.verdict ?? '未回传'}
                </Badge>
              }
              body={
                scan.virus
                  ? `引擎 ${scan.virus.engine || '—'}${scan.virus.signature ? ` · 特征 ${scan.virus.signature}` : ''}${
                      scan.virus.detail ? ` · ${scan.virus.detail}` : ''
                    }`
                  : '本段记录未回传'
              }
            />
            <ScanStep title="③ 内容审核" badge={moderationBadge(scan.moderation)} body={moderationBody(scan.moderation)} />
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * moderation 字段是双形状：步骤数组（审了）或 {skipped, reason}（没审）。
 * 🔴 「没审」不是「通过」—— 后端刻意不给 skipped 写 passed:true，这里同样不给它绿色。
 */
function moderationBadge(moderation: ModerationField) {
  if (!moderation) return <Badge tone="slate">未回传</Badge>
  if (Array.isArray(moderation)) {
    const failed = moderation.find((step) => !step.passed)
    if (failed) {
      const meta = MODERATION_LABEL[failed.label] ?? { tone: 'coral' as const, label: failed.label }
      return <Badge tone={meta.tone}>{meta.label}</Badge>
    }
    return <Badge tone="emerald">通过</Badge>
  }
  return <Badge tone="amber">未审核</Badge>
}

function moderationBody(moderation: ModerationField) {
  if (!moderation) return '本段记录未回传'
  if (Array.isArray(moderation)) {
    return moderation
      .map((step) => {
        const meta = MODERATION_LABEL[step.label]
        return `${step.engine || '审核器'}：${meta?.label ?? step.label}${step.reason ? ` · ${step.reason}` : ''}`
      })
      .join('\n')
  }
  return moderation.reason
}

function ScanStep({ title, badge, body }: { title: string; badge: ReactNode; body: string }) {
  return (
    <div className="scan-step">
      <div className="scan-step-head">
        <b>{title}</b>
        {badge}
      </div>
      <p>{body}</p>
    </div>
  )
}

/** 抽屉脚注按钮按状态出：manual 三键全开；rejected/scanning 只有重扫；ready 只读 + 改判。 */
function DrawerActions({
  item,
  busy,
  onResolve,
  onRescan,
}: {
  item: FileReviewItem
  busy: boolean
  onResolve: (item: FileReviewItem, action: FileReviewAction) => void
  onRescan: (item: FileReviewItem) => void
}) {
  const itemState = fileReviewStateOf(item)
  if (itemState === 'ready') {
    return (
      <>
        <span className="hint">已通过（{item.scan_result?.manual ? '人工放行' : '链路放行'}），只读留档</span>
        <div className="toolbar-spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => onResolve(item, 'reject')} disabled={busy}>
          <X size={14} /> 改判驳回
        </button>
      </>
    )
  }
  if (itemState === 'manual') {
    return (
      <>
        <button className="btn btn-emerald" disabled={busy} onClick={() => onResolve(item, 'approve')}>
          <CheckCircle2 size={15} /> 通过（放行文件）
        </button>
        <button className="btn btn-danger" disabled={busy} onClick={() => onResolve(item, 'reject')}>
          <X size={15} /> 驳回（阻断文件）
        </button>
        <div className="toolbar-spacer" />
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onRescan(item)} title="重新走一遍自动链路">
          <RotateCcw size={14} /> 重新扫描
        </button>
      </>
    )
  }
  return (
    <>
      <span className="hint">{itemState === 'rejected' ? '已驳回 · ' : '扫描进行中 · '}可重新入队</span>
      <div className="toolbar-spacer" />
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onRescan(item)}>
        <RotateCcw size={14} /> 重新扫描
      </button>
    </>
  )
}
