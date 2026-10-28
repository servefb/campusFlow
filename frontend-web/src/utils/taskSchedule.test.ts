import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GRACE_HOURS, resolveDue } from './taskSchedule'

/** 时限判定驱动两处 UI：左列的「已截止」胶囊与右栏底部主按钮（提交 / 申请延期），
    所以三个分支都要钉住 —— 尤其是 expired 这个新字段，它决定用户能不能提交。 */
describe('resolveDue', () => {
  const NOW = new Date('2026-09-15T12:00:00+08:00').getTime()

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
  afterEach(() => { vi.useRealTimers() })

  const at = (offsetHours: number) => new Date(NOW + offsetHours * 3600000).toISOString()

  it('缺省或不可解析时返回 null（调用方不渲染时限）', () => {
    expect(resolveDue(undefined)).toBeNull()
    expect(resolveDue(null)).toBeNull()
    expect(resolveDue('不是时间')).toBeNull()
  })

  it('未到期：给剩余时长，不超期、不截止', () => {
    const due = resolveDue(at(50))
    expect(due).toMatchObject({ text: '剩余 2 天', overdue: false, expired: false, consequence: '' })
    expect(due?.deadlineText).toMatch(/^09-17 \d{2}:00$/)
  })

  it('超期但在宽限期内：仍可补交，主按钮不该切成延期', () => {
    const due = resolveDue(at(-(GRACE_HOURS - 1)))
    expect(due).toMatchObject({ text: '已超时', overdue: true, expired: false })
    expect(due?.consequence).toBe('已超时，仍可补交')
  })

  it('超过宽限期：已截止，必须申请延期', () => {
    const due = resolveDue(at(-(GRACE_HOURS + 1)))
    expect(due).toMatchObject({ text: '已截止', overdue: true, expired: true })
    expect(due?.consequence).toBe('已截止，需申请延期')
  })
})
