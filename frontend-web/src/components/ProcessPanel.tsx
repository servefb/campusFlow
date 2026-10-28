import { useEffect, useState } from 'react'
import { Brain, Check, ChevronDown, ChevronRight, Loader2, Terminal, X } from 'lucide-react'

/**
 * agent 工作过程的一条记录。
 * 后端只在 SSE 里推送、不落库，所以刷新后历史会话看不到——这是有意设计：
 * 过程用于「让用户看到 agent 怎么干活」，最终回答才是要沉淀的内容。
 *
 * ⚠️ write_todos（10-09）**不进**时间线：任务清单渲染成输入框上方的 TodoPanel
 * （Codex 式「当前进度」面板），见 ConversationPage 的 liveTodos。
 */
export interface TraceItem {
  /**
   * kind='think'（09-19 十七改）：模型的一「波」思考（SSE think 事件按波次切进来 ——
   * step/tool 一到就断波，下一次 think 开新波），渲染成时间线上折叠的「深度思考」条目。
   */
  kind: 'step' | 'tool' | 'result' | 'think'
  /** kind='step'：模型调用工具前写的前言；kind='think'：这波思考的全文（流式增量拼接） */
  text?: string
  /** kind='tool' | 'result'：工具名 */
  tool?: string
  /** kind='result'：工具返回内容（已截断） */
  result?: string
  /**
   * kind='tool' | 'result'：配对键（后端 09-17 契约化新增，event:tool / event:tool_result 同名小写下划线 `call_id`）。
   * 结果按 id 归进所属调用；后端未上线或拿不到时为空 → 前端退回「归进最近一次调用」的时序兜底。
   */
  callId?: string
}

/**
 * 时间线上的一段：**模型前言**，或**一次工具调用**（含它收到的输出）。
 *
 * 之所以要分段而不是分成「前言堆 + 工具堆」：用户要的是「一条前言，跟着一条这条前言干了什么」——
 * 两堆分开摆，前言和它的动作就对不上号了（见 ProcessPanel 顶部注释）。
 */
type Segment =
  | { kind: 'note'; text: string }
  | { kind: 'tool'; tool: string; results: string[]; index: number }
  | { kind: 'think'; text: string; index: number }

/** 结果预览长度：够看清是什么，又不至于把过程区撑太长 */
const RESULT_PREVIEW = 160

/** 过程条目里的长文本统一截断：模型在前言里复述工具输出（ls/命令回显）时不至于糊一大坨 */
const preview = (text: string) => (text.length > RESULT_PREVIEW ? `${text.slice(0, RESULT_PREVIEW)}…` : text)

/**
 * 用时文案：不足 1 分钟给「12.3 秒」，超过给「1 分 05 秒」。
 * 一位小数足够分辨快慢，再多是噪音；分钟段补零是为了让长短两次的串宽度接近，读起来不跳。
 */
