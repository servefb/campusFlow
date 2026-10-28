import { useEffect, useRef, useState } from 'react'
import { Building2, CheckCircle2, ChevronRight, CircleAlert, Clock3, MoreHorizontal, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { TaskFlow } from '../components/TaskFlow'
import { TaskCardHead } from '../components/TaskCardHead'
import { TaskWorkbench } from '../components/TaskWorkbench'
import { TaskCreateFab } from '../components/TaskCreateFab'
import { TaskCreateModal } from '../components/TaskCreateModal'
import { apiErrorMessage } from '../services/http'
import { getTask, getTaskReceiptDownloadUrl, getTaskRequirements, getTaskSummary, getTasks, saveTaskDraft, submitTask } from '../services/tasks'
import type { TaskCreated, TaskDetail, TaskListItem, TaskRequirement, TaskStatus, TaskSummary } from '../types/api'
import { computeTaskProgress } from '../utils/taskProgress'
import { resolveDue } from '../utils/taskSchedule'

type Filter = 'all' | TaskStatus

/** 状态文案：与后端 TaskStatus 一一对应，不要在这里写死演示数据。 */
const labels: Record<TaskStatus, string> = { draft: '草稿', in_progress: '进行中', material_required: '等待补充材料', under_review: '学院审核中', completed: '已办结', cancelled: '已取消' }

/** 顶部筛选：顺序与文案对齐设计稿；计数来自 GET /tasks/summary。 */
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'material_required', label: '待补充' },
  { value: 'in_progress', label: '进行中' },
  { value: 'completed', label: '已办结' },
]

const pad = (value: number) => String(value).padStart(2, '0')

