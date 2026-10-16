import { describe, expect, it } from 'vitest'
import { clockLabel, groupConversations, groupOf, splitByWorkspace } from './conversationGroups'
import type { ConversationSummary } from '../types/api'

/** 侧边栏「今天 / 昨天 / 更早」分组与悬停时刻（09-18 三改）。 */
const record = (id: number, title: string, updatedAt: string): ConversationSummary => ({
  id,
  title,
  updated_at: updatedAt,
})

const at = (dayOffset: number, hour: number, minute: number) => {
  const date = new Date()
  date.setDate(date.getDate() + dayOffset)
  date.setHours(hour, minute, 0, 0)
  return date.toISOString()
}

const todayAt = (hour: number, minute = 12) => at(0, hour, minute)
const yesterdayAt = (hour: number, minute = 5) => at(-1, hour, minute)
const earlierAt = () => at(-9, 10, 0)

describe('会话分组', () => {
  it('按今天 / 昨天 / 更早切组，空组不出现', () => {
    const groups = groupConversations([
      record(1, '今天的会话', todayAt(9)),
      record(2, '昨天的会话', yesterdayAt(20)),
      record(3, '更早的会话', earlierAt()),
    ])
    expect(groups.map((group) => [group.key, group.records.length])).toEqual([
      ['today', 1],
      ['yesterday', 1],
      ['earlier', 1],
    ])
    expect(groupConversations([record(1, '只有今天', todayAt(9))]).map((group) => group.key)).toEqual(['today'])
    expect(groupConversations([])).toEqual([])
  })

  it('切日是当地 0 点，不是「距现在 24 小时」的滚动窗口', () => {
    // 昨天 23:59 仍算昨天（滚动窗口下会被算成今天）
    expect(groupOf(yesterdayAt(23, 59))).toBe('yesterday')
    // 今天 00:01 算今天
    expect(groupOf(todayAt(0, 1))).toBe('today')
    // 时间解析不了时兜底到「更早」，不至于丢记录
    expect(groupOf('不是时间')).toBe('earlier')
  })
})

describe('时刻文案', () => {
  it('今天给时刻、昨天带前缀、更早给月/日', () => {
    expect(clockLabel(todayAt(9, 12))).toBe('09:12')
    expect(clockLabel(yesterdayAt(20))).toBe('昨天 20:05')
    expect(clockLabel(earlierAt())).toMatch(/^\d{1,2}\/\d{1,2}$/)
    expect(clockLabel('不是时间')).toBe('')
  })
})

/** 工作区分组（09-18 八改，后端 `/history/conversations` 新字段 `work_space`）。
 *  「最后一级文件夹名」本身的口径单测在 `workspacePath.test.ts`（输入框 chip 也用同一个）。 */
describe('按工作区切分', () => {
  it('有工作区的进分组、没值的进 rest，两边都不重排', () => {
    const items: ConversationSummary[] = [
      { ...record(1, 'A', todayAt(15)), work_space: 'd:proj/campusflow' },
      { ...record(2, 'B', todayAt(14)) },
      { ...record(3, 'C', todayAt(13)), work_space: 'd:exam' },
      { ...record(4, 'D', todayAt(12)), work_space: 'd:proj/campusflow' },
    ]
    const { workspaces, rest } = splitByWorkspace(items)
    // 组内保持原顺序（= 时间倒序）；组与组之间按「第一条约会出现的先后」
    expect(workspaces.map((group) => [group.label, group.records.map((item) => item.id)])).toEqual([
      ['campusflow', [1, 4]],
      ['exam', [3]],
    ])
    expect(rest.map((item) => item.id)).toEqual([2])
  })

  it('末段同名的两个工作区不并组：键是完整路径', () => {
    const { workspaces } = splitByWorkspace([
      { ...record(1, 'A', todayAt(15)), work_space: 'd:one/proj' },
      { ...record(2, 'B', todayAt(14)), work_space: 'd:two/proj' },
    ])
    // 标签同名（都显示 proj），但必须是两组 —— 拿文件夹名当键就会把它们并成一个
    expect(workspaces.map((group) => group.label)).toEqual(['proj', 'proj'])
    expect(workspaces.map((group) => group.key)).toEqual(['d:one/proj', 'd:two/proj'])
  })

  it('全都没有工作区 → workspaces 空、全部落进 rest', () => {
    const { workspaces, rest } = splitByWorkspace([record(1, 'A', todayAt(15)), record(2, 'B', yesterdayAt(9))])
    expect(workspaces).toEqual([])
    expect(rest.map((item) => item.id)).toEqual([1, 2])
  })

  it('空串 / 空白 / null 都当「没有工作区」，不建组', () => {
    const { workspaces, rest } = splitByWorkspace([
      { ...record(1, 'A', todayAt(15)), work_space: '   ' },
      { ...record(2, 'B', todayAt(14)), work_space: null },
      { ...record(3, 'C', todayAt(13)) },
    ])
    expect(workspaces).toEqual([])
    expect(rest).toHaveLength(3)
  })
})
