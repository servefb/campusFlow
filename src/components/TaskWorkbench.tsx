import { useState } from 'react'
import { AlertCircle, CalendarClock, CheckCircle2, Clock3, FileUp, Info, Maximize2, MessageSquarePlus, Minimize2, Play, QrCode, RefreshCw, Sparkles, UploadCloud } from 'lucide-react'
import { apiErrorMessage } from '../services/http'
import { uploadFile } from '../services/files'
import { associateTaskMaterial } from '../services/tasks'
import { resolveDue } from '../utils/taskSchedule'
import type { TaskDetail, TaskListItem, TaskRequirement } from '../types/api'

interface TaskWorkbenchProps {
  task: TaskListItem
  detail: TaskDetail | null
  requirements: TaskRequirement[]
  message: string
  onSave: () => void
  onSubmit: () => void
  onUrge: () => void
  /** 已截止时底部主按钮的动作：到对话里发起延期申请（前端没有延期接口，见底部注释）。 */
  onExtend: () => void
  onMessage: (message: string) => void
  onMaterialUploaded: () => void
}

interface FileState {
  name: string
  size: number
  status: 'uploading' | 'done' | 'error'
  fileId?: string | number
  error?: string
}

const typeLabel = (types?: unknown) => {
  if (!Array.isArray(types) || !types.length) return 'JPG / PNG'
  return types.map((type) => { const parts = String(type).split('/'); return (parts[parts.length - 1] || '').toUpperCase() }).filter(Boolean).join(' / ')
}

const reqStatusText = (item: TaskRequirement) => {
  if (item.status === 'accepted') return '已核验 · 系统自动调取档案'
  if (item.status === 'passed') return '已签批 · 系统流转回执'
  if (item.material_id) return '已核验'
  if (item.status === 'rejected') return '需重新提交'
  return item.status || '待校验'
}

const readString = (value: unknown): string => (typeof value === 'string' ? value : '')

