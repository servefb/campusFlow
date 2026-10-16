import { useEffect } from 'react'
import { BookOpen, GraduationCap, Landmark, ListChecks, Route, Scale, Workflow, X, type LucideIcon } from 'lucide-react'
import type { Agent } from '../services/workspace'

const BY_KEY: Record<string, LucideIcon> = {
  router_agent: Route,
  policy_agent: Scale,
  academic_agent: GraduationCap,
  workflow_agent: Workflow,
}
const FALLBACK_ICONS: LucideIcon[] = [Route, Scale, GraduationCap, Workflow, BookOpen, Landmark, ListChecks]

// 不同智能体使用不同图标：优先按 key，其次按名称关键词，最后按序号兜底，确保不重复。
function agentIcon(agent: Agent, index: number): LucideIcon {
  if (BY_KEY[agent.key]) return BY_KEY[agent.key]
  const name = agent.name || ''
  if (/路由/.test(name)) return Route
  if (/政策|奖助|资助/.test(name)) return Scale
  if (/教务|教学|学籍/.test(name)) return GraduationCap
  if (/事务|流转|材料/.test(name)) return Workflow
  return FALLBACK_ICONS[index % FALLBACK_ICONS.length]
}

function BurstSvg({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="2.4" />
        <line x1="12" y1="12" x2="12" y2="4.8" />
        <line x1="12" y1="12" x2="18.2" y2="8.4" />
        <line x1="12" y1="12" x2="18.2" y2="15.6" />
        <line x1="12" y1="12" x2="12" y2="19.2" />
        <line x1="12" y1="12" x2="5.8" y2="15.6" />
        <line x1="12" y1="12" x2="5.8" y2="8.4" />
      </g>
      <g fill="currentColor">
        <circle cx="12" cy="4.8" r="1.6" />
        <circle cx="18.2" cy="8.4" r="1.6" />
        <circle cx="18.2" cy="15.6" r="1.6" />
        <circle cx="12" cy="19.2" r="1.6" />
        <circle cx="5.8" cy="15.6" r="1.6" />
        <circle cx="5.8" cy="8.4" r="1.6" />
      </g>
    </svg>
  )
}

/**
 * 卡片领域标签（09-17）：直接读 /agents 下发的 agent.domains（agents 表 JSON 列），
 * 兼容字符串与 {key,name} 对象两种存法；缺省/为空的卡片回落到「对应业务」行。
 */
function agentDomainLabels(agent: Agent): string[] {
  return (agent.domains ?? [])
    .map((item) => (typeof item === 'string' ? item : item.name || item.key || ''))
    .filter((label): label is string => Boolean(label))
}

export function AgentMatrixModal({
  open,
  onClose,
  agents,
  selectedKey,
  onSelect,
  onStart,
}: {
  open: boolean
  onClose: () => void
  agents: Agent[]
  selectedKey: string
  onSelect: (key: string) => void
  onStart?: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  // 当前调度的 Agent：优先按已选 key 匹配；无法匹配（含 key 缺失）时默认第一个，保证仅一个"对话中"。
  const activeIndex =
    selectedKey && selectedKey !== 'auto' && selectedKey !== ''
      ? agents.findIndex((agent) => agent.key === selectedKey)
      : 0
  const resolvedActive = activeIndex >= 0 ? activeIndex : 0

  return (
    <div className="agent-matrix-layer">
      <div className="agent-matrix-backdrop" onClick={onClose} />
      <div className="agent-matrix" role="dialog" aria-modal="true" aria-label="Campus Flow 智能体管理">
        <header className="agent-matrix-head">
          <div className="agent-matrix-title">
            <span className="agent-matrix-icon">
              <BurstSvg size={17} />
            </span>
            <div>
              <h2>
                Campus Flow <b>智能体</b> 管理
              </h2>
              <p>全域专精智能体实时资源与权限调度</p>
            </div>
          </div>
          <button type="button" className="agent-matrix-close" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="agent-matrix-body">
          {agents.length ? (
            agents.map((agent, index) => {
              const online = agent.status === 'online'
              const active = index === resolvedActive
              const Icon = agentIcon(agent, index)
              // 领域标签（09-17）：直接读 agent.domains（/agents 已下发），空则回落「对应业务」行
              const domainLabels = agentDomainLabels(agent)
              return (
                <article className="agent-card" key={agent.key}>
                  <span className="agent-card-icon">
                    <Icon size={15} />
                  </span>
                  <div className="agent-card-main">
                    <div className="agent-card-head">
                      <h3>{agent.name}</h3>
                      <span className={`agent-status${online ? ' online' : ''}`}>{online ? '在线' : '离线'}</span>
                      <button type="button" className={`agent-switch${active ? ' active' : ''}`} onClick={() => onSelect(agent.key)}>
                        {active ? '对话中' : '切换调用'}
                      </button>
                    </div>
                    <p>{agent.description || '暂无职责说明。'}</p>
                    {domainLabels.length > 0 ? (
                      <div className="agent-card-domains">
                        {domainLabels.map((label) => (
                          <span className="agent-domain-tag" key={label}>{label}</span>
                        ))}
                      </div>
                    ) : (
                      <div className="agent-scope">
                        <span>对应业务：</span>全校行政办事与政策库
                      </div>
                    )}
                  </div>
                </article>
              )
            })
          ) : (
            <p className="agent-matrix-empty">Agent 列表暂不可用</p>
          )}
        </div>

        <footer className="agent-matrix-foot">
          <span className="agent-matrix-hint">支持自定义接入学院二级数据库</span>
          <button type="button" className="agent-matrix-start" onClick={() => { onStart?.(); onClose() }}>
            完成并开始对话
          </button>
        </footer>
      </div>
    </div>
  )
}
