/**
 * 行级 diff（10-07）：「已修改的文件」Codex 式视图的本地计算。
 *
 * 数据来源是 SSE `event: tool` 的 args —— edit_file 带 old_string/new_string，
 * write_file 带 content，所以前端自己算 diff，不需要后端新事件。
 * LCS 是 O(n·m)，只用于小规模编辑（调用方先按字符上限把关）；超大改动直接不存
 * diff，抽屉降级走「读文件内容预览」那条路。
 */

export interface DiffOp {
  type: 'ctx' | 'add' | 'del' | 'gap'
  text: string
  /** 旧文件行号（ctx/del 有） */
  oldNo?: number
  /** 新文件行号（ctx/add 有） */
  newNo?: number
}

export interface DiffStats { added: number; removed: number }

/** 超过这个字符数的 before/after 不做 diff（防止 O(n·m) 爆内存） */
export const DIFF_MAX_CHARS = 20000

/** diff 一行都没有（写入空文件等）：也算合法，全空 */
export function diffLines(before: string, after: string): DiffOp[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const n = a.length
  const m = b.length
  // 滚动数组版 LCS 表（n·m 的空间在 2 万字符级也不会太大，但按行数算更省）
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'ctx', text: a[i], oldNo: i + 1, newNo: j + 1 })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: a[i], oldNo: i + 1 })
      i += 1
    } else {
      ops.push({ type: 'add', text: b[j], newNo: j + 1 })
      j += 1
    }
  }
  while (i < n) {
    ops.push({ type: 'del', text: a[i], oldNo: i + 1 })
    i += 1
  }
  while (j < m) {
    ops.push({ type: 'add', text: b[j], newNo: j + 1 })
    j += 1
  }
  return ops
}

/** 统计增删行数（不计上下文行）。 */
export function countDiff(ops: DiffOp[]): DiffStats {
  let added = 0
  let removed = 0
  for (const op of ops) {
    if (op.type === 'add') added += 1
    else if (op.type === 'del') removed += 1
  }
  return { added, removed }
}

/**
 * 折叠上下文：只保留改动附近 context 行，两段之间插一条 `gap`（渲染成省略号）。
 * 全是改动（如新文件 diff）时原样返回、零 gap。
 */
export function collapseContext(ops: DiffOp[], context = 3): DiffOp[] {
  const changeIdx: number[] = []
  ops.forEach((op, index) => {
    if (op.type !== 'ctx') changeIdx.push(index)
  })
  if (!changeIdx.length) return ops // 没有改动（两次内容相同）：不折叠，照常展示
  const keep = new Set<number>()
  for (const idx of changeIdx) {
    for (let k = idx - context; k <= idx + context; k++) {
      if (k >= 0 && k < ops.length) keep.add(k)
    }
  }
  const out: DiffOp[] = []
  let gapOpen = false
  ops.forEach((op, index) => {
    if (keep.has(index)) {
      out.push(op)
      gapOpen = false
    } else if (!gapOpen) {
      out.push({ type: 'gap', text: '' })
      gapOpen = true
    }
  })
  return out
}
