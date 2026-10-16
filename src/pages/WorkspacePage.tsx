import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Boxes,
  Building2,
  Check,
  FileText,
  Flame,
  Hourglass,
  Info,
  Lock,
  Megaphone,
  Network,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Upload,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { getWorkspaceSummary, MAIN_AGENT, type WorkspaceSummary } from '../services/workspace'
import { getTask, getTasks } from '../services/tasks'
import { getKnowledgeDocuments } from '../services/knowledge'
import { apiErrorMessage } from '../services/http'
import { useAuthStore } from '../stores/auth'
import type { KnowledgeDocument, TaskDetail, TaskListItem, TaskStatus, TaskStep, TaskStepStatus } from '../types/api'
import { computeTaskProgress } from '../utils/taskProgress'

/** 任务状态 → 中文标签 / 药丸色调。后端新增状态时退回中性色，不崩。 */
const STATUS_META: Record<TaskStatus, { label: string; tone: string }> = {
  draft: { label: '草稿未提交', tone: 'neutral' },
  in_progress: { label: '办理中', tone: 'progress' },
  material_required: { label: '待补材料', tone: 'warning' },
  under_review: { label: '审核中', tone: 'info' },
  completed: { label: '已办结', tone: 'success' },
  cancelled: { label: '已取消', tone: 'neutral' },
}

const fallbackStatus = { label: '进行中', tone: 'neutral' }

/** 未办结的状态药丸带呼吸点，已办结/已取消则静止——避免"完成"看起来还在跑。 */
const LIVE_TONES = new Set(['progress', 'warning', 'info'])

/**
 * 事务类别：后端列表接口暂未下发类别字段，按标题关键词推导，
 * 只用于卡片左上角徽章的文字与配色，不参与任何业务判断。
 * 顺序即优先级——「一卡通」必须排在「证」之前，否则会被判成证件办理。
 */
const TASK_CATEGORY: Array<[RegExp, { label: string; tone: CategoryTone }]> = [
  [/奖|助|资助|励志|贷款/, { label: '奖助学金', tone: 'rose' }],
  [/学籍|教务|选课|课程|成绩|辅修|学分|转专业|培养方案|考|论文/, { label: '教务学籍', tone: 'blue' }],
  [/就业|实习|职业|三方|派遣|招聘/, { label: '就业发展', tone: 'amber' }],
  [/一卡通|后勤|住宿|宿舍|生活|医院|供暖|食堂|报销/, { label: '后勤与综合', tone: 'green' }],
  [/证|证明|卡|章|票据/, { label: '证件办理', tone: 'blue' }],
]

type CategoryTone = 'rose' | 'blue' | 'amber' | 'green' | 'slate'

const FALLBACK_CATEGORY = { label: '综合事务', tone: 'slate' as CategoryTone }

const pickCategory = (text: string) => TASK_CATEGORY.find(([pattern]) => pattern.test(text))?.[1] ?? FALLBACK_CATEGORY

/** 流转节点状态 → 视觉谱系。驳回不伪装成「待流转」，单独用珊瑚色示警。 */
const STEP_TONE: Record<TaskStepStatus, 'done' | 'active' | 'todo' | 'alert'> = {
  completed: 'done',
  active: 'active',
  pending: 'todo',
  rejected: 'alert',
  skipped: 'todo',
}

const STEP_ICON = { done: Check, active: Hourglass, todo: Lock, alert: RotateCcw }

/** 高频咨询胶囊前的彩点：优先按后端给的 category 归类，归类不出就按序号轮换。 */
const QUICK_TONES: CategoryTone[] = ['rose', 'green', 'amber', 'slate']

const quickTone = (category: string | undefined, index: number): CategoryTone => {
  if (category) {
    if (/奖|助|资助|学工/.test(category)) return 'rose'
    if (/教务|学籍|教学|考试|课程/.test(category)) return 'green'
    if (/服务|后勤|生活|证明|证件/.test(category)) return 'amber'
  }
  return QUICK_TONES[index % QUICK_TONES.length]
}

/** 后端可能返回字符串或对象形式的主体名称，统一取可读文本。 */
const nameOf = (value: unknown): string => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'name' in (value as Record<string, unknown>)) return String((value as { name?: unknown }).name ?? '')
  return ''
}

const formatDay = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

/** 紧凑语境（流转节点、公文日期）用 MM-DD，跟设计稿的等宽短日期一致。 */
const formatMD = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 流转节点副标题：优先给"什么时候发生了什么"，拿不到就退回状态本身的说法。 */
const stepHint = (step: TaskStep) => {
  if (step.status === 'completed') {
    const at = formatMD(step.completed_at)
    return at ? `${at} 已完成` : '已完成'
  }
  if (step.status === 'active') {
    const due = formatMD(step.due_at)
    return due ? `预计 ${due}` : '进行中'
  }
  if (step.status === 'rejected') return '需重新提交'
  if (step.status === 'skipped') return '已跳过'
  return '待流转'
}

