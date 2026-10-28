import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamConversationReply } from './conversations'

// 服务端事件序列：accepted 带回 conversation_id，token 增量，最后 done。
const SSE_FRAME = [
  'event: accepted',
  'data: {"conversation_id":"1234567890123456789"}',
  '',
  'event: token',
  'data: {"text":"根据现行评选细则，"}',
  '',
  'event: done',
  'data: {"message_id":"1234567890123456789","grounded":true}',
  '',
].join('\n')

interface CapturedRequest {
  url: string
  /** 请求体：09-20 起是 multipart 表单，文本字段按名取字符串，文件字段只记名字与大小 */
  body: Record<string, unknown>
  /** `files` 字段里的文件名（按加入顺序）—— 断言「发的是文件本体」用 */
  fileNames: string[]
  /** 是否 FormData（契约要求**一律** multipart，连没附件时也是） */
  isFormData: boolean
  /** 手写的 Content-Type；multipart 时必须是 undefined，否则 boundary 会被写死 */
  contentType?: string
  authorization?: string
}

/** 记录请求并返回固定 SSE 响应的 fetch 替身。 */
function stubFetch(frame: string = SSE_FRAME): CapturedRequest[] {
  const captured: CapturedRequest[] = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>
    const body: Record<string, unknown> = {}
    const fileNames: string[] = []
    const sent = init.body
    if (sent instanceof FormData) {
      for (const [key, value] of sent.entries()) {
        if (value instanceof File) {
          if (key === 'files') fileNames.push(value.name)
          body[key] = { name: value.name, size: value.size }
        } else {
          body[key] = value
        }
      }
    } else {
      Object.assign(body, JSON.parse(String(sent)))
    }
    captured.push({
      url: String(url),
      body,
      fileNames,
      isFormData: sent instanceof FormData,
      contentType: headers['Content-Type'],
      authorization: headers.Authorization,
    })
    return Promise.resolve(new Response(frame, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
  })
  return captured
}

