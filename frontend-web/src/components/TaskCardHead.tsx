import { Building2 } from 'lucide-react'
import type { TaskListItem } from '../types/api'

interface TaskCardHeadProps {
  task: TaskListItem
  /** 当前选中且未办结 —— 只影响标题字重，卡片描边与配色一律统一。 */
  expanded: boolean
  label: string
}

const pad = (value: number) => String(value).padStart(2, '0')

/** 2026-09-03 14:18；接口时间不可解析时给中性占位，不编造日期。 */
const display = (value?: string | null) => {
  if (!value) return '时间待定'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间待定'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 徽章只靠**圆点颜色**区分语义：胶囊本身的几何、底色、字重全部一致（见 tasks.css
    「统一胶囊」一节）。此前 待补充/进行中/已办结 分别是琥珀底、灰底、薄荷底 + 勾选图标，
    同屏看像三个不同组件。 */
const badgeTone = (status: TaskListItem['status']) =>
  status === 'material_required' ? 'warn'
    : status === 'completed' ? 'success'
      : status === 'cancelled' ? 'muted' : 'neutral'

/** 「办结用时」由 created_at → updated_at 推导；任一缺失或不可解析就不显示这一项。 */
const spentTime = (task: TaskListItem) => {
  if (task.status !== 'completed' || !task.created_at) return null
  const from = new Date(task.created_at).getTime()
  const to = new Date(task.updated_at).getTime()
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return null
  return `办结用时：${Math.max(1, Math.round((to - from) / 86400000))} 个工作日`
}

/** 卡头固定两行：第 1 行「标题 + 状态」，第 2 行「编号 / 发起时间 / 主办方」。
    两行之间不再夹任何浮层（此前右侧挂的「当前办理中」与状态徽章语义重复，已删）。 */
export function TaskCardHead({ task, expanded, label }: TaskCardHeadProps) {
  const org = task.responsible_organization?.name || '受理机构待分配'
  const done = task.status === 'completed'
  const spent = spentTime(task)

  return <div className={`task-card-head${expanded ? ' is-expanded' : ''}${done ? ' is-completed' : ''}`}>
    <div className="task-card-title">
      <div className="task-card-title-line">
        <h2>{task.title}</h2>
        <span className={`task-badge ${badgeTone(task.status)}`}>
          <i className="task-badge-dot" />
          {label}
        </span>
      </div>
      <p className="task-card-meta">
        <span className="task-card-no">#{task.task_no}</span>
        <span>{done ? '办结归档时间：' : '发起时间：'}{display(done ? task.updated_at : task.created_at || task.updated_at)}</span>
        {spent && <span>{spent}</span>}
        <span className="task-card-org"><Building2 size={12} />主办：{org}</span>
      </p>
    </div>
  </div>
}