export function WorkspacePage() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState('')
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null)
  const [tasks, setTasks] = useState<TaskListItem[]>([])
  const [taskTotal, setTaskTotal] = useState(0)
  const [featuredSteps, setFeaturedSteps] = useState<TaskStep[]>([])
  const [docs, setDocs] = useState<KnowledgeDocument[]>([])
  const [docTotal, setDocTotal] = useState(0)
  const [pending, setPending] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    // 四个接口互不依赖：任何一个失败都只影响它自己那一块，其余照常渲染。
    // 09-23：不再拉 /agents —— 全站只剩一个主智能体，没有可选的 Agent 列表了。
    Promise.allSettled([
      getWorkspaceSummary(),
      getTasks({ page_size: 3, sort: false }),
      getKnowledgeDocuments({ page_size: 3, sort: false }),
    ]).then(([summaryResult, tasksResult, docsResult]) => {
      const failures: unknown[] = []

      if (summaryResult.status === 'fulfilled') setSummary((summaryResult.value.data as { data?: WorkspaceSummary } | undefined)?.data ?? null)
      else failures.push(summaryResult.reason)

      if (tasksResult.status === 'fulfilled') {
        const data = (tasksResult.value.data as { data?: { items?: TaskListItem[]; total?: number } } | undefined)?.data
        const items = data?.items ?? []
        setTasks(items)
        // 列表接口的 total 即「全部项数」，不再额外请求 /tasks/summary。
        setTaskTotal(data?.total ?? items.length)

        // 流转轨道需要每一步，而列表接口只给当前环节：只为首条重点卡补一次详情。
        // 失败就退回进度条，不影响其余内容。
        if (items[0]?.id != null) {
          getTask(items[0].id)
            .then((response) => {
              const detail = (response.data as { data?: TaskDetail } | undefined)?.data
              setFeaturedSteps(Array.isArray(detail?.steps) ? detail.steps : [])
            })
            .catch(() => setFeaturedSteps([]))
        }
      } else failures.push(tasksResult.reason)

      if (docsResult.status === 'fulfilled') {
        const data = (docsResult.value.data as { data?: { items?: KnowledgeDocument[]; total?: number } } | undefined)?.data
        setDocs(data?.items ?? [])
        setDocTotal(data?.total ?? 0)
      } else failures.push(docsResult.reason)

      // 工作台摘要是首屏主线，它失败才算硬错误；其余接口失败按缺数据降级。
      if (summaryResult.status === 'rejected') setError(apiErrorMessage(failures[0], '工作台数据加载失败，请稍后重试'))
      setPending(false)
    })
  }, [])

  const quickEntries = summary?.quick_entries ?? []
  const hotTopics = summary?.hot_topics ?? []
  const department = user?.department || '自动识别院系'

  const statusText = useMemo(() => {
    // 09-23：不再拼「N 个领域 Agent 在线」—— 全站只剩一个主智能体，报数没有意义。
    return docTotal ? `知识库 ${docTotal} 份效力文件` : ''
  }, [docTotal])

  const askFrom = (text: string) => {
    setDraft(text)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    promptRef.current?.focus()
  }

  const submit = (question: string) => {
    const content = question.trim()
    if (!content) {
      promptRef.current?.focus()
      return
    }
    // agent_mode 恒为 auto（09-23）：前端只剩一个主智能体，没有可选项了。
    navigate('/conversations/new', { state: { question: content, agentMode: 'auto' } })
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit(draft)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 输入法组词确认的回车不发送；Shift + Enter 保留换行。
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit(draft)
    }
  }

  const featured = tasks[0]
  const featuredMeta = STATUS_META[featured?.status ?? 'draft'] ?? fallbackStatus
  const featuredCategory = pickCategory(featured?.title ?? '')
  const featuredStep = featured?.current_step || ''
  const featuredOrg = nameOf(featured?.responsible_organization)
  const featuredProgress = computeTaskProgress(featured)
  const latestDoc = docs[0] ?? null
  const relatedDocs = docs.slice(1, 3)
  const docIssuer = nameOf(latestDoc?.issuer)
  const docNo = latestDoc?.document_no || ''
  // 接口只有 published_at，没有生效日期字段：措辞按「发布」说，不写成「生效」。
  const docBadge = !latestDoc
    ? null
    : latestDoc.validity === 'revised'
      ? { label: '重要变更', tone: 'warn' }
      : latestDoc.validity === 'current'
        ? { label: '现行效力', tone: 'ok' }
        : { label: '近期归档', tone: 'mute' }

  return (
    <section className="page home-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">CAMPUS FLOW AI 智能调度核心</p>
          <h1>今天想解决什么校园事务？</h1>
          <p className="muted">知识库深度联动 · 规章原文溯源校验 · 多智能体协同办理</p>
        </div>
        {statusText ? (
          <span className="home-status-pill">
            <ShieldCheck size={15} />
            {statusText}
          </span>
        ) : null}
      </header>

      <form className="home-console" onSubmit={handleSubmit}>
        <div className="home-console-tabs">
          <div className="home-agent-list">
            {/* 只有一个主智能体（09-23）：原来是「自动路由 + 各领域 Agent」的切换行，
                现在收成一个静态标签 —— 仍用 button 是为了沿用既有药丸样式（type=button，
                在 form 里不会触发提交），但它不可点、也没有第二种选中态。 */}
            <button type="button" className="active" title={MAIN_AGENT.description} aria-current="true">
              <i className="home-agent-dot" />
              <Sparkles size={14} />
              {MAIN_AGENT.name}
            </button>
          </div>
          <span className="home-rag">
            <i />
            RAG 向量节点就绪
          </span>
        </div>

        <div className="home-console-input">
          <label className="sr-only" htmlFor="home-ai-input">输入校园问题</label>
          <textarea
            id="home-ai-input"
            ref={promptRef}
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="例如：跨专业保研的学分置换流程是什么？需要先找原学院教务还是直接提交研究生院？需要带哪些加盖公章的成绩单？"
          />
          <div className="home-console-tools">
            <div className="home-tool-group">
              <Link className="home-tool is-rose" to="/tasks">
                <Upload size={15} />
                上传材料/草表比对
              </Link>
              <span className="home-tool home-tool-static is-green">
                <Building2 size={15} />
                所属院系：{department}（自动）
              </span>
              <span className="home-tool-note">｜ 支持多文档跨部门溯源</span>
            </div>
            <div className="home-submit-group">
              <span className="home-key-hint">Enter 提问 · Shift+Enter 换行</span>
              <button className="home-submit" type="submit">
                向智能助手提问
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>

        {quickEntries.length ? (
          <div className="home-quick">
            <span><TrendingUp size={14} />高频咨询：</span>
            {quickEntries.map((entry, index) => (
              <button key={entry.key} type="button" onClick={() => askFrom(entry.prompt || entry.title)} title={entry.prompt}>
                <i className={`dot-${quickTone(entry.category, index)}`} />
                {entry.title}
              </button>
            ))}
          </div>
        ) : null}
      </form>

      {error ? <div className="home-alert">{error}</div> : null}

      <div className="home-grid">
        <section className="home-flow">
          <header className="home-section-head">
            <div className="home-section-title">
              <Network size={20} />
              <h2>待办与办事流转脉络</h2>
              <span className="home-section-code">MY FLOW TASKS</span>
            </div>
            <Link className="home-section-more" to="/tasks">
              全部 {taskTotal} 项
              <ArrowRight size={14} />
            </Link>
          </header>

          {pending ? (
            <div className="home-placeholder">正在读取待办事项…</div>
          ) : featured ? (
            <>
              <article className="home-task">
                <div className="home-task-top">
                  <div className="home-task-head">
                    <div className="home-task-meta">
                      <span className={`home-task-tag tone-${featuredCategory.tone}`}>{featuredCategory.label}</span>
                      {featured.task_no ? <span className="home-task-no">ID: {featured.task_no}</span> : null}
                    </div>
                    <h3>{featured.title}</h3>
                  </div>
                  <span className={`home-task-status tone-${featuredMeta.tone}${LIVE_TONES.has(featuredMeta.tone) ? ' is-live' : ''}`}>
                    <i />{featuredMeta.label}
                  </span>
                </div>

                {featuredSteps.length ? (
                  <ol className="home-rail">
                    {featuredSteps.map((step) => {
                      const tone = STEP_TONE[step.status] ?? 'todo'
                      const Icon = STEP_ICON[tone]
                      return (
                        <li className={`home-node is-${tone}`} key={step.id ?? step.step_order}>
                          <span className="home-node-dot"><Icon size={14} /></span>
                          <span className="home-node-name">{step.name}</span>
                          <span className="home-node-hint">{stepHint(step)}</span>
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <>
                    {featuredStep ? <p className="home-task-line">当前环节：{featuredStep}</p> : null}
                    {featuredProgress !== null ? (
                      <div className="home-task-progress">
                        <div className="home-task-progress-head">
                          <span><ShieldCheck size={15} />办理进度</span>
                          <em>更新于 {formatDay(featured.updated_at) || '—'}</em>
                        </div>
                        <div className="home-bar"><i style={{ width: `${featuredProgress}%` }} /></div>
                        <div className="home-task-progress-foot">
                          <span>{featured.task_no || '办理中'}</span>
                          <b>{featuredProgress}% 完成</b>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}

                <footer className="home-task-foot">
                  <span>
                    <Info size={14} />
                    当前经办部门：{featuredOrg || '待分派'}
                  </span>
                  <Link to="/tasks">查看材料清单 <ArrowRight size={13} /></Link>
                </footer>
              </article>

              {tasks.slice(1, 3).map((task) => {
                const category = pickCategory(task.title)
                const meta = STATUS_META[task.status] ?? fallbackStatus
                const org = nameOf(task.responsible_organization)
                return (
                  <article className="home-task-sm" key={task.id}>
                    <div className="home-task-top">
                      <div className="home-task-head">
                        <div className="home-task-meta">
                          <span className={`home-task-tag tone-${category.tone}`}>{category.label}</span>
                          {task.task_no ? <span className="home-task-no">ID: {task.task_no}</span> : null}
                        </div>
                        <h3>{task.title}</h3>
                      </div>
                      <span className={`home-task-status tone-${meta.tone}${LIVE_TONES.has(meta.tone) ? ' is-live' : ''}`}>
                        <i />{meta.label}
                      </span>
                    </div>

                    <div className="home-task-sm-box">
                      <span className="home-task-sm-info">
                        <FileText size={18} />
                        <span>
                          <b>{task.current_step || `更新于 ${formatDay(task.updated_at) || '—'}`}</b>
                          {org ? <small>{org}</small> : null}
                        </span>
                      </span>
                      <Link className="home-task-sm-link" to="/tasks">查看详情</Link>
                    </div>
                  </article>
                )
              })}
            </>
          ) : (
            <div className="home-placeholder">暂无进行中的办事事项，可在「我的任务」中发起。</div>
          )}
        </section>

        <section className="home-side">
          <div className="home-panel">
            <div className="home-panel-head">
              <span className="home-panel-title is-flame"><Flame size={18} />全校热搜事项与咨询排行</span>
              <span className="home-panel-note">{hotTopics.length ? `共 ${hotTopics.length} 条` : '暂无数据'}</span>
            </div>
            {hotTopics.length ? (
              <div className="home-rank">
                {hotTopics.slice(0, 3).map((topic, index) => (
                  <button key={`${topic}-${index}`} type="button" className={`rank-${index + 1}`} onClick={() => askFrom(topic)} title="点击填入提问框">
                    <b>{index + 1}</b>
                    <span>{topic}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="home-panel-empty">热度数据由后端汇总后返回。</p>
            )}
          </div>

          <div className="home-panel">
            <div className="home-panel-head">
              <span className="home-panel-title is-policy"><Megaphone size={18} />最新公文与规章修订直达</span>
              {docBadge ? <span className={`home-policy-badge tone-${docBadge.tone}`}>{docBadge.label}</span> : null}
            </div>
            {latestDoc ? (
              <>
                <div className="home-policy-card">
                  <div className="home-policy-meta">
                    <b>{docNo || '文号待同步'}</b>
                    {formatMD(latestDoc.published_at) ? <em>发布 {formatMD(latestDoc.published_at)}</em> : null}
                  </div>
                  <h4 className="home-policy-title">{latestDoc.title}</h4>
                  {latestDoc.summary ? <p className="home-policy-text">{latestDoc.summary}</p> : null}
                  <div className="home-policy-foot">
                    <span>{docIssuer ? `发文单位：${docIssuer}` : '发文单位待同步'}</span>
                    <button
                      type="button"
                      onClick={() => submit(`请对比《${latestDoc.title}》本次修订与上一版本的具体差异，并说明对在校生的影响。`)}
                    >
                      问 AI 新旧细则对比
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>

                {relatedDocs.length ? (
                  <div className="home-policy-more">
                    {relatedDocs.map((doc) => (
                      <Link key={doc.id} to="/knowledge">
                        <span>{doc.title}</span>
                        <em>{formatMD(doc.published_at)}</em>
                      </Link>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="home-panel-empty">规章库暂无最新修订记录。</p>
            )}
          </div>
        </section>
      </div>

      <div className="home-union">
        <div className="home-union-lead">
          <span className="home-union-icon"><Boxes size={18} /></span>
          <div>
            <strong>
              校园多部门规章数据库已联通
              <i className="home-live-dot" />
            </strong>
            <small>
              {docTotal ? `已收录 ${docTotal} 份现行效力文件 · ` : ''}
              支持按部门、文号与生效状态穿透检索
            </small>
          </div>
        </div>
        <div className="home-union-links">
          <Link to="/knowledge">规章查验检索</Link>
          <i>·</i>
          <Link to="/tasks">我的任务</Link>
          <i>·</i>
          <Link to="/news">校园新闻</Link>
        </div>
      </div>
    </section>
  )
}
