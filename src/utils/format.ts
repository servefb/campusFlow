/** 展示层格式化。所有数字都要过一遍这里的 `formatNumber` 才能上屏，避免千分位不统一。 */

export const formatNumber = (value: number | null | undefined, fallback = '—') =>
  value === null || value === undefined || Number.isNaN(value) ? fallback : value.toLocaleString('zh-CN')

/** 大数压缩：24,892 → 24,892；1,428,900 → 142.9万 */
export const formatCompact = (value: number | null | undefined, fallback = '—') => {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(1)}万`
  return value.toLocaleString('zh-CN')
}

/** 比率：0.986 → 98.6% */
export const formatPercent = (value: number | null | undefined, digits = 1, fallback = '—') =>
  value === null || value === undefined || Number.isNaN(value) ? fallback : `${(value * 100).toFixed(digits)}%`

/** 耗时：1180 → 1.18s；920 → 920ms */
export const formatDuration = (ms: number | null | undefined, fallback = '—') => {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return fallback
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${Math.round(ms)}ms`
}

export const formatSignedPercent = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined ? '—' : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`

const pad = (n: number) => String(n).padStart(2, '0')

/** 2026-09-15T16:42:18+08:00 → 2026-09-15 16:42:18（审计表用，UTC+8 口径） */
export const formatDateTime = (iso: string | null | undefined, fallback = '—') => {
  if (!iso) return fallback
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 2026-09-15 16:42 */
export const formatShortDateTime = (iso: string | null | undefined, fallback = '—') => {
  if (!iso) return fallback
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 2026-09-15T16:42:18+08:00 → 2026-09-15（表格单元格里只放日期，宽度可控） */
export const formatDate = (iso: string | null | undefined, fallback = '—') => {
  if (!iso) return fallback
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 相对时间：刚刚 / 3 分钟前 / 昨天 17:45 / 182 天前 */
export const formatRelative = (iso: string | null | undefined, fallback = '—') => {
  if (!iso) return fallback
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return fallback
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`

  const days = Math.floor(hours / 24)
  if (days === 1) return `昨天 ${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (days < 30) return `${days} 天前`
  if (days < 365) return `${Math.floor(days / 30)} 个月前`
  return `${Math.floor(days / 365)} 年前`
}

/** 把耗时转成「28 分钟前」这种复核队列用的短表述 */
export const formatQueueAge = (iso: string) => formatRelative(iso)

export const humanFileSize = (bytes: number | null | undefined, fallback = '—') => {
  if (bytes === null || bytes === undefined) return fallback
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 姓名取首字做头像占位 */
export const initials = (name: string | null | undefined) => (name ? name.slice(0, 1) : '—')

/** 脱敏：学号 2023110822 → 2023****822 */
export const maskAccount = (account: string | null | undefined) => {
  if (!account) return '—'
  if (account.length <= 6) return account
  return `${account.slice(0, 4)}****${account.slice(-3)}`
}
