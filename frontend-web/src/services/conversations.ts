import { aiHttp, makeIdempotencyKey } from './http'
import type { ApiSuccess } from '../types/api'

export interface ConversationMessage { id: string | number; role: 'user' | 'assistant' | 'system'; content: string; created_at?: string; grounded?: boolean; citation_ids?: Array<string | number>; citation_count?: number; /** 思考过程（仅 assistant）。后端落库后由历史详情接口下发，老数据为 null。 */ reasoning_content?: string | null }
export const createConversation = (payload: { title: string; agent_mode: 'auto' | string; source: string }) => aiHttp.post<ApiSuccess<{ id: string | number }>>('/conversations', payload)
export const getConversation = (id: string | number) => aiHttp.get<ApiSuccess<Record<string, unknown>>>(`/conversations/${id}`)
export const getConversationMessages = (id: string | number) => aiHttp.get<ApiSuccess<{ items: ConversationMessage[] }>>(`/conversations/${id}/messages`, { params: { page: 1, page_size: 50 } })
export const deleteConversation = (id: string | number) => aiHttp.delete<ApiSuccess<Record<string, unknown>>>(`/conversations/${id}`)
export const exportConversation = (id: string | number, format = 'pdf', include_citations = true) =>
  aiHttp.post<ApiSuccess<Record<string, unknown>>>(
    `/conversations/${id}/export`,
    { format, include_citations },
    { headers: { 'Idempotency-Key': makeIdempotencyKey() } },
  )
export const sendFeedback = (messageId: string | number, rating: 'helpful' | 'unhelpful', reason?: string) => aiHttp.post<ApiSuccess<Record<string, unknown>>>(`/messages/${messageId}/feedback`, { rating, reason })

/** 与 http.ts 的 aiHttp 保持同一版本前缀，供 fetch 版 SSE 使用。 */
const AI_BASE_URL = import.meta.env.VITE_AI_API_BASE_URL || '/api/v2'

export interface StreamReplyPayload {
  /**
   * 续接已有会话时必须回传：后端按它复用同一个 thread_id 并只写入本轮新增消息。
   * 不传（或传空）后端会当作新会话处理，于是每一轮都会新开一个线程，多轮上下文丢失。
   */
  conversation_id?: string | number
  title?: string
  content: string
  agent_mode?: string
  /** 提问模式（09-16 新增）：chat = 纯对话 · agent = 交给 Agent（agent_mode 决定具体路由） */
  mode?: 'chat' | 'agent'
  source?: string
  /**
   * 附件（09-19 二阶，用户拍板）：本轮随带文件的**本体**，以 multipart 的 `files` 字段发出
   * （后端模型 `Message.files: list[UploadFile]`）。**没有 `attachment_ids` 了** ——
   * 文件不再先走 `/files/presign` 换 id，而是直接跟着这条消息过去。
   */
  files?: File[]
  /**
   * 工作区（09-17）：文件夹选择器选中的位置，格式 `<rootKey>:<相对路径>`（如 `d:exam`）。
   * 浏览器拿不到本机绝对路径，绝对路径由后端解析后挂成 /user/ 路由。
   */
  workspace_path?: string
  /** 权限档位（09-17）：前端「批准方式」三档，后端据此生成文件读写权限规则。 */
  permission_mode?: 'ask' | 'auto' | 'full'
  /** 回答偏好（09-19）：concise / balanced / detailed，缺省后端按 balanced。来自自定义参数弹层 */
  answer_style?: 'concise' | 'balanced' | 'detailed'
  /** 深度思考等级（09-19）：off / low / high / max，缺省后端按 off（后端自行映射推理预算） */
  thinking_level?: 'off' | 'low' | 'high' | 'max'
  quoted_section_ids?: Array<string | number>
  /**
   * ask_user 的回答：收到 `event: question` 后，把用户选择回传以续跑同一条线程。
   * 后端 ask_user 中间件按 `{"status":"answered","answers":[...]}` 解析，
   * answers 顺序必须与 questions 一一对应（数量不等会被判为 error）。
   */
  resume?: string
}

/** ask_user 追问项（SSE `event: question` 的 data.questions[]）。 */
export interface AskUserQuestion {
  question: string
  /** text=自由输入 · multiple_choice=单选 · multi_select=多选（后端未给时按单选处理） */
  type?: 'text' | 'multiple_choice' | 'multi_select'
  choices?: Array<{ value: string }>
  /** 默认全部必答；false 表示可跳过 */
  required?: boolean
}