describe('streamConversationReply', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('首问不带 conversation_id，由服务端新建会话', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => 'token-123' })
    const captured = stubFetch()
    const acceptedIds: Array<string | number | undefined> = []

    await streamConversationReply(
      { title: '国家奖学金申请条件', content: '申请国家奖学金需要哪些条件？', agent_mode: 'auto', source: 'conversation' },
      { onAccepted: (info) => acceptedIds.push(info.conversation_id) },
    )

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toMatch(/\/conversations\/messages\/stream$/)
    expect(captured[0].body).not.toHaveProperty('conversation_id')
    expect(captured[0].body).toMatchObject({
      title: '国家奖学金申请条件',
      content: '申请国家奖学金需要哪些条件？',
      agent_mode: 'auto',
      source: 'conversation',
    })
    expect(captured[0].authorization).toBe('Bearer token-123')
    // 09-20 契约：一律 multipart（没附件时也一样），且**不能手写 Content-Type**（boundary 得让浏览器生成）
    expect(captured[0].isFormData).toBe(true)
    expect(captured[0].contentType).toBeUndefined()
    // accepted 事件里的 conversation_id 必须交回调用方保存，供下一轮续接使用。
    expect(acceptedIds).toEqual(['1234567890123456789'])
  })

  it('附件走 multipart 的 files 字段：文件本体 + 顺序，且不再有 attachment_ids', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => 'token-123' })
    const captured = stubFetch()
    const files = [
      new File(['%PDF-1.4 fake'], '成绩单.pdf', { type: 'application/pdf' }),
      new File(['jpeg-bytes'], '在读证明.jpg', { type: 'image/jpeg' }),
    ]

    await streamConversationReply({ content: '帮我看看这两份材料', agent_mode: 'auto', files }, {})

    expect(captured[0].isFormData).toBe(true)
    expect(captured[0].fileNames).toEqual(['成绩单.pdf', '在读证明.jpg'])
    expect(captured[0].body).toMatchObject({ content: '帮我看看这两份材料', agent_mode: 'auto' })
    // 旧字段必须彻底消失，否则后端会拿到两个来源、又变成「id 无人消费」那种悬空状态
    expect(captured[0].body).not.toHaveProperty('attachment_ids')
  })

  it('续问回传 conversation_id，复用同一会话线程', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => 'token-123' })
    const captured = stubFetch()
    const tokens: string[] = []

    await streamConversationReply(
      { conversation_id: '1234567890123456789', content: '那材料清单呢？', agent_mode: 'policy_agent' },
      { onToken: (text) => tokens.push(text) },
    )

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toMatch(/\/conversations\/messages\/stream$/)
    // 没有 conversation_id 时后端会新开线程，多轮上下文就断了。
    expect(captured[0].body).toMatchObject({
      conversation_id: '1234567890123456789',
      content: '那材料清单呢？',
      agent_mode: 'policy_agent',
    })
    expect(captured[0].body).not.toHaveProperty('title')
    expect(tokens).toEqual(['根据现行评选细则，'])
  })

  it('流式请求失败时抛出可读错误', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => 'token-123' })
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 401 })))

    await expect(streamConversationReply({ content: '你好' }, {})).rejects.toThrow('流式请求失败（401）')
  })

  it('think 事件按顺序解析（思考先于正文 token，回调互不串味）', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => 'token-123' })
    // 后端格式：event: think + data.text（源自 chunk.reasoning_content，见 conversations_repo.py）。
    stubFetch(
      [
        'event: accepted',
        'data: {"conversation_id":"42"}',
        '',
        'event: think',
        'data: {"node":"workflow_agent","text":"先确认办理主体，"}',
        '',
        'event: think',
        'data: {"node":"workflow_agent","text":"再核对材料清单。"}',
        '',
        'event: token',
        'data: {"node":"workflow_agent","text":"好的，已匹配到模板。"}',
        '',
        'event: done',
        'data: {"message_id":"42","grounded":true}',
        '',
      ].join('\n'),
    )
    const order: string[] = []

    await streamConversationReply(
      { content: '我要转专业' },
      {
        onThink: (text) => order.push(`think:${text}`),
        onToken: (text) => order.push(`token:${text}`),
        onDone: () => order.push('done'),
      },
    )

    expect(order).toEqual([
      'think:先确认办理主体，',
      'think:再核对材料清单。',
      'token:好的，已匹配到模板。',
      'done',
    ])
  })

  it('ask_user 追问：question 事件透出问题与选项，answer 不影响其它回调', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => 'token-123' })
    // 后端在 interrupt 时推 question 后直接收流（没有 done 事件）。
    stubFetch(
      [
        'event: accepted',
        'data: {"conversation_id":"7505862602119974913"}',
        '',
        'event: question',
        'data: {"type":"ask_user","questions":[{"question":"请说明学生证补办原因","type":"multiple_choice","choices":[{"value":"遗失"},{"value":"损坏"}]},{"question":"是否现在为你创建该补办任务的草稿？","type":"multiple_choice","choices":[{"value":"是，先创建草稿，我再补传材料"},{"value":"先不创建，我只想了解流程"}]}]}',
        '',
      ].join('\n'),
    )
    const asked: Array<{ type?: string; questions?: unknown[] }> = []
    const tokens: string[] = []

    await streamConversationReply(
      { conversation_id: '7505862602119974913', content: '学生证丢了' },
      { onQuestion: (info) => asked.push(info), onToken: (text) => tokens.push(text) },
    )

    expect(tokens).toEqual([])
    expect(asked).toHaveLength(1)
    expect(asked[0].type).toBe('ask_user')
    expect(asked[0].questions).toHaveLength(2)
    expect(asked[0].questions?.[0]).toMatchObject({
      question: '请说明学生证补办原因',
      type: 'multiple_choice',
      choices: [{ value: '遗失' }, { value: '损坏' }],
    })
  })

  it('resume 随请求体回传（作答后续跑同一线程）', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => 'token-123' })
    const captured = stubFetch()
    const resume = JSON.stringify({ status: 'answered', answers: ['遗失', '是，先创建草稿，我再补传材料'] })

    await streamConversationReply({ conversation_id: '42', content: '1. 遗失\n2. 是，先创建草稿，我再补传材料', resume }, {})

    expect(captured[0].body).toMatchObject({
      conversation_id: '42',
      resume,
    })
  })

  // 「暂停」（10-08）：软暂停落地 —— 本轮流没结束、可续跑，前端把发送键换「继续」。
  // paused 与 stopped 是两条不同的收口路径，分发必须各走各的回调。
  it('paused 事件透出软暂停信号，且不误触 stopped / done', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => 'token-123' })
    stubFetch(
      [
        'event: accepted',
        'data: {"conversation_id":"44"}',
        '',
        'event: token',
        'data: {"text":"正在整理材料……"}',
        '',
        'event: paused',
        'data: {"type":"stop_pause"}',
        '',
      ].join('\n'),
    )
    const events: string[] = []

    await streamConversationReply(
      { conversation_id: '44', content: '帮我整理证明材料' },
      {
        onToken: () => events.push('token'),
        onPaused: () => events.push('paused'),
        onStopped: () => events.push('stopped'),
        onDone: () => events.push('done'),
      },
    )

    expect(events).toEqual(['token', 'paused'])
  })

  // 后端新增 `event: title`（data.title = 模型起的会话标题）：
  // 首问时前端拿用户输入顶标题，这个事件到了要能把它换成后端给的标题。
  it('title 事件解析出标题，且不打断 token / done 的次序', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => 'token-123' })
    stubFetch(
      [
        'event: accepted',
        'data: {"conversation_id":"43"}',
        '',
        'event: route',
        'data: {"agent_key":"policy_agent","agent_name":"奖助政策 Agent"}',
        '',
        'event: title',
        'data: {"title":"国家奖学金申请条件与材料清单"}',
        '',
        'event: token',
        'data: {"text":"根据现行评选细则，"}',
        '',
        'event: done',
        'data: {"message_id":"47","grounded":true}',
        '',
      ].join('\n'),
    )
    const order: string[] = []

    await streamConversationReply(
      { title: '申请国家奖学金需要哪些条件？', content: '申请国家奖学金需要哪些条件？', source: 'conversation' },
      {
        onTitle: (title) => order.push(`title:${title}`),
        onToken: (text) => order.push(`token:${text}`),
        onDone: () => order.push('done'),
      },
    )

    expect(order).toEqual(['title:国家奖学金申请条件与材料清单', 'token:根据现行评选细则，', 'done'])
  })

  it('title 为空串 / 非字符串 / 缺字段时不触发回调（不把页头刷成空白）', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => 'token-123' })
    stubFetch(
      [
        'event: title',
        'data: {"title":""}',
        '',
        'event: title',
        'data: {"title":"   "}',
        '',
        'event: title',
        'data: {"title":null}',
        '',
        'event: title',
        'data: {"message":"没有 title 字段"}',
        '',
        'event: token',
        'data: {"text":"正文"}',
        '',
      ].join('\n'),
    )
    const titles: string[] = []

    await streamConversationReply({ content: '你好' }, { onTitle: (t) => titles.push(t) })

    expect(titles).toEqual([])
  })

  it('think 的 text 缺失或非字符串时静默跳过，不误触发回调', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => 'token-123' })
    stubFetch(
      [
        'event: think',
        'data: {"node":"workflow_agent"}',
        '',
        'event: think',
        'data: {"node":"workflow_agent","text":null}',
        '',
        'event: token',
        'data: {"text":"正文"}',
        '',
      ].join('\n'),
    )
    const thinks: string[] = []
    const tokens: string[] = []

    await streamConversationReply({ content: '你好' }, { onThink: (t) => thinks.push(t), onToken: (t) => tokens.push(t) })

    expect(thinks).toEqual([])
    expect(tokens).toEqual(['正文'])
  })

  // 后端契约（conversations_repo.create_conversation）：
  // 模型调工具前写的前言走 step（独立事件）；回答正文走 submit_answer 的 token。
  // 两者在流里各自成序，互不串台。
  it('过程事件按序解析：step → tool → tool_result → 正文 token', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => 'token-123' })
    stubFetch(
      [
        'event: step',
        'data: {"node":"workflow_agent_node","text":"我来帮您查询"}',
        '',
        'event: tool',
        'data: {"node":"workflow_agent_node","tool":"get_task_info","args":"{\\"title\\":\\"退补选\\"}"}',
        '',
        'event: tool_result',
        'data: {"tool":"get_task_info","content":"已匹配到课程退补选申请"}',
        '',
        'event: token',
        'data: {"node":"workflow_agent_node","msg_id":"m2","text":"关于课程退补选，"}',
        '',
      ].join('\n'),
    )
    const order: string[] = []

    await streamConversationReply(
      { content: '课程退补选' },
      {
        onToken: (text, msgId) => order.push(`token:${msgId}:${text}`),
        onStep: (step) => order.push(`step:${step.text}`),
        onTool: (info) => order.push(`tool:${info.tool}`),
        onToolResult: (info) => order.push(`result:${info.content}`),
      },
    )

    expect(order).toEqual([
      'step:我来帮您查询',
      'tool:get_task_info',
      'result:已匹配到课程退补选申请',
      'token:m2:关于课程退补选，',
    ])
  })

  it('过程事件不影响 token 顺序，缺 text 的 step/tool_result 不误触发', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => 'token-123' })
    stubFetch(
      [
        'event: step',
        'data: {"node":"x"}',
        '',
        'event: token',
        'data: {"msg_id":"m","text":"正文"}',
        '',
      ].join('\n'),
    )
    const steps: Array<string | undefined> = []
    const tokens: string[] = []

    await streamConversationReply({ content: '你好' }, { onStep: (s) => steps.push(s.text), onToken: (t) => tokens.push(t) })

    expect(steps).toEqual([undefined])
    expect(tokens).toEqual(['正文'])
  })
})
