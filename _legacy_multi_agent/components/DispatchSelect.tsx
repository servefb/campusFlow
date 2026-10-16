import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Settings2, Workflow, X } from 'lucide-react'

export interface DispatchOption {
  value: string
  label: string
  /** 可选的说明（后端 /agents 的 description），有才渲染 */
  description?: string
}

// 自定义调度入口。两种形态：
// - dropdown（默认，工作台首页用）：贴着触发的浮层菜单；
// - dialog（对话页用，09-16 用户拍板）：居中弹窗，点当前 Agent 名字后出现，
//   不再是下拉框 —— 列出全部 Agent 及其说明，选中项打勾。
export function DispatchSelect({
  value,
  options,
  onChange,
  ariaLabel,
  label,
  variant = 'dialog',
}: {
  value: string
  options: DispatchOption[]
  onChange: (value: string) => void
  ariaLabel?: string
  /** 触发按钮内的前置标签（如「当前调度：」）。整块（含标签）都可点开弹窗。 */
  label?: string
  variant?: 'dropdown' | 'dialog'
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const selected = options.find((option) => option.value === value) ?? options[0]

  // 打开时把光标落在当前选中项上
  useEffect(() => {
    if (open) setActive(Math.max(options.findIndex((option) => option.value === value), 0))
  }, [open, options, value])

  useEffect(() => {
    if (!open) return
    if (variant === 'dialog') dialogRef.current?.focus()
    const onClickOutside = (event: MouseEvent) => {
      if (variant !== 'dropdown') return
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open, variant])

  const pick = useCallback(
    (next: string) => {
      onChange(next)
      setOpen(false)
    },
    [onChange],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        return
      }
      if (variant !== 'dialog') return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setActive((current) => (current + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const target = options[active]
        if (target) pick(target.value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, open, options, pick, variant])

  return (
    <div className={`dispatch-select${open ? ' open' : ''}`} ref={rootRef}>
      {/* 只有「当前调度：」这块是控件（点它开弹窗）；Agent 名字只作展示，不参与交互 */}
      <button
        type="button"
        className="dispatch-trigger"
        aria-haspopup={variant === 'dialog' ? 'dialog' : 'listbox'}
        aria-expanded={open}
        aria-label={`${ariaLabel || '切换调度'}，当前为${selected?.label ?? ''}`}
        onClick={() => setOpen((current) => !current)}
      >
        {label ? (
          <>
            <Settings2 size={15} />
            <span className="dispatch-label">{label}</span>
          </>
        ) : (
          // 没有前置标签时才用「值 + 箭头」的形态（贴边下拉的老样子），有标签则不加箭头
          <ChevronDown size={14} />
        )}
      </button>
      {/* agent 模式：名字前带一个调度图标（与 chat 模式的 💬 Chat 对称） */}
      <Workflow size={13} className="dispatch-mode-icon" />
      <span className="dispatch-current">{selected?.label}</span>

      {open && variant === 'dropdown' && (
        <div className="dispatch-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              key={`${option.value}-${index}`}
              className={`dispatch-option${option.value === value ? ' selected' : ''}`}
              onClick={() => pick(option.value)}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}

      {open &&
        variant === 'dialog' &&
        createPortal(
          <div className="dispatch-dialog-backdrop" onMouseDown={() => setOpen(false)}>
            <div
              className="dispatch-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabel || '选择智能体'}
              tabIndex={-1}
              ref={dialogRef}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header>
                <h3>选择智能体</h3>
                <p>选好后，这一轮提问交给它处理</p>
                <button type="button" className="dispatch-dialog-close" aria-label="关闭" onClick={() => setOpen(false)}>
                  <X size={15} />
                </button>
              </header>
              <div className="dispatch-dialog-list" role="listbox" aria-label={ariaLabel}>
                {options.map((option, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    key={`${option.value}-${index}`}
                    className={`dispatch-dialog-row${option.value === value ? ' selected' : ''}${index === active ? ' active' : ''}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(option.value)}
                  >
                    <span className="dispatch-dialog-row-main">
                      <strong>{option.label}</strong>
                      {option.description ? <small>{option.description}</small> : null}
                    </span>
                    {option.value === value && <Check size={15} />}
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
