import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Inbox, X } from 'lucide-react'
import type { BadgeTone } from '../design/tokens'
/**
 * 仪表读数的「启动式」：数值从 0 缓动滚到目标值，而不是凭空蹦出来。
 *
 * 规则：
 *  · 目标值不是有限数（接口没回传）时恒返回 null —— 调用方显示「—」，绝不假装在滚；
 *  · 数据晚到（异步）时同样从 0 起滚 —— 第一次亮起的感觉就是给它的；
 *  · 目标值中途变化（切时间范围）时从当前读数续滚，不回零。
 */
export function useCountUp(target: number | null | undefined, duration = 800): number | null {
  const [display, setDisplay] = useState<number | null>(null)
  const displayRef = useRef<number | null>(null)
  const rafRef = useRef(0)

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    if (target === null || target === undefined || !Number.isFinite(target)) {
      displayRef.current = null
      setDisplay(null)
      return
    }
    const from = displayRef.current ?? 0
    if (from === target) {
      displayRef.current = target
      setDisplay(target)
      return
    }
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      const value = from + (target - from) * eased
      displayRef.current = value
      setDisplay(value)
      if (progress < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration])

  return display
}

/** 状态徽章 —— 四种语义色见 styles/admin.css 的 .badge。 */
export function Badge({
  tone = 'slate',
  children,
  dot = false,
  icon,
}: {
  tone?: BadgeTone
  children: ReactNode
  dot?: boolean
  icon?: ReactNode
}) {
  return (
    <span className={`badge ${tone}`}>
      {dot && <i className="badge-dot" />}
      {icon}
      {children}
    </span>
  )
}

/** 页头：面包屑（系统 / 页面）+ 标题 + 导语 + 右侧工具槽。 */
/**
 * 台账行：**一整条**白卡，内部用竖 hairline 分格，像账本/年表的一行。
 *
 * 它和「四张并排的指标卡」是两种完全不同的形态 —— 后者是仪表面板（系统观察旗舰页专用），
 * 台账行是档案语汇：安静、紧凑、一格一条事实，适合「指标本身不需要可视化」的页面。
 * 每格：标签 / 读数（mono）/ 脚注。`tone` 只在「这一格需要被看见」时用（如待办积压）。
 */
export function Ledger({
  cells,
  size = 'md',
  className = '',
}: {
  cells: Array<{
    label: ReactNode
    value: ReactNode
    unit?: string
    sub?: ReactNode
    tone?: 'default' | 'coral' | 'emerald'
  }>
  size?: 'md' | 'sm'
  className?: string
}) {
  return (
    <section className={`ledger ${size === 'sm' ? 'ledger-sm' : ''} ${className}`}>
      {cells.map((cell, index) => (
        <div className={`ledger-cell${cell.tone && cell.tone !== 'default' ? ` tone-${cell.tone}` : ''}`} key={index}>
          <span className="ledger-label">{cell.label}</span>
          <span className="ledger-value">
            {cell.value}
            {cell.unit && <small>{cell.unit}</small>}
          </span>
          {cell.sub && <span className="ledger-sub">{cell.sub}</span>}
        </div>
      ))}
    </section>
  )
}

/**
 * 页头：眉标（业务域）+ 标题 + 导语 + 右侧工具槽。
 *
 * 眉标只标「当前在哪个业务域」（侧栏分组名），一行为限、灰绿色、12px ——
 * 它不该跟标题抢注意力。数据源状态与接口路径是调试信息，已移出页头
 * （mock/live 的切换入口在侧栏底部与系统设置）。
 */
export function PageHead({
  crumb,
  title,
  lede,
  tools,
}: {
  crumb: string
  title: string
  lede?: string
  tools?: ReactNode
}) {
  return (
    <div className="page-head">
      <div>
        {/* 面包屑只标「当前在哪个业务域」（中文）。
            数据源状态与接口路径是调试信息，2026-09-22 评审后移出页面标题区：
            mock/live 的切换入口在系统设置，不再挂在每页的眉头上。 */}
        {crumb && (
          <div className="breadcrumb">
            <span>{crumb}</span>
          </div>
        )}
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {tools && <div className="head-tools">{tools}</div>}
    </div>
  )
}

/**
 * 指标卡：值 + 单位 + 图标 + 脚注（可带涨跌）。alert 态走珊瑚红左锚定条。
 *
 * `delta.value` 允许 `undefined`，且**没有值就不渲染涨跌角标**。
 * 这是刻意的：这个 prop 以前是必填 `number`，于是调用方为了过类型检查随手写
 * `delta={{ value: 0.14 }}`，屏幕上就出现一个恒定的「↑14.0%」——接口里根本没有这个概念。
 * 缺失时正确的表达是「不显示」，而不是拿常量填空（少了这条，还会在值为 undefined 时
 * 打印出 `NaN%`）。
 */
