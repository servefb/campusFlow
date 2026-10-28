/** 任务清单里的一项（后端 TodoListMiddleware 的 write_todos 工具，10-09 接入）。 */
export interface TraceTodo {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/**
 * 解析 `event: tool`（tool=write_todos）的 args JSON → 任务清单。
 * args 是完整参数串（后端在 AI 消息结算时才发 tool 事件），但模型输出不可信：
 * 解析失败 / 任一项形状不对一律返回 null，调用方退回通用工具行 —— 宁可丑也不能崩。
 */
export function parseWriteTodosArgs(args: string | undefined): TraceTodo[] | null {
  try {
    const raw = JSON.parse(args || '{}') as { todos?: unknown }
    if (!Array.isArray(raw.todos) || !raw.todos.length) return null
    const todos: TraceTodo[] = []
    for (const item of raw.todos) {
      if (!item || typeof item !== 'object') return null
      const content = typeof item.content === 'string' ? item.content.trim() : ''
      const status = item.status
      if (!content || (status !== 'pending' && status !== 'in_progress' && status !== 'completed')) return null
      todos.push({ content, status })
    }
    return todos
  } catch {
    return null
  }
}