/** 权限确认卡片上的一条动作（SSE `event: question` 且 data.type='permission'）。 */
export interface PermissionAction {
  /** 工具原名，如 write_file / search */
  tool?: string
  /** 中文动作名，如「写入文件」「联网搜索」 */
  label?: string
  /**
   * 这次调用要干什么（联网工具的 purpose 参数，一句话）。卡片上最该被读的一行；
   * 文件工具没有这个参数，返回空串。
   */
  purpose?: string
  /** 目标路径（agent 视角的虚拟路径，如 /user/hi.txt）；非文件类工具为空 */
  path?: string
  /** 参数摘要（搜索关键词、目标 URL 等）：辅助信息，浅灰小块展示。宿主机命令是完整命令原文（不截断） */
  detail?: string
  /**
   * 访问范围提示（后端在宿主机命令下发前算好）：**始终有值**，三态 ——
   * 检出越界位置 / 写明的路径都在文件夹内 / 含变量无法静态确认。
   * 因为静态分析证明不了「命令只碰文件夹内」，卡片不能只报检出结果就完事；
   * 非宿主机命令为空串。
   */
  warning?: string
  /** 上面那行的级别：warn=检出越界（amber）· info=范围声明（灰色）· 空=不显示 */
  warning_level?: 'warn' | 'info' | ''
  /**
   * 这条命令会被工具侧的安全规则拒绝（如删根目录、格式化磁盘），点「允许」也不会执行。
   * 非空时卡片要禁用「允许」并说明原因 —— 否则用户会点一个注定被拒的按钮。
   */
  blocked?: string
}

/**
 * 权限确认请求（data.type='permission'）：被拦截的动作等人工批准 —— 既可能是改动用户
 * 电脑上的文件，也可能是调用受控工具（联网搜索等）。作答仍走 `resume`，载荷与 ask_user 同形：
 * `{"status":"answered","answers":["允许" | "拒绝"]}`（后端翻译成 HITL 的 decisions）。
 */
export interface PermissionRequest {
  actions?: PermissionAction[]
  /** 兜底问题（老客户端用 ask_user 卡片渲染），新客户端用 actions 渲染专门卡片 */
  questions?: AskUserQuestion[]
}

export interface StreamReplyHandlers {
  onAccepted?: (info: { conversation_id?: string | number; message_id?: string | number; run_id?: string | number }) => void
  onRoute?: (info: { agent_key?: string; agent_name?: string }) => void
  /**
   * 会话标题（SSE `event: title`，后端新增）：模型起的一句话标题，替代首问时拿用户输入顶的占位标题。
   * 与过程事件同属「只推不落库之外的东西」——落库与否由后端决定，前端只负责把标题刷成它给的值。
   */
  onTitle?: (title: string) => void
  /** 工作过程文字（SSE `event: step`）：模型调用工具前写的前言，不属于最终回答。 */
  onStep?: (step: { node?: string; text?: string }) => void
  /** 思考过程增量（SSE `event: think`，data.text 为 chunk.reasoning_content），先于/伴随正文 token 到达。 */
  onThink?: (text: string) => void
  /** 正文增量。msgId 为该段文本所属的后端消息 id。 */
  onToken?: (text: string, msgId?: string) => void
  /** 工具调用（SSE `event: tool`）：agent 正在干什么。call_id 用于与 tool_result 按键配对（未上线时为空）。 */
  onTool?: (info: { node?: string; tool?: string; args?: string; call_id?: string }) => void
  /** 工具返回摘要（SSE `event: tool_result`）。call_id 对应所属的 event: tool（未上线时为空）。 */
  onToolResult?: (info: { tool?: string; content?: string; call_id?: string }) => void
  /**
   * 追问（SSE `event: question` 且 type 不是 permission）：agent 需要用户澄清时中断等待，
   * 推完本事件即结束本轮流，前端渲染成可交互的问题卡片，用户作答后带 `resume`
   * 重新发起流式请求续跑同一线程。
   */
  onQuestion?: (info: { type?: string; questions?: AskUserQuestion[] }) => void
  /**
   * 权限确认（SSE `event: question` 且 type='permission'）：模型要改动用户电脑上的文件，
   * 被权限档位拦下等人工批准。前端渲染成「允许 / 拒绝」卡片；作答同样走 `resume`，
   * 载荷与 ask_user 同形（answers[0] = '允许' | '拒绝'）。
   */
  onPermission?: (info: PermissionRequest) => void
  onDone?: (info: { message_id?: string | number; grounded?: boolean; elapsed_ms?: number }) => void
  /**
   * 用户主动停止（SSE `event: stopped`，后端新增）：点「停止」后服务端取消本轮执行，
   * 尽力落库半截结果后以此事件收尾。语义上等同流结束，但本条回答作废——
   * 前端把已收到的内容定格并标记「已停止」，随后重新启用发送框。
   */
  onStopped?: (info: { message_id?: string | number }) => void
  /**
   * 「暂停」（SSE `event: paused`，10-08 新增）：停止按钮的**软暂停**落地 —— 图停在
   * 干净的模型调用边界，本轮**没有结束、可续跑**（连点停止强杀才走 stopped）。
   * 前端把本条回答标「已暂停」，发送键原位变「继续」；继续 = 走 resume 通道发
   * `{"action":"continue"}`；暂停中直接输入新消息照常发送，后端自动转「继续+补充」。
   */
  onPaused?: (info: { type?: string }) => void
  /**
   * 「执行中追加」的说明（SSE `event: notice`，后端新增）：生成中又发了一条消息时
   * 后端下发的说明。前端拿它出个提示即可；不认识该事件的老代码走 default 被忽略，不受影响。
   */
  onNotice?: (info: { message?: string }) => void
}

