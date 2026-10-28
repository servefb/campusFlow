import type { ConversationSummary } from '../types/api'
// 「最后一级文件夹名」的口径在 workspacePath.ts —— 输入框那个工作区 chip 也用同一个，
// 两边必须一致（否则同一块工作区在左栏叫 campusflow、在输入框叫 d:campusflow）。
import { workspaceName } from './workspacePath'

/**
 * 会话按日期分组的口径（09-18 侧边栏三改抽出来的）。
 *
 * 放在 utils 而不是组件文件里有两个原因：
 * ① 它是纯函数、要能单测；② 组件文件只导出组件，否则 react-refresh 会告警。
 */

export type GroupKey = 'today' | 'yesterday' | 'earlier'

/** 分组标签：切日边界与历史弹窗一致（当地 0 点），只是窄栏里不放「(TODAY)」那半截英文。 */
export const GROUPS: Array<{ key: GroupKey; label: string }> = [
  { key: 'today', label: '今天' },
  { key: 'yesterday', label: '昨天' },
  { key: 'earlier', label: '更早' },
]

/**
 * 分组边界：按当地 0 点切日，不用「距现在 24 小时」的滚动窗口 ——
 * 否则昨晚的记录会被算进今天（HistoryModal 的 mapToRecords 同口径）。
 */
export const groupOf = (value: string): GroupKey => {
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return 'earlier'
  const startToday = new Date()
  startToday.setHours(0, 0, 0, 0)
  const startYesterday = new Date(startToday)
  startYesterday.setDate(startYesterday.getDate() - 1)
  if (time >= startToday.getTime()) return 'today'
  if (time >= startYesterday.getTime()) return 'yesterday'
  return 'earlier'
}

/**
 * 时刻文案：侧边栏里**只在悬停/选中时才露出来**（09-18 三改用户拍板「去掉重复时钟」）——
 * 常驻的时钟图标 + 时刻要挤掉标题四五个字，而分组标签已经说明了「这是哪天」。
 * 今天给时刻、昨天带前缀、更早只给月/日。
 */
export const clockLabel = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const clock = date.toTimeString().slice(0, 5)
  const group = groupOf(value)
  if (group === 'today') return clock
  if (group === 'yesterday') return `昨天 ${clock}`
  return `${date.getMonth() + 1}/${date.getDate()}`
}

/** 按今天 / 昨天 / 更早切组，只返回非空的组。 */
export const groupConversations = (items: ConversationSummary[]) =>
  GROUPS.map((group) => ({
    ...group,
    records: items.filter((item) => groupOf(item.updated_at) === group.key),
  })).filter((group) => group.records.length > 0)

/* ===== 工作区分组（09-18 八改，后端 `work_space` 新字段）==========================
   用户口径：「有工作区的分到工作区里，没有的按时间」。所以这里只负责**切出有工作区的
   那一半**，剩下的原样返回交给 groupConversations 走今天 / 昨天 / 更早（见组件里的两段）。
   ============================================================================ */

/** 侧边栏一段工作区最多先铺几条，超出的收进「展开显示」（参考图里那行「展开显示」）。 */
export const WORKSPACE_PREVIEW = 5

export interface WorkspaceGroup {
  /** 分组键 = **完整的 work_space 原值**（不能拿末段文件夹名当键：两条路径可能末段重名）。 */
  key: string
  /** 展示用的文件夹名（原值最后一段）；取不出来时退回原值，不编名字。 */
  label: string
  records: ConversationSummary[]
}

/**
 * 按工作区切分。**不重排**：items 本来就是按最近消息倒序，
 * 组内顺序即时间倒序，组与组之间按「各自最近一条」的先后自然排列
 * （Map 保持插入顺序，所以第一条出现的会话决定这个组排第几）。
 */
export const splitByWorkspace = (items: ConversationSummary[]) => {
  const buckets = new Map<string, WorkspaceGroup>()
  const rest: ConversationSummary[] = []
  for (const item of items) {
    const key = (item.work_space ?? '').trim()
    if (!key) {
      // 没有工作区的（含存量 NULL）——用户拍板：**按时间排**，
      // 直接落到今天 / 昨天 / 更早，不再套一层「未指定工作区」标题（09-18 九改）
      rest.push(item)
      continue
    }
    const bucket = buckets.get(key)
    if (bucket) bucket.records.push(item)
    else buckets.set(key, { key, label: workspaceName(key) || key, records: [item] })
  }
  return { workspaces: [...buckets.values()], rest }
}
