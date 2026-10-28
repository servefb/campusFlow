import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  CheckCircle2,
  ClipboardCopy,
  FilePen,
  GripVertical,
  History,
  MessageSquarePlus,
  PanelLeftOpen,
  Paperclip,
  Pencil,
  Reply,
  RotateCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  sendFeedback,
  sendSupplement,
  stopConversationReply,
  streamConversationReply,
  type AskUserQuestion,
  type ConversationMessage,
  type PermissionAction,
} from '../services/conversations'
import { getHistoryConversation } from '../services/history'
import { buildAnswerPrefsPayload } from '../services/answerPrefs'
// 附件（09-19 二阶）：输入框选/拖的文件以**本体**随本轮提问发出（multipart 的 `files` 字段），不再有 attachment_ids
import { clearAttachments, formatAttachmentSize, getAttachmentFiles } from '../services/attachments'
import { apiErrorMessage } from '../services/http'
import { MAIN_AGENT } from '../services/workspace'
import { AssistantSidebar } from '../components/AssistantSidebar'
import { HistoryModal } from '../components/HistoryModal'
import { MarkdownText } from '../components/MarkdownText'
import { ProcessPanel, type TraceItem } from '../components/ProcessPanel'
import { parseWriteTodosArgs, type TraceTodo } from '../utils/writeTodos'
import { TodoPanel } from '../components/TodoPanel'
import { AskUserCard } from '../components/AskUserCard'
import { PermissionCard } from '../components/PermissionCard'
import { PromptComposer } from '../components/PromptComposer'
import { AskModeSwitch } from '../components/AskModeSwitch'
import { FilePreviewPanel, type ChangedFileRef } from '../components/FilePreviewPanel'
import { AttachmentImageChip } from '../components/AttachmentImageChip'
import { isImagePath } from '../utils/docxText'
import { countDiff, diffLines, DIFF_MAX_CHARS } from '../utils/lineDiff'
import { getAskMode } from '../services/askMode'
import { useWorkspace } from '../services/workspaceSelection'
import { useSidebarOpen } from '../utils/sidebarState'
import { getPermissionMode } from '../services/permissionMode'
import type { ConversationSummary } from '../types/api'

interface ChatMessage {
  key: string
  id?: string | number
  role: 'user' | 'assistant'
  content: string
  /** 思考过程文本（SSE think 事件累积）。仅流式本轮有值，历史接口暂不下发该字段。 */
  reasoning?: string
  /** agent 工作过程（SSE step/tool/tool_result 累积）。后端不落库，刷新后为空。 */
  trace?: TraceItem[]
  createdAt?: string
  citations: string[]
  /** waiting = ask_user 追问挂起中（本轮未结束，不能显示「已完成」与操作条）。 */
  status: 'done' | 'streaming' | 'failed' | 'waiting' | 'stopped' | 'paused'
  /**
   * 本轮起算时刻（ms）与总用时（ms）。过程区的「已完成 · 用时 X」靠它俩。
   * 后端不落库也不下发，纯前端计时：续跑（ask_user 作答）沿用同一条消息的 startedAt，
   * 所以口径是「首次发出 → 最终 done」，含中间等用户作答的时间。
   */
  startedAt?: number
  elapsedMs?: number
  /**
   * 本条提问随带的附件（09-19）：只用于在用户气泡上回显「发了什么」。
   * 服务端历史接口暂不下发附件，所以这是**前端本地记忆**（刷新后为空），
   * 且静默刷新合并（silentRefresh）时要按位置回填，否则回答一跑完气泡上的文件就消失。
   */
  attachments?: Array<{ name: string; size: number }>
  /**
   * 本轮 agent 实际改动过的文件（10-07）：回答末尾的「已修改的文件」清单读它。
   * 从 SSE 过程事件推导 —— `event: tool` 是文件类工具（write_file/edit_file/delete）且
   * `event: tool_result` 回来不是被拒/失败，才算「真的改到了」。
   * write/edit 还带 diff 素材（Codex 式红绿视图用）；与 trace 同源（过程事件不落库），刷新/换设备后为空。
   */
  changedFiles?: ChangedFileRef[]
}

/** download_from_sandbox 一次落多个文件 → 候选按「组」记（call_id → 组）。 */
type ToolArgs = {
  file_path?: unknown
  path?: unknown
  content?: unknown
  old_string?: unknown
  new_string?: unknown
  paths?: unknown
}

/**
 * 工具 → 动作。真正改动用户文件的四条路：
 *   write_file / edit_file / delete —— 内置文件工具；
 *   download_from_sandbox —— 沙箱产物落盘（固定进 ai_output/，args.paths 是沙箱路径列表，一次可多个）。
 * run_on_host 已被提示词禁止用于写文件（10-07：写文件统一走内置工具，界面才有改动记录可看），
 * 故不在清单口径内；read_file/ls/glob/grep/upload_to_sandbox 只读或不落用户盘，也不算。
 */
const FILE_ACTIONS: Record<string, 'write' | 'edit' | 'delete'> = {
  write_file: 'write',
  edit_file: 'edit',
  delete: 'delete',
  download_from_sandbox: 'write',
}
/**
 * 工具返回像「没改到」的内容 → 不计入改动清单。覆盖两类：
 * ① 权限卡被拒（HITL 的 ToolMessage：用户拒绝了这次操作）；② 安全规则拦截 / 目标不存在等失败。
 * 文件工具的成功返回是「Updated file …」这类确认语，不会撞上这些词。
 */
const FILE_FAIL_PATTERN = /(用户拒绝|拒绝执行|安全规则|操作被拒|not found|no such|不存在|outside|error|failed)/i
/** 展示用路径：agent 视角的 /user/ 前缀换成用户看得懂的位置（与权限卡同口径）。 */
const displayFilePath = (path: string) => (path.startsWith('/user/') ? `工作文件夹/${path.slice('/user/'.length)}` : path)

const formatTime = (iso?: string) => {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toTimeString().slice(0, 5)
}

function mapApiMessage(message: ConversationMessage, index: number): ChatMessage {
  return {
    key: `api-${message.id ?? index}`,
    id: message.id,
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: message.content,
    // 后端落库了思考过程（messages.reasoning_content）：刷新/换设备也能回看，老数据为空。
    reasoning: message.reasoning_content || undefined,
    createdAt: message.created_at,
    citations: [],
    status: 'done',
  }
}

/**
 * 会话页：会话摘要、消息列表与流式提问全部来自接口。
 */