/**
 * 流式提问：`POST /conversations/messages/stream`（SSE）。
 * 首问不带 conversation_id，服务端创建会话并启动 Agent，`accepted` 事件返回 conversation_id；
 * 续问把该 id 放回请求体，服务端就会复用同一 thread_id（多轮上下文），不会再新建会话。
 *
 * 事件顺序：accepted → route → (title) → (think | step | tool | tool_result | token)* → done|error，
 * 允许插入 heartbeat。其中 step/tool/tool_result 是「过程事件」——只用于展示 agent
 * 的工作过程，不会落库；只有最终回答（token）会写进历史消息。
 * `title`（后端新增）只在需要重起标题时出现（一般首问一次），位置不保证在 route 之后，
 * 前端按事件名处理即可，不依赖它在序列中的位置。
 */
export async function streamConversationReply(payload: StreamReplyPayload, handlers: StreamReplyHandlers, signal?: AbortSignal) {
  const token = sessionStorage.getItem('access_token')
  // 🔴 一律 multipart/form-data（09-19 二阶改版）：后端 `Message` 含 `files: list[UploadFile]`，
  // 收文件只能走表单 —— 所以这里不按「有没有文件」分两条路，统一 append 进 FormData。
  // ⚠️ 前提是**后端路由参数标了 `Form()`**（`Annotated[Message, Form()]`）。只在 Pydantic 类里写
  // `Form(...)` 默认值**不生效**：FastAPI 仍按 JSON body 解析，multipart 正文会被整体当成一个字符串
  // 塞进模型 → `422 model_attributes_type`（09-20 线上实测踩过，判定矩阵见接口文档 §8.2）。
  // ⚠️ 千万别手写 Content-Type，boundary 必须让浏览器自己生成。
  const form = new FormData()
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'files' || value === undefined || value === null) continue
    // 数组按 FastAPI 的约定重复同名字段（如 quoted_section_ids 传多个）
    if (Array.isArray(value)) value.forEach((item) => form.append(key, String(item)))
    else form.append(key, String(value))
  }
  for (const file of payload.files ?? []) form.append('files', file, file.name)
  const response = await fetch(`${AI_BASE_URL}/conversations/messages/stream`, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form,
    signal,
  })
  if (!response.ok || !response.body) throw new Error(`流式请求失败（${response.status}）`)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const dispatch = (frame: string) => {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (!dataLines.length) return
    let data: Record<string, unknown>
    try {
      data = JSON.parse(dataLines.join('\n')) as Record<string, unknown>
    } catch {
      return
    }
    switch (event) {
      case 'accepted':
        handlers.onAccepted?.(data as { conversation_id?: string | number; message_id?: string | number; run_id?: string | number })
        break
      case 'route':
        handlers.onRoute?.(data as { agent_key?: string; agent_name?: string })
        break
      case 'title':
        // 标题为空串/非字符串一律当没推：空标题覆盖上去会让页头从「用户输入」变成空白。
        if (typeof data.title === 'string' && data.title.trim()) handlers.onTitle?.(data.title.trim())
        break
      case 'step':
        handlers.onStep?.(data as { node?: string; text?: string })
        break
      case 'think':
        if (typeof data.text === 'string') handlers.onThink?.(data.text)
        break
      case 'tool':
        handlers.onTool?.(data as { node?: string; tool?: string; args?: string; call_id?: string })
        break
      case 'tool_result':
        handlers.onToolResult?.(data as { tool?: string; content?: string; call_id?: string })
        break
      case 'token':
        if (typeof data.text === 'string') handlers.onToken?.(data.text, typeof data.msg_id === 'string' ? data.msg_id : undefined)
        break
      case 'question': {
        // 同名事件两种语义：权限确认走专门的确认卡片（兼容：老后端只给 questions 时按追问处理）
        const actions = data.actions as PermissionAction[] | undefined
        if (data.type === 'permission' && actions?.length) {
          handlers.onPermission?.(data as PermissionRequest)
        } else {
          handlers.onQuestion?.(data as { type?: string; questions?: AskUserQuestion[] })
        }
        break
      }
      case 'done':
        handlers.onDone?.(data as { message_id?: string | number; grounded?: boolean; elapsed_ms?: number })
        break
      case 'stopped':
        handlers.onStopped?.(data as { message_id?: string | number })
        break
      case 'paused':
        handlers.onPaused?.(data as { type?: string })
        break
      case 'notice':
        handlers.onNotice?.(data as { message?: string })
        break
      case 'error':
        throw new Error(typeof data.message === 'string' ? data.message : '生成回答失败，请稍后重试')
      default:
        break
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let separator = buffer.indexOf('\n\n')
    while (separator >= 0) {
      dispatch(buffer.slice(0, separator))
      buffer = buffer.slice(separator + 2)
      separator = buffer.indexOf('\n\n')
    }
  }
  // 收尾帧兜底：流如果在最后一帧后没有空行就断开（部分网关/代理会吞掉结尾的 \n\n），
  // 只按 \n\n 切会让 done 或最后一个 token/think 增量被静默丢掉，这里补派发一次。
  if (buffer.trim()) dispatch(buffer)
}

