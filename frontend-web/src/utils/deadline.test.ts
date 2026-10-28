import { describe, expect, it, vi, afterEach } from 'vitest'
import { formatDeadline } from './deadline'

/**
 * 截止时间分档：红只留给「真紧急」。
 * 用假时钟固定"今天"，否则断言会随真实日期漂移（这正是当初踩过的坑）。
 */
const freeze = (iso: string) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}
afterEach(() => vi.useRealTimers())

describe('formatDeadline', () => {
  it('没有截止时间返回 null（调用方据此隐藏整块，不渲染空日期）', () => {
    expect(formatDeadline(null)).toBeNull()
    expect(formatDeadline(undefined)).toBeNull()
    expect(formatDeadline('')).toBeNull()
  })

  it('8 天以上是中性档', () => {
    freeze('2026-09-15T09:00:00+08:00')
    const info = formatDeadline('2026-10-15T18:00:00+08:00', '申请截止')!
    expect(info.tone).toBe('normal')
    expect(info.text).toContain('申请截止')
    expect(info.text).toContain('10/15')
  })

  it('7 天以内是临近档（橙色），并写明还有几天', () => {
    freeze('2026-09-15T09:00:00+08:00')
    const info = formatDeadline('2026-09-22T22:00:00+08:00', '报名截止')!
    expect(info.tone).toBe('soon')
    expect(info.text).toContain('报名截止')
    expect(info.text).toMatch(/还有 \d 天/)
  })

  it('48 小时内是紧急档（红色）', () => {
    freeze('2026-09-15T09:00:00+08:00')
    const info = formatDeadline('2026-09-16T18:00:00+08:00', '申请截止')!
    expect(info.tone).toBe('urgent')
  })

  it('已过期的标注「已逾期」并走紧急档', () => {
    freeze('2026-09-15T09:00:00+08:00')
    const info = formatDeadline('2026-09-10T18:00:00+08:00', '申请截止')!
    expect(info.tone).toBe('urgent')
    expect(info.expired).toBe(true)
    expect(info.text).toContain('已逾期')
  })

  it('当天到期标「今天」、次日标「明天」，不让用户自己算', () => {
    freeze('2026-09-15T09:00:00+08:00')
    expect(formatDeadline('2026-09-15T23:00:00+08:00')!.text).toContain('今天')
    expect(formatDeadline('2026-09-16T23:00:00+08:00')!.text).toContain('明天')
  })

  it('推不出语义时退回「截止」，不写死成某个动作', () => {
    freeze('2026-09-15T09:00:00+08:00')
    expect(formatDeadline('2026-10-15T18:00:00+08:00')!.text.startsWith('截止 ·')).toBe(true)
  })

  it('时间串无法解析时兜底展示原文，不崩也不静默丢弃', () => {
    freeze('2026-09-15T09:00:00+08:00')
    const info = formatDeadline('九月中旬', '申请截止')!
    expect(info.text).toContain('九月中旬')
    expect(info.tone).toBe('normal')
    expect(info.daysLeft).toBeNull()
  })
})