const formatSize = (bytes: number) => {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/** 右栏顶部「当前承办流向」的提示语，完全由后端状态决定。 */
const flowHint = (status: TaskListItem['status']) =>
  status === 'material_required' ? '需本人提交补充材料'
    : status === 'under_review' ? '学院审核中'
      : status === 'completed' ? '已办结归档'
        : status === 'draft' ? '草稿未提交' : '流转办理中'

export function TaskWorkbench({ task, detail, requirements, message, onSave, onSubmit, onUrge, onExtend, onMessage, onMaterialUploaded }: TaskWorkbenchProps) {
  const [fileStates, setFileStates] = useState<Record<string, FileState>>({})
  /** 附言草稿按任务 id 记忆：切换任务时自动回落到接口返回的 form_data，无需额外的同步 effect。 */
  const [noteDraft, setNoteDraft] = useState<{ id?: string | number; text: string }>({ text: '' })
  /** 头部 ⤢ 图标：收起/展开工作台正文，底部操作条始终保留（长表单也要能找到提交入口）。 */
  const [collapsed, setCollapsed] = useState(false)

  const status = detail?.status ?? task.status
  const title = detail?.title ?? task.title
  const activeStep = detail?.steps?.find((step) => step.status === 'active') ?? null
  const agency = activeStep?.organization?.name ?? task.responsible_organization?.name ?? '待分配'
  const assignee = activeStep?.assignee?.name ?? '待分配'
  const stepName = activeStep?.name ?? detail?.current_step?.name ?? ''
  const stepOrg = activeStep?.organization?.name ?? ''
  const stepDesc = readString(activeStep?.result?.description)
  const noteFromApi = readString(detail?.form_data?.description)
  const noteValue = noteDraft.id === detail?.id ? noteDraft.text : noteFromApi
  /** 时限来自当前步骤的 due_at；超期时给明确后果，避免「右侧还能上传＝是不是还能办」的误解。 */
  const due = resolveDue(activeStep?.due_at)

  const isProvided = (item: TaskRequirement) => {
    if (item.status === 'rejected') return false
    if (item.material_id != null) return true
    return item.status === 'accepted' || item.status === 'passed'
  }
  const missing = requirements.filter((item) => !isProvided(item))
  const accepted = requirements.filter((item) => isProvided(item))
  const total = requirements.length
  const missingCount = missing.length
  const acceptedCount = accepted.length
  const requiredMissing = missing.filter((item) => item.required !== false)
  /** 选填项不算阻塞：只有必填项齐了才允许提交。 */
  const canSubmit = requiredMissing.every((item) => fileStates[String(item.id)]?.status === 'done')
  const verifyPercent = total ? Math.round((acceptedCount / total) * 100) : 0
  const submitLabel = status === 'material_required' ? '提交补充材料' : '确认并提交审核'
  /** 已截止（超过宽限期）：按业务规则必须先申请延期，底部主按钮随之切换。
      规则来源见 utils/taskSchedule.ts —— 后端暂未返回「是否允许补交」字段，前端按宽限期判定。 */
  const expired = due?.expired === true

  const handleUpload = async (requirementId: string | number, file?: File) => {
    if (!file) return
    const key = String(requirementId)
    setFileStates((s) => ({ ...s, [key]: { name: file.name, size: file.size, status: 'uploading' } }))
    try {
      const fileId = await uploadFile(file, 'task_material')
      await associateTaskMaterial(task.id, { requirement_id: requirementId, file_id: fileId })
      setFileStates((s) => ({ ...s, [key]: { name: file.name, size: file.size, status: 'done', fileId } }))
      // 上传成功 ≠ 提交成功：必须说清还要点一次提交，否则用户以为已经办完了。
      onMessage(`材料已上传成功，还需点击「${submitLabel}」才算提交`)
      onMaterialUploaded()
    } catch (e) {
      const msg = apiErrorMessage(e, '文件上传失败，请重试')
      setFileStates((s) => ({ ...s, [key]: { name: file.name, size: file.size, status: 'error', error: msg } }))
      onMessage(msg)
    }
  }

  /** 标题叫「办理说明」：接口只给了步骤与承办机构，没有核验标准，不能挂着「依据与标准」的名。 */
  const rulesText = [
    stepName ? `当前办理步骤：${stepName}${stepOrg ? `，由${stepOrg}承办` : ''}` : '任务处于流转办理中',
    stepDesc,
  ].filter(Boolean).join('。') + '。'

  return <div className="task-wb">
    <div className="task-wb-header">
      <span className="task-wb-tag">办理工作台</span>
      <span className="task-wb-no">#{task.task_no}</span>
      <div className="task-wb-icons">
        <button type="button" className="task-wb-icon" aria-label="刷新流转状态" title="刷新流转状态" onClick={onMaterialUploaded}><RefreshCw size={14} /></button>
        <button
          type="button"
          className="task-wb-icon"
          aria-label={collapsed ? '展开工作台' : '收起工作台'}
          title={collapsed ? '展开工作台' : '收起工作台'}
          onClick={() => setCollapsed((value) => !value)}
        >{collapsed ? <Maximize2 size={14} /> : <Minimize2 size={14} />}</button>
      </div>
    </div>

    {!collapsed && <div className="task-wb-body">
      <div className="task-wb-flow">
        <div className="task-wb-flow-head">
          <span className="task-wb-kicker">当前承办流向</span>
          <span className={`task-wb-flow-hint${status === 'material_required' ? ' warn' : ''}`}>{flowHint(status)}</span>
        </div>
        <h2 className="task-wb-title">{title}</h2>
        <p className="task-wb-sub">承办部门：{agency} · 经办人：{assignee}</p>
      </div>

      {due && <div className={`task-wb-due${due.overdue ? ' overdue' : ''}`}>
        <Clock3 size={15} />
        <span>
          <strong>{due.overdue ? `${due.text} · 截止 ${due.deadlineText}` : `${due.text}（截止 ${due.deadlineText}）`}</strong>
          <small>{due.consequence || '请在截止时间前完成提交'}</small>
        </span>
      </div>}

      <div className="task-wb-rules">
        <Info size={18} />
        <div><strong>办理说明</strong><p>{rulesText}</p></div>
      </div>

      <div className="task-wb-material-head">
        <h3 className="task-wb-section">材料核验清单（{acceptedCount}/{total}）</h3>
        <span className="task-wb-code">必填项验证 {verifyPercent}%</span>
      </div>

      <div className="task-wb-list">
        {accepted.map((item, index) => <div className="task-wb-req accepted" key={String(item.id ?? index)}>
          <span className="task-wb-req-icon"><CheckCircle2 size={16} /></span>
          <div><strong>{item.name || '材料'}</strong><small>{reqStatusText(item)}</small></div>
          <span className="task-wb-req-code">已通过</span>
        </div>)}

        {missing.map((item, index) => {
          const inputId = `task-wb-file-${String(item.id ?? index)}`
          const cameraId = `task-wb-camera-${String(item.id ?? index)}`
          const state = fileStates[String(item.id ?? index)]
          const accept = Array.isArray(item.allowed_types) ? item.allowed_types.join(',') : undefined
          const base = `${typeLabel(item.allowed_types)}${item.max_size_mb ? ` · ${item.max_size_mb}MB以内` : ''}`
          const strongText = state?.status === 'uploading' ? `上传中… ${state.name}` : state?.status === 'done' ? `已上传 ${state.name}（文件编号：${state.fileId}）` : state?.status === 'error' ? '上传失败，请重新选择' : '点击选择图片 或 将证件照片拖入此处'
          const smallText = state?.status === 'uploading' ? `正在上传至对象存储（${formatSize(state.size)}）` : state?.status === 'error' ? state.error : `支持 ${base} 格式${state?.status === 'done' ? ` · 已就绪 ${formatSize(state.size)}` : ''}`
          const boxClass = `task-wb-upload${state?.status === 'done' ? ' uploaded' : ''}${state?.status === 'error' ? ' error' : ''}`

          return <div className="task-wb-req missing" key={String(item.id ?? index)}>
            <input id={inputId} className="task-wb-file-input" type="file" accept={accept} onChange={(e) => handleUpload(item.id, e.target.files?.[0])} />
            <input id={cameraId} className="task-wb-file-input" type="file" accept="image/*" capture="environment" onChange={(e) => handleUpload(item.id, e.target.files?.[0])} />

            <div className="task-wb-req-row">
              <span className="task-wb-req-icon"><AlertCircle size={16} /></span>
              {/* 行内只说「缺什么、卡不卡」；格式与大小限制统一放在上传区那一行（唯一一处） */}
              <div><strong>{item.name || '待补充材料'}</strong><small>{item.required === false ? '选填项，可跳过' : '必填项，补齐后才能提交'}</small></div>
              <span className={`task-wb-req-badge${item.required === false ? ' optional' : ''}`}>{item.required === false ? '选填' : '缺少材料'}</span>
            </div>

            <label htmlFor={inputId} className={boxClass}>
              <span className="task-wb-upload-icon"><UploadCloud size={18} /></span>
              <strong>{state?.status === 'done' && <CheckCircle2 size={14} />}{strongText}</strong>
              <small>{smallText}</small>
            </label>
            {/* 次级入口：与「点击上传」是同一批文件的不同来源，做成一行文字链接，不抢主操作 */}
            <div className="task-wb-upload-actions">
              <label htmlFor={inputId} className="task-wb-upload-btn"><FileUp size={12} /> 从学籍库调取</label>
              <label htmlFor={cameraId} className="task-wb-upload-btn"><QrCode size={12} /> 手机扫码拍摄</label>
            </div>
          </div>
        })}

        {total === 0 && <p className="task-wb-empty">接口未返回材料要求</p>}
      </div>

      <div className="task-wb-note-head">
        <label className="task-wb-section" htmlFor="task-wb-note">办理附言及取卡偏好（选填）</label>
        <span className="task-wb-code">{noteValue.length} / 200</span>
      </div>
      <textarea
        id="task-wb-note"
        className="task-wb-note"
        maxLength={200}
        placeholder="如有乘车区间变更需求或希望加急制卡，请在此简述说明..."
        value={noteValue}
        onChange={(e) => setNoteDraft({ id: detail?.id, text: e.target.value })}
      />

      <div className="task-wb-agent">
        <Sparkles size={16} />
        <span>多智能体协同处理中，材料齐备后将自动推进至下一节点。</span>
        <button type="button" onClick={onUrge}><MessageSquarePlus size={13} />向助手催办</button>
      </div>
    </div>}

    {message && <p className="task-wb-message">{message}</p>}

    {/* 底部操作条常驻：正文滚动时提交入口不会被滚出视野。 */}
    <div className="task-wb-footer">
      {status === 'completed'
        ? <span className="task-wb-foot-note done"><CheckCircle2 size={14} />已办结，无需提交</span>
        : status === 'under_review'
          ? <span className="task-wb-foot-note done"><CheckCircle2 size={14} />已提交，等待学院复审</span>
          /* 已截止时先把「该做什么」和「材料还在不在」写清楚，否则用户只看到一个灰按钮会卡住 */
          : expired
            ? <span className="task-wb-foot-note blocked">
              <b>已截止，需先申请延期</b>
              <small>材料可先上传保留、附言请点「暂存草稿」；延期通过后再提交</small>
            </span>
            : missingCount > 0
              ? <span className="task-wb-foot-note">
                <b>还需补充 {missingCount} 项</b>
                <small>{requiredMissing.length ? '必填项补齐后才能提交' : '均为选填项，可直接提交'}</small>
              </span>
              : <span className="task-wb-foot-note done"><CheckCircle2 size={14} />材料已齐备</span>}

      {status !== 'completed' && <button type="button" className="task-wb-draft" onClick={onSave}>暂存草稿</button>}
      {status !== 'completed' && status !== 'under_review' && (expired
        ? <button type="button" className="task-wb-submit" onClick={onExtend}><CalendarClock size={14} />申请延期</button>
        : <button type="button" className="task-wb-submit" disabled={!canSubmit} onClick={onSubmit}><Play size={14} />{submitLabel}</button>)}
    </div>
  </div>
}
