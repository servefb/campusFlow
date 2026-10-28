import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Waypoints } from 'lucide-react'

/**
 * 任务页右下角的「发起办事」悬浮球。
 *
 * 可拖拽：Pointer Events（鼠标 / 触屏同一套）+ `setPointerCapture`，拖出视口也会继续跟随。
 *   位置存在 localStorage，下次进来还在原处；窗口变小或拖出边界都会自动拉回。
 *   拖动位移超过阈值就不再触发「点开弹窗」—— 否则每次拖完都会顺带弹出框。
 *
 * 形状恒定：**永远是一枚 48px 正圆**（2026-09-15 按用户要求去掉 hover 展开的胶囊标签）。
 *   此前 hover / 聚焦时标签会向右长成胶囊，球在右半边还得改成右缘锚定才不顶出边界；
 *   现在没有可变宽度，定位一律用 left/top，翻转逻辑与 viewportWidth 状态一并删掉。
 *   按钮的含义改由 aria-label + title 承载（无文字标签不再影响可达性）。
 */

/** 球体边长（2026-09-15：56 → 48），与 CSS 的 12 + 24 + 12 一致；拖拽边界按它算。
    改尺寸时两处必须一起改。 */
const SIZE = 48
/** 距视口边缘的最小留白，也是默认落位时的外边距。 */
const MARGIN = 20
/** 超过这个位移才算「拖」而不是「点」。 */
const DRAG_THRESHOLD = 5
/** 静置多久后进入「休眠」（更浅、几乎融进背景）。 */
const SLEEP_DELAY = 5000
/** 指针离球心多远算「靠近」——进入这个半径就把球唤醒到常态档。 */
const PROXIMITY = 96
const STORAGE_KEY = 'campusflow_task_fab_pos'

type Pos = { x: number; y: number }

const readStored = (): Pos | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Pos> | null
    return typeof parsed?.x === 'number' && typeof parsed?.y === 'number' ? { x: parsed.x, y: parsed.y } : null
  } catch {
    return null
  }
}

const clampPos = (pos: Pos): Pos => {
  const maxX = window.innerWidth - SIZE - MARGIN
  const maxY = window.innerHeight - SIZE - MARGIN
  // ⚠️ 视口拿不到尺寸时（页面正在卸载 / 被隐藏，innerWidth 会是 0）不要硬夹 ——
  // 那样会把位置压到左上角的 MARGIN 并把坏值写进 localStorage，下次打开球就贴到左上角。
  if (maxX <= MARGIN || maxY <= MARGIN) return pos
  return { x: Math.min(Math.max(pos.x, MARGIN), maxX), y: Math.min(Math.max(pos.y, MARGIN), maxY) }
}

export function TaskCreateFab({ onOpen }: { onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<Pos | null>(null)
  const [dragging, setDragging] = useState(false)
  /** 指针是否已靠近（用于「靠近唤醒」）。 */
  const [pointerNear, setPointerNear] = useState(false)
  /** 悬停或键盘聚焦 —— 与 dragging 一起作为「不许休眠」的条件。 */
  const [engaged, setEngaged] = useState(false)
  /** 休眠 = 静置 SLEEP_DELAY 且没人理它：更浅、几乎融进背景（详见 tasks.css 的 .sleeping）。 */
  const [sleeping, setSleeping] = useState(false)
  /** 拖完那一下要吞掉紧随其后的 click；用 ref 避免多一次渲染。 */
  const suppressClick = useRef(false)
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean } | null>(null)
  /** 球心（视口坐标），给全局 pointermove 判距离用 —— 放 ref 里，避免拖拽时每帧重挂监听。 */
  const center = useRef({ x: 0, y: 0 })

  /** 首次落位：优先上次拖到的位置；没有就沿用 CSS 给的默认位（右下角 / 窄屏自动抬到移动底栏之上）。 */
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect()
    const initial = readStored() ?? (rect ? { x: rect.left, y: rect.top } : null)
    if (initial) setPos(clampPos(initial))
  }, [])

  useEffect(() => {
    if (pos) center.current = { x: pos.x + SIZE / 2, y: pos.y + SIZE / 2 }
  }, [pos])

  useEffect(() => {
    const onResize = () => { setPos((current) => (current ? clampPos(current) : current)) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /**
   * 「靠近唤醒」：全局监听指针，进入球的 PROXIMITY 半径内就醒过来。
   * 只在布尔值真的翻转时才 setState（返回同值 React 会直接跳过渲染），
   * 否则这段会被每次 pointermove 触发一次渲染。
   */
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const near = Math.hypot(event.clientX - center.current.x, event.clientY - center.current.y) <= SIZE / 2 + PROXIMITY
      setPointerNear((current) => (current === near ? current : near))
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  /** 静置计时：一旦没人理它就起表；被悬停 / 聚焦 / 拖拽 / 指针靠近都会立刻唤醒并取消计时。 */
  useEffect(() => {
    if (pointerNear || engaged || dragging) {
      setSleeping(false)
      return
    }
    const timer = window.setTimeout(() => setSleeping(true), SLEEP_DELAY)
    return () => window.clearTimeout(timer)
  }, [pointerNear, engaged, dragging])

  /** 落位后写回本机（拖拽途中不写，免得每帧一次 IO）。 */
  useEffect(() => {
    if (!pos || dragging) return
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)) } catch { /* 隐私模式下写不了，忽略 */ }
  }, [pos, dragging])

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    drag.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    }
    // 从「CSS 默认位」切到显式 left/top，否则第一帧拖动会跳
    setPos({ x: rect.left, y: rect.top })
    suppressClick.current = false
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 指针已释放，忽略 */ }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    if (!state.moved) {
      if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) <= DRAG_THRESHOLD) return
      state.moved = true
      setDragging(true)
    }
    setPos(clampPos({ x: event.clientX - state.offsetX, y: event.clientY - state.offsetY }))
  }

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    drag.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* 已自动释放 */ }
    setDragging(false)
    if (state.moved) suppressClick.current = true
  }

  const handleClick = () => {
    if (suppressClick.current) { suppressClick.current = false; return }
    onOpen()
  }

  // 球体尺寸恒定 → 一律用 left/top 落位（不再需要「球在右半边就用右缘锚定」那套翻转）
  const style = pos === null ? undefined : { left: pos.x, top: pos.y }

  return (
    <button
      ref={ref}
      type="button"
      className={`task-create-fab${pos ? ' is-positioned' : ''}${dragging ? ' dragging' : ''}${sleeping ? ' sleeping' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerEnter={() => setEngaged(true)}
      onPointerLeave={() => setEngaged(false)}
      onFocus={() => setEngaged(true)}
      onBlur={() => setEngaged(false)}
      onClick={handleClick}
      aria-label="发起校园事务办事流程（可拖动）"
      title="发起校园事务办事流程（可拖动）"
    >
      <Waypoints size={24} strokeWidth={1.8} />
    </button>
  )
}
