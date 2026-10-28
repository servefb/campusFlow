/**
 * 截止时间的**统一口径**（新闻页与后续其它列表共用，别各算各的）。
 *
 * 背景（2026-09-15 用户反馈④）：旧实现把收到的每个 `deadline_at` 都渲染成红底，
 * 10 月 15 日和 9 月 28 日看起来一样紧急。现在按「距今天数」分三档，红只留给真紧急：
 *   · `normal`  中性 —— 还有 8 天以上（或时间无法解析）
 *   · `soon`    橙色 —— 7 天以内（含当天）
 *   · `urgent`  红色 —— 48 小时内 / 已逾期
 * 阈值是**前端暂定**：接口只有 `deadline_at`，没有「紧急度」字段。后端若补 `deadline_level`
 * 之类字段，把 LEVELS 判据换掉即可，调用方不用动。
 *
 * 文案：单独一个日期（「10月15日」）不带含义，所以一律拼语义前缀（「报名截止 · 10月15日」）。
 * 前缀由调用方按标题语义推导后传入，推不出来时退回「截止」。
 */

export type DeadlineTone = 'normal' | 'soon' | 'urgent'

export type DeadlineInfo = {
  /** 展示文本，如「报名截止 · 10月15日 18:00」；已过期为「报名截止 · 10月15日（已逾期）」 */
  text: string
  tone: DeadlineTone
  /** 距今天数（向下取整）；无法解析时为 null */
  daysLeft: number | null
  label: string
  expired: boolean
}

const URGENT_HOURS = 48
const SOON_DAYS = 7

/** 当天 0 点（把比较基准拉平到"日历天"，而不是"距现在多少小时"）。 */
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
const DAY_MS = 86_400_000

export function formatDeadline(raw?: string | null, label?: string): DeadlineInfo | null {
  if (!raw) return null
  const at = new Date(raw)
  const prefix = label?.trim() || '截止'
  if (Number.isNaN(at.getTime())) return { text: `${prefix} · ${raw}`, tone: 'normal', daysLeft: null, label: prefix, expired: false }

  const now = new Date()
  // ⚠️ daysLeft 必须是**日历天差**（今天=0、明天=1）。早先写成「先算各自当天 24:00 再相减」，
  //    当天到期的会算成 −1，文案显示成「还有 -1 天」（单元测试抓到的）。
  const daysLeft = Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS)
  const hoursLeft = (at.getTime() - now.getTime()) / 3_600_000

  const stamp = at.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const expired = hoursLeft <= 0
  const tone: DeadlineTone = expired || hoursLeft <= URGENT_HOURS ? 'urgent' : daysLeft <= SOON_DAYS ? 'soon' : 'normal'

  const suffix = expired
    ? '（已逾期）'
    : daysLeft === 0
      ? '（今天）'
      : daysLeft === 1
        ? '（明天）'
        : daysLeft <= SOON_DAYS
          ? `（还有 ${daysLeft} 天）`
          : ''

  return { text: `${prefix} · ${stamp}${suffix}`, tone, daysLeft, label: prefix, expired }
}
