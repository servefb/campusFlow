import { useEffect, useState } from 'react'
import { Check, ChevronDown, Circle, ListTodo, Loader2 } from 'lucide-react'
import type { TraceTodo } from '../utils/writeTodos'

/**
 * 任务清单面板（10-09，Codex 式）：悬浮在输入框上方的一张卡，展示**当前**任务清单。
 *
 * - 数据来自本轮流里最近一次 `write_todos`（每次调用全量替换 → 面板原地更新，
 *   时间线上不留任务卡 —— 清单是「当前进度」不是历史，历史语义交给过程区的
 *   前言/工具行）。
 * - 头部给进度计数（n/m），列表三态：completed 划线绿勾 / in_progress 转圈 / pending 空圈。
 * - 默认展开，可点头收成一行；新清单到达时自动回到展开态。
 * - 与 todos 数据同生命周期（不落库），刷新后为空。
 */
export function TodoPanel({ todos }: { todos: TraceTodo[] }) {
  const [collapsed, setCollapsed] = useState(false)
  // 新清单（进度推进）到达时自动展开 —— 收起是用户对「这一版清单」的选择，不该连坐到下一版
  useEffect(() => {
    setCollapsed(false)
  }, [todos])

  const done = todos.filter((todo) => todo.status === 'completed').length
  return (
    <div className="convo-todo-panel">
      <button
        type="button"
        className="convo-todo-head"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((prev) => !prev)}
      >
        <ListTodo size={13} />
        <span>任务清单</span>
        <em>{done}/{todos.length}</em>
        <ChevronDown size={13} className={`convo-todo-chev${collapsed ? '' : ' open'}`} />
      </button>
      {!collapsed ? (
        <ul className="convo-todo-list">
          {todos.map((todo, index) => (
            <li className={`is-${todo.status}`} key={index}>
              {todo.status === 'completed' ? (
                <Check size={13} />
              ) : todo.status === 'in_progress' ? (
                <Loader2 size={13} className="convo-spin" />
              ) : (
                <Circle size={13} />
              )}
              <span>{todo.content}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
