import { describe, expect, it } from 'vitest'
import { computeTaskProgress } from './taskProgress'

describe('computeTaskProgress', () => {
  it('completed 任务恒为 100，即使 current_step_order 缺失', () => {
    expect(computeTaskProgress({ status: 'completed', current_step_order: 4, total_steps: 4 })).toBe(100)
    expect(computeTaskProgress({ status: 'completed', total_steps: 4 })).toBe(100)
  })

  it('进行中任务按已完成步骤数算：停在第 2/2 步是 50%，不是 100%（回归：进行中不得满格）', () => {
    expect(computeTaskProgress({ status: 'in_progress', current_step_order: 2, total_steps: 2 })).toBe(50)
    expect(computeTaskProgress({ status: 'in_progress', current_step_order: 2, total_steps: 4 })).toBe(25)
    expect(computeTaskProgress({ status: 'under_review', current_step_order: 3, total_steps: 4 })).toBe(50)
  })

  it('第一步（order=1）进度为 0', () => {
    expect(computeTaskProgress({ status: 'in_progress', current_step_order: 1, total_steps: 4 })).toBe(0)
  })

  it('draft 为 0，cancelled 不渲染进度条', () => {
    expect(computeTaskProgress({ status: 'draft', current_step_order: 1, total_steps: 5 })).toBe(0)
    expect(computeTaskProgress({ status: 'cancelled', current_step_order: 2, total_steps: 5 })).toBeNull()
  })

  it('total_steps 或 current_step_order 缺失/非法时返回 null，不硬凑数字', () => {
    expect(computeTaskProgress({ status: 'in_progress' })).toBeNull()
    expect(computeTaskProgress({ status: 'in_progress', current_step_order: 2 })).toBeNull()
    expect(computeTaskProgress({ status: 'in_progress', current_step_order: 2, total_steps: 0 })).toBeNull()
    expect(computeTaskProgress({ status: 'in_progress', total_steps: 4 })).toBeNull()
  })

  it('后端给的 order 超过 total 时按 total 钳制，不爆 100', () => {
    expect(computeTaskProgress({ status: 'in_progress', current_step_order: 9, total_steps: 4 })).toBe(75)
  })

  it('任务本身缺失（null/undefined）返回 null，不抛错（回归：/workspace 首屏 tasks 为空时曾把首页打白屏）', () => {
    expect(computeTaskProgress(null)).toBeNull()
    expect(computeTaskProgress(undefined)).toBeNull()
  })
})