export function ConversationPage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  // 问助手页"新建"入口：/conversations/new 携带首问状态，由本页发起流式请求。
  const locationState = location.state as { question?: string } | null
  const pendingQuestion = locationState?.question
  // 工作区（09-17）：全局会话级 store，主页选定后新建对话/切页都保留，不再经 location.state 搬运
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const streamStartedRef = useRef(false)
  const realIdRef = useRef<string | null>(null)
  // 「执行中补充」横条（09-23 五次定稿）：生成中在输入框**正常发送** → 内容暂存成
  // 输入框上方的横条（不进对话流、没有气泡），横条上三个键：发送（Reply，修改键
  // 旁边那个）= 送达正在执行的任务；修改（Pencil）= 原地改文本；删除（Trash2）= 丢弃。
  // ref 镜像供流收尾读取 —— 流式回调闭包里的 state 是发车那一刻的旧值。
  const [supplementStrips, setSupplementStrips] = useState<{ id: string; content: string; sending: boolean }[]>([])
  const supplementStripsRef = useRef<{ id: string; content: string }[]>([])
  useEffect(() => {
    supplementStripsRef.current = supplementStrips.map(({ id, content }) => ({ id, content }))
  }, [supplementStrips])
  const [editingStripId, setEditingStripId] = useState<string | null>(null)
  const [editingStripValue, setEditingStripValue] = useState('')
  // 送达成功的短暂 toast（09-23）：替代常驻页脚提示 —— 暂存不提示（横条本身就是反馈），
  // 点发送键送达时才弹一下，2.6s 自灭。
  const [supplementToast, setSupplementToast] = useState('')
  useEffect(() => {
    if (!supplementToast) return
    const timer = window.setTimeout(() => setSupplementToast(''), 2600)
    return () => window.clearTimeout(timer)
  }, [supplementToast])
  /**
   * 标题是否已由流里的 `event: title` 定过（09-18 后端新增该事件）。
   * 定过之后本轮结束的静默刷新**不再**用历史详情里的 title 覆盖它 —— 标题刚落库有先后，
   * 详情接口可能还是旧标题（首问时写进去的用户输入），覆盖上去会让新标题当场弹回去。
   * 切换会话（load）时复位，所以重新打开这条会话仍以库里的标题为准。
   */
  const titleFromStreamRef = useRef(false)
  const [title, setTitle] = useState('')
  // 全站只剩一个主智能体（09-23）：页头「正在作答的是谁」不再跟着后端 route 事件变，
  // 固定显示主智能体名（后端也不再回写 agent_mode，route 事件实际上不会来了）。
  const agent = MAIN_AGENT.name
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  // 「暂停」（10-08）：软暂停落地后的状态 —— 本轮流已结束但任务没完、可续跑。
  // 驱动发送键原位变「继续」；续跑开新流时清掉。刷新后丢失（后端线程仍暂停着，
  // 用户直接发消息后端会凭 content 检测到暂停态并自动转「继续+补充」）。
  const [paused, setPaused] = useState(false)
  // 在跑的流数量（09-23「执行中追加」）：追加时新旧两条流短暂并存（旧流要等服务端的
  // stopped 收尾），sending 不能再由单条流的 finally 直接置 false —— 用计数收口，
  // 最后一条流结束才把发送态收掉。发送态本身仍由 sending 驱动（停止键 / 追加键切换）。
  const activeStreamsRef = useRef(0)
  // 「停止生成」（09-19）：点了停止后等 服务端推 stopped 事件 / 主动关流 再收尾，
  // 这期间不 abort 本地 fetch（半截内容与收尾事件还要从流里读）；10s 兜底强制断开。
  const stopFallbackRef = useRef<number | null>(null)
  const [notice, setNotice] = useState('')
  /**
   * 短暂提示（10-08）：notice 条本身**常驻**（复制成功、落库失败这类信息挂住没毛病），
   * 但「任务已暂停」这种一次性引导如果也走 setNotice，就会一直顶在输入框上方
   * （用户实测反馈「一直显示」）。flashNotice = 展示几秒后自动收走，期间若来了
   * 别的提示则以新的为准（比较的是文案本身，不会误清新到的）。
   */
  const flashNotice = (message: string, ms = 4000) => {
    setNotice(message)
    window.setTimeout(() => setNotice((prev) => (prev === message ? '' : prev)), ms)
  }
  const [feedback, setFeedback] = useState<Record<string, 'helpful' | 'unhelpful'>>({})
  const [historyOpen, setHistoryOpen] = useState(false)
  // 侧边栏形态（09-18 七改）：与问助手页共用同一个展开状态和持久化键 ——
  // 在会话页收起侧栏，回到问助手页也是收起的（用户说的「同步」）。
  const [sidebarOpen, setSidebarOpen] = useSidebarOpen()
  // 09-18 十六改：首问（/conversations/new）时 accepted 返回的真实会话 id。
  // 路由 id 因 replaceState 不更新，侧栏选中态靠这份 state（发给 activeId prop）。
  const [streamConversationId, setStreamConversationId] = useState<string | null>(null)
  /**
   * 首问的「占位行」（09-19 二十四改）：给侧栏在**后端落库之前**先顶一行。
   *
   * 为什么必须前端顶：真后端把 conversations 行的 INSERT 放在整轮回答跑完之后
   * （`conversations_repo._agent_stream` 里 `session.add(con)+commit()` 在 astream 循环之后、
   * `done` 之前），所以 `accepted` 那一刻重拉列表**必然查不到**刚发的这条 ——
   * 侧栏既缺这一行、也没有选中态（用户 09-19 截图：「我这个新对话侧边栏怎么就不显示呢」）。
   * 字段口径与页头标题一致：标题先用用户输入（`content.slice(0,80)`），
   * 工作区用本轮 workspace_path（保证它落进同一个文件夹组、且排在组内第一行）；
   * `event: title` 到了就换模型标题，`done` 重拉拿到真行后由侧栏按 id 去重让位。
   */
  const [pendingConversation, setPendingConversation] = useState<ConversationSummary | null>(null)
  // 变了就让侧栏重拉会话列表：accepted（新会话进列表）、done（模型标题落库）各一次。
  const [sidebarRefresh, setSidebarRefresh] = useState(0)
  // 工作区（09-17）：全局会话级 store（localStorage），发送时放进 workspace_path
  const workspacePath = useWorkspace()
  // ask_user 待答追问：后端中断本轮等作答，事件不落库，所以放在会话级 state（message 列表会被静默刷新整体替换）。
  const [pendingAsk, setPendingAsk] = useState<AskUserQuestion[] | null>(null)
  // 权限确认待答：被拦的动作等人工批准（改文件 / 调用受控工具，如联网搜索），
  // 与追问同一个停靠位，二选一展示
  const [pendingPermission, setPendingPermission] = useState<PermissionAction[] | null>(null)
  // 任务清单面板（10-09，Codex 式）：悬浮在输入框上方，展示**当前**清单。
  // write_todos 每次全量替换 → 面板原地更新（时间线上不留任务卡，那里不是「当前进度」的家）。
  // 会话级 state：新提问即作废（新一轮的任务在新清单里），todos 不落库、刷新后为空。
  const [liveTodos, setLiveTodos] = useState<TraceTodo[] | null>(null)
  // 「已修改的文件」右侧边栏（10-07）：点清单胶囊展开，Codex 式停靠面板（非模态、不遮聊天区）
  const [previewFile, setPreviewFile] = useState<ChangedFileRef | null>(null)
  // 对话大纲（ChatGPT 式）：右缘竖排短横线，悬停展开问题标签 + 预览卡，点击跳转，滚动时定位当前条。
  const [outlinePreview, setOutlinePreview] = useState<number | null>(null)
  const [outlineActive, setOutlineActive] = useState(0)
  const lastSentRef = useRef('')
  /**
   * 流式回答的正文缓存，按后端 msg_id 分组。
   * 后端可能用多个 msg_id 分批推正文（如续跑接上前一轮），按 key 分组才能按到达顺序拼回去。
   */
  const answerBufRef = useRef<{ order: string[]; text: Record<string, string> }>({ order: [], text: {} })

  // 09-23：原先这里拉 /workspace/summary + /agents，只为喂「智能体管理」入口的在线数
  // 和调度下拉的选项。全站只剩一个主智能体，两样都没有了，请求一并去掉。

  const load = useCallback(() => {
    if (id === 'new') {
      // 新会话占位路由：无后端会话可查，等流式 accepted 返回真实 id 后再刷新。
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    // 打开的是别的真实会话：上一场留下的占位行作废（首问流程 id 恒为 'new'，不会走到这里）。
    setPendingConversation(null)
    // 同理作废输入框里遗留的附件（09-19）：那是为「上一轮/上一次提问」挑的文件，
    // 直接跟着下一条发出去会串（首问流程 id 恒为 'new'，不会误伤刚发出去的那一轮）。
    clearAttachments()
    // 换了一条会话：标题重新以库里的为准（上一轮流里定过的标题不能跨会话粘住）。
    titleFromStreamRef.current = false
    // 会话摘要与消息统一由 /history/conversations/{id} 返回（后端未单独提供 conversations/{id} 的 GET 接口）。
    getHistoryConversation(id!).then(({ data }) => {
      const payload = data.data as { title?: string; agent_name?: string; messages?: ConversationMessage[] } | undefined
      if (!payload || typeof payload !== 'object') throw new Error('会话接口返回格式异常')
      if (payload.title) setTitle(String(payload.title))
      setMessages((Array.isArray(payload.messages) ? payload.messages : []).map(mapApiMessage))
      setLoading(false)
    }).catch((failure) => {
      setLoadError(apiErrorMessage(failure, '会话数据加载失败，请稍后重试'))
      setLoading(false)
    })
  }, [id])

  useEffect(() => {
    load()
    // 仅在真实会话卸载时中断流；new 占位路由的自动流不中断（StrictMode 双调用需保留）。
    if (id !== 'new') return () => abortRef.current?.abort()
  }, [load, id])

  // 新消息或流式增量时贴底（追问卡片出现时也要滚到可见处）。
  // 贴底跟随（ChatGPT 同款）：用户上翻阅读时不再强行拽回，滚回底部才恢复跟随。
  const stickRef = useRef(true)
  const [scrolledUp, setScrolledUp] = useState(false)
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const update = () => {
      stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 8
      setScrolledUp(!stickRef.current)
    }
    update()
    node.addEventListener('scroll', update, { passive: true })
    return () => node.removeEventListener('scroll', update)
  }, [])
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    if (pendingAsk || pendingPermission || stickRef.current) node.scrollTop = node.scrollHeight
  }, [messages, pendingAsk, pendingPermission])

  // 流结束后按真实会话 id 静默刷新，绑定服务端消息 id（评价、导出等操作依赖真实 id）。
  const silentRefresh = useCallback((conversationId: string) => {
    getHistoryConversation(conversationId).then(({ data }) => {
      const payload = data.data as { title?: string; agent_name?: string; messages?: ConversationMessage[] } | undefined
      if (!payload || typeof payload !== 'object') return
      // 流里已推过标题就认它：本轮标题刚落库，详情接口可能还没更新到，别把新标题顶回旧的。
      if (!titleFromStreamRef.current && payload.title) setTitle(String(payload.title))
      if (Array.isArray(payload.messages) && payload.messages.length) {
        const serverMessages = payload.messages.map(mapApiMessage)
        // 服务端返回的消息比本地已渲染的还少，说明本轮还没落库（写入失败或延迟），
        // 这时用服务端结果覆盖会让刚流式出来的问答整段消失，因此保留本地视图。
        // 思考过程已由后端落库并在历史详情里下发（messages.reasoning_content），无需再做本地回填。
        setMessages((prev) => {
          if (serverMessages.length < prev.length) return prev
          // 工作过程（step/tool/tool_result）后端不落库，直接覆盖会让刚看到的过程瞬间消失，
          // 因此按位置把本地的 trace 回填到刷新后的 assistant 消息上；「本轮起算时刻 / 用时」
          // 同理（后端没有这两个字段）—— 不回填的话，刷新一到刚显示的「用时」就没了。
          const merged = serverMessages.map((server, index) => {
            const local = prev[index]
            if (server.role === 'assistant' && local?.role === 'assistant') {
              const carried: Partial<ChatMessage> = {}
              if (local.trace?.length) carried.trace = local.trace
              if (local.startedAt != null) carried.startedAt = local.startedAt
              if (local.elapsedMs != null) carried.elapsedMs = local.elapsedMs
              // 改动文件清单（10-07）同理：过程事件不落库，不回填的话回答一落库清单就消失
              if (local.changedFiles?.length) carried.changedFiles = local.changedFiles
              return Object.keys(carried).length ? { ...server, ...carried } : server
            }
            // 附件的回显（09-19）同理：服务端历史接口不下发附件，不回填的话回答一落库、
            // 用户气泡上的文件名就凭空消失了。
            if (server.role === 'user' && local?.role === 'user' && local.attachments?.length) {
              return { ...server, attachments: local.attachments }
            }
            return server
          })
          // ask_user 挂起中（waiting）/ 软暂停（paused）的这轮还没结束：服务端没有这个状态
          // （mapApiMessage 一律 done），不把 waiting/paused 带过去的话，刷新一到就会
          // 冒出「已完成」和操作条。
          const lastLocal = [...prev].reverse().find((message) => message.role === 'assistant')
          const lastServer = [...merged].reverse().find((message) => message.role === 'assistant')
          if (lastServer && lastLocal?.status === 'waiting') lastServer.status = 'waiting'
          if (lastServer && lastLocal?.status === 'paused') lastServer.status = 'paused'
          return merged
        })
      }
    })
  }, [])

  const send = async (
    rawContent?: string,
    resumePayload?: string,
    /**
     * 追问续跑专用：
     * - targetKey：续写**已有**的那条 assistant 消息（ask_user 的问答属于同一轮，不新开气泡）
     * - appendUser：是否补一条用户气泡（作答不补：选择由卡片承载，回显答案属于噪音）
     */
    options?: { targetKey?: string; appendUser?: boolean },
  ) => {
    const content = (rawContent ?? draft).trim()
    // 🔴 生成中发送（09-23 五次定稿）：不开新流（后端对执行中的线程一律回 stream_running），
    // 也不直接送达 —— 内容暂存成输入框上方的「补充横条」，点横条上的发送键才送出去。
    // 追问续跑（resumePayload）不受此影响，照常发。
    if (sending && content && !resumePayload) {
      setSupplementStrips((prev) => [...prev, { id: `strip-${Date.now()}`, content, sending: false }])
      setDraft('')
      // 暂存不发页脚提示（09-23 用户拍板）：横条本身已经是反馈，别再用常驻文字占地方
      return
    }
    // 追问续跑时即使人话为空（全部题目都可跳过）也必须发出去，兜底交给 resume 承载。
    if ((!content && !resumePayload) || sending) return
    // 「暂停续跑」（10-08）：任务暂停时发消息 = 隐式「继续」—— 续写暂停中的那条
    // 助手气泡（不新开），用户气泡照常补。后端凭 content 检测到暂停态会自动转
    // Command(resume={"action":"continue","supplement":content})，前端不用带 resume。
    let sendOptions = options
    if (paused && !resumePayload && !options?.targetKey) {
      const targetKey = [...messages].reverse().find((message) => message.role === 'assistant')?.key
      if (targetKey) sendOptions = { targetKey, appendUser: Boolean(content) }
    }
    lastSentRef.current = content
    if (!rawContent) setDraft('')
    const resuming = Boolean(sendOptions?.targetKey)
    /**
     * 本轮随带的附件（09-19 二阶）：发送前先快照文件本体。追问续跑（ask_user 作答、权限作答）
     * 属于同一轮、内容就是同一批文件，不带附件 —— 否则同一批文件会被重复挂到后面那条消息上。
     */
    const outgoingAttachments = resuming ? [] : getAttachmentFiles()
    // 不续跑而是重新提问时，上一张权限卡已失效（被中断的那一轮不会再用它续跑），清掉免得误点
    if (!resuming) setPendingPermission(null)
    // 上一轮的任务清单同理：新一轮的任务进度看新清单，旧面板不留着误导
    if (!resuming) setLiveTodos(null)
    // 工作区随每一轮请求都带上（09-19 改：resume/权限卡作答也带）——后端工作区绑定
    // 只认「请求体 + Redis」，不再查库兜底；store 在 localStorage 不会无故丢，
    // 用户中途换绑时续跑轮以新值为准（后端写穿覆盖）
    const outgoingWorkspacePath = workspacePath
    const assistantKey = sendOptions?.targetKey ?? `stream-${Date.now()}`
    /**
     * 回答正文按 msg_id 分组缓存：后端可能用多个 msg_id 分批推正文，
     * 按到达顺序拼回一条完整回答。续跑同一轮时保留已有缓存，新轮的 msg_id 继续追加，正文才接得上。
     * 09-23 改为每次调用一份本地缓存（执行中追加改为软注入后不再有并存流，
     * 但本地缓存仍是对的：调用之间不共享状态，少一层隐式耦合）。
     * 追问续跑（同一轮）发车时把 ref 里的旧缓存拷进本地接着写，再把 ref 复位（它只作为续跑的交接站）。
     */
    if (resuming) {
      // 续写已有气泡（追问 / 暂停续跑 / 权限作答）：把气泡里**已有的正文**作为第一段
      // 喂回缓存，后续 token 追加在其后 —— 否则续跑流的第一个 flushAnswer 会用空
      // 缓存把已有内容整体覆盖掉（续跑即清空，10-08 顺带修掉）。
      const target = messages.find((message) => message.key === assistantKey)
      answerBufRef.current = {
        order: ['resume-prior'],
        text: { 'resume-prior': target?.content ?? '' },
      }
    }
    const answerBuf = resuming
      ? { order: [...answerBufRef.current.order], text: { ...answerBufRef.current.text } }
      : { order: [] as string[], text: {} as Record<string, string> }
    answerBufRef.current = { order: [], text: {} }
    setMessages((prev) => {
      const appended = sendOptions?.appendUser === false
        ? []
        : [{
            key: `user-${Date.now()}`,
            role: 'user' as const,
            content,
            citations: [],
            status: 'done' as const,
            /* 附件回显（09-19）：本地记一份文件名，服务端历史接口不下发附件，刷新后这里自然为空 */
            ...(outgoingAttachments.length
              ? { attachments: outgoingAttachments.map((file) => ({ name: file.name, size: file.size })) }
              : {}),
          }]
      const withUser = [...prev, ...appended]
      if (resuming) {
        // 追问续跑：不新增助手气泡，把原来那条从「等待作答」切回声流中
        return withUser.map((message) => (message.key === assistantKey ? { ...message, status: 'streaming' as const } : message))
      }
      return [
        ...withUser,
        { key: assistantKey, role: 'assistant' as const, content: '', reasoning: '', trace: [], citations: [], status: 'streaming' as const, startedAt: Date.now() },
      ]
    })
    setSending(true)
    // 续跑/新轮开始即解除暂停态（这轮流若再次暂停，由 onPaused 重新置位）
    setPaused(false)
    activeStreamsRef.current += 1
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    // 续接已有会话：优先用流里拿到的真实 id（/conversations/new 首轮后才有），其次用路由参数；
    // 'new' 是还没有后端会话的占位路由，此时不传 conversation_id，由服务端新建。
    const conversationId = realIdRef.current ?? (id && id !== 'new' ? id : undefined)
    /**
     * 标题（09-18）：首问不等接口，先把用户输入顶上去 —— 页头立刻有内容，不挂在「新会话」上；
     * 与请求体里 `title: content.slice(0,80)` 用同一个截断口径，两边不会出现两个标题。
     * 后端起好标题会推 `event: title` 覆盖它（见下面 onTitle）；续接已有会话不碰标题。
     */
    if (!conversationId && content) {
      titleFromStreamRef.current = false
      setTitle(content.slice(0, 80))
    }
    const patchAssistant = (patch: (message: ChatMessage) => ChatMessage) =>
      setMessages((prev) => prev.map((message) => (message.key === assistantKey ? patch(message) : message)))
    /**
     * 收尾：本轮落定，顺手把「用时」结在消息上（过程区的「已完成 · 用时 X」读它）。
     * 续跑沿用同一 startedAt，所以整轮只结一次账；`??` 兜底防 done 来两遍时被改写。
     */
    const finish = (message: ChatMessage, status: ChatMessage['status']): ChatMessage => ({
      ...message,
      status,
      elapsedMs: message.elapsedMs ?? Date.now() - (message.startedAt ?? Date.now()),
    })
    // 把 msg_id 分组缓存拼成当前回答正文
    const flushAnswer = () => {
      const content = answerBuf.order.map((id) => answerBuf.text[id] ?? '').join('')
      patchAssistant((message) => ({ ...message, content }))
    }
    const pushTrace = (item: TraceItem) =>
      patchAssistant((message) => ({ ...message, trace: [...(message.trace ?? []), item] }))
    /**
     * 本轮改动文件清单（10-07）：`event: tool` 先按 call_id 记候选（解析 args 里的
     * file_path/path + diff 素材），`event: tool_result` 回来后不是被拒/失败才算「真的改到了」。
     * 按 path 去重（同一文件改多次只留一条，动作/diff 取最后一次）。
     * 续跑轮（ask_user/权限作答续写同一条气泡）从旧清单接着记，别把已确认的冲掉。
     */
    const changedTracker = {
      // call_id → 候选组（download_from_sandbox 一次调用可落多个文件）
      pending: new Map<string, ChangedFileRef[]>(),
      paths: new Map<string, ChangedFileRef>(
        (options?.targetKey
          ? messages.find((message) => message.key === options.targetKey)?.changedFiles ?? []
          : []
        ).map((file) => [file.path, file]),
      ),
    }
    const syncChangedFiles = () =>
      patchAssistant((message) => ({ ...message, changedFiles: [...changedTracker.paths.values()] }))
    try {
      await streamConversationReply(
        {
          // 带上 conversation_id 才会续接同一会话线程，否则后端每轮都新开线程，多轮上下文会丢。
          conversation_id: conversationId,
          // 只有新建会话才需要标题与来源；续接时后端复用已有会话，不需要也不该覆盖标题。
          ...(conversationId ? {} : { title: content.slice(0, 80), source: 'conversation' }),
          // 自定义参数（09-19）：回答偏好/思考等级走接口真字段（契约 §8.2），content 保持原文；
          // 全默认时不带字段，后端按缺省（balanced / off）处理。追问续跑同样带上。
          content,
          // 附件（09-19 二阶）：文件**本体**随这轮提问一起走 multipart 的 `files` 字段
          // （后端 `Message.files: list[UploadFile]`）。一个都没有时不带，别给后端塞空字段。
          ...(outgoingAttachments.length ? { files: outgoingAttachments } : {}),
          ...buildAnswerPrefsPayload(),
          // 09-23：全站只剩一个主智能体，前端不再有可选的 agent key，恒发 auto
          // （后端 `Message.agent_mode` 默认值也是 auto，契约字段保留不动）。
          agent_mode: 'auto',
          // 页头 Chat / Agent 模式：chat 表示纯对话（后端可据此跳过 Agent 调度）
          mode: getAskMode(),
          // ask_user 追问的回答：带 resume 时后端用它续跑被中断的线程（answers 顺序必须对齐问题）
          ...(resumePayload ? { resume: resumePayload } : {}),
          // 工作区（09-17）：随本次提问绑定到接口，格式 `<rootKey>:<相对路径>`（如 d:exam）
          ...(outgoingWorkspacePath ? { workspace_path: outgoingWorkspacePath } : {}),
          // 权限档位（09-17）：取当前「批准方式」，后端按它生成文件读写权限规则
          permission_mode: getPermissionMode(),
        },
        {
          onAccepted: (info) => {
            /**
             * 附件（09-20 二阶）：文件已随本轮请求发出去（multipart 的 `files`），清空输入框里的这份快照，
             * 免得它们跟着下一轮再发一遍。放在 accepted 而不是点发送那一刻 —— 请求失败时
             * 文件还留在框里，用户能直接重发。追加阶段（resume）本来就是空的，无害。
             */
            clearAttachments()
            // 服务端在 accepted 事件返回真实会话 id：更新地址栏但不触发路由重挂载。
            if (info.conversation_id != null) {
              const conversationId = String(info.conversation_id)
              realIdRef.current = conversationId
              window.history.replaceState(null, '', `/conversations/${conversationId}`)
              // 09-18 十六改：replaceState 不触发路由重渲染，路由 id 还是 'new' →
              // 侧栏选中态无从挂起。把 accepted 拿到的 id 存进 state 直接传给侧栏，
              // 同时 bump refreshKey 让它重拉列表（新会话此刻才在列表里存在）——
              // 用户拍板：发送那一刻就该选中刚发的那条，不等 AI 响应完。
              setStreamConversationId(conversationId)
              setSidebarRefresh((n) => n + 1)
              // 09-19 二十四改：**重拉列表看不到这条**（后端此刻还没 INSERT 会话行），
              // 所以除了 bump 重拉，还要用已知信息先顶一行占位 —— 侧栏这才当场有行 + 有选中态。
              // 标题沿用首问口径（用户输入截断），工作区沿用本轮 workspace_path（决定落在哪个文件夹组）。
              setPendingConversation({
                id: conversationId,
                title: content.slice(0, 80) || '新会话',
                agent_name: null,
                message_count: 0,
                is_bookmarked: false,
                updated_at: new Date().toISOString(),
                ...(outgoingWorkspacePath ? { work_space: outgoingWorkspacePath } : {}),
              })
            }
          },
          // 09-23：`onRoute` 回调用不上了 —— 后端只剩一个节点，不再回写 agent_mode，
          // route 事件不会再来；页头的作答者名固定取 MAIN_AGENT.name。
          // 标题：后端模型起好的一句话标题，用它覆盖首问时顶上来的用户输入（页头 + 历史列表同一个名）。
          onTitle: (value) => {
            titleFromStreamRef.current = true
            setTitle(value)
            // 占位行跟着换名（侧栏那一行与页头必须同名）；真行还没到，正是它顶着的这段窗口。
            setPendingConversation((prev) => (prev ? { ...prev, title: value } : prev))
          },
          // 思考（09-19 十七改）：按「波次」进时间线 —— step/tool 一到，下一次 think
          // 自然开新波（后端本就是 think → step → tool 交替推），时间线上就是
          // 深度思考 → 前言 → 工具 → 深度思考 … 的原序；整轮全文仍累进 reasoning
          // （落库/门控口径不变，ProcessPanel 只在没有思考波时才用它兜底）。
          onThink: (text) =>
            patchAssistant((message) => {
              const trace = message.trace ?? []
              const last = trace[trace.length - 1]
              const nextTrace =
                last?.kind === 'think'
                  ? [...trace.slice(0, -1), { kind: 'think' as const, text: (last.text ?? '') + text }]
                  : [...trace, { kind: 'think' as const, text }]
              return { ...message, reasoning: (message.reasoning ?? '') + text, trace: nextTrace }
            }),
          // 工作过程：前言 / 工具调用 / 工具返回（后端只推不落库）
          onStep: (step) => {
            if (step.text) pushTrace({ kind: 'step', text: step.text })
          },
          onTool: (info) => {
            // write_todos（TodoListMiddleware，10-09）：args 就是任务清单 JSON，喂给
            // 输入框上方的任务清单面板（Codex 式，每次调用全量替换、原地更新）。
            // 时间线上**不留**任务卡；解析失败就当没发生（它的 tool_result 是英文 repr，
            // 下面 onToolResult 里也会丢，两处都拦是防御）。
            if (info.tool === 'write_todos') {
              const todos = parseWriteTodosArgs(info.args)
              if (todos) setLiveTodos(todos)
              return
            }
            pushTrace({ kind: 'tool', tool: info.tool, callId: info.call_id })
            // 改动文件清单（10-07）：文件类工具先记候选，等 tool_result 判定成败。
            // args 是完整参数 JSON：write/edit 顺带捕获 diff 素材（超过 DIFF_MAX_CHARS 不存，
            // 抽屉降级走「读文件内容预览」）；download_from_sandbox 一次落多个文件 → 按组记，
            // 产物固定落 ai_output/<沙箱文件名>（workspace_files.py 的口径）。
            const action = FILE_ACTIONS[info.tool ?? '']
            if (!action || !info.call_id) return
            let args: ToolArgs | null = null
            try {
              args = JSON.parse(info.args || '{}') as ToolArgs
            } catch {
              args = null // args 不是完整 JSON（异常分片才会出现）：放弃这组候选，宁缺毋滥
            }
            if (!args) return
            const group: ChangedFileRef[] = []
            if (info.tool === 'download_from_sandbox') {
              const list = Array.isArray(args.paths) ? args.paths : []
              for (const item of list) {
                const name = String(item).replace(/\\/g, '/').split('/').pop()
                if (name) group.push({ path: `/user/ai_output/${name}`, action: 'write', confirmed: false })
              }
            } else {
              const content = typeof args.content === 'string' ? args.content : ''
              const before = typeof args.old_string === 'string' ? args.old_string : ''
              const after = typeof args.new_string === 'string' ? args.new_string : ''
              const path = String(args.file_path ?? args.path ?? '')
              let diff: ChangedFileRef['diff']
              if (action === 'write' && content && content.length <= DIFF_MAX_CHARS) {
                diff = { kind: 'write', after: content }
              } else if (action === 'edit' && before.length + after.length <= DIFF_MAX_CHARS) {
                diff = { kind: 'edit', before, after }
              }
              if (path) group.push({ path, action, diff, confirmed: false })
            }
            if (!group.length) return
            changedTracker.pending.set(info.call_id, group)
            // 🔴 候选必须**立刻**落进消息状态（10-07 真机实测教训）：ask/auto 档写文件会先弹
            // 权限卡、流在弹卡处结束；作答续跑的新流**不会重推 event: tool**（工具调用已在
            // checkpoint 里，收尾只补发 tool_result）—— 候选若只活在本段流的内存里，
            // 续跑后按 call_id 就配不上了，清单永远空。
            for (const item of group) changedTracker.paths.set(item.path, item)
            syncChangedFiles()
          },
          onToolResult: (info) => {
            // submit_answer 的返回就是回答本身（已按 token 进正文区），后端不该推
            // tool_result；万一旧后端/异常路径漏推，这里拦一道，别让回答原文
            // 挂进上一张工具卡（前端按 call_id 配不到调用时会兜底挂最近一次调用）。
            if (info.tool === 'submit_answer') return
            // write_todos 的返回是英文 repr（"Updated todo list to [...]"），清单本体已在
            // event: tool 的 args 里渲染成任务卡 —— 这行结果纯属噪音，直接丢，别让
            // 孤儿归位逻辑把它挂到别的工具卡下面。
            if (info.tool === 'write_todos') return
            pushTrace({ kind: 'result', tool: info.tool, result: info.content, callId: info.call_id })
            // 判定候选成败（10-07）：被拒/失败的调用没有真的改到文件，从清单剔除。
            // 配对顺序：① call_id 精确配（同一段流，含 download 的多文件组）；② 同动作的未确认候选
            // 兜底 —— 🔴 权限卡作答后的续跑段**不会重推 event: tool**，pending 是空的，
            // 只有候选已在弹卡前落进消息状态（confirmed:false），这里才配得上。
            const action = FILE_ACTIONS[info.tool ?? '']
            const key = info.call_id ?? ''
            let group = changedTracker.pending.get(key)
            if (!group && action) {
              group = [...changedTracker.paths.values()].filter(
                (item) => item.confirmed === false && item.action === action,
              )
            }
            if (!group?.length) return
            if (key) changedTracker.pending.delete(key)
            const content = info.content ?? ''
            const confirm = (item: ChangedFileRef) => changedTracker.paths.set(item.path, { ...item, confirmed: true })
            const drop = (item: ChangedFileRef) => {
              // 同路径早前已确认过的改动不能被这次失败连坐删掉
              if (!changedTracker.paths.get(item.path)?.confirmed) changedTracker.paths.delete(item.path)
            }
            if (info.tool === 'download_from_sandbox') {
              // 机器格式（workspace_files._do_download）：saved 行是落盘绝对路径、failed 行是
              // /workspace/ 沙箱路径 —— 解析得动就精确到文件：成了的确认、败的剔除，其余保持
              // 未确认（不显示，宁缺毋滥）；解析不动（整体失败等）退回失败词判定。
              const savedNames = new Set<string>()
              const failedNames = new Set<string>()
              for (const match of content.matchAll(/^\s{2}(.+?)（/gm)) {
                const raw = match[1].replace(/\\/g, '/')
                const name = raw.split('/').pop() ?? ''
                if (!name) continue
                if (raw.startsWith('/workspace/')) failedNames.add(name)
                else savedNames.add(name)
              }
              if (savedNames.size || failedNames.size) {
                for (const item of group) {
                  const name = item.path.split('/').pop() ?? ''
                  if (savedNames.has(name)) confirm(item)
                  else if (failedNames.has(name)) drop(item)
                }
              } else if (FILE_FAIL_PATTERN.test(content)) {
                group.forEach(drop)
              } else {
                group.forEach(confirm)
              }
            } else if (FILE_FAIL_PATTERN.test(content)) {
              group.forEach(drop)
            } else {
              group.forEach(confirm)
            }
            syncChangedFiles()
          },
          onToken: (text, msgId) => {
            const key = msgId || 'default'
            if (answerBuf.text[key] === undefined) answerBuf.order.push(key)
            answerBuf.text[key] = (answerBuf.text[key] ?? '') + text
            flushAnswer()
          },
          // 追问：后端中断本轮，推完 question 事件就收流；用户作答后带 resume 续跑同一线程。
          // 这一轮**没有结束**（还没 done），所以标 waiting 而不是 done：
          // 不显示「已完成」摘要、不出现复制/点赞/重新生成操作条，等最后的 done 到了才收尾。
          onQuestion: (info) => {
            if (info.questions?.length) {
              setPendingAsk(info.questions)
              patchAssistant((message) => ({ ...message, status: 'waiting' }))
            }
          },
          // 权限确认（改用户真实文件 / 受控工具调用前）——专门的卡片承载，与追问同一停靠位、互斥
          onPermission: (info) => {
            if (info.actions?.length) {
              setPendingPermission(info.actions)
              patchAssistant((message) => ({ ...message, status: 'waiting' }))
            }
          },
          onDone: () => {
            patchAssistant((message) => finish(message, 'done'))
            // 09-18 十六改：模型标题此刻才落库，bump 让侧栏重拉、刚那条的标题跟上
            setSidebarRefresh((n) => n + 1)
          },
          // 用户点了「停止」（09-19）：服务端取消执行并尽力落库半截结果后以此收尾。
          // 把已收到的内容定格标「已停止」（等同流结束，但不算完成态、不出操作条）。
          onStopped: () => {
            patchAssistant((message) =>
              message.status === 'streaming' || message.status === 'waiting' ? finish(message, 'stopped') : message,
            )
            setPendingAsk(null)
            setPendingPermission(null)
            setSidebarRefresh((n) => n + 1)
          },
          // 「暂停」（10-08）：软暂停落地 —— 图停在干净的模型调用边界，本轮**没结束**、
          // 可续跑（连点停止强杀才走 stopped）。标 paused（不出「已完成」、不出操作条），
          // 发送键原位变「继续」；注意不结 elapsedMs（继续后用时接着算）。
          // 引导文案走 flashNotice（几秒自清）：常驻栏会一直挂着，用户实测嫌吵 ——
          // 持久的状态标记由气泡下面的「任务已暂停」承担。
          onPaused: () => {
            patchAssistant((message) =>
              message.status === 'streaming' || message.status === 'waiting'
                ? { ...message, status: 'paused' as const }
                : message,
            )
            setPaused(true)
            flashNotice('任务已暂停，点输入框旁的「继续」恢复执行；直接输入新消息也可继续任务。')
          },
          // 「执行中追加」（09-23）：后端停旧流、起新轮之前先发的说明 —— 复用页脚上方的
          // notice 条展示，用户能看懂「为什么上一条突然停了」。
          onNotice: (info) => {
            if (info.message) setNotice(info.message)
          },
        },
        abortRef.current.signal,
      )
      // 流正常结束但未收到 done 事件时的兜底收尾。
      patchAssistant((message) => (message.status === 'streaming' ? finish(message, 'done') : message))
    } catch (streamError) {
      if ((streamError as Error).name !== 'AbortError') patchAssistant((message) => finish(message, 'failed'))
    } finally {
      if (stopFallbackRef.current) {
        clearTimeout(stopFallbackRef.current)
        stopFallbackRef.current = null
      }
      // 轮次收尾（09-23）：没送出去的暂存条放回输入框 —— 任务已结束，横条上的
      // 发送键只会得到 queued=false，与其让用户逐条点，不如直接物归原主
      if (supplementStripsRef.current.length) {
        const salvage = supplementStripsRef.current.map((strip) => strip.content).join('\n')
        setDraft((prev) => (prev ? `${prev}\n${salvage}` : salvage))
        setSupplementStrips([])
        setEditingStripId(null)
        setEditingStripValue('')
      }
      // 计数收口（09-23）：追加场景下旧流的 finally 会晚于新流的 start 到达，
      // 谁都不能直接 setSending(false) —— 最后一条流结束才收发送态。
      activeStreamsRef.current = Math.max(0, activeStreamsRef.current - 1)
      if (activeStreamsRef.current === 0) setSending(false)
      const conversationId = realIdRef.current
      if (conversationId) silentRefresh(conversationId)
    }
  }

  /**
   * 停止正在执行的 agent 轮次（09-19）。POST /conversations/{id}/stop 让服务端取消
   * 流任务，本地 fetch 保持连接等 `event: stopped` / 关流（onStopped 里收尾）；
   * 连 accepted 都没拿到（会话 id 未知）或停止请求失败时，退化为直接 abort 本地流。
   */
  const stopStreaming = () => {
    const cid = realIdRef.current
    if (!cid) {
      abortRef.current?.abort()
      return
    }
    void stopConversationReply(cid)
      .then(() => {
        stopFallbackRef.current = window.setTimeout(() => abortRef.current?.abort(), 10_000)
      })
      .catch(() => abortRef.current?.abort())
  }

  /**
   * 「继续」（10-08）：恢复被软暂停的任务 —— 走 resume 通道发 `{"action":"continue"}`，
   * 后端 StopPauseMiddleware 在断点原位接住续跑决定，从 checkpoint 继续执行
   * （已做过的工具调用不会重放）。续写暂停中的那条助手气泡，不补用户气泡。
   */
  const resumePaused = () => {
    if (!paused) return
    const targetKey = [...messages].reverse().find((message) => message.role === 'assistant')?.key
    if (!targetKey) {
      // 找不到可续写的气泡（理论不可达）：至少把按钮态收掉，别把用户卡死
      setPaused(false)
      return
    }
    void send('', JSON.stringify({ action: 'continue' }), { targetKey, appendUser: false })
  }

  /**
   * 提交 ask_user 追问的作答：回到同一个流式接口，把答案放进 `resume` 续跑被中断的线程。
   * 后端 ask_user 中间件按 {"status":"answered","answers":[...]} 解析，answers 顺序与问题一一对应；
   * 纯文本给模型看，所以 content 也带上同样的人话（后端优先用 resume）。
   * 两个刻意的处理：① 不补用户气泡（选择由卡片承载）；② 续写原来那条助手消息（同一轮，不新开气泡）。
   */
  const answerAsk = (answers: string[], displayText: string) => {
    const targetKey = [...messages].reverse().find((message) => message.role === 'assistant')?.key
    setPendingAsk(null)
    const text = (displayText || answers.join('；') || '（未填写）').trim()
    void send(text, JSON.stringify({ status: 'answered', answers }), {
      targetKey,
      appendUser: false,
    })
  }

  /**
   * 提交权限确认的作答。契约与 ask_user 同形（answers[0] = '允许' | '拒绝'），
   * 后端会把它翻译成 HITL 要的 decisions 再续跑同一条被中断的线程，
   * 所以这里复用 send 的 resume 通道，不新开用户气泡、续写原来那条助手消息。
   */
  const answerPermission = (allow: boolean) => {
    const targetKey = [...messages].reverse().find((message) => message.role === 'assistant')?.key
    setPendingPermission(null)
    const answer = allow ? '允许' : '拒绝'
    void send(answer, JSON.stringify({ status: 'answered', answers: [answer] }), {
      targetKey,
      appendUser: false,
    })
  }

  // 新会话占位路由：携带首问时自动发起一次流式请求（ref 防止 StrictMode 下重复触发）。
  useEffect(() => {
    if (id === 'new' && pendingQuestion && !streamStartedRef.current) {
      streamStartedRef.current = true
      void send(pendingQuestion)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, pendingQuestion])

  // Enter 发送、Shift+Enter 换行与输入法组词保护都收在 PromptComposer 里，本页不再自己处理键盘。

  const copyMessage = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content)
      setNotice('回答内容已复制')
    } catch {
      setNotice('复制失败，请手动选择文本复制')
    }
  }

  /**
   * 「执行中补充」横条（09-23 五次定稿）：生成中在输入框正常发送 → 暂存成输入框
   * 上方的横条；**横条上的发送键**（修改键旁边那个，Reply）才真正把内容送达正在
   * 执行的任务（软注入，不打断，回答仍从原有那条流出）。修改键原地改文本，删除键丢弃。
   */
  const sendStrip = async (stripId: string) => {
    const strip = supplementStrips.find((item) => item.id === stripId)
    if (!strip || strip.sending) return
    const supplementConversationId = realIdRef.current ?? (id && id !== 'new' ? id : undefined)
    if (!supplementConversationId) return
    setSupplementStrips((prev) => prev.map((item) => (item.id === stripId ? { ...item, sending: true } : item)))
    try {
      const queued = await sendSupplement(supplementConversationId, strip.content)
      if (queued) {
        setSupplementStrips((prev) => prev.filter((item) => item.id !== stripId))
        // 送达成功用短暂 toast（09-23 用户拍板：追加时弹窗提示一下就行，不要常驻页脚文字）
        setSupplementToast('补充已送达正在执行的任务')
      } else {
        // 流刚好自己结束了：内容放回输入框，用户直接正常发送即可
        setSupplementStrips((prev) => prev.filter((item) => item.id !== stripId))
        setDraft((prev) => (prev ? `${prev}\n${strip.content}` : strip.content))
        setNotice('任务刚刚结束，补充内容已放回输入框，可直接发送。')
      }
    } catch {
      setSupplementStrips((prev) => prev.map((item) => (item.id === stripId ? { ...item, sending: false } : item)))
      setNotice('补充发送失败，请重试。')
    }
  }

  const removeStrip = (stripId: string) => {
    setSupplementStrips((prev) => prev.filter((item) => item.id !== stripId))
    if (editingStripId === stripId) {
      setEditingStripId(null)
      setEditingStripValue('')
    }
  }

  const commitEditStrip = () => {
    const next = editingStripValue.trim()
    if (editingStripId && next) {
      setSupplementStrips((prev) => prev.map((item) => (item.id === editingStripId ? { ...item, content: next } : item)))
    }
    setEditingStripId(null)
    setEditingStripValue('')
  }

  const rateMessage = async (message: ChatMessage, rating: 'helpful' | 'unhelpful') => {
    if (!message.id || feedback[message.key] === rating) return
    setFeedback((prev) => ({ ...prev, [message.key]: rating }))
    try {
      await sendFeedback(message.id, rating)
    } catch {
      setFeedback((prev) => {
        const next = { ...prev }
        delete next[message.key]
        return next
      })
    }
  }

  // 重新生成：取该回答前面最近的一条用户提问重新发送（历史加载的会话也能用）。
  const regenerate = (message: ChatMessage) => {
    if (sending) return
    const index = messages.findIndex((item) => item.key === message.key)
    for (let i = index - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') {
        void send(messages[i].content)
        return
      }
    }
  }

  // 大纲跳转：滚动到对应消息并短暂高亮。消息元素通过 data-mkey 定位，避免维护一整套 ref。
  const jumpToMessage = (key: string) => {
    const node = scrollRef.current?.querySelector<HTMLElement>(`[data-mkey="${key}"]`)
    if (!node) return
    node.scrollIntoView({ behavior: 'smooth', block: 'start' })
    node.classList.add('convo-flash')
    window.setTimeout(() => node.classList.remove('convo-flash'), 1300)
  }

  // 一轮 = 一条用户提问 + 其后连续的若干条 assistant；后端会把「我来帮您查询…」这类
  // 中间态也落库成 assistant 消息，聊天流里只渲染该轮最后一条（= 最终回答），
  // 否则一轮问答会冒出两三个气泡。过滤只影响渲染，不影响数据/评价等后续操作。
  const visibleMessages = useMemo(
    () => messages.filter((message, index) => message.role === 'user' || messages[index + 1]?.role !== 'assistant'),
    [messages],
  )

  // 大纲条目：每个用户提问一条，紧跟的回答作为预览卡内容。
  // 回答要取该轮**最后一条** assistant（中间态不是答案），否则悬停预览卡片显示的是「让我进一步查询…」。
  const outlineItems = useMemo(
    () =>
      messages.flatMap((message, index) => {
        if (message.role !== 'user' || !message.content) return []
        let answer: ChatMessage | undefined
        for (let cursor = index + 1; cursor < messages.length && messages[cursor].role === 'assistant'; cursor += 1) {
          answer = messages[cursor]
        }
        return [{ question: message, answer }]
      }),
    [messages],
  )

  // 思考条归属：后端把整轮累积的同一份思考写到了该轮每一条 assistant 消息上（实测同一份 5711 字 × 3 条），
  // 逐条渲染会出现三条一模一样的「已深度思考」。只认该轮最后一条（后面不再紧跟 assistant 的那条）。
  const reasoningOwnerKeys = useMemo(() => {
    const owners = new Set<string>()
    messages.forEach((message, index) => {
      if (message.role !== 'assistant' || !message.reasoning) return
      if (messages[index + 1]?.role === 'assistant') return
      owners.add(message.key)
    })
    return owners
  }, [messages])

  // 滚动跟随：视口顶端最近的那条提问在大纲里高亮（ChatGPT 的当前位置指示）。
  useEffect(() => {
    const node = scrollRef.current
    if (!node || outlineItems.length === 0) return
    const computeActive = () => {
      // 贴底兜底：滚动条到底时，最后一条提问可能还悬在视口中部（末轮回答短、下方还有输入区），
      // 按阈值规则它永远高亮不上 —— 直接高亮最后一条（ChatGPT 同款处理）。
      if (node.scrollHeight - node.scrollTop - node.clientHeight <= 8) {
        setOutlineActive(outlineItems.length - 1)
        return
      }
      const base = node.getBoundingClientRect().top
      let active = 0
      outlineItems.forEach((item, index) => {
        const el = node.querySelector(`[data-mkey="${item.question.key}"]`)
        if (el && el.getBoundingClientRect().top - base <= 140) active = index
      })
      setOutlineActive(active)
    }
    node.addEventListener('scroll', computeActive, { passive: true })
    computeActive()
    return () => node.removeEventListener('scroll', computeActive)
  }, [outlineItems])

  return (
    <section className={`convo-page${sidebarOpen ? ' sidebar-open' : ''}${previewFile ? ' file-panel-open' : ''}`}>
      <header className="assistant-modern-header convo-header">
        {sidebarOpen ? (
          /* 侧栏展开时顶栏只留会话状态 —— 与问助手页同一套摆法：
             Chat/Agent、新建会话、智能体管理三样都搬进侧栏，这里不留重复的第二份；
             收起按钮也在侧栏里（`.assistant-sidebar-fold`），顶栏不再挂第二个折叠图标。 */
          <span className="assistant-session-name is-standalone">
            <i />
            {loading && !title ? '会话加载中…' : title || '新会话'}
          </span>
        ) : (
          <>
            {/* 侧栏收起态的**唯一**入口：不留在顶栏就再也打不开了
                （原位置那颗是「返回问助手」，含义不同 —— 回问助手的入口在全局导航里）。 */}
            <button
              type="button"
              className="assistant-sidebar-toggle"
              onClick={() => setSidebarOpen(true)}
              aria-label="展开侧边栏"
              title="展开侧边栏"
            >
              <PanelLeftOpen size={16} />
            </button>
            <div className="assistant-session-actions">
              <AskModeSwitch />
              <button type="button" onClick={() => navigate('/workspace')}>
                <MessageSquarePlus size={15} />
                <span className="assistant-session-label">新建会话</span>
              </button>
              <span className="assistant-session-name">
                <i />
                {loading && !title ? '会话加载中…' : title || '新会话'}
              </span>
            </div>
            <div className="assistant-header-status">
              <button type="button" className="assistant-history-btn" onClick={() => setHistoryOpen(true)}>
                <History size={15} />
                <span className="assistant-session-label">历史对话</span>
              </button>
            </div>
          </>
        )}
      </header>

      {sidebarOpen && (
        <AssistantSidebar
          /* 选中行跟着路由走：会话页里「高亮的那条」永远 = 你正打开的那条。
             首问（/conversations/new）例外：replaceState 不触发路由重渲染，
             用 accepted 拿到的真实 id 顶上（streamConversationId）。 */
          activeId={id === 'new' ? streamConversationId : (id ?? null)}
          refreshKey={sidebarRefresh}
          pending={pendingConversation}
          onNew={() => navigate('/workspace')}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      <div className="convo-content" ref={scrollRef}>
        <div className="convo-scroll">
          {loading && (
            <div className="convo-loading" aria-label="会话加载中">
              <span className="convo-skeleton convo-skeleton-user" />
              <span className="convo-skeleton convo-skeleton-answer" />
            </div>
          )}

          {!loading && loadError && (
            <div className="convo-banner" role="alert">
              <span>{loadError}</span>
              <button type="button" onClick={load}>
                <RotateCw size={13} />
                重试
              </button>
            </div>
          )}

          {!loading && !loadError && !messages.length && (
            <div className="convo-empty">
              <Sparkles size={22} />
              <h3>还没有消息</h3>
              <p>在下方输入你的问题，Agent 会给出带依据的回答。</p>
            </div>
          )}

          {visibleMessages.map((message) =>
            message.role === 'user' ? (
              <div className="convo-user" key={message.key} data-mkey={message.key}>
                {/* 附件回显（09-19）：气泡上方一排小胶囊，让用户一眼确认「这轮发出去的是哪几个文件」。
                    图片附件（10-07）：悬停出缩略图、点击进右侧边栏（面板动作文案 =「已上传」）。 */}
                {message.attachments?.length ? (
                  <div className="convo-user-files">
                    {message.attachments.map((file, index) =>
                      isImagePath(file.name) ? (
                        <AttachmentImageChip
                          key={`${message.key}-${index}`}
                          name={file.name}
                          size={file.size}
                          workspace={workspacePath}
                          onOpen={() => setPreviewFile({ path: `/user/uploads/${file.name}`, action: 'write', label: '已上传' })}
                        />
                      ) : (
                        <span className="convo-user-file" key={`${message.key}-${index}`} title={file.name}>
                          <Paperclip size={11} />
                          <b>{file.name}</b>
                          <small>{formatAttachmentSize(file.size)}</small>
                        </span>
                      ),
                    )}
                  </div>
                ) : null}
                <p>{message.content}</p>
                {message.createdAt && (
                  <small>
                    <button
                      type="button"
                      className="convo-user-copy"
                      aria-label="复制"
                      title="复制"
                      onClick={() => void copyMessage(message)}
                    >
                      <ClipboardCopy size={12} />
                    </button>
                    {formatTime(message.createdAt)}
                  </small>
                )}
              </div>
            ) : (
              <article
                className={`convo-answer convo-msg${message.status === 'failed' ? ' failed' : ''}`}
                key={message.key}
                data-mkey={message.key}
              >
                <div className="convo-msg-head">
                  <span>
                    <Sparkles size={12} />
                    {/* 生成中给 Agent 名加 Codex 式高光扫描（只作用于文字，图标不受影响） */}
                    <em className={`convo-agent-label${message.status === 'streaming' ? ' is-shimmer' : ''}`}>{agent}</em>
                  </span>
                </div>

                {(message.trace?.length || (message.reasoning && reasoningOwnerKeys.has(message.key))) ? (
                  <ProcessPanel
                    reasoning={reasoningOwnerKeys.has(message.key) ? message.reasoning : undefined}
                    trace={message.trace}
                    // waiting（等用户作答）/ paused（软暂停）都按「进行中」渲染：本轮还没结束，别显示「已完成」
                    running={message.status === 'streaming' || message.status === 'waiting' || message.status === 'paused'}
                    elapsedMs={message.elapsedMs}
                    failed={message.status === 'failed'}
                  />
                ) : null}

                {message.status === 'failed' ? (
                  <div className="convo-msg-failed">
                    <button
                      type="button"
                      className="convo-regen"
                      aria-label="重新生成"
                      title="重新生成"
                      onClick={() => regenerate(message)}
                      disabled={sending}
                    >
                      <RotateCw size={13} />
                    </button>
                    回答生成失败，请检查网络后重试。
                  </div>
                ) : message.content ? (
                  <MarkdownText className="convo-msg-text" content={message.content} />
                ) : null}

                {/* 已修改的文件（10-07）：本轮 agent 真正改动过的用户文件，回答末尾点名。
                    行数统计来自 diff 素材（Codex 式）；没有素材（超大/老流）就不显示统计。
                    被权限卡拒绝/失败的调用不会出现在这里（见 FILE_FAIL_PATTERN）；
                    confirmed=false 的候选（弹了权限卡还没等到 tool_result）同样不显示。 */}
                {message.changedFiles?.filter((file) => file.confirmed !== false).length ? (
                  <div className="convo-files">
                    <p className="convo-files-title">
                      <FilePen size={12} />
                      已修改的文件
                    </p>
                    <ul className="convo-files-list">
                      {message.changedFiles.filter((file) => file.confirmed !== false).map((file) => {
                        const stats = file.diff
                          ? countDiff(diffLines(file.diff.kind === 'write' ? '' : file.diff.before ?? '', file.diff.after))
                          : null
                        return (
                          <li key={file.path}>
                            <button
                              type="button"
                              className="convo-file"
                              title={`${file.path}（点击查看改动）`}
                              onClick={() => setPreviewFile(file)}
                            >
                              {file.action === 'delete' ? <Trash2 size={13} /> : <FilePen size={13} />}
                              <span>{displayFilePath(file.path)}</span>
                              {file.action === 'delete' ? (
                                <em className="convo-file-badge">已删除</em>
                              ) : stats && (stats.added || stats.removed) ? (
                                <em className="convo-file-stats">
                                  <b className="is-add">+{stats.added}</b>
                                  <b className="is-del">−{stats.removed}</b>
                                </em>
                              ) : null}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ) : null}

                {/* 用户主动停止（09-19）：定格收到的内容并给出明确标记，不出「已完成」操作条 */}
                {message.status === 'stopped' && (
                  <div className="convo-msg-stopped">已停止生成</div>
                )}

                {/* 软暂停（10-08）：任务停在干净边界可续跑 —— 发送键位置有「继续」按钮；
                    直接输入新消息发送也等于继续任务（后端自动转「继续+补充」）。
                    文案保持极短：引导只在 flashNotice 里弹一次，这里挂的是持久状态 */}
                {message.status === 'paused' && (
                  <div className="convo-msg-stopped is-paused">任务已暂停</div>
                )}

                {message.citations.length > 0 && (
                  <div className="convo-citations">
                    {message.citations.map((label, index) => (
                      <div className="convo-citation" key={`${message.key}-cite-${index}`}>
                        <span className="convo-citation-icon">
                          <BookOpen size={13} />
                        </span>
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                )}

                {message.status === 'done' && message.content && (
                  <div className="convo-answer-actions">
                    <button type="button" onClick={() => void copyMessage(message)}>
                      <ClipboardCopy size={14} />
                      <span className="convo-action-text">复制</span>
                    </button>
                    <span className={`convo-like${feedback[message.key] === 'helpful' ? ' active-up' : ''}`}>
                      <button type="button" aria-label="有帮助" title="有帮助" onClick={() => void rateMessage(message, 'helpful')}>
                        <ThumbsUp size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label="无帮助"
                        title="无帮助"
                        className={feedback[message.key] === 'unhelpful' ? 'active-down' : ''}
                        onClick={() => void rateMessage(message, 'unhelpful')}
                      >
                        <ThumbsDown size={14} />
                      </button>
                    </span>
                    <button
                      type="button"
                      className="convo-regen"
                      aria-label="重新生成"
                      title="重新生成"
                      disabled={sending}
                      onClick={() => regenerate(message)}
                    >
                      <RotateCw size={14} />
                    </button>
                    {message.createdAt && <em className="convo-action-time">{formatTime(message.createdAt)}</em>}
                  </div>
                )}
              </article>
            ),
          )}
        </div>
      </div>

      {outlineItems.length > 1 && (
        <div className="convo-outline" onMouseLeave={() => setOutlinePreview(null)}>
          {outlinePreview !== null && outlineItems[outlinePreview] && (
            <div className="convo-outline-preview" role="tooltip">
              <h4>{outlineItems[outlinePreview].question.content}</h4>
              <p>{outlineItems[outlinePreview].answer?.content || '这个问题还没有回答。'}</p>
            </div>
          )}
          <div className="convo-outline-rail">
            {outlineItems.map((item, index) => (
              <button
                type="button"
                className={`convo-outline-item${index === outlineActive ? ' is-active' : ''}`}
                key={item.question.key}
                aria-label={item.question.content}
                onMouseEnter={() => setOutlinePreview(index)}
                onFocus={() => setOutlinePreview(index)}
                onClick={() => jumpToMessage(item.question.key)}
              >
                <span className="convo-outline-label">{item.question.content}</span>
                <i className="convo-outline-dash" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="convo-composer-wrap">
        {/* 生成中的三点指示：钉在输入框上方（参考新版样式），仅上翻阅读时显示——贴底看最新内容时隐藏 */}
        {visibleMessages.some((m) => m.status === 'streaming') && scrolledUp && (
          <div className="convo-typing-dock" aria-label="回答生成中">
            <em className="convo-typing">
              <i />
              <i />
              <i />
            </em>
          </div>
        )}
        {notice && (
          <p className="convo-notice" role="status">
            {notice}
          </p>
        )}
        {/* 09-23 改：权限确认 / ask_user 追问面板不再「贴在输入框上方」占一条流式空间，
            而是**完全压在输入框上**（浮层 absolute 在下面的锚点里，贴输入框底边向上生长）。
            两者互斥（同一时刻只会挂起一个中断），权限确认优先。
            输入框保持挂载在浮层下面 —— 草稿、附件、各弹层状态都不丢。 */}
        <div className="convo-composer-anchor">
          {/* 任务清单面板（10-09，Codex 式）：悬在输入框上方的一张白卡，展示当前 write_todos
              清单并随进度原地更新；新一轮提问作废。与追问/权限浮层互不干扰 —— 它不压输入框，
              只是排在输入框上方（清单是常驻进度条，不是需要立刻作答的模态）。 */}
          {liveTodos?.length ? <TodoPanel todos={liveTodos} /> : null}
          {/* 「执行中补充」横条（09-23 终稿）：补充条是**独立的白色圆角卡**，悬在输入框
              上方、底边被输入框卡叠压（WorkBuddy 同款的两卡叠压，不是嵌在同一个卡里）。
              发送键（Reply）才真正送达执行中的任务；修改（Pencil）原地改文本；
              删除（Trash2）丢弃。 */}
          {supplementStrips.length > 0 && (
            <div className="convo-supplement-strips">
              {supplementStrips.map((strip) => (
                <div className={`convo-supplement-strip${strip.sending ? ' is-sending' : ''}`} key={strip.id}>
                  <GripVertical size={14} className="strip-grip" aria-hidden="true" />
                  {editingStripId === strip.id ? (
                    <input
                      className="strip-edit"
                      value={editingStripValue}
                      autoFocus
                      onChange={(event) => setEditingStripValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitEditStrip()
                        else if (event.key === 'Escape') {
                          setEditingStripId(null)
                          setEditingStripValue('')
                        }
                      }}
                      onBlur={commitEditStrip}
                    />
                  ) : (
                    <span className="strip-content" title={strip.content}>{strip.content}</span>
                  )}
                  <span className="strip-actions">
                    <button
                      type="button"
                      className="strip-btn is-send"
                      aria-label="发送补充"
                      title="把这条补充发送给正在执行的任务"
                      disabled={strip.sending}
                      onClick={() => void sendStrip(strip.id)}
                    >
                      <Reply size={16} />
                    </button>
                    <button
                      type="button"
                      className="strip-btn"
                      aria-label="修改"
                      title="修改"
                      disabled={strip.sending}
                      onClick={() => {
                        setEditingStripId(strip.id)
                        setEditingStripValue(strip.content)
                      }}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      className="strip-btn is-del"
                      aria-label="删除"
                      title="删除"
                      disabled={strip.sending}
                      onClick={() => removeStrip(strip.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {/* 与问助手欢迎页共用同一个输入框组件（PromptComposer）；只有一个主智能体，
              输入框里不再有「当前调度」那行（选择器与展示行都已撤掉，见 09-23）。 */}
          <PromptComposer
            className="convo-composer"
            value={draft}
            onChange={setDraft}
            onSubmit={() => void send()}
            sending={sending}
            onStop={stopStreaming}
            paused={paused}
            onResume={resumePaused}
          />
          {pendingPermission?.length ? (
            <div className="convo-ask-dock">
              <PermissionCard
                actions={pendingPermission}
                agentName={agent}
                disabled={sending}
                onDecide={answerPermission}
              />
            </div>
          ) : pendingAsk?.length ? (
            <div className="convo-ask-dock">
              <AskUserCard questions={pendingAsk} agentName={agent} disabled={sending} onSubmit={answerAsk} />
            </div>
          ) : null}
        </div>
        <p className="convo-footer-note">Campus Flow 基于全校核准政策库生成建议。涉及重大政策评优资格请以各学院学工组书面答复为准。</p>
      </div>

      {/* 「已修改的文件」右侧边栏（10-07 三改）：Codex 式停靠面板 —— 网格的第三列，
          不遮遮罩、聊天区照常可用；点清单胶囊展开、× 收起。 */}
      {previewFile ? (
        <FilePreviewPanel file={previewFile} workspace={workspacePath} onClose={() => setPreviewFile(null)} />
      ) : null}

      {/* 补充送达 toast（09-23）：短暂弹一下，2.6s 自灭；压在输入框上方居中位置 */}
      <div className={supplementToast ? 'convo-supplement-toast visible' : 'convo-supplement-toast'} role="status">
        <CheckCircle2 size={16} />
        {supplementToast}
      </div>

      <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </section>
  )
}
