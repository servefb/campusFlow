import { useState } from 'react'
import { Check, ChevronRight, Clock3 } from 'lucide-react'
import { apiErrorMessage } from '../services/http'
import { getTaskTimeline } from '../services/tasks'
import { resolveDue } from '../utils/taskSchedule'
import type { DueInfo } from '../utils/taskSchedule'
import type { TaskDetail, TaskStatus } from '../types/api'

interface TaskFlowProps {
  /** 流转日志按任务维度拉取：GET /tasks/{task_id}/timeline。 */
  taskId: string | number
  detail: TaskDetail | null
  taskStatus: TaskStatus
  missingMaterial?: string
}

interface TimelineEntry {
  id?: unknown
  type?: unknown
  title?: unknown
  operator?: unknown
  created_at?: unknown
}

const stepTime = (value?: string | null) => {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

/** 流转日志接口的条目字段按 unknown 兜底，非字符串一律渲染为空。 */
const readText = (value: unknown) => (typeof value === 'string' ? value : '')

/** 「已截止 / 已超时」这两个词此刻就在步骤标题右侧的胶囊里，正文不必再说一遍，
    只留后果：需申请延期 / 仍可补交。（右侧工作台用的仍是完整句子，不在这里截。） */
const consequenceOf = (limit: DueInfo) =>
  limit.text && limit.consequence.startsWith(limit.text)
    ? limit.consequence.slice(limit.text.length).replace(/^[，,、\s]+/, '')
    : limit.consequence

export function TaskFlow({ taskId, detail, taskStatus, missingMaterial }: TaskFlowProps) {
  const steps = detail?.steps ?? []
  /** 默认只摊开**当前节点**这一条（2026-09-15 压缩左列）：此前是「当前 + 下一步」，再叠上
      卡头的标题/元信息与材料提示、截止时间，第一张卡比其它卡高出一大截，而右侧工作台
      又把同一批信息讲了一遍。现在左列只回答「现在卡在哪一步、什么时候截止」，
      整条流程交给头部的「查看流程」。 */
  const activeIndex = steps.findIndex((step) => step.status === 'active')
  /** 没有显式 active（草稿 / 步骤尚未推进）时退到第一步，窗口逻辑保持一致。 */
  const focus = activeIndex >= 0 ? activeIndex : 0
  const [showAll, setShowAll] = useState(false)
  /** ≤2 步没有折叠的意义，直接全展开。 */
  const collapsible = steps.length > 2
  const shown = !collapsible || showAll ? steps : steps.filter((_, index) => index === focus)
  const hiddenBefore = shown.length ? steps.indexOf(shown[0]) : 0

  /** 「查看全流程流转日志」：首次展开时拉 GET /tasks/{id}/timeline，之后本地缓存、只做开合。 */
  const [log, setLog] = useState<{ open: boolean; loading: boolean; error: string; items: TimelineEntry[] }>({ open: false, loading: false, error: '', items: [] })

  const toggleLog = async () => {
    if (log.open) { setLog((s) => ({ ...s, open: false })); return }
    setLog((s) => ({ ...s, open: true, loading: !s.items.length, error: '' }))
    if (log.items.length) return
    try {
      const { data } = await getTaskTimeline(taskId)
      const items = data.data.items
      setLog({ open: true, loading: false, error: '', items: Array.isArray(items) ? items : [] })
    } catch (e) {
      setLog((s) => ({ ...s, open: true, loading: false, error: apiErrorMessage(e, '流转日志加载失败，请稍后重试') }))
    }
  }

  return <>
    <div className="task-flow">
      <div className="task-flow-head">
        {/* 标题只留「第几步 / 共几步」——当前节点名就在下面那一行，不再复述一遍。
            「前 N 步已完成」也收进这一行：单独占一行（带节点的折叠条）会把选中卡顶高 ~36px，
            而它的作用只是提示进度，展开入口本来就有「查看流程」。 */}
        <span className="task-flow-caption">
          {steps.length ? `第 ${focus + 1} / ${steps.length} 步 · 当前节点` : '流转脉络'}
          {hiddenBefore > 0 && <span className="task-flow-done">前 {hiddenBefore} 步已完成</span>}
        </span>
        <span className="task-flow-tools">
          {collapsible && <button type="button" className="task-flow-link" onClick={(e) => { e.stopPropagation(); setShowAll((v) => !v) }}>
            {showAll ? '收起流程' : '查看流程'} <ChevronRight size={12} className={showAll ? 'is-open' : ''} />
          </button>}
          <button type="button" className="task-flow-link" onClick={(e) => { e.stopPropagation(); void toggleLog() }}>
            {log.open ? '收起流转日志' : '流转日志'} <ChevronRight size={12} className={log.open ? 'is-open' : ''} />
          </button>
        </span>
      </div>

      {steps.length === 0 && <p className="task-flow-empty">暂无流程步骤数据</p>}

      <div className="task-flow-track">
        {shown.map((step) => {
          const current = step.status === 'active'
          const done = step.status === 'completed' || step.status === 'skipped'
          const description = typeof step.result?.description === 'string' ? step.result.description : ''
          const limit = resolveDue(step.due_at)
          const completedTime = stepTime(step.completed_at)
          const materialAction = current && taskStatus === 'material_required'
          const body = materialAction
            ? (missingMaterial ? `系统校验到「${missingMaterial}」尚未齐全，请上传后在右侧提交。` : '系统校验到必需材料尚未齐全，请上传后在右侧提交。')
            : description || (step.organization?.name ? `办理机构：${step.organization.name}` : '等待流程推进')

          return <div className={`task-step${current ? ' current' : done ? ' done' : ' pending'}`} key={step.id}>
            <span className="task-step-node">
              {done ? <Check size={12} /> : current ? <i className="task-step-core" /> : <i className="task-step-idle" />}
            </span>
            <div className={`task-step-body${current ? ' active' : ''}`}>
              <div className="task-step-line">
                <span className="task-step-name">第 {step.step_order} 步：{step.name}</span>
                {/* 时限状态（剩余 N 天 / 已超时 / 已截止）挂在当前步骤标题右侧，
                    与其它胶囊同一套样式：超期与否都不在这里飘红。 */}
                {current
                  ? <span className="task-step-flag">
                    {limit ? <Clock3 size={11} /> : null}{limit?.text || '需本人操作'}
                  </span>
                  : <span className="task-step-flag muted">{done ? completedTime || '已完成' : '待前序完成'}</span>}
              </div>
              {(current || description) && <p className="task-step-desc">{body}</p>}
              {/* 正文里只有截止时刻是红色重点；后果说明保持次要灰，避免整段飘红。
                  超期也要说清后果：右侧仍可上传，用户需要知道还能不能办。 */}
              {current && limit && <p className="task-step-due">
                截止 <b className={limit.overdue ? 'overdue' : ''}>{limit.deadlineText}</b>
                {consequenceOf(limit) ? <span className="task-step-consequence"> · {consequenceOf(limit)}</span> : null}
              </p>}
            </div>
          </div>
        })}
      </div>
    </div>
    {log.open && <div className="task-log-panel">
      {log.loading && <p className="task-log-empty">正在读取流转日志...</p>}
      {log.error && <p className="task-log-empty">{log.error}</p>}
      {!log.loading && !log.error && (log.items.length
        ? <ul className="task-log-list">
          {log.items.map((item, index) => <li key={String(item.id ?? index)}>
            <span>{readText(item.title) || '流程事件'}</span>
            <small>{readText(item.operator)}{item.created_at ? ` · ${stepTime(readText(item.created_at)) || ''}` : ''}</small>
          </li>)}
        </ul>
        : <p className="task-log-empty">接口暂未返回日志记录</p>)}
    </div>}
  </>
}
