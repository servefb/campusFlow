/**
 * 办理时限的统一口径 —— 左列卡片时间轴与右栏工作台共用，避免两处各算各的。
 * -----------------------------------------------------------------------------
 * ⚠️ 业务规则目前**只存在于前端**：`TaskStep` 只有 `due_at`，没有「是否允许补交 /
 * 需申请延期」这类字段。下面的 GRACE_HOURS 是暂定宽限期：
 *   · 超期 ≤ GRACE_HOURS → 「已超时，仍可补交」
 *   · 超期 >  GRACE_HOURS → 「已截止，需申请延期」
 * 后端补上规则字段（如 allow_late_submit / extension_required）后，直接读字段，
 * 本文件的两个分支整段删掉即可，调用方不用动。
 */
export const GRACE_HOURS = 72

const pad = (value: number) => String(value).padStart(2, '0')

/** 截止时刻的展示格式：09-15 18:00。 */
const formatDeadline = (value: Date) =>
  `${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`

export interface DueInfo {
  /** 徽标短文案：剩余 N 小时 / 已超时 / 已截止 */
  text: string
  /** 是否已超期 */
  overdue: boolean
  /** 超过宽限期：**不能再补交，必须先申请延期**。底部主按钮据此切换。 */
  expired: boolean
  /** 「09-15 18:00」，只在能解析出截止时刻时才有 */
  deadlineText: string
  /** 超期后果说明；未超期为空串 */
  consequence: string
}

/** 剩余时长的人话表达：≥1 天给天，≥1 小时给小时，否则给分钟。 */
const remainingText = (ms: number) => {
  const minutes = Math.ceil(ms / 60000)
  if (minutes >= 1440) return `剩余 ${Math.floor(minutes / 1440)} 天`
  if (minutes >= 60) return `剩余 ${Math.floor(minutes / 60)} 小时`
  return `剩余 ${Math.max(1, minutes)} 分钟`
}

/** 由 due_at 推出展示所需的全部信息；缺失或不可解析时返回 null（调用方不渲染时限）。 */
export const resolveDue = (value?: string | null): DueInfo | null => {
  if (!value) return null
  const due = new Date(value).getTime()
  if (Number.isNaN(due)) return null

  const deadlineText = formatDeadline(new Date(due))
  const diff = due - Date.now()
  if (diff > 0) return { text: remainingText(diff), overdue: false, expired: false, deadlineText, consequence: '' }

  const overdueHours = Math.floor(-diff / 3600000)
  const tooLate = overdueHours > GRACE_HOURS
  return {
    text: tooLate ? '已截止' : '已超时',
    overdue: true,
    expired: tooLate,
    deadlineText,
    consequence: tooLate ? '已截止，需申请延期' : '已超时，仍可补交',
  }
}