/**
 * 停止某会话正在执行的 agent 轮次（「停止」按钮）。
 * 服务端取消流任务后会尽力落库半截结果，并向仍连着的流推 `event: stopped` 后关闭——
 * 所以点击后**不要立刻 abort 本地 fetch**，等 onStopped/流自然关闭再收尾；
 * 超时兜底由调用方负责（10s 内没等到就自行 abort，当作连接已断）。
 * 返回 stopped=false 表示该会话没有在跑的流（可能刚好自己结束了），同样按流结束处理。
 */
export async function stopConversationReply(conversationId: string | number): Promise<boolean> {
  const token = sessionStorage.getItem('access_token')
  const response = await fetch(`${AI_BASE_URL}/conversations/${conversationId}/stop`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!response.ok) throw new Error(`停止请求失败（${response.status}）`)
  const data = (await response.json()) as { stopped?: boolean }
  return data.stopped === true
}

/**
 * 「执行中追加」（09-23 二次定稿）：把一条**补充说明**递给正在执行的轮次（不打断任务）。
 * 后端把消息即时落库并注入正在跑的 agent 上下文，回答仍从**原有的那条流**继续出 ——
 * 所以调用方不要为它开新流、也不要动 sending 状态。
 * 返回 queued=false 表示该会话当前没有在跑的流（可能刚好自己结束了），调用方提示兜底。
 */
export async function sendSupplement(conversationId: string | number, content: string): Promise<boolean> {
  const token = sessionStorage.getItem('access_token')
  // 与流式端点同一套表单口径（后端 Message 模型标了 Form()）
  const form = new FormData()
  form.append('content', content)
  const response = await fetch(`${AI_BASE_URL}/conversations/${conversationId}/supplement`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form,
  })
  if (!response.ok) throw new Error(`补充发送失败（${response.status}）`)
  const data = (await response.json()) as { queued?: boolean }
  return data.queued === true
}
