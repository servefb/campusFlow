import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Check, ChevronLeft, ChevronRight, Pencil, Square } from 'lucide-react'
import type { AskUserQuestion } from '../services/conversations'

/** 「其他」哨兵值：选中它时改用自由输入，不直接作为答案回传。 */
const OTHER = '__other__'
/** 「跳过」哨兵值：仅可选题出现，选中表示明确留空。 */
const SKIP = '__skip__'

interface Draft {
  /** 已勾选的选项值（multiple_choice 至多一个） */
  selected: string[]
  /** 「其他」自由输入 */
  other: string
  /** type='text' 的自由输入 */
  text: string
}

/** 一行选项：真实选项 / 其他 / 跳过。 */
interface Option {
  value: string
  label: string
  /** 自由输入的占位文案（value=OTHER 时有值） */
  placeholder?: string
}

const emptyDraft = (): Draft => ({ selected: [], other: '', text: '' })

function optionsOf(question: AskUserQuestion): Option[] {
  const rows: Option[] = (question.choices ?? []).map((choice) => ({ value: choice.value, label: choice.value }))
  rows.push({ value: OTHER, label: '其他补充…', placeholder: '请输入你的答案' })
  if (question.required === false) rows.push({ value: SKIP, label: '跳过这一题' })
  return rows
}

/**
 * ask_user 追问面板（SSE `event: question`）。09-23 改：**完全压在输入框上**的浮层
 * （挂在 ConversationPage 的 .convo-composer-anchor 里，贴输入框底边向上生长），不随消息流滚走。
 * 多题时分页展示（一页一题 + 上一题/下一题），避免一屏堆四五道题。
 * 交互沿用主流 agent 的提问面板：纵向选项行 + 左侧序号圈 + 键盘操作
 * （↑↓ 移动 · 1-9 直选 · ←→ 翻页 · Enter 下一步/提交）。
 * 09-23 五改：单题 multiple_choice **点选项即作答**，不再有单独的提交箭头
 * （text / 「其他」用输入框 Enter 提交；多题翻页与单题 multi_select 仍保留右下角箭头）。
 * 09-23 六改补：自由输入填了内容后右下角箭头重新出现（鼠标用户也得有得点），
 * 且输入法组字中的 Enter / 数字不再误触快捷键（isComposing 守卫）。
 * 答案口径按后端 ask_user 中间件：multiple_choice 原样字符串 · multi_select 为 JSON 数组字符串 ·
 * text 为原文；answers 顺序必须与 questions 一一对应。
 */
