/**
 * 任务进度的统一口径 —— /tasks 列卡与 /workspace 焦点卡共用，避免两处各算各的。
 * -----------------------------------------------------------------------------
 * 自 2026-09 起后端不再返回 progress，列表接口只回 `status`、`current_step`、
 * `current_step_order` 与 `total_steps`（步骤实例总数），进度由前端按同一公式推导：
 *   · completed → 100
 *   · cancelled → null（取消的任务不渲染进度条）
 *   · draft     → 0
 *   · 其余      → round(100 × (current_step_order − 1) / total_steps)
 * 进度 = 已完成步骤数占比：当前步骤视为「进行中」，不计入已完成。
 * 因此进行中的任务最高只到 (total−1)/total，永远不会显示 100%——
 * 否则会出现「停在最后一步的任务进度满格、但状态还是进行中」的矛盾
 * （如 2 步流程停在第 2 步，按 order/total 会算出 100%）。
 * total_steps 或 current_step_order 缺失时返回 null —— 宁可不渲染进度条，也不硬凑数字。
 * 调用方传 null / undefined（如 /workspace 焦点卡在任务列表为空时 tasks[0]）同样返回 null，
 * 不抛错 —— 该函数在首屏渲染路径上，抛错会把整个应用打白屏（2026-09-15 首页白屏回归）。
 */
export interface TaskProgressInput {
  status: 'draft' | 'in_progress' | 'material_required' | 'under_review' | 'completed' | 'cancelled'
  current_step_order?: number | null
  total_steps?: number | null
}

export const computeTaskProgress = (task: TaskProgressInput | null | undefined): number | null => {
  if (!task) return null
  const total = typeof task.total_steps === 'number' && task.total_steps > 0 ? task.total_steps : null
  if (total === null || task.status === 'cancelled') return null
  if (task.status === 'completed') return 100
  if (task.status === 'draft') return 0

  const order = typeof task.current_step_order === 'number' && task.current_step_order > 0
    ? Math.min(task.current_step_order, total)
    : null
  if (order === null) return null
  return Math.round((100 * (order - 1)) / total)
}