export function Stat({
  label,
  value,
  unit,
  icon,
  foot,
  viz,
  delta,
  alert = false,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  unit?: string
  icon?: ReactNode
  foot?: ReactNode
  /**
   * 底部带里的微可视化（走势线 / 目标条 / 行动条）。
   * 它存在的意义是把「一个数字装在白盒子里」变成仪表读数：
   * 没有它，卡片下方必然空掉一大块，整屏读起来像填了真数字的线框稿。
   * 传进来的图形必须由接口真给了的数据算出 —— 没有数据就传空态，不要画示意曲线。
   */
  viz?: ReactNode
  delta?: { value?: number; suffix?: string; goodWhenUp?: boolean }
  alert?: boolean
  tone?: 'default' | 'coral' | 'emerald' | 'amber'
}) {
  const deltaValue = delta?.value
  const hasDelta = typeof deltaValue === 'number' && !Number.isNaN(deltaValue)
  const deltaClass = !hasDelta ? 'flat' : deltaValue > 0 ? 'up' : deltaValue < 0 ? 'down' : 'flat'
  return (
    <div className={`stat${alert ? ' is-alert' : ''}`}>
      <div className="stat-top">
        <span className="t">{label}</span>
        {icon && <span className={`stat-icon ${tone === 'default' ? '' : tone}`}>{icon}</span>}
      </div>
      <div className={`stat-value${alert ? ' is-alert' : ''}`}>
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {viz && <div className="stat-viz">{viz}</div>}
      {(foot || hasDelta) && (
        <div className="stat-foot">
          {hasDelta && (
            <span className={`delta ${deltaClass}`}>
              {deltaValue > 0 ? '↑' : deltaValue < 0 ? '↓' : '·'}
              {Math.abs(deltaValue * 100).toFixed(1)}%
            </span>
          )}
          {foot}
        </div>
      )}
    </div>
  )
}

/**
 * 迷你走势线：把一串真实序列压成一条 30px 高的线，用在指标卡的底部带里。
 *
 * 用 viewBox 0 0 100 30 + preserveAspectRatio="none" 让它随卡片宽度自由伸缩，
 * 再给描边加 vector-effect="non-scaling-stroke"，否则横向拉伸会把线压成粗细不均。
 * 少于两个点时**不画**（一个点连不成趋势），交给调用方显示空态文案。
 */