export function AskUserCard({
  questions,
  agentName,
  disabled,
  onSubmit,
}: {
  questions: AskUserQuestion[]
  /** 发起追问的 Agent（会话页头部那个身份），让用户知道「是谁在问」 */
  agentName?: string
  disabled?: boolean
  onSubmit: (answers: string[], displayText: string) => void
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map(emptyDraft))
  /** 键盘光标：[问题序号, 选项序号]；null = 还没动过键盘 */
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const [page, setPage] = useState(0)
  const cardRef = useRef<HTMLDivElement>(null)
  const otherInputRef = useRef<HTMLInputElement>(null)

  const optionRows = useMemo(() => questions.map((question) => optionsOf(question)), [questions])
  const total = questions.length
  const paged = total > 1
  const single = total === 1
  const question = questions[page]
  const draft = drafts[page] ?? emptyDraft()

  const patch = useCallback(
    (index: number, next: (draft: Draft) => Draft) =>
      setDrafts((prev) => prev.map((item, i) => (i === index ? next(item) : item))),
    [],
  )

  const pick = useCallback(
    (index: number, value: string) => {
      const isMulti = questions[index]?.type === 'multi_select'
      if (value === OTHER) {
        patch(index, (current) => ({
          ...current,
          other: '',
          selected: isMulti ? [...new Set([...current.selected.filter((v) => v !== SKIP && v !== OTHER), OTHER])] : [OTHER],
        }))
        window.setTimeout(() => otherInputRef.current?.focus(), 0)
        return
      }
      if (value === SKIP) {
        patch(index, () => ({ ...emptyDraft(), selected: [SKIP] }))
        return
      }
      patch(index, (current) => {
        const base = current.selected.filter((v) => v !== SKIP) // 选真实选项即取消「跳过」
        const selected = isMulti ? (base.includes(value) ? base.filter((v) => v !== value) : [...base, value]) : [value]
        return { ...current, selected }
      })
    },
    [patch, questions],
  )

  const answers = useMemo(
    () =>
      questions.map((item, index) => {
        const current = drafts[index] ?? emptyDraft()
        if (item.type === 'text') return current.text.trim()
        if (current.selected.includes(SKIP)) return ''
        const other = current.other.trim()
        const picked = current.selected.filter((value) => value !== OTHER && value !== SKIP)
        if (item.type === 'multi_select') return JSON.stringify([...picked, ...(other ? [other] : [])])
        return current.selected.includes(OTHER) ? other : (picked[0] ?? '')
      }),
    [drafts, questions],
  )

  const answered = useCallback(
    (index: number) => questions[index]?.required === false || (answers[index] ?? '').length > 0,
    [answers, questions],
  )
  const ready = questions.every((_, index) => answered(index))
  const lastPage = page === total - 1
  // 自由输入已填内容 → 需要可见的提交键（09-23 六改补）：单题没有箭头时，
  // text 题 / 「其他补充」输入完只有键盘 Enter 一条路，鼠标用户无从提交 ——
  // 填了内容就把右下角箭头放出来；空着的时候仍然不放（选项卡保持干净）。
  const inputTouched =
    (question.type === 'text' && draft.text.trim().length > 0) ||
    (question.type !== 'text' && draft.selected.includes(OTHER) && draft.other.trim().length > 0)

  const submit = useCallback(() => {
    if (disabled || !ready) return
    const display = paged ? answers.map((answer, index) => `${index + 1}. ${answer || '（跳过）'}`).join('\n') : answers[0]
    onSubmit(answers, display)
  }, [answers, disabled, onSubmit, paged, ready])

  const next = useCallback(() => {
    if (disabled) return
    if (lastPage) submit()
    else if (answered(page)) setPage((current) => Math.min(current + 1, total - 1))
  }, [answered, disabled, lastPage, page, submit, total])

  const prev = useCallback(() => setPage((current) => Math.max(current - 1, 0)), [])

  // 面板出现/翻页后拿到焦点，键盘操作才有落点（Copilot 同款：追问面板抢焦点）
  useEffect(() => {
    cardRef.current?.focus()
  }, [page, questions])

  // 键盘：↑↓ 在当前题的可见选项间移动，1-9 直选，←→ 翻页，Enter 下一步 / 提交
  useEffect(() => {
    const node = cardRef.current
    if (!node) return
    const flat = optionRows[page]?.map((_, order) => [page, order] as [number, number]) ?? []
    if (!flat.length && questions[page]?.type !== 'text') return

    const onKeyDown = (event: KeyboardEvent) => {
      if (disabled) return
      // 输入法组字中的按键（选字 / 翻候选的 Enter、数字、方向键）不当作面板快捷键，
      // 否则拼音打字时按 Enter 确认候选会被误判成「提交」、数字选字会被误判成「直选选项」
      if ((event as KeyboardEvent).isComposing || event.keyCode === 229) return
      const inInput = (event.target as HTMLElement)?.tagName === 'INPUT'
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!flat.length) return
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setCursor((current) => {
          const at = current ? flat.findIndex(([q, o]) => q === current[0] && o === current[1]) : -1
          if (at < 0) return step > 0 ? flat[0] : flat[flat.length - 1]
          return flat[(at + step + flat.length) % flat.length]
        })
        return
      }
      if (event.key === 'ArrowLeft' && paged) {
        event.preventDefault()
        prev()
        return
      }
      if (event.key === 'ArrowRight' && paged) {
        event.preventDefault()
        next()
        return
      }
      const digit = Number.parseInt(event.key, 10)
      if (digit >= 1 && digit <= 9 && !inInput) {
        const target = optionRows[page]?.[digit - 1]
        if (target) {
          event.preventDefault()
          setCursor([page, digit - 1])
          pick(page, target.value)
        }
        return
      }
      if (event.key === 'Enter' && !event.shiftKey && !inInput) {
        event.preventDefault()
        next()
      }
    }
    node.addEventListener('keydown', onKeyDown)
    return () => node.removeEventListener('keydown', onKeyDown)
  }, [disabled, next, optionRows, page, paged, pick, prev, questions])

  return (
    <div className={`convo-ask${disabled ? ' busy' : ''}`} ref={cardRef} tabIndex={-1}>
      <div className="convo-ask-head">
        <p className="convo-ask-eyebrow">需要你确认</p>
        {agentName ? (
          <span className="convo-ask-agent">
            <i />
            {agentName}
          </span>
        ) : null}
        {/* 多题：< 2/2 > 翻页，末页的 › 变提交；单题：直接一个提交按钮。底部不再放操作条 */}
        <span className="convo-ask-pager">
          {paged ? (
            <>
              <button type="button" className="convo-ask-step" disabled={disabled || page === 0} aria-label="上一题" onClick={prev}>
                <ChevronLeft size={14} />
              </button>
              <em>
                {page + 1} / {total}
              </em>
            </>
          ) : null}
        </span>
      </div>

      <div className="convo-ask-q">
        <p className="convo-ask-title">
          <span>{question.question}</span>
          {question.required === false ? <small>可跳过</small> : null}
        </p>

        {question.type === 'text' ? (
          <input
            className="convo-ask-input"
            value={draft.text}
            placeholder="请输入…"
            disabled={disabled}
            onKeyDown={(event) => {
              // 单题没有常驻提交箭头（09-23 五改），text 题的提交收口在输入框 Enter；
              // isComposing：输入法选字那下 Enter 是「确认候选」，不是提交
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                next()
              }
            }}
            onChange={(event) => patch(page, (current) => ({ ...current, text: event.target.value }))}
          />
        ) : (
          <ul className="convo-ask-options">
            {optionRows[page].map((option, order) => {
              const on = draft.selected.includes(option.value)
              const focused = cursor?.[0] === page && cursor?.[1] === order
              // 左侧徽标：单选 = 序号圈（参考图式），多选 = 勾选框，「其他」= 铅笔（自由输入行）
              const mark =
                option.value === OTHER ? (
                  <Pencil size={12} />
                ) : question.type === 'multi_select' ? (
                  on ? <Check size={11} /> : <Square size={11} />
                ) : (
                  <b className="convo-ask-num">{order + 1}</b>
                )
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    className={`convo-ask-option${on ? ' on' : ''}${focused ? ' cursor' : ''}`}
                    disabled={disabled}
                    aria-pressed={on}
                    onMouseEnter={() => setCursor([page, order])}
                    onClick={() => {
                      // 09-23 五改（用户拍板）：单题 single-choice 点选项本身就是答案，
                      // 直接回传、不再有单独的提交箭头（「其他」例外——要先输入再 Enter）。
                      if (single && question.type === 'multiple_choice' && option.value !== OTHER) {
                        if (!disabled) {
                          const answer = option.value === SKIP ? '' : option.value
                          onSubmit([answer], answer)
                        }
                        return
                      }
                      pick(page, option.value)
                    }}
                  >
                    <span
                      className={`convo-ask-mark${option.value === OTHER ? ' other' : ''}${
                        option.value !== OTHER && question.type !== 'multi_select' ? ' num' : ''
                      }`}
                    >
                      {mark}
                    </span>
                    <span className="convo-ask-option-label">{option.label}</span>
                    {/* 行尾箭头：悬停 / 键盘光标 / 选中时亮出（序号已在左圈，右边不再放行号） */}
                    <span className="convo-ask-go">
                      <ChevronRight size={14} />
                    </span>
                  </button>
                  {option.value === OTHER && on ? (
                    <input
                      className="convo-ask-input"
                      ref={otherInputRef}
                      value={draft.other}
                      placeholder={option.placeholder}
                      disabled={disabled}
                      onKeyDown={(event) => {
                        // 「其他」输入完 Enter = 提交（isComposing：输入法选字的 Enter 不算）
                        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault()
                          next()
                        }
                      }}
                      onChange={(event) => patch(page, (current) => ({ ...current, other: event.target.value }))}
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* 09-23 五改/六改补：提交箭头只在「确实需要单独一步」时出现 ——
          多题翻页（未到末页 = 下一题，末页 = 提交）、单题 multi_select（勾完要显式确认）、
          以及自由输入已填内容（text 题 / 「其他补充」，鼠标用户也得有得点）。
          单题 multiple_choice 点选项即作答、输入框 Enter 亦可提交，空着时不放箭头。 */}
      {paged || question.type === 'multi_select' || inputTouched ? (
        <div className="convo-ask-foot">
          <button
            type="button"
            className={lastPage ? 'assistant-send' : 'convo-ask-submit step'}
            disabled={disabled || (lastPage ? !ready : !answered(page))}
            title={lastPage ? (ready ? '提交选择并继续' : '请先完成必答项') : '下一题'}
            aria-label={lastPage ? '提交' : '下一题'}
            onClick={next}
          >
            {lastPage ? <ArrowUp size={16} /> : <ChevronRight size={15} />}
          </button>
        </div>
      ) : null}
    </div>
  )
}
