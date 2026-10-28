import { MessageSquare, Workflow } from 'lucide-react'
import { setAskMode, useAskMode, type AskMode } from '../services/askMode'

const MODES: Array<{ key: AskMode; label: string; icon: typeof MessageSquare; title: string }> = [
  { key: 'chat', label: 'Chat', icon: MessageSquare, title: '纯对话：直接回答，不调度 Agent' },
  { key: 'agent', label: 'Agent', icon: Workflow, title: 'Agent 模式：交给 Campus Flow 处理，它自己拆解、按需派子智能体' },
]

/**
 * 提问模式切换（Chat / Agent）。放在页头状态位（原「工作台数据来自接口」胶囊处）。
 * 只做展示与请求字段，不改后端既有行为。
 *
 * 09-19 二十三改：液态滑块**不在这里渲染**了 —— 侧栏把滑块上移到背景组
 * （`.assistant-sidebar-head-thumb`，两个槽位），本组件
 * 回归纯分段；顶栏变体依旧零改动。
 */
export function AskModeSwitch({ compact = false }: { compact?: boolean }) {
  const mode = useAskMode()
  return (
    <div
      className={`ask-mode-switch${compact ? ' compact' : ''}`}
      role="group"
      aria-label="提问模式"
    >
      {MODES.map((item) => {
        const Icon = item.icon
        const active = item.key === mode
        return (
          <button
            key={item.key}
            type="button"
            className={`ask-mode-item${active ? ' active' : ''}`}
            aria-pressed={active}
            aria-label={item.label}
            title={item.title}
            onClick={() => setAskMode(item.key)}
          >
            <Icon size={compact ? 15 : 13} />
            {!compact && item.label}
          </button>
        )
      })}
    </div>
  )
}