/** 统一的时间显示：2026-09-03 14:18（接口返回 ISO 字符串，解析失败时给中性占位）。 */
const date = (value?: string | null) => {
  if (!value) return '时间待定'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '时间待定'
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

/**
 * 左侧红色竖条 = 「异常 / 已截止」的唯一表达：
 *   · 状态是 material_required（等本人补材料）；
 *   · 或当前步骤的 due_at 已超期 —— 时限藏在步骤里、列表接口不返回，
 *     只能借展开卡片那份详情判断（detail 必须确实属于这张卡）。
 * 选中态不再用红色，也不再加深色描边（见 tasks.css）。
 */
const isAlertTask = (task: TaskListItem, detail: TaskDetail | null) => {
  if (task.status === 'material_required') return true
  if (!detail || String(detail.id) !== String(task.id)) return false
  return detail.steps.some((step) => step.status === 'active' && resolveDue(step.due_at)?.overdue === true)
}

export function TasksPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const [tasks, setTasks] = useState<TaskListItem[]>([])
  const [summary, setSummary] = useState<TaskSummary | null>(null)
  const [selectedId, setSelectedId] = useState<string | number>()
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [requirements, setRequirements] = useState<TaskRequirement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [requirementsVersion, setRequirementsVersion] = useState(0)
  const [message, setMessage] = useState('')
  const [syncedAt, setSyncedAt] = useState<number>()
  /** 「发起办事流程」弹窗；创建成功后用它刷新列表。 */
  const [createOpen, setCreateOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  /** 新建的任务要在列表回来后自动选中 —— 用 ref 传，避免进请求依赖导致死循环。 */
  const pendingSelectRef = useRef<string | number | undefined>(undefined)
  /** 让「同步于 N 分钟前」自己走字，而不是永远停在打开页面那一刻。 */
  const [, tickClock] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => tickClock((value) => value + 1), 30000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let stop = false
    setLoading(true)
    getTasks({ status: filter === 'all' ? undefined : filter, page: 1, page_size: 20, sort: false })
      .then(({ data }) => {
        if (stop) return
        const body = data.data as { items?: TaskListItem[]; item?: TaskListItem[] }
        const next = body.items ?? body.item ?? []
        setTasks(next)
        // 刚创建的任务优先选中；否则保持当前选中项（仍存在时），最后才退回第一条。
        const pending = pendingSelectRef.current
        pendingSelectRef.current = undefined
        setSelectedId((current) => {
          if (pending !== undefined && next.some((t) => String(t.id) === String(pending))) return pending
          if (current !== undefined && next.some((t) => String(t.id) === String(current))) return current
          return next[0]?.id
        })
        setSyncedAt(Date.now())
      })
      .catch((e) => {
        if (!stop) { setTasks([]); setError(apiErrorMessage(e, '任务数据加载失败，请稍后重试')) }
      })
      .finally(() => { if (!stop) setLoading(false) })
    getTaskSummary()
      .then(({ data }) => { if (!stop) setSummary(data.data) })
      .catch(() => { if (!stop) setSummary(null) })
    return () => { stop = true }
  }, [filter, refreshKey])

  useEffect(() => {
    if (selectedId === undefined) return
    let stop = false
    Promise.all([getTask(selectedId), getTaskRequirements(selectedId)])
      .then(([d, r]) => { if (!stop) { setDetail(d.data.data); setRequirements(r.data.data.items || []) } })
      .catch(() => { if (!stop) { setDetail(null); setRequirements([]) } })
    return () => { stop = true }
  }, [selectedId, requirementsVersion])

  const selected = tasks.find((t) => String(t.id) === String(selectedId)) || null
  const count = (key: keyof TaskSummary) => summary?.[key] ?? 0
  const missing = requirements.filter((r) => r.status === 'missing')
  const syncText = syncedAt === undefined ? '同步中' : (() => {
    const minutes = Math.floor((Date.now() - syncedAt) / 60000)
    return minutes < 1 ? '刚刚同步' : `${minutes} 分钟前同步`
  })()

  const save = async () => {
    if (!selected || !detail) return
    try { await saveTaskDraft(selected.id, { form_data: detail.form_data, version: detail.version }); setMessage('草稿已保存') }
    catch (e) { setMessage(apiErrorMessage(e, '保存失败')) }
  }
  const submit = async () => {
    if (!selected || !detail) return
    try {
      await submitTask(selected.id, { version: detail.version, confirm: true })
      // 与「材料已上传成功」区分开：这里才是真正提交成功。
      setMessage(selected.status === 'material_required' ? '补充材料已提交，等待学院复核' : '已提交，等待学院审核')
    }
    catch (e) { setMessage(apiErrorMessage(e, '提交失败')) }
  }

  /** 办结回执下载：先取短时效 download_url，再由浏览器打开下载（按卡片自身 id，不依赖选中态）。 */
  const [receiptBusyId, setReceiptBusyId] = useState<string | number>()
  const downloadReceipt = async (taskId: string | number) => {
    if (receiptBusyId !== undefined) return
    setReceiptBusyId(taskId)
    try {
      const { data } = await getTaskReceiptDownloadUrl(taskId)
      const { download_url: url, filename } = data.data
      if (!url) { setMessage('接口未返回回执下载地址'); return }
      window.open(url, '_blank', 'noopener,noreferrer')
      setMessage(filename ? `回执已开始下载：${filename}` : '回执已开始下载')
    } catch (e) {
      setMessage(apiErrorMessage(e, '获取回执下载地址失败'))
    } finally {
      setReceiptBusyId(undefined)
    }
  }

  /**
   * 发起办事流程成功后：关弹窗、提示、刷新列表并选中新任务。
   * 新任务是 draft，当前筛选若不是「全部」会看不见它 —— 顺手切回「全部」。
   */
  const handleCreated = (task: TaskCreated, note: string) => {
    setCreateOpen(false)
    setMessage(note)
    pendingSelectRef.current = task.id
    if (filter !== 'all') setFilter('all')
    setRefreshKey((value) => value + 1)
  }

  return <section className="page wide-page tasks-page">
    <div className="task-page-heading">
      <div className="task-heading-main">
        <div className="task-title-group">
          <p className="eyebrow">TASK CENTER</p>
          <div className="task-title-line">
            <h1>我的任务中心</h1>
            {summary && <div className="task-summary-pills">
              <span className="task-pill warn"><i className="task-pill-dot ping" />{count('material_required')} 项等待材料补充</span>
              <span className="task-pill neutral"><i className="task-pill-dot" />{count('under_review')} 项学院审核中</span>
              <span className="task-pill success"><i className="task-pill-dot" />{count('completed')} 项已办结</span>
            </div>}
          </div>
        </div>
      </div>
    </div>

    <div className="task-filter-bar">
      <div className="task-filter-group">
        {FILTERS.map((item) => {
          const active = filter === item.value
          const total = count(item.value === 'all' ? 'all' : item.value as keyof TaskSummary)
          return <button type="button" key={item.value} className={`task-filter${active ? ' active' : ''}`} onClick={() => setFilter(item.value)}>
            {item.label}
            {item.value === 'material_required' && <i className="task-filter-dot" />}
            <span className="task-filter-count">({total})</span>
          </button>
        })}
      </div>
      <p className="task-sync-note">
        <RefreshCw size={14} />
        {syncText}
      </p>
    </div>

    {loading
      ? <div className="task-empty-state">正在读取任务数据...</div>
      : error
        ? <div className="task-empty-state"><CircleAlert size={28} /><h2>任务暂时无法加载</h2><p>{error}</p></div>
        : <div className="task-layout">
          <div className="task-list">
            {tasks.map((task) => {
              const isSelected = String(task.id) === String(selectedId)
              const expanded = isSelected && task.status !== 'completed'
              const org = task.responsible_organization?.name || '受理机构待分配'
              const progress = computeTaskProgress(task)
              const alert = isAlertTask(task, expanded ? detail : null)
              return <article
                className={`task-card task-status-${task.status}${isSelected ? ' selected' : ''}${alert ? ' is-alert' : ''}`}
                key={task.id}
                onClick={() => setSelectedId(task.id)}
              >
                <TaskCardHead task={task} expanded={expanded} label={labels[task.status]} />
                {expanded
                  ? <TaskFlow taskId={task.id} detail={detail} taskStatus={task.status} missingMaterial={String(missing[0]?.name || '')} />
                  : task.status === 'in_progress' || task.status === 'under_review'
                    ? <div className="task-card-progress">
                      <div className="task-card-menu" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="task-menu-trigger" aria-label="更多操作" title="更多操作"><MoreHorizontal size={15} /></button>
                        <div className="task-menu-pop">
                          <button type="button" onClick={() => setSelectedId(task.id)}>查看办理详情</button>
                          <button type="button" onClick={() => navigate('/workspace')}>向助手催办</button>
                        </div>
                      </div>
                      <div className="task-progress-head">
                        <span>当前流程节点：{task.current_step || '等待流程推进'}</span>
                        {progress !== null && (
                          <small>
                            进度 {progress}%
                            {typeof task.current_step_order === 'number' && typeof task.total_steps === 'number' && ` · 第 ${task.current_step_order}/${task.total_steps} 步`}
                          </small>
                        )}
                      </div>
                      {progress !== null && <div className="task-progress-track"><i style={{ width: `${progress}%` }} /></div>}
                      <div className="task-progress-foot">
                        <span>主办：{org}</span>
                        <span>最近更新：{date(task.updated_at)}</span>
                      </div>
                    </div>
                    : task.status === 'completed'
                      ? <div className="task-card-result">
                        <span><CheckCircle2 size={14} /> 已生成带有校务公章与电子防伪码的办结凭证</span>
                        <button type="button" disabled={receiptBusyId === task.id} onClick={(e) => { e.stopPropagation(); void downloadReceipt(task.id) }}>
                          官方回执与电子凭证 PDF <ChevronRight size={13} />
                        </button>
                      </div>
                      : <div className="task-card-default">
                        <span>{task.current_step || '等待流程推进'}</span>
                        <span><Clock3 size={13} />{date(task.updated_at)}</span>
                      </div>}
              </article>
            })}
            {tasks.length === 0 && <div className="task-no-results"><Building2 size={26} /><p>当前筛选条件下没有任务</p></div>}
          </div>
          <aside className="task-detail">
            {selected && <TaskWorkbench
              task={selected}
              detail={detail}
              requirements={requirements}
              message={message}
              onSave={save}
              onSubmit={submit}
              onUrge={() => navigate('/workspace')}
              /* 延期没有后端接口（services/tasks.ts 只到 submit）—— 不假装成功：
                 把请求交给助手对话，带上任务号与当前步骤，用户在对话里补一句就能提交申请。
                 与 /workspace 的「提问即开新会话」是同一条既有链路（state.question）。 */
              onExtend={() => navigate('/conversations/new', {
                state: {
                  question: `任务 #${selected.task_no}《${selected.title}》当前步骤已过截止时间，请协助我提交延期申请。`,
                  agentMode: 'auto',
                },
              })}
              onMessage={setMessage}
              onMaterialUploaded={() => setRequirementsVersion((v) => v + 1)}
            />}
          </aside>
        </div>}

    <TaskCreateFab onOpen={() => setCreateOpen(true)} />
    <TaskCreateModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleCreated} />
  </section>
}