const formatDuration = (ms: number) => {
  const seconds = Math.max(0, ms) / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`
  const rest = Math.round(seconds % 60)
  return `${Math.floor(seconds / 60)} 分 ${String(rest).padStart(2, '0')} 秒`
}

/**
 * 工具原始输出的特征 —— **纯兜底**，只在后端把「工具返回帧」误判成模型前言时才会用到。
 *
 * 后端已在源头按类型挡掉（`isinstance(chunk, ToolMessage)`，见 conversations_repo.py），
 * 正常路径下这里的判定永远不会命中。留着是防御性的：万一还有别的路径把工具回显塞进
 * step，也不让它冒充模型的话术出现在前言区。
 *
 * ⚠️ 只在**行首**匹配，避免误伤正常前言（如「我按【学生证补办】的流程来」这类中文方括号
 * 和句中出现的 [目录] 都不该被拦）。所以这是一条「宁可漏判也别误杀」的规则。
 */
const TOOL_OUTPUT_PATTERN = /^\s*(\[原始数据\]|\[\s*目录\s*\]|\[\s*文件\s*\]|\{\s*"|Path\s*\n-{2,})/

/** 是不是「像工具回显」的文本（决定它能不能进 notes 区） */
const looksLikeToolOutput = (text: string) => TOOL_OUTPUT_PATTERN.test(text)

/**
 * 工具调用头（Codex 同款）：一行轻量文字 —— 图标 + 「已运行 工具名」+ 参数摘要 + 展开箭头。
 * 不加边框、不做卡片；点它开合下面的输出块（Codex 里每次调用各自可折）。
 */
function ToolLine({
  item,
  running,
  open,
  onToggle,
}: {
  item: TraceItem
  running?: boolean
  open: boolean
  onToggle: () => void
}) {
  return (
    <button type="button" className="convo-trace-tool" aria-expanded={open} onClick={onToggle}>
      <Terminal size={12} />
      <span className="convo-trace-tool-verb">{running ? '正在运行' : '已运行'}</span>
      <code>{item.tool || 'tool'}</code>
      {/* 箭头只在悬停时浮现（Codex 同款，由 CSS 控制显隐） */}
      <ChevronRight size={12} className={`convo-trace-tool-chev${open ? ' open' : ''}`} />
    </button>
  )
}

/**
 * 工具输出块（Codex 的终端卡片）：左上角类型标签，下面是等宽正文，右下角状态。
 * Codex 里整块是浅灰大圆角，输出长得像终端回显 —— 这里保持同样的观感。
 */
function ResultLine({ item, running }: { item: TraceItem; running?: boolean }) {
  const text = item.result || ''
  return (
    <div className="convo-trace-term">
      <span className="convo-trace-term-kind">{item.tool || 'Shell'}</span>
      <pre className="convo-trace-term-body">{preview(text)}</pre>
      <span className={`convo-trace-term-status${running ? '' : ' done'}`}>
        {running ? <Loader2 size={11} className="convo-spin" /> : <Check size={11} />}
        {running ? '运行中' : '成功'}
      </span>
    </div>
  )
}

/**
 * 过程面板（09-18 五轮：交替时间线）。
 *
 * 用户口径：内部要**一条前言跟一条它干的什么**（前言 → 工具 → 前言 → 工具…），
 * 不是「所有前言摞一块、所有工具摞另一块」—— 那样前言和它的动作对不上号。
 * 一轮跑完则整体收成一行「已完成 · 用时 X」（前一轮的口径，保留）。
 *
 * - 流式中：不套外壳，思考条 + 时间线实时铺开；
 * - 结束后：收成一行「已完成 · 用时 X」，点开还原整条时间线（每个工具组仍各自可折）；
 * - 历史回放（trace 与用时都没有，只剩一个思考条）：不套外壳 —— 那里思考条自带折叠头，
 *   再套一层就要连点两次才读到正文，纯属添堵；
 * - 用户手动点过之后，以用户的选择为准（manual 非空）。
 */
export function ProcessPanel({
  reasoning,
  trace,
  running,
  elapsedMs,
  failed,
}: {
  reasoning?: string
  trace?: TraceItem[]
  running: boolean
  /** 本轮总用时（ms）。后端不落库、历史回放为空 —— 为空时头里不显示用时那一段。 */
  elapsedMs?: number
  /** 本轮以失败告终：头文案换「已中断」，不然一行绿勾「已完成」是骗人的。 */
  failed?: boolean
}) {
  const [thinkManual, setThinkManual] = useState<boolean | null>(null)
  const [doneManual, setDoneManual] = useState<boolean | null>(null)
  /**
   * 每次工具调用各自可折（Codex 同款）。口径：**默认全部折叠**，只有用户点开的才展开。
   * 所以这里记的是「被展开」的组号（白名单），而不是被收起的——刚发出的新工具自然也是折着的。
   */
  const [openedTools, setOpenedTools] = useState<Set<number>>(new Set())
  /**
   * 时间线上的「深度思考」条目（09-23 改）：自动态 = **正在生长的最后一波默认展开**
   * （用户口径：思考中就直接看内容，想完才收起来），其余波折叠；
   * `thinkOverrides` 记手动点过的条目，一旦点过就以用户为准（不再是纯白名单）。
   */
  const [thinkOverrides, setThinkOverrides] = useState<Map<number, boolean>>(new Map())
  // 新一轮流开始时重置：思考块回到自动态，外壳回到自动态，工具/思考块回到各自默认
  useEffect(() => {
    if (running) {
      setThinkManual(null)
      setDoneManual(null)
      setOpenedTools(new Set())
      setThinkOverrides(new Map())
    }
  }, [running])

  const thinkText = reasoning ?? ''
  const items = trace ?? []

  /**
   * 铺时间线：按 `items` 的**原序**逐条落段 —— 前言 / 它引发的工具调用交替出现。
   * 后端本就是按发生顺序推 step → tool → tool_result → step …（见 ConversationPage 的 pushTrace），
   * 所以这里不用重排，只按顺序切段即可。
   */
  const segments: Segment[] = []
  const byId = new Map<string, Extract<Segment, { kind: 'tool' }>>()
  const orphans: string[] = []
  let toolCount = 0
  let thinkCount = 0
  // 拿「最近一次工具段」用扫的，不用变量存 —— 变量只在 forEach 回调里被赋值的话，
  // TS 的控制流分析会认为它没变过（回头看还是 null），后面一用就报 never。
  const lastToolSegment = () => {
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const segment = segments[i]
      if (segment.kind === 'tool') return segment
    }
    return null
  }
  items.forEach((item) => {
    if (item.kind === 'tool') {
      const segment: Extract<Segment, { kind: 'tool' }> = { kind: 'tool', tool: item.tool || 'tool', results: [], index: toolCount++ }
      segments.push(segment)
      if (item.callId) byId.set(item.callId, segment)
    } else if (item.kind === 'result') {
      // 优先按 callId 归位（并行调用时返回顺序可能乱），拿不到 id 才退回「最近一次调用」
      const target = (item.callId && byId.get(item.callId)) || lastToolSegment()
      if (target) target.results.push(item.result || '')
      else orphans.push(item.result || '')
    } else if (item.kind === 'think') {
      const text = (item.text || '').trim()
      if (!text) return
      // 防御性合并：正常路径 ConversationPage 已把连续 think 拼成一条，这里兜住漏网的
      const last = segments[segments.length - 1]
      if (last?.kind === 'think') last.text = `${last.text}\n${text}`
      else segments.push({ kind: 'think', text, index: thinkCount++ })
    } else if (item.text) {
      const text = item.text.trim()
      // 空文本（只有换行的 step）直接丢；兜底：像工具回显的 step 不能冒充模型的话
      // 进时间线（正常路径后端已挡掉，见 looksLikeToolOutput）
      if (text) {
        if (looksLikeToolOutput(text)) orphans.push(text)
        else segments.push({ kind: 'note', text })
      }
    }
  })
  // 孤儿内容统一挂到最后一次工具调用下面（没有工具就丢掉，不往前言区塞）
  const tail = lastToolSegment()
  if (orphans.length && tail) tail.results.push(...orphans)

  const hasThink = Boolean(thinkText)
  if (!hasThink && !segments.length) return null

  const thinkOpen = thinkManual ?? running
  const thinkSummary = `已深度思考 · ${thinkText.length} 字`
  /**
   * 跑完就收成一行：前言 / 思考条 / 工具行**全都**收进外壳（用户 09-18 拍的最终版）。
   * 上一版把前言留在壳外，实测是「已完成」被夹在前言和回答正文中间那种割裂感 ——
   * 「最后收成一行」就得是整轮过程连前言一起收，正文前面不再挂任何裸露的过程条目。
   * 历史回放（无前言无工具、也没用时）不套壳，让思考条自己的头直接露出来。
   */
  const collapsible = !running && (segments.length > 0 || elapsedMs != null)
  const doneOpen = doneManual ?? false
  // 工具调用：默认折叠，白名单里的才展开（用户拍板：默认折叠态、悬停显出箭头）
  const isToolOpen = (index: number) => openedTools.has(index)
  const toggleTool = (index: number) =>
    setOpenedTools((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  // 「深度思考」条目：自动态 = 正在生长的最后一波展开、其余折叠；手动覆盖优先
  const isThinkOpen = (index: number, live: boolean) => thinkOverrides.get(index) ?? live
  const toggleThink = (index: number, currentOpen: boolean) =>
    setThinkOverrides((prev) => {
      const next = new Map(prev)
      next.set(index, !currentOpen)
      return next
    })

  const chev = (open: boolean) => <ChevronDown size={12} className={`convo-think-chev${open ? ' open' : ''}`} />

  /**
   * 时间线（09-19 十七改）：思考波 / 前言 / 工具**交替**铺开 ——
   * 「深度思考」→「我先看看有哪些分类」（前言）→「已运行 list_user_folder」→ 下一波思考 …
   * 思考条目 09-23 起自动态 = 正在生长的最后一波展开、其余折叠（想完自动收起，
   * 手动点过的以用户为准）—— 旧版全部折叠，思考中反而一个字都看不到。
   */
  const liveThink = (() => {
    if (!running || items[items.length - 1]?.kind !== 'think') return null
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const segment = segments[i]
      if (segment.kind === 'think') return segment
    }
    return null
  })()
  const timeline = segments.map((segment, index) => {
    if (segment.kind === 'think') {
      const live = liveThink === segment
      const thinkOpen = isThinkOpen(segment.index, live)
      return (
        <div className="convo-think-group" key={`seg-${index}`}>
          <button
            type="button"
            className="convo-panel-toggle"
            aria-expanded={thinkOpen}
            onClick={() => toggleThink(segment.index, thinkOpen)}
          >
            {live ? <Loader2 size={12} className="convo-spin" /> : <Brain size={12} />}
            <span>{live ? '深度思考中…' : '深度思考'}</span>
            {chev(thinkOpen)}
          </button>
          {thinkOpen ? <div className="convo-think-full">{segment.text}</div> : null}
        </div>
      )
    }
    return segment.kind === 'note' ? (
      <p className="convo-panel-note" key={`seg-${index}`}>
        {segment.text}
      </p>
    ) : (
      <div className="convo-tool-group" key={`seg-${index}`}>
        {/* 单个调用的完成态跟「本组是否已拿到结果」走，不跟整轮 running 走：
            结果一到就该亮绿勾，别让用户看着它转圈转到整轮结束（后端已改实时推结果）。 */}
        {(() => {
          const toolDone = segment.results.length > 0
          return (
            <>
              <ToolLine
                item={{ kind: 'tool', tool: segment.tool }}
                running={running && !toolDone}
                open={isToolOpen(segment.index)}
                onToggle={() => toggleTool(segment.index)}
              />
              {isToolOpen(segment.index) ? (
                segment.results.length ? (
                  segment.results.map((result, rIndex) => (
                    <ResultLine
                      item={{ kind: 'result', result, tool: segment.tool }}
                      running={running && !toolDone}
                      key={`res-${segment.index}-${rIndex}`}
                    />
                  ))
                ) : running ? (
                  // 返回还没到（工具刚发出）：先占位，别让「已运行」下面空着
                  <ResultLine item={{ kind: 'result', result: '执行中，稍候…', tool: segment.tool }} running key={`res-${segment.index}-pending`} />
                ) : null
              ) : null}
            </>
          )
        })()}
      </div>
    )
  })

  // 块一：思考过程（Codex 同款轻量头，无边框卡片）。
  // ⚠️ 十七改起它只是**兜底**：流式轮的思考已经按波次插进时间线（见 timeline），
  // 整轮全文再整块摆一遍就是重复 —— 只在「没有思考波」时才用（历史回放：
  // trace 不落库，读的是落库的 reasoning_content 整块全文）。
  const hasTraceThink = segments.some((segment) => segment.kind === 'think')
  const thinkBlock = hasThink && !hasTraceThink ? (
    <div className={`convo-panel-block${running ? ' live' : ''}`}>
      <button
        type="button"
        className="convo-panel-toggle"
        aria-expanded={thinkOpen}
        onClick={() => setThinkManual(!thinkOpen)}
      >
        {running ? <Loader2 size={12} className="convo-spin" /> : <Brain size={12} />}
        <span>{running ? '思考中…' : thinkSummary}</span>
        {chev(thinkOpen)}
      </button>
      {thinkOpen ? (
        <div className="convo-panel-body">
          <div className="convo-think-full">{thinkText}</div>
        </div>
      ) : null}
    </div>
  ) : null

  // 思考条与时间线都是外层 flex 的直接子节点（Fragment 不产生 DOM 节点），
  // 于是折叠态和流式态共用同一套间距，不用各写一份。
  const inner = (
    <>
      {thinkBlock}
      {timeline}
    </>
  )

  return (
    <div className="convo-panel">
      {collapsible ? (
        <div className="convo-panel-done">
          <button
            type="button"
            className={`convo-panel-toggle convo-panel-done-head${failed ? ' is-failed' : ''}`}
            aria-expanded={doneOpen}
            onClick={() => setDoneManual(!doneOpen)}
          >
            {failed ? <X size={12} /> : <Check size={12} />}
            <span>{failed ? '已中断' : '已完成'}</span>
            {elapsedMs != null ? <em className="convo-panel-done-time">用时 {formatDuration(elapsedMs)}</em> : null}
            {chev(doneOpen)}
          </button>
          {doneOpen ? <div className="convo-panel-done-body">{inner}</div> : null}
        </div>
      ) : (
        inner
      )}
    </div>
  )
}