export function Sparkline({
  values,
  tone = 'neutral',
}: {
  values: number[]
  tone?: 'neutral' | 'coral' | 'emerald' | 'amber'
}) {
  const points = values.filter((value) => Number.isFinite(value))
  if (points.length < 2) return null

  const W = 100
  const H = 30
  const padY = 4
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const stepX = W / (points.length - 1)
  const yAt = (value: number) => H - padY - ((value - min) / span) * (H - padY * 2)
  const coords = points.map((value, index) => [index * stepX, yAt(value)] as const)
  const line = coords.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  const [endX, endY] = coords[coords.length - 1]
  const toneClass = tone === 'neutral' ? '' : ` tone-${tone}`

  return (
    <svg className={`spark${toneClass}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path className="spark-area" d={area} />
      {/* pathLength=1：把路径长度归一化，CSS 的自绘动画（dasharray:1）才能按全程计算 */}
      <path className="spark-line" d={line} pathLength={1} vectorEffect="non-scaling-stroke" />
      {/* 末端点：标出「最新一个采样」，让这条线有方向 */}
      <circle className="spark-end" cx={endX} cy={endY} r={2.6} />
    </svg>
  )
}

/** 卡片容器：可带标题栏与右侧槽位。`id` 用于设置页的锚点跳转。 */
export function Card({
  title,
  sub,
  extra,
  children,
  pad = true,
  className = '',
  id,
  onHeadClick,
  headExpanded,
}: {
  title?: ReactNode
  sub?: ReactNode
  extra?: ReactNode
  children: ReactNode
  pad?: boolean
  className?: string
  id?: string
  /** 让整个标题栏可点（折叠面板用）。给了就自动补上键盘可达性与 role。 */
  onHeadClick?: () => void
  /** 折叠面板的展开态，仅用于 aria-expanded。 */
  headExpanded?: boolean
}) {
  return (
    <section className={`card ${className}`} id={id}>
      {(title || extra) && (
        <header
          className="card-head"
          onClick={onHeadClick}
          role={onHeadClick ? 'button' : undefined}
          tabIndex={onHeadClick ? 0 : undefined}
          aria-expanded={onHeadClick ? headExpanded : undefined}
          onKeyDown={
            onHeadClick
              ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onHeadClick()
                  }
                }
              : undefined
          }
        >
          <div>
            {title && <h2>{title}</h2>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          <div className="spacer" />
          {extra}
        </header>
      )}
      {pad ? <div className="card-body">{children}</div> : children}
    </section>
  )
}

/** 空态。区分「后端没返回」与「筛选后没结果」两种语气，别让用户猜。 */
export function EmptyState({
  title,
  desc,
  tone = 'neutral',
  icon,
  action,
}: {
  title: string
  desc?: string
  tone?: 'neutral' | 'warning'
  icon?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty">
      {icon ?? (tone === 'warning' ? <AlertTriangle size={26} /> : <Inbox size={26} />)}
      <b>{title}</b>
      {desc && <span style={{ maxWidth: 420, lineHeight: 1.6 }}>{desc}</span>}
      {action}
    </div>
  )
}

/** 骨架行，用于表格/列表加载态。 */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ padding: '16px 20px', display: 'grid', gap: 14 }}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr .8fr .6fr', gap: 16, alignItems: 'center' }}>
          <div className="skeleton" style={{ width: '82%' }} />
          <div className="skeleton" style={{ width: '64%' }} />
          <div className="skeleton" style={{ width: '52%' }} />
          <div className="skeleton" style={{ width: '44%' }} />
        </div>
      ))}
    </div>
  )
}

/** 抽屉：右侧滑出，ESC 关闭，点遮罩关闭。 */
export function Drawer({
  open,
  title,
  sub,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean
  title: ReactNode
  sub?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
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

  return (
    <>
      <div className="drawer-veil" onClick={onClose} />
      <aside className={`drawer${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <header className="drawer-head">
          <div className="titles">
            <h2>{title}</h2>
            {sub && <div className="sub">{sub}</div>}
          </div>
          <span className="esc-hint">
            <kbd>ESC</kbd>
          </span>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </>
  )
}

/** 弹窗：确认类 560px，配置类 wide=840px。 */
export function Modal({
  open,
  title,
  sub,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean
  title: ReactNode
  sub?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
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

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className={`modal${wide ? ' wide' : ''}`} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <header className="modal-head">
          <div className="titles">
            <h2>{title}</h2>
            {sub && <div className="sub">{sub}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/**
 * 分段控件（时间范围 / 状态切换）。
 *
 * `disabled` 不是装饰：当后端没有对应的查询参数时，控件应当**禁用并说明原因**，
 * 而不是留一个点得动、点了没反应的假开关（那比没有控件更像半成品）。
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  title,
}: {
  value: T
  options: Array<{ value: T; label: ReactNode }>
  onChange: (value: T) => void
  disabled?: boolean
  title?: string
}) {
  return (
    <div className={`segmented${disabled ? ' is-disabled' : ''}`} role="tablist" title={title}>
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={value === option.value}
          className={value === option.value ? 'on' : ''}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** 筛选页签（带计数）。 */
export function Chip({
  on,
  children,
  count,
  onClick,
  disabled = false,
}: {
  on?: boolean
  children: ReactNode
  count?: number
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button className={`chip${on ? ' on' : ''}`} onClick={onClick} disabled={disabled}>
      {children}
      {count !== undefined && <b>{count}</b>}
    </button>
  )
}

/** 开关。 */
export function Switch({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label?: string }) {
  return (
    <button
      className={`switch${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    />
  )
}

/** 复选框。 */
export function Checkbox({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label?: string }) {
  return (
    <button
      className={`checkbox${on ? ' on' : ''}`}
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onChange(!on)
      }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </button>
  )
}

/** 提示条：coral=高风险 / amber=需注意 / emerald=成功 / slate=中性说明。 */
export function Notice({
  tone = 'slate',
  icon,
  children,
}: {
  tone?: 'coral' | 'amber' | 'emerald' | 'slate'
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={`notice ${tone}`}>
      {icon ?? (tone === 'coral' ? <AlertTriangle size={15} /> : null)}
      <div>{children}</div>
    </div>
  )
}

/** 分页器。页数多时中间折叠。 */
export function Pager({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number
  pageSize: number
  total: number
  onChange: (page: number) => void
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  if (pageCount <= 1) return null

  const pages: Array<number | 'gap'> = []
  const push = (n: number | 'gap') => pages.push(n)
  if (pageCount <= 7) {
    for (let i = 1; i <= pageCount; i += 1) push(i)
  } else {
    push(1)
    if (page > 3) push('gap')
    for (let i = Math.max(2, page - 1); i <= Math.min(pageCount - 1, page + 1); i += 1) push(i)
    if (page < pageCount - 2) push('gap')
    push(pageCount)
  }

  return (
    <div className="pager">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}>
        上一页
      </button>
      {pages.map((item, index) =>
        item === 'gap' ? (
          <span className="gap" key={`gap-${index}`}>
            …
          </span>
        ) : (
          <button key={item} className={item === page ? 'on' : ''} onClick={() => onChange(item)}>
            {item}
          </button>
        ),
      )}
      <button disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
        下一页
      </button>
    </div>
  )
}

/** 数据源标记：live 模式下后端未返回时用它标注，避免把「缺数据」看成「数据是 0」。 */
export function MockFlag({ label = 'Mock 数据' }: { label?: string }) {
  return <span className="mock-flag">{label}</span>
}
