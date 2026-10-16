import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, BadgeCheck, Building2, CheckCircle2, ChevronDown, CircleAlert, ClipboardList, ExternalLink, FileText, Loader2,
  PackageOpen, RefreshCw, Route, Search, Sparkles, Trash2, Upload, Waypoints, X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { apiErrorMessage } from '../services/http'
import { getConversationMessages, type ConversationMessage } from '../services/conversations'
import { getHistoryConversations } from '../services/history'
import { getKnowledgeCategories } from '../services/knowledge'
import { uploadFile } from '../services/files'
import { associateTaskMaterial, createTask, getTaskRequirements, getTemplateRequirements, getTaskTemplates, matchTaskDocuments, matchTaskTemplates, saveTaskDraft, submitTask } from '../services/tasks'
import { useAuthStore } from '../stores/auth'
import type { ConversationSummary, KnowledgeCategory, TaskCreated, TaskDocumentMatch, TaskDocumentMatchDocument, TaskRequirement, TaskTemplate, TaskTemplateMatch } from '../types/api'

/**
 * 「发起校园事务办事流程」弹窗 —— 按 stitch 原型 `code.html` 复刻，入口是 /tasks 页的悬浮球。
 *
 * 版式（2026-09-14 按 stitch 设计稿 `DESIGN.md` + `code.html` 重整手动申报）：
 *  · **模式切换（智能协作 / 手动申报）常驻页头右上角**，与关闭按钮同组 —— 原先是页头下方
 *    独占一整行（`.tc-tabs`，左右各一个半宽按钮），既多占一行高度，又把「换一种发起方式」
 *    这件次要操作摆成了页面的第一层级。现在收成页头里的一枚紧凑分段控件，页头只剩一条分隔线。
 *  · 手动申报的表单**按设计稿的「一、二、三」分节**：每节一张浅底分区（编号标题 + 左侧 6×14
 *    深墨竖条 + 右侧元信息 + 发丝线），字段落进分区里，而不是平铺在弹窗底上。
 *  · 申请人信息条来自**登录会话**（`useAuthStore`，不走接口）：只有姓名 / 账号 / 部门 / 角色，
 *    学籍状态、学号、班级、手机号接口里都没有，所以那几格一个都不写。
 *
 * 数据边界（原型里有、接口没有的，一律不编）：
 *  ✅ 关联会话下拉 + 会话编号    ← `GET /v1/history/conversations`
 *  ✅ 原始问题回溯（首条提问）  ← `GET /v1/conversations/{id}/messages`
 *  ✅ 业务大类                   ← `GET /v1/knowledge/categories`
 *  ✅ 办理依据（原「政策依据匹配」）← `POST /v2/tasks/document/match`（AI 服务；body 只有 `query`）
 *  ✅ 事项名称联想 + 模板绑定    ← `POST /v2/tasks/templates/match`（body 只有 `title`；**在该输入框按回车才发一次**，不做按键防抖）
 *  ✅ 办事模板全量清单           ← `GET /v1/tasks/templates`（手动模式的模板下拉）
 *  ✅ 落库                       ← `POST /v1/tasks`（草稿）→ `PATCH /draft`（事由）→ `POST /submit`
 *  ✅ 附件                       ← `POST /files/presign` → 直传 → `POST /files/{id}/complete` → `POST /tasks/{id}/materials`
 *  🚫 学籍库自动比对 / 申报资格校规核验 / 责任归口 / 业务批次时限 / 受理单位 / 紧急度 /
 *     材料装配清单 / 审批节点 —— 接口均无来源，改成「提交后由后端生成」的说明或干脆不渲染。
 */

type Mode = 'ai' | 'manual'

const MAX_FILE_MB = 50
const ALLOWED_EXT = ['doc', 'docx', 'xls', 'xlsx', 'pdf', 'jpg', 'jpeg', 'png', 'zip', 'rar', '7z']

const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''

/** 时间显示：12 分钟前 / 昨天 / 3 天前（列表接口给的是 ISO 字符串，解析失败就不显示）。 */
const relative = (value?: string) => {
  if (!value) return ''
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return ''
  const minutes = Math.floor((Date.now() - time) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  return `${Math.floor(days / 30)} 个月前`
}

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

/**
 * 单个材料的体积上限文案：**优先用接口给的真实上限**。
 * 模板对照片类常见 2MB，而前端通用上限是 50MB —— 差一个量级，写死就会承诺做不到的事
 * （用户反馈里「上传区写 50MB、材料行写 2MB」这种自相矛盾正是这么来的）。
 * 接口没给 `max_size_bytes` 时才退回 `MAX_FILE_MB`（与上传校验同一档，不至于两处打架）。
 */
const sizeLimitText = (bytes?: number | null) =>
  typeof bytes === 'number' && bytes > 0 ? sizeText(bytes) : `${MAX_FILE_MB}MB`

/* ===== 规章匹配（`POST /v2/tasks/document/match`）的取值助手 =====
 * 字段名已按 2026-09-15 真实响应核对：全下划线、得分叫 `relevance`、理由叫 `reason`，
 * 命中规章在 `documents[]`（数组）。这里保留 `pickDocField` 做 trim/空串归一，
 * 「字段名对不上就整块空掉」的兜底精神不变，但不再双写驼峰别名（真实返回里没有）。
 */
const pickDocField = (...values: Array<string | null | undefined>) =>
  values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? null

/** 文号：`document_no`（真实响应口径）。 */
const pickDocNo = (doc: TaskDocumentMatchDocument) => pickDocField(doc.document_no)

/** 规章主键：有它才能真正跳到知识库详情页（`/knowledge?doc=`），没有就退回按标题搜索。 */
const pickDocId = (doc: TaskDocumentMatchDocument) => doc.document_id ?? null

/**
 * 单个附件「待上传 → 上传中 → 已关联 / 未关联 / 失败」的进展。
 *
 * 必须**逐项**跟踪，不能只汇总一个数字：多文件是串行上传的，只报「2 项上传失败」时
 * 用户不知道是哪两项、也看不到原因，而弹窗一关这条信息就彻底没了
 * （2026-09-14 用户反馈「手动申报流程不对劲」的核心之一）。
 * `unlinked` 与 `failed` 要分开：前者是文件传上去了但没有材料项可挂（后端缺 template 兜底匹配），
 * 后者是文件根本没传成功（体积 / 网络 / 401），两者的补救动作完全不同。
 */
type Attachment = {
  file: File
  status: 'pending' | 'uploading' | 'linked' | 'unlinked' | 'failed'
}

const ATTACHMENT_TEXT: Record<Attachment['status'], string> = {
  pending: '待上传',
  uploading: '上传中',
  linked: '已关联',
  unlinked: '未关联',
  failed: '上传失败',
}

/** 把附件挂到材料项上：优先挑「还没满足、且允许该扩展名」的那条，其次挑第一条未满足的。 */
const pickRequirement = (items: TaskRequirement[], file: File) => {
  const ext = extensionOf(file.name)
  const open = items.filter((item) => item.status !== 'passed' && item.status !== 'accepted')
  return (
    open.find((item) => (item.allowed_types || []).some((type) => type.toLowerCase().replace('.', '') === ext)) ??
    open[0] ??
    null
  )
}

/** 联想下拉最多展示几条 —— 后端可以多返回，前端只展示前几条。 */
const SUGGEST_LIMIT = 6

/**
 * 匹配结果 → 联想候选项。
 * 后端把**命中项放在顶层**（`template_key` / `template_name` / `confidence` / `reason`），
 * `candidates` 是含它的候选池；这里合并去重、命中项排最前。
 * 命中项同时带上 `requirements` / `steps` 条数，复用下拉里「N 项材料」的既有展示。
 */
const toTemplateCandidates = (result: TaskTemplateMatch | null): TaskTemplate[] => {
  if (!result) return []
  const pool: Array<{ template_key: string; template_id?: number | null; template_name: string; confidence?: number | null; reason?: string | null }> = []
  if (result.matched && result.template_key) {
    pool.push({
      template_key: result.template_key,
      template_id: result.template_id ?? null,
      template_name: result.template_name || result.template_key,
      confidence: result.confidence ?? null,
      reason: result.reason ?? null,
    })
  }
  for (const item of result.candidates || []) pool.push(item)

  const seen = new Set<string>()
  const list: TaskTemplate[] = []
  for (const item of pool) {
    const key = (item.template_key || item.template_name || '').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    const hit = key === result.template_key
    list.push({
      // 优先用后端给的**数字主键**（建单要带 `templateId`）；没有才拿 key 当 id 用
      id: item.template_id ?? key,
      template_key: key,
      name: item.template_name || key,
      // 命中项用后端的理由说明「为什么是它」；没有理由就留空，不编。
      description: item.reason ?? null,
      responsible_organization_name: null,
      requirement_count: hit ? result.requirements?.length ?? null : null,
      step_count: hit ? result.steps?.length ?? null : null,
    })
  }
  return list
}

/** MIME 类型清单 → 人话（`application/pdf` → PDF）；未知类型回退到子类型大写，不硬编。 */
const CONTENT_TYPE_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/zip': 'ZIP',
}

const typeText = (types?: string[] | null) =>
  (types || [])
    .map((type) => CONTENT_TYPE_LABEL[type.toLowerCase()] || type.split('/').pop()?.toUpperCase() || type)
    .join(' / ')

/**
 * 材料行左侧那枚「文件类型片」上的文字（PDF / 图片 / 表格 / 文档 / 文件）。
 * **只按 `allowed_content_types` 归类，不猜内容**：接口没给格式就显示中性的「文件」——
 * 设计稿那行「免手写 · 已预生成」是原型里预生成的申请表格，我们没有任何生成表格的接口，
 * 所以那一档一律不写（写上去用户会以为表已经填好了）。
 * ⚠️ 色片**不带色调**（2026-09-14 用户要求颜色收到三类）：格式差异只由片上文字承担。
 */
const materialKind = (types?: string[] | null): string => {
  const list = (types || []).map((type) => type.toLowerCase())
  if (!list.length) return '文件'
  if (list.some((type) => type.includes('pdf'))) return 'PDF'
  if (list.some((type) => type.startsWith('image/'))) return '图片'
  if (list.some((type) => type.includes('sheet') || type.includes('excel'))) return '表格'
  if (list.some((type) => type.includes('word') || type.includes('document'))) return '文档'
  return list[0].split('/').pop()?.toUpperCase() || '文件'
}

export function TaskCreateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  /** 任务创建成功后回调：页面据此刷新列表、选中新任务并给出提示。 */
  onCreated: (task: TaskCreated, note: string) => void
}) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('ai')
  /**
   * 页头模式切换的弹出菜单开合（2026-09-14 用户要求「改成悬停弹出」）。
   * 收起后页头右上只剩「当前模式 + 推荐角标 + ▾」；两个模式的说明放进菜单里。
   * 悬停与点击**都能开**：悬停是为了快，点击/聚焦是为了键盘与触摸屏（没有 hover）。
   */
  const [modeOpen, setModeOpen] = useState(false)
  /** 申请人信息条的唯一数据来源：登录会话本身，不额外打接口，也不编学籍字段。 */
  const user = useAuthStore((state) => state.user)
  /** 角色文案沿用设置页同一套口径；取不到就不渲染这一格。 */
  const roleLabel =
    user?.role === 'admin' ? '管理员' : user?.role === 'teacher' ? '教师' : user?.role === 'student' ? '学生' : ''

  // —— 接口数据 ——
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [categories, setCategories] = useState<KnowledgeCategory[]>([])
  /**
   * 「办理依据」= 校内规章匹配结果（`POST /v2/tasks/document/match`）。
   *
   * 2026-09-15 改口径：**不再自己拿标题去查知识库列表**（原来是
   * `GET /v1/knowledge/documents?query=`，而该接口的 `query` 参数后端实测完全忽略，
   * 返回的是与关键词无关的一堆文档 —— 等于「政策依据」根本没那么匹配）。
   * 现在匹配这件事交给 AI 服务的规章匹配接口：输入仍是同一份事项名称，输出是命中的那一份规章
   * （标题 / 文号 / 命中理由 / 得分）。字段名两种写法都兜（见 `TaskDocumentMatch`）。
   */
  const [docMatch, setDocMatch] = useState<TaskDocumentMatch | null>(null)
  /**
   * 规章匹配的状态：`idle`（还没填事项名称）/ `loading` / `empty`（匹配了但没命中）/ `error`。
   * ⚠️ 这四态**必须分开**：原来只区分「有没有结果」，接口 404（未实现）时页面会静静显示
   * 「暂未检索到相关规定」，看起来像「知识库里真没有」，其实是接口没通 —— 排查时最容易误判。
   */
  const [docState, setDocState] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle')
  /**
   * **手动模式**「匹配办理依据与材料」的这一路要打哪个接口 —— 决定材料清单从哪来（2026-09-15）。
   *
   * 上面那组 `docMatch` / `docState` 是给**智能协作**模式用的。手动模式**不能复用它们**，
   * 手动模式**不能复用它们**，因为两个模式的「材料从哪来」根本不是同一条路：
   *  · 手动：事务是下拉选的，`GET /tasks/templates`（A.5.13）**不下发**材料与节点明细，
   *    所以要把手上那把 `template_key` 交给后端换明细 —— `GET /tasks/templates/{key}/requirements`。
   *  · 智能协作：名称是用户敲的，靠 `POST /v2/tasks/templates/match` 的语义匹配命中模板并带回明细。
   * ⚠️ 早先手动这一路直接复用 `matchState` / `matchResult`，结果是**两个模式共用一个状态机**：
   *    手动点按钮把 `matchState` 置成 loading，`anyMatching` 随之变真 —— 于是**智能协作**那边
   *    也被改成「正在匹配中」，它的输入框与「匹配事项」按钮一起被禁用（串扰）。
   * ⚠️ 又被 `useEffect([mode])` 的清理重置成 idle（该 effect 的依赖是 `mode`，切回同一模式不重跑），
   *    导致从 AI 模式切回手动时，按钮转圈不消失、明细永远不展开。
   *    现在手动模式**独立成一路**（自己的状态 + 自己的数据），上面两个 bug 一起消失。
   */
  const [manualMatchState, setManualMatchState] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle')
  const [manualMatch, setManualMatch] = useState<TaskTemplateMatch | null>(null)
  /** 手动模式的匹配说明（降级原因 / 缺字段提示），随每次匹配重写。 */
  const [manualMatchNote, setManualMatchNote] = useState('')
  /** 手动模式匹配的请求序号，同 `suggestSeq` / `docSeq`：连点只认最后一次响应。 */
  const manualSeq = useRef(0)
  /** 规章匹配的请求序号（同 `suggestSeq`）：标题改得快时只认最后一次响应。 */
  const docSeq = useRef(0)
  /** 办事模板**全量**清单：手动模式「办事模板」下拉用。打开弹窗就拉。 */
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  /**
   * 模板清单的加载状态。**空清单必须能区分三种情况**：还没拉到 / 拉失败 / 后端真的没有模板 ——
   * 只写一句「模板列表暂不可用」时，用户和排查的人都看不出是接口挂了还是本来就没有
   * （2026-09-15 后端这个接口因取值别名写错一直 500，前端却只显示「暂不可用」，没人发现）。
   */
  const [templatesState, setTemplatesState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const templatesRequested = useRef(false)
  /** 联想候选：**由后端按输入匹配返回**（前端不做任何本地匹配），且**只在该输入框按回车时**才请求一次。 */
  const [suggestions, setSuggestions] = useState<TaskTemplate[]>([])
  /**
   * 完整的匹配结果（`data.items` 那个对象）。不只用来出下拉 —— 命中时它带回了
   * **建单前的材料清单与审批节点**（`requirements` / `steps`），以及模板还缺哪些字段
   * （`missing_fields` / `clarifying_questions`），弹窗里那两块「清单/节点」面板就靠它渲染。
   */
  const [matchResult, setMatchResult] = useState<TaskTemplateMatch | null>(null)
  /** 匹配请求的状态：加载中 / 匹配到了但为空 / 请求失败 —— 三种情况必须能区分（同模板清单的处理纪律）。 */
  const [matchState, setMatchState] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle')
  /** 请求序号：连按回车、或改完输入又回车时，只认最后一次请求的响应。 */
  const suggestSeq = useRef(0)

  // —— 关联会话（用于回溯原始提问）——
  const [conversationId, setConversationId] = useState('')
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [title, setTitle] = useState('')
  /** 「刷新提取」的版本号：会话没变也要能重新拉一次消息。 */
  const [reloadKey, setReloadKey] = useState(0)

  // —— 手动申报模式 ——
  const [categoryId, setCategoryId] = useState('')
  const [reason, setReason] = useState('')
  /**
   * 「还需要你补充确认」里的**自由文本补充项**（AI 模式）。
   *
   * 2026-09-15 用户反馈 1 指出的正是这个洞：`clarifying_questions` 会把「请说明学生证补办原因」
   * 直接摊在结果区，**下面却没有任何输入框** —— 提示用户补充，却没有补充入口。
   * 这里给需要文字的项配一个输入框，提交时并进 `reason`（AI 模式没有独立的申报事由字段，
   * 任务详情里仍可编辑），所以**不阻塞发起**。
   *
   * 匹配结果换了一份模板就重置 —— 那份追问属于上一份模板，跟着走会张冠李戴。
   */
  const [clarifyText, setClarifyText] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  /**
   * 「建单已成功、但附件没全部挂上」时的停靠态：**不自动关弹窗**，
   * 把逐项状态和「留作草稿 / 仍然提交」的选择权交给用户 ——
   * 之前是直接关掉，失败信息只活在一次性的 toast 里，用户回到任务详情找不到自己传的文件。
   * 此时不能再重复建单，`submit` 会直接 return。
   */
  const [settled, setSettled] = useState<{ task: TaskCreated; notes: string[] } | null>(null)

  /**
   * 选中的模板（存对象，不靠 key 反查）：只有「标题仍等于被选模板的名字」时才随建单提交 `template_key`。
   * `templateSource` 区分模板是哪来的 —— 联想选中的，改标题就该解绑；
   * 下拉明确选的，是用户的刻意选择，改标题**不能**解绑（标题可以是他自己的话）。
   */
  const [templateKey, setTemplateKey] = useState('')
  const [templateSource, setTemplateSource] = useState<'suggest' | 'select' | ''>('')
  const [pickedTemplate, setPickedTemplate] = useState<TaskTemplate | null>(null)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestIndex, setSuggestIndex] = useState(0)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  /** 结果区锚点：匹配采用后用它把结果标题滚到固定页头下方（用户反馈 4）。 */
  const resultsRef = useRef<HTMLDivElement>(null)
  /** 正文滚动容器：自动滚动只发生在它内部（页头/底栏固定，见 tasks.css）。 */
  const bodyRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(
    () => conversations.find((item) => String(item.id) === conversationId),
    [conversations, conversationId],
  )
  /** 原始问题回溯：会话里的第一条 user 消息，同时作为 `source_message_id` 提交。 */
  const question = useMemo(() => messages.find((item) => item.role === 'user')?.content?.trim() ?? '', [messages])
  /**
   * 命中的规章 = `docMatch.documents[0]`（接口 2026-09-15 真实形状：`documents` 是**数组**，
   * 可能下发多份；渲染处按序全画，第一份排在最上面当主依据）。
   * `docMatch` 本身还带着 `missing_fields` / `clarifying_questions`（暂不渲染，先收着）。
   */
  const policyHit = docMatch?.documents?.[0] ?? null
  /**
   * 明细区读的**规章匹配状态**：两种模式各看自己那一路。
   * 手动模式的依据匹配刻意不写全局 `docState` 的 **loading**（写了会把智能协作的输入框锁死），
   * 但**完成时仍会写** `docState`（idle/empty/error，`runDocMatch` 的 then/catch 无条件写）——
   * 所以这里：在途看 `manualMatchState`，完成后回落 `docState`（那格的「未匹配到 / 匹配失败」
   * 两态只有它分得清，`manualMatchState` 是材料链路的状态，替不了）。
   */
  const docStatus = mode === 'manual' && manualMatchState === 'loading' ? 'loading' : docState
  /**
   * 「办理依据」那一格的重试：两种模式各重跑自己那一路。
   * ⚠️ 手动模式**不能**只重跑依据（`runDocMatch`）—— 用户点的是一次「匹配办理依据与材料」，
   *    重试也该把材料一起重来，否则他会看到一个转圈只在依据那格亮着的半截重试。
   *    没选事务时依据格不可能处于 error（那次点击都发生不了），直接不重跑。
   */
  const retryDocMatch = () => {
    if (mode === 'manual') {
      if (pickedTemplate) runManualMatch(pickedTemplate)
      return
    }
    runDocMatch(effectiveTitle)
  }
  /**
   * 提交用的标题。
   *  · AI 模式 = 用户输入的事项名称；
   *  · 手动模式 = **所选事务（办事模板）的名字**，没有自由输入这一路 ——
   *    用户要求「手动只能处理模板里的事务」，事务名就该由模板给，而不是让他自己发明一个
   *    （2026-09-14）。所以这里不再读某个 manualTitle state，只有 `pickedTemplate` 一个来源。
   */
  const effectiveTitle = (mode === 'ai' ? title : pickedTemplate?.name ?? '').trim()
  /**
   * 「已采用」的那一份匹配明细：只有**用户点选了候选、真正采用这个模板**之后才成立。
   * 光回车匹配出来还不算采用 —— 那只是候选建议，用户可能只是先看看有哪些（09-14 用户要求
   * 「点击这个之后下面的内容才开始展示」）。`pickedTemplate` 与命中项同 key 才算采用。
   */
  const adopted = matchResult?.matched && matchResult.template_key === pickedTemplate?.template_key ? matchResult : null
  /**
   * **明细区（办理依据 / 所需材料 / 预计办理流程）到底展不展开** —— 两种模式分开判（09-15）：
   *  · AI 模式：沿用 `adopted` 的口径，**回车匹配出来还不算**，要点选候选才算采用
   *    （09-14 用户要求「点击这个之后下面的内容才开始展示」）。
   *  · **手动模式：事务一下拉选定就是要办的那件事**，没有候选可选，所以「触发过匹配且命中」就等于采用。
   *    ⚠️ 这里补的正是个真 bug：改前明细区只认 AI 模式的 `adopted`，
   *    手动模式**三块明细永远不渲染**（下面 `{detailsOpen && ...}` 的旧写法就是 `{adopted && ...}`）。
   *  · **规章匹配有过结果（含「没匹配到」和「匹配失败」）也允许展开** —— 依据的送达与模板无关
   *    （两个接口各自独立）。⚠️ 判据必须是 `docState !== 'idle'` 而**不是** `!!docMatch`：
   *    后者在「查过了但没命中」时是 null，会让整块明细连同「暂未匹配到直接相关的校内规章」
   *    这句**业务结论**一起消失，用户看到的是什么都没有 —— 分不清"没匹配到"和"没查过"。
   *    这条是跑工装时实测出来的（`_verify-doc-match-enter.mjs` 的 ④ 用例一开始就是红的）。
   */
  const detailsOpen =
    (mode === 'manual' && manualMatchState !== 'idle') ||
    !!adopted ||
    !!docMatch ||
    docState !== 'idle'
  /**
   * 材料清单 / 审批节点只认「采用的那一份」：
   *  · 智能协作 → 用户点选采用的那份（`adopted`）；
   *  · 手动申报 → 自己那一路的 `manualMatch`（08-31 起不再借用 AI 模式的 `matchResult`，
   *    两个模式的状态机彻底分开，见 `manualMatchState` 的注释）。
   */
  const detailMatch = mode === 'manual' ? manualMatch : adopted
  const matchedRequirements = detailMatch?.requirements || []
  const matchedSteps = detailMatch?.steps || []
  const clarifying = detailMatch?.clarifying_questions || []
  /** 匹配到了候选、但用户还没点选：下方面板给「点选后展示」的引导，而不是先摊开明细。 */
  const awaitingPick = !!matchResult?.matched && !adopted
  /**
   * 明细区是否处于「正在匹配」——**按模式各看自己那一路**（2026-09-15 修串扰）：
   *  · 智能协作：`matchState`（模板）与 `docState`（依据）是同一次回车的两条链路，任一在途都算；
   *  · 手动申报：只看自己的 `manualMatchState` —— 它的依据匹配刻意不写全局 `docState`
   *    （写了就会把智能协作那边锁住），所以这里也不能再去读那个全局值。
   */
  const anyMatching = mode === 'manual'
    ? manualMatchState === 'loading'
    : matchState === 'loading' || docState === 'loading'
  /**
   * 建单要带的模板**数字主键**（`task_templates.id`）：命中项有就用它的（A.5.14 新增的 `template_id`）；
   * 若用户点的是非命中候选，退回候选自带的那份（`toTemplateCandidates` 把它放进了 `TaskTemplate.id`）。
   */
  const templateId = adopted?.template_id ?? (typeof pickedTemplate?.id === 'number' ? pickedTemplate.id : null)
  /**
   * 置信度**不再上屏**（2026-09-15 用户反馈 3）：
   * 用户原话「『置信度 99%』过于抢眼，匹配对象却不够明确 —— 用户需要确认的是**匹配到了哪个事项**」。
   * 那个百分比对用户没有可执行含义（99% 不代表材料齐、更不代表申请资格通过），
   * 真正能核的是「事项名 + 受理单位」。所以这里只保留计算给**结果栏**用的三个事实，
   * 数字本身一个字符都不渲染（放在 `matchbar` 里也没用，直接不留）。
   */
  /**
   * 审批节点 → 办理部门名。
   *
   * ⚠️ 匹配响应里的 `organization_id` 是**机构主键**（落 `task_step_instances.organization_id`），
   * 不是机构名；而前端手里唯一带机构名的清单是 `GET /tasks/templates` 的
   * `responsible_organization_name` —— 它**不带机构 id**，所以两者只能按
   * 「命中模板自己的责任机构」来对应，取不到就返回 `null`。
   *
   * 也就是说：**只有当前采用的模板能在清单里找到责任机构时，节点才写得出部门名**。
   * 查不到就整行不渲染 —— 宁可少写，也不编「学院 / 教务处」（接口没给的一律不写）。
   */
  const organizationNameOf = (templateKey?: string | null): string | null => {
    if (!templateKey) return null
    return templates.find((item) => item.template_key === templateKey)?.responsible_organization_name || null
  }
  /**
   * 受理单位（结果栏第二段）：优先取**全量模板清单**里该模板的责任机构，
   * 退回匹配响应的 `extracted.organization_hint`（后端给的「可能归口」）。
   * 两个都没有就整段不渲染。
   */
  const matchOrganization = useMemo(() => {
    if (!adopted) return null
    const fromList = templates.find((item) => item.template_key === adopted.template_key)?.responsible_organization_name
    return fromList || adopted.extracted?.organization_hint || null
  }, [adopted, templates])
  /**
   * 补充项分流（用户反馈 1）：
   *  · **照片 / 扫描件这类材料** → 归材料侧，统一写「发起后需完成」（发起前没有上传口）；
   *  · **其余带「请」字的追问**（请说明…原因 / 请确认…）→ 归**可填写**的补充说明。
   * 这段判断只看后端给的问句文本，不自己发明问题。
   */
  const materialAskRe = /(照片|扫描|原件|复印件|截图|上传|附件|证件)/
  const todoAsks = clarifying.filter((ask) => !materialAskRe.test(ask))
  const materialAsks = clarifying.filter((ask) => materialAskRe.test(ask))
  /**
   * 补充说明字段的标签：问句里都带「请」，直接当标签读不顺（「请说明补办原因」→「说明补办原因」）。
   * 去掉开头的「请」并收尾的句号；去不掉就整句当标签。
   */
  const clarifyLabel = (ask: string) => ask.replace(/^请/, '').replace(/[。.]$/, '') || ask
  /**
   * 分析中枢状态行右侧那句「已装配 N 项材料 · M 个节点」。
   * 全部来自匹配命中那一次的 `requirements` / `steps`；没采用就不说（只显示「等意图解析」的语义由调用处决定）。
   * 设计稿这里写的是「全链路自治」——那是一句没有数据支撑的断言，换成真实装配结果是同一位置的诚实写法。
   */
  const assembly = useMemo(() => {
    if (!adopted) return ''
    const bits = [
      matchedRequirements.length ? `${matchedRequirements.length} 项材料` : '',
      matchedSteps.length ? `${matchedSteps.length} 个节点` : '',
    ].filter(Boolean)
    return bits.length ? `已装配 ${bits.join(' · ')}` : '已命中办事模板'
  }, [adopted, matchedRequirements.length, matchedSteps.length])
  /** 需在提交前准备的必交材料数 / 需要用户本人参与的节点数 —— 面板标题右侧的两处真实计数。 */
  const requiredCount = matchedRequirements.filter((item) => item.is_required).length
  const actionStepCount = matchedSteps.filter((step) => step.requires_user_action).length
  /** 联想（回车触发匹配）只在 AI 模式存在：手动模式的事务由下拉选定，没有可匹配的输入。 */
  const titleInput = title
  /** 后端可以多返回，前端只展示前几条；键盘导航也按「展示出来的」算，避免选中看不见的项。 */
  const visibleSuggestions = useMemo(() => suggestions.slice(0, SUGGEST_LIMIT), [suggestions])

  /**
   * 手动申报的「办事模板」下拉只能用**真的能绑定的**模板：`template_key` 为空的下拉项，
   * 选中后 value 会落回空串，表现成「点了没反应」—— 以前默认项是「不指定」，这种项混在里面无所谓；
   * 现在模板是必选，混进来就是一个骗人的死选项（接口文档 A.5.13 要求 `template_key` 非空唯一）。
   */
  const usableTemplates = useMemo(() => templates.filter((item) => !!item.template_key), [templates])

  /** 「N 项材料 · M 个审批节点 · 责任机构」—— 模板选中后给用户的唯一可见反馈，数量级全部来自接口。 */
  const templateSummary = useMemo(() => {
    if (!pickedTemplate) return ''
    const bits: string[] = []
    if (typeof pickedTemplate.requirement_count === 'number') bits.push(`${pickedTemplate.requirement_count} 项材料`)
    if (typeof pickedTemplate.step_count === 'number') bits.push(`${pickedTemplate.step_count} 个审批节点`)
    if (pickedTemplate.responsible_organization_name) bits.push(pickedTemplate.responsible_organization_name)
    return bits.join(' · ')
  }, [pickedTemplate])

  /**
   * 匹配采用后（AI 模式）：**自动折叠顶部协作说明 + 把结果标题滚到固定页头下方**（用户反馈 4）。
   *
   * 用户截图里「顶部协作区有一部分藏在固定标题后面」—— 那是正文滚动后，协作区被页头压住了一半。
   * 靠「滚到刚好」是治不住的（内容高度随时在变），所以这里做两件事：
   *  ① **结构性收缩**：采用结果后协作区收成一行（`.tc-strip.compact`），纵向空间让给结果区；
   *     页头/底栏已 `flex:none` 固定、只有 `.tc-body` 滚动，所以结果标题不会被遮挡。
   *  ② **最小必要滚动**：只滚到「结果区刚进入可视区（其标题落在页头下方）」为止，
   *     **不**把结果区顶到最顶端。
   *
   * ⚠️ 早先写法是 `scrollIntoView({ block: 'start' })` —— 那是「把 results 顶到顶部」，
   *    属于过量滚动：结果区很长时，滚完输入框会被页头吞掉（实测 `.tc-lead` top = −1），
   *    用户既看不见自己填的是什么、也够不到「更换事项」。所以改成按差值精确滚动。
   * ⚠️ 只依赖 `[adopted]`：点选 / 换模板 / 重新匹配都会重新触发，符合「展开结果时」的语义；
   *    会话选择器等控件**没有藏**，紧凑态下仍可改、可重新提取。
   */
  useEffect(() => {
    if (!open || mode !== 'ai' || !adopted) return
    // 等一帧：`.tc-results` 的分组内容刚挂上，滚动目标高度此刻才是最终值。
    const timer = window.setTimeout(() => {
      const body = bodyRef.current
      const target = resultsRef.current
      if (!body || !target) return
      const head = document.querySelector('.tc-head') as HTMLElement | null
      const bodyBox = body.getBoundingClientRect()
      // 可视区顶端 = 正文滚动容器顶端 + 页头高度（页头在正文之外，所以要避开它）
      const viewTop = bodyBox.top + (head?.getBoundingClientRect().height ?? 0) + 12
      const targetTop = target.getBoundingClientRect().top
      // 目标已经在可视区内（标题可见）就**不滚**，避免无来由的跳动
      if (targetTop >= viewTop && targetTop < bodyBox.bottom) return
      body.scrollTo({ top: body.scrollTop + (targetTop - viewTop), behavior: 'smooth' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [open, mode, adopted])

  /**
   * 拉一次可用模板清单（几十条，全量）。**打开弹窗就拉**，不做懒加载：
   * 手动模式的「办事模板」是个原生 `<select>`，聚焦才拉会让选项晚一拍到，
   * 用户已经点开下拉时看到的是「暂不可用」；AI 模式的联想也同理，首字就该有候选。
   *
   * ⚠️ 失败**不再把 `templatesRequested` 永久置位**：以前失败也置位，等于这次会话里
   *    再也没有第二次机会，用户只能关掉弹窗重开。现在传 `retry` 就能重拉。
   */
  const ensureTemplates = useCallback((retry = false) => {
    if (templatesRequested.current && !retry) return
    templatesRequested.current = true
    setTemplatesState('loading')
    getTaskTemplates()
      .then(({ data }) => { setTemplates(data.data?.items || []); setTemplatesState('ready') })
      .catch(() => { setTemplates([]); setTemplatesState('error') })
  }, [])

  /** 打开时拉一次：近期会话、知识分类、办事模板。 */
  useEffect(() => {
    if (!open) return
    let stop = false
    getHistoryConversations({ page: 1, page_size: 10 })
      .then(({ data }) => { if (!stop) setConversations(data.data.items || []) })
      .catch(() => { if (!stop) setConversations([]) })
    getKnowledgeCategories()
      .then(({ data }) => { if (!stop) setCategories(data.data.items || []) })
      .catch(() => { if (!stop) setCategories([]) })
    ensureTemplates()
    return () => { stop = true }
  }, [open, ensureTemplates])

  /**
   * 会话是**可选的意图来源**，不自动预选：默认就是「不关联」，用户想用会话里已有的问答
   * 上下文时才主动选一条。之前默认选最近一条，会让标题被会话标题预填、还要手动清空，
   * 反而挡住了「直接自己填事项名称」这条路。
   */

  /** 选中会话 → 取消息（首条提问 = 原始问题回溯），并用会话标题预填事项名称。 */
  useEffect(() => {
    if (!open || mode !== 'ai' || !conversationId) {
      // 取消关联 / 切到手动模式时清掉上一条会话的回溯，否则会发出
      // 「带 source_message_id 却不带 conversation_id」的不一致请求。
      setMessages((current) => (current.length ? [] : current))
      return
    }
    let stop = false
    setMessagesLoading(true)
    getConversationMessages(conversationId)
      .then(({ data }) => { if (!stop) setMessages(data.data.items || []) })
      .catch(() => { if (!stop) setMessages([]) })
      .finally(() => { if (!stop) setMessagesLoading(false) })
    return () => { stop = true }
  }, [open, mode, conversationId, reloadKey])

  useEffect(() => {
    if (!open) return
    if (mode === 'ai') setTitle((current) => current || selected?.title || '')
  }, [open, mode, selected])

  /**
   * 规章匹配（`POST /v2/tasks/document/match`，body `{ query }`）—— **按回车/点「匹配事项」时触发一次**，
   * 与模板匹配**完全同一个入口**（`runMatch` 里成对调用），**不做按键防抖**。
   *
   * 2026-09-15 用户要求改成回车触发（原先是「标题一变防抖 400ms 就发一次」）：
   *  · 一致性 —— 这个接口本质是 AI 服务的语义匹配，和模板匹配是同一类「我按一下，你去理解」的动作，
   *    一个回车触发、一个边敲边发，用户看到的节奏完全不同（敲字打到一半界面就开始闪「正在匹配」）；
   *  · 省流量 —— 语义匹配比列表查询贵，敲一句「申请国家奖学金」原先要发 8 次，现在只有回车那 1 次；
   *  · 手动模式也随之统一：事务是下拉选的，改选中不再无脑重发，改用底部的「匹配事项」按钮重跑。
   *
   * 与模板匹配仍是**两条独立链路**：模板给材料清单与审批节点，规章只给办理依据，
   * 各自失败互不牵连（规章匹配失败不阻断建单，也不影响模板面板）。`docSeq` 丢弃过期响应。
   */
  const runDocMatch = useCallback((query: string, mark = true) => {
    const keyword = query.trim()
    const seq = docSeq.current + 1
    docSeq.current = seq
    if (!keyword) { setDocMatch(null); setDocState('idle'); return }
    // `mark=false` 时**不碰全局的 loading 态**（手动模式用）：
    // `docState==='loading'` 会喂给 `anyMatching`，而 `anyMatching` 又被智能协作模式的
    // 输入框与「匹配事项」按钮读走 —— 手动点一次匹配就把另一个模式锁住，那是串扰。
    if (mark) setDocState('loading')
    matchTaskDocuments(keyword)
      .then(({ data }) => {
        if (docSeq.current !== seq) return
        // ⚠️ `data.items` 是单个结果对象（不是数组），同模板匹配那处的坑；
        //    但里面的 `documents` **是数组**（2026-09-15 按真实响应核对）。
        const item = data.data?.items ?? null
        // 「命中」= matched 不为 false 且 `documents` 真有内容 ——
        // matched:true 但文档列表为空时按「未匹配到」处理（policyHit 取不到文档，落空态）。
        const hit = item && item.matched !== false && (item.documents?.length ?? 0) > 0 ? item : null
        setDocMatch(hit)
        // 命中 → `idle`（有结果）；没命中 → `empty`（要能区分「查过了，没有」与「没查过」）
        setDocState(hit ? 'idle' : 'empty')
      })
      .catch(() => {
        if (docSeq.current !== seq) return
        setDocMatch(null)
        setDocState('error')
      })
  }, [])

  /**
   * 规章匹配**没有**自己的触发 effect（2026-09-15 改为回车触发）：
   * 唯一入口是 `runMatch`（回车 / 「匹配事项」按钮）里的 `runDocMatch` 调用，
   * 以及匹配结果栏「更换事项」那次重跑。
   * ⚠️ 别为了「改标题立刻刷新依据」再加一个监听 `effectiveTitle` 的 effect ——
   *    那就是回到边敲边发的旧行为，与模板匹配的节奏打架（也是用户这次要求改掉的点）。
   * 标题变了只管**作废**上一份结果，清理由 `changeTitle` / `selectTemplate` 负责。
   */

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  /** 关闭后清空易变状态，下次打开是新的一次申报。 */
  useEffect(() => {
    if (open) return
    setError(''); setFiles([]); setReason(''); setTitle(''); setMessages([])
    setSettled(null)
    setTemplateKey(''); setTemplateSource(''); setPickedTemplate(null); setSuggestions([])
    setSuggestOpen(false); setSuggestIndex(0); setMatchState('idle'); setMatchResult(null)
    setDocMatch(null); setDocState('idle')
    setManualMatch(null); setManualMatchState('idle'); setManualMatchNote('')
    suggestSeq.current += 1   // 丢弃在途的联想请求
    docSeq.current += 1       // 丢弃在途的规章匹配请求
    manualSeq.current += 1    // 丢弃在途的手动模式匹配请求
  }, [open])

  /**
   * 切模式时收起上一个模式的结果：
   *  · 联想下拉没跟着串到另一个输入框；
   *  · 手动模式那一路（`manualMatch` / `manualMatchState`）也一起复位 ——
   *    ⚠️ 它曾经借 AI 模式的 `matchState` 存状态，切模式时会被这个 effect 静默清空，
   *    于是「从 AI 切回手动」看到的是按钮转圈不消失、明细永远不展开（`mode` 没变、effect 不重跑）。
   *    两个模式各存各的之后，这里只是例行复位，不再有跨模式的连带伤害。
   */
  useEffect(() => {
    setSuggestOpen(false); setSuggestions([]); setSuggestIndex(0); setMatchState('idle'); setMatchResult(null)
    setDocMatch(null); setDocState('idle')
    setManualMatch(null); setManualMatchState('idle'); setManualMatchNote('')
    manualSeq.current += 1
  }, [mode])

  /**
   * 首次聚焦标题输入时才拉模板清单：模板总量小（几十条），拉一次全量后本地模糊匹配，
   * 不给每个按键打接口。拉失败就当作「没有联想」，不影响手写标题提交。
   */

  /**
   * 聚焦 AI 模式的标题输入框：
   * ① 顺手保证模板清单已加载（联想的数据源）；
   * ② 标题若是「所选会话标题」预填的，聚焦时**全选**一下 —— 用户接着敲字就是替换，
   *    而不是把预填的长句拼在前面（拼上去之后永远匹配不到任何模板名，表现成「联想没做匹配」）。
   *    用户自己改过的标题不再全选，正常点哪落哪。
   *
   * 手动模式没有可输入的标题（事项名由所选事务决定，只读回显），所以这条路只在 AI 模式存在。
   */
  const focusTitle = (event: React.FocusEvent<HTMLInputElement>) => {
    ensureTemplates()
    const prefilled = selected?.title?.trim()
    if (prefilled && event.currentTarget.value.trim() === prefilled) event.currentTarget.select()
  }

  /**
   * 改标题：**收起上一次匹配带出来的候选**（那份候选对应的是旧输入），并解绑联想来的模板 ——
   * 沿用旧模板建单会挂错材料。要不要重新匹配由用户再按一次回车决定：输入过程**不发请求**。
   */
  const changeTitle = (value: string) => {
    setTitle(value)
    setSuggestOpen(false)
    setSuggestions((current) => (current.length ? [] : current))
    setMatchState('idle')
    // 输入变了，上一次匹配带回来的材料清单 / 审批节点也就作废了 —— 别让它挂在面板上误导人
    setMatchResult(null)
    // 规章匹配同款：依据也是按**旧标题**匹配出来的，留着同样张冠李戴。
    // ⚠️ 这里只**作废**、不重发：重发由用户按下一次回车（或点「匹配事项」）决定（09-15 改口径）。
    docSeq.current += 1
    setDocMatch(null)
    setDocState('idle')
    setSuggestIndex(0)
    if (templateSource === 'suggest' && pickedTemplate && value.trim() !== pickedTemplate.name) {
      setTemplateKey('')
      setTemplateSource('')
      setPickedTemplate(null)
    }
  }

  /**
   * 匹配请求（**按回车或点「匹配事项」时打一次**，不做按键防抖）。一次触发是**两个接口**：
   *   ① `POST /v2/tasks/templates/match`，body 只有 `title` —— 命中模板 + 候选 + 材料清单 + 审批节点；
   *   ② `POST /v2/tasks/document/match`，body 只有 `query`（同一份输入）—— 办理依据（校内规章）。
   * 两者**并行发、各自独立结算**：任一个失败都不影响另一个（规章匹配挂了照样能选模板建单，
   * 模板没命中也不影响展示依据）。谁都别去 await 对方 —— 那会把两条独立链路绑成一条。
   *
   * **前端不做任何本地匹配** —— 匹配规则、排序、条数都由后端定。
   * 用 `suggestSeq` / `docSeq` 丢弃过期响应：连按回车、或匹配在途时又改了输入再回车，只认最后一次。
   * `matchState` 把「加载中 / 匹配到 0 条 / 请求失败」分开，别让用户面对一个没有解释的空白下拉。
   * ⚠️ 后端在本地/预览下回得比一帧还快，`loading` 态会一闪而过（探针抓不到）—— 这是真实现象，
   *   不是没设状态：`.tc-match-btn` 的转圈与中枢的「正在匹配」由 `matchState==='loading'` 驱动，
   *   生产网络下必然看得见。断言这一态时要用**打点延迟**，别指望肉眼或瞬时快照能抓到。
   */
  const runMatch = (value: string) => {
    const keyword = value.trim()
    // 空输入：两个接口都不发，两份结果一起清掉（否则会留下上一次的旧依据）
    if (!keyword) {
      setSuggestions([]); setMatchResult(null); setSuggestOpen(false); setMatchState('idle')
      setDocMatch(null); setDocState('idle')
      return
    }
    // 规章匹配与模板匹配**同一次触发**（用户要求「这个也是回车触发的」），所以在这里成对调用，
    // 不放进 `runDocMatch` 内部 —— 保持它是个纯「打一次接口」的函数，重试/单发都能复用。
    runDocMatch(keyword)
    const seq = suggestSeq.current + 1
    suggestSeq.current = seq
    setMatchState('loading')
    matchTaskTemplates(keyword)
      .then(({ data }) => {
        if (suggestSeq.current !== seq) return
        // ⚠️ `data.items` 是**单个匹配结果对象**（不是数组），回退成数组会让候选下拉拿到 undefined。
        const result = data.data?.items ?? null
        const items = toTemplateCandidates(result)
        setMatchResult(result)
        setSuggestions(items)
        setSuggestOpen(items.length > 0)
        setSuggestIndex(0)
        // 后端把「没命中」和「模板库里没有能对上的」都表达成 `matched:false`，前端统一按「没匹配到」提示
        setMatchState(items.length ? 'idle' : 'empty')
      })
      .catch(() => {
        if (suggestSeq.current !== seq) return
        setMatchResult(null)
        setSuggestions([])
        setSuggestOpen(false)
        setMatchState('error')
      })
  }

  /** 联想里选中：标题直接换成模板名（AI 模式专用 —— 手动模式事务由下拉选定，不走联想）。 */
  const pickTemplate = (item: TaskTemplate) => {
    setTitle(item.name)
    setTemplateKey(item.template_key || '')
    setTemplateSource('suggest')
    setPickedTemplate(item)
    // 材料清单 / 审批节点只有「命中项」那一份明细（后端只给命中项下发），
    // 选的是别的候选就把它收起来 —— 不拿 A 模板的清单去配 B 模板。
    if (matchResult?.template_key !== item.template_key) setMatchResult(null)
    setSuggestOpen(false)
    setSuggestIndex(0)
  }

  /**
   * 手动模式的「要办理的事务」下拉：**这就是手动申报的事务来源**。
   * 只绑模板，不写任何标题 state —— 标题在渲染时直接由 `pickedTemplate.name` 派生，
   * 单一数据来源，避免「换了事务但标题还停在旧的」这类不一致。
   */
  const selectTemplate = (key: string) => {
    const item = key ? templates.find((template) => template.template_key === key) ?? null : null
    setTemplateKey(key)
    setTemplateSource(key ? 'select' : '')
    setPickedTemplate(item)
    // 换了事务 = 换了要匹配的东西：上一份依据按**旧事务名**匹配而来，留着是张冠李戴。
    // ⚠️ 同 `changeTitle`：只作废、不自动重发 —— 手动模式要重跑就点摘要卡里的
    //    「匹配办理依据与材料」（那里会拿新事务把依据与材料一起打一遍）。
    docSeq.current += 1
    setDocMatch(null)
    setDocState('idle')
    // 材料侧同款：换事务就作废上一次的材料与节点，别让 A 事务的清单挂在 B 事务下面。
    manualSeq.current += 1
    setManualMatch(null)
    setManualMatchState('idle')
    setManualMatchNote('')
  }

  /**
   * 手动模式「匹配办理依据与材料」—— 摘要卡里那枚按钮的唯一实现（2026-09-15 重写）。
   *
   * 一次点击 = **两个接口**，与智能协作模式「回车」的两个接口**不是同一对**：
   *  ① 材料与节点 ← `GET /v1/tasks/templates/{template_key}/requirements`（按模板标识取明细）
   *     —— 手动模式手里有确定的 `template_key`（下拉选的），不该再拿事务名去 AI 那边猜自己。
   *     ⚠️ **该接口后端尚未实现**（2026-09-15 实测 `/v3/api-docs` 无此路由）→ 失败即降级 ②；
   *  ② 办理依据   ← `POST /v2/tasks/document/match`（AI 服务，body `query` = 事务名）。
   *
   * 两条链路**并行、各自结算**：依据拿不到不影响材料清单，反之亦然（与 AI 模式同一纪律）。
   *
   * 降级顺序（务必守住「不编数据」这条线）：
   *  ① 按 key 取明细成功 → 材料与节点来自该返回；
   *  ② ① 失败 → 退回 `POST /v2/tasks/templates/match`（body `title` = 事务名）；命中且 key 一致才采用，
   *     并把「走的是匹配、不是按模板取」写进说明行 —— 用户看得到差别，也看得到后端还差哪一步；
   *  ③ ② 也没命中 / 也失败 → 材料块说明原因。**`GET /tasks/templates` 的 `requirement_count`
   *     一个材料项都还原不出来，绝不拿它凑数**（那个数字只够显示「· N 项材料」）。
   *
   * ⚠️ 这里**不写全局 `docState` / `matchState`**（那会把另一个模式锁住，见 `manualMatchState` 的注释）；
   *    写的是手动模式自己的 `manualMatchState`，而 `.tc-group-head` 的状态位两种模式都读，
   *    所以转圈、失败、重试在界面上照旧显示。
   */
  const runManualMatch = (template: TaskTemplate) => {
    const seq = manualSeq.current + 1
    manualSeq.current = seq
    setManualMatchState('loading')
    setManualMatch(null)
    setManualMatchNote('')

    // 办理依据：与材料链路并行发；`mark=false` 表示不置全局 loading。
    runDocMatch(template.name, false)

    const merge = (detail: TaskTemplateMatch | null, note: string) => {
      if (manualSeq.current !== seq) return
      const hasDetail = !!detail && ((detail.requirements?.length ?? 0) > 0 || (detail.steps?.length ?? 0) > 0)
      setManualMatch(detail)
      setManualMatchState(detail ? (hasDetail ? 'ready' : 'empty') : 'empty')
      // 说明行只在「有话说」时给：缺字段（后端要用户补）或降级/失败原因。
      const bits = [
        detail?.missing_fields?.length ? `模板还缺 ${detail.missing_fields.length} 项信息，发起后可在任务详情补齐` : '',
        note,
      ].filter(Boolean)
      setManualMatchNote(bits.join('；'))
    }

    getTemplateRequirements(template.template_key)
      .then(({ data }) => {
        const payload = data.data
        // 形状与 A.5.14 的命中文案保持一致，好让两种模式共用同一套明细渲染。
        merge(
          {
            matched: true,
            template_key: template.template_key,
            template_id: typeof template.id === 'number' ? template.id : null,
            template_name: template.name,
            requirements: payload?.requirements ?? [],
            steps: payload?.steps ?? [],
          },
          '',
        )
      })
      .catch(() => {
        // ① 没通（后端未实现 / 该模板没有明细）→ 退回 AI 匹配，**并如实说明这一步是降级来的**。
        if (manualSeq.current !== seq) return
        matchTaskTemplates(template.name)
          .then(({ data }) => {
            const hit = data.data?.items ?? null
            // 只有匹配回来的确实是**当前所选事务**才采用 —— 否则就是拿别的模板的材料误导用户。
            if (hit?.matched && hit.template_key === template.template_key) {
              merge(hit, '材料清单由事项名称匹配得到（按模板标识取明细的接口暂不可用）')
            } else {
              merge(null, '材料清单暂时取不到：按模板标识取明细的接口尚未开放，事项名称匹配也没命中该模板。不影响发起，条目在任务创建后下发。')
            }
          })
          .catch(() => {
            merge(null, '材料清单暂时取不到（两个接口都没通）。不影响发起，材料条目在任务创建后下发，可在任务详情里逐项上传与核验。')
          })
      })
  }

  /**
   * 输入框键盘行为：
   *  · 回车 —— 候选已展开时是「选中该候选」；**没有候选时，回车就是发出这次模板匹配请求**
   *    （`runMatch`）。匹配由用户主动触发，敲字过程不打接口。
   *  · 上下键 —— 候选展开时移动高亮；Esc 只收下拉，不关弹窗（弹窗外层监听的是 window）。
   */
  const titleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      const item = suggestOpen ? visibleSuggestions[Math.min(suggestIndex, visibleSuggestions.length - 1)] : undefined
      if (item) pickTemplate(item)
      else runMatch(titleInput)
      return
    }
    if (!visibleSuggestions.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSuggestIndex((index) => (index + 1) % visibleSuggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSuggestIndex((index) => (index - 1 + visibleSuggestions.length) % visibleSuggestions.length)
    } else if (event.key === 'Escape') {
      event.stopPropagation()
      setSuggestOpen(false)
    }
  }

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return
    const next: Attachment[] = []
    for (const file of Array.from(list)) {
      if (file.size > MAX_FILE_MB * 1024 * 1024) { setError(`「${file.name}」超过 ${MAX_FILE_MB}MB，未加入清单`); continue }
      if (!ALLOWED_EXT.includes(extensionOf(file.name))) { setError(`「${file.name}」格式不在支持范围内（Word / Excel / PDF / JPG / ZIP）`); continue }
      next.push({ file, status: 'pending' })
    }
    if (next.length) { setError(''); setFiles((current) => [...current, ...next]) }
  }

  /**
   * 附件走「预签名直传 → 确认 → 关联材料」三步，按加入顺序串行，单个失败不阻断后面的。
   * 每处理完一个立刻把状态写回**那一行**：只汇总一个数字的话，
   * 用户不知道是哪一项没上去，而弹窗一关这条信息就没了。
   */
  const uploadAttachments = async (taskId: string | number) => {
    if (!files.length) return { linked: 0, unlinked: 0, failed: 0 }
    let requirements: TaskRequirement[] = []
    try {
      const { data } = await getTaskRequirements(taskId)
      requirements = data.data.items || []
    } catch { requirements = [] }

    const mark = (index: number, status: Attachment['status']) =>
      setFiles((current) => current.map((item, i) => (i === index ? { ...item, status } : item)))

    let linked = 0
    let unlinked = 0
    let failed = 0
    for (let index = 0; index < files.length; index += 1) {
      const { file } = files[index]
      mark(index, 'uploading')
      try {
        const fileId = await uploadFile(file, 'task_material')
        const target = pickRequirement(requirements, file)
        if (target) {
          await associateTaskMaterial(taskId, { requirement_id: target.id, file_id: fileId })
          mark(index, 'linked')
          linked += 1
        } else {
          // 传上去了但任务没有可挂的材料项。与「上传失败」分开报：补救动作完全不同。
          mark(index, 'unlinked')
          unlinked += 1
        }
      } catch { mark(index, 'failed'); failed += 1 }
    }
    return { linked, unlinked, failed }
  }

  /** 停靠态下的「仍然提交」：任务已建好，这里只补一次 submit，不重复建单。 */
  const submitSettled = async () => {
    if (!settled || busy) return
    setBusy(true)
    setError('')
    try {
      await submitTask(settled.task.id, { version: settled.task.version, confirm: true })
      onCreated(settled.task, `已发起办事流转 · ${settled.notes.join(' · ')}`)
    } catch (e) {
      setError(apiErrorMessage(e, '提交未通过，请稍后在任务详情中提交'))
    } finally {
      setBusy(false)
    }
  }

  const submit = async (asDraft: boolean) => {
    if (busy || settled) return
    /*
     * 校验按标签上的 `*` 逐项对齐。手动申报的分级（2026-09-14 用户要求「只能处理模板里的事务」）：
     *  · **结构性字段（要办理的事务）两条路径都必填** —— 事务是材料清单与审批节点的唯一来源，
     *    没有它的任务建出来永远推不动；而且建单之后**没有改模板的接口**，
     *    放过一个无事务草稿 = 造一个永远补不回来的死草稿。所以草稿也不豁免。
     *  · **内容性字段（业务大类 / 申报事由）只在真提交时必填** —— 草稿的语义就是「还没填完」，
     *    这两项后面在任务详情里还能补，草稿豁免。
     *  · 手动模式的标题**不是用户输入**（= 所选事务名，只读回显），所以不单独校验文本。
     */
    if (mode === 'manual') {
      if (!templateKey || !pickedTemplate) { setError('请选择要办理的事务：材料清单与审批节点由它决定'); return }
      if (!asDraft) {
        if (!categoryId) { setError('请选择所属业务大类'); return }
        if (!reason.trim()) { setError('请填写申报事由与情况说明'); return }
      }
    } else if (!effectiveTitle) {
      setError('请填写拟发起事项名称')
      return
    }    setBusy(true)
    setError('')
    try {
      const created = (
        await createTask({
          title: effectiveTitle,
          // 采用过模板就把 templateKey 带上：后端据此下发材料要求与审批步骤（不采用则只给标题）。
          ...(templateKey ? { templateKey } : {}),
          // 模板数字主键：后端落 tasks.template_id 不必再按 key 反查（A.5.14 新增 template_id）
          ...(templateId ? { templateId } : {}),
          ...(mode === 'ai' && conversationId ? { conversationId } : {}),
          ...(mode === 'ai' && question ? { sourceMessageId: messages.find((item) => item.role === 'user')?.id } : {}),
          /*
           * 审批节点与材料要求：**只在用户采用了候选模板时**才带 —— 「待选定」状态不产生任何绑定。
           * 后端拿到后**直接入库**（`task_step_instances` / 材料要求记录），不必再按模板生成一遍。
           * ⚠️ 手动申报模式没有这两份明细（`GET /tasks/templates` 不下发，A.5.13），
           * 那种情况仍由后端按 `templateKey` 生成 —— 不是漏传。
           */
          ...(adopted
            ? {
                steps: (adopted.steps || []).map((step, index) => ({
                  stepId: step.step_id ?? null,
                  stepOrder: step.step_order ?? index + 1,
                  organizationId: step.organization_id ?? null,
                  name: step.name,
                  requiresUserAction: step.requires_user_action ?? null,
                })),
                requirements: (adopted.requirements || []).map((item) => ({
                  requirementKey: item.requirement_key ?? null,
                  name: item.name,
                  allowedContentTypes: item.allowed_content_types ?? null,
                  maxSizeBytes: item.max_size_bytes ?? null,
                  isRequired: item.is_required ?? null,
                })),
              }
            : {}),
          // 手动申报的表单字段一并提交，省掉建单后那次 PATCH（PATCH 暂留做兜底，后端收下这两个字段后可删）
          ...(mode === 'manual' && categoryId ? { categoryId } : {}),
          ...(mode === 'manual' && reason.trim() ? { reason: reason.trim() } : {}),
        })
      ).data.data

      const notes: string[] = []
      // 手动模式的「申报事由 / 业务大类」没有专门的建单字段，按草稿表单存进 form_data。
      if (mode === 'manual' && (reason.trim() || categoryId)) {
        try {
          await saveTaskDraft(created.id, {
            form_data: { ...(reason.trim() ? { description: reason.trim() } : {}), ...(categoryId ? { category_id: Number(categoryId) } : {}) },
            version: created.version,
          })
        } catch { notes.push('事由未随任务保存') }
      }
      /*
       * AI 模式的「补充说明」（用户反馈 1 给的那类追问项）：任务模型里只有**一个事由字段**，
       * 而 AI 模式没有独立的申报事由输入，所以直接把它并进去。走同一条 `PATCH /draft`，
       * 与手动模式的事由落库方式一致 —— 成功不额外播报（它只是用户刚填的内容），
       * 失败才记一条，免得用户以为填了没保存。
       */
      if (mode === 'ai' && clarifyText.trim()) {
        try {
          await saveTaskDraft(created.id, { form_data: { description: clarifyText.trim() }, version: created.version })
        } catch { notes.push('补充说明未随任务保存') }
      }
      // 附件先上传，再尝试挂到后端生成的材料项上。
      if (mode === 'manual' && files.length) {
        const { linked, unlinked, failed } = await uploadAttachments(created.id)
        if (linked) notes.push(`${linked} 项材料已关联`)
        if (unlinked) notes.push(`${unlinked} 项未关联到材料项`)
        if (failed) notes.push(`${failed} 项上传失败`)
        /*
         * 有附件没挂上就**不擅自提交**：提交后材料清单就锁了，用户更没机会补。
         * 停下来把逐项状态留在屏幕上，让他自己选「留作草稿」还是「仍然提交」。
         * 此时任务已经建好，所以不能再走一遍建单 —— `submit` 开头的 `settled` 就是防这个。
         */
        if (unlinked + failed > 0) { setSettled({ task: created, notes }); return }
      }
      if (!asDraft) {
        try {
          await submitTask(created.id, { version: created.version, confirm: true })
        } catch (e) {
          // 建单成功即算落地，提交失败不算失败 —— 如实告知，用户可在任务详情里再提交。
          onCreated(created, `任务已创建为草稿，提交未通过：${apiErrorMessage(e, '请稍后在任务详情中提交')}`)
          return
        }
      }
      onCreated(created, `${asDraft ? '草稿已保存' : '已发起办事流转'}${notes.length ? ` · ${notes.join(' · ')}` : ''}`)
    } catch (e) {
      setError(apiErrorMessage(e, '任务创建失败，请稍后重试'))
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null


  const renderSuggest = () =>
    // ⚠️ 必须同时看 `suggestOpen`：只看 `suggestions.length` 的话，选中候选后
    // `pickTemplate` 里的 `setSuggestOpen(false)` 没人理，候选块会一直赖在输入框下面
    // —— 表现成「点了候选没反应 / 选中不了」（09-14 用户反馈）。
    suggestOpen && suggestions.length > 0 && (
      <div className="tc-suggest" role="listbox" aria-label="办事模板联想">
        <div className="tc-suggest-head">办事模板候选，选中即套用其审批流程与材料清单</div>
        {visibleSuggestions.map((item, index) => (
          <div
            key={item.template_key || item.name}
            role="option"
            aria-selected={index === suggestIndex}
            className={`tc-suggest-item${index === suggestIndex ? ' active' : ''}`}
            // **按下就选中**，不只是 preventDefault：候选块现在是随内容展开的普通节点，
            // 万一 blur 先跑（块被收起、DOM 卸载），随后的 click 就落空了 —— 那才是真的「选不中」。
            // `onClick` 留着兜底（触摸 / 键盘触发 click 的路径）。
            onMouseDown={(event) => { event.preventDefault(); pickTemplate(item) }}
            onMouseEnter={() => setSuggestIndex(index)}
            onClick={() => pickTemplate(item)}
          >
            <b>{item.name}</b>
            <small>
              {item.description || item.responsible_organization_name || '办事模板'}
              {typeof item.requirement_count === 'number' && item.requirement_count > 0 ? ` · ${item.requirement_count} 项材料` : ''}
            </small>
          </div>
        ))}
      </div>
    )

  /**
   * 标题输入框下方的匹配状态提示（AI 模式）。
   * 回车触发匹配后，用户必须能分清「还在匹配 / 匹配到 0 条 / 请求失败」——
   * 只让下拉默默不出现，用户会以为回车没生效。**再按一次回车就是重试**。
   */
  /**
   * 「办理依据 / 所需材料 / 预计办理流程」三块明细 —— **两种模式共用同一份实现**（2026-09-15 抽出）。
   *
   * ⚠️ 抽出来之前它只写在 AI 模式那半边（`mode === 'ai'` 分支里），所以**手动申报根本渲染不出明细** ——
   *    配套加的「匹配办理依据与材料」按钮点了会看到两个接口都发出去了、页面上却什么都没有
   *    （跑 `_verify-manual-doc-match.mjs` 时抓到的：接口回显正确、三块面板全是 null）。
   * 三块的内容全部来自 `detailMatch` / `policyHit`，与模式无关，所以同一份 JSX 两边都能用。
   */
  const renderDetailGroups = () => (<>
    {/* ① 办理依据（原「政策依据匹配」）—— 数据源：`POST /v2/tasks/document/match`
        （AI 服务按事项名称匹配校内规章），**不再是「拿标题去知识库列表里搜」**：
        那个接口的 `query` 被后端忽略，命中的文档与事项其实无关。
        右侧状态位按四态如实报：正在匹配 / 已匹配到校内规章 / 未匹配到 / 匹配失败（可重试）。
        ⚠️ 手动模式那一格的状态改由 `manualMatchState` 报（它自己的依据匹配没写全局 `docState`）。 */}
    <div className="tc-group">
      <div className="tc-group-head">
        <h3>办理依据</h3>
        <span className={policyHit ? 'ok' : docStatus === 'error' ? 'warn' : ''}>
          {docStatus === 'loading' && <><Loader2 size={12} className="tc-spin" />正在匹配…</>}
          {docStatus === 'idle' && (policyHit
            ? `已匹配到${(docMatch?.documents?.length ?? 0) > 1 ? ` ${docMatch?.documents?.length} 份` : ''}校内规章`
            : '')}
          {docStatus === 'empty' && '未匹配到直接相关的规定'}
          {docStatus === 'error' && (
            <>
              规章匹配失败
              <button type="button" className="tc-reload" onClick={retryDocMatch}>重试</button>
            </>
          )}
        </span>
      </div>
      {policyHit
        ? /* 命中：`documents[]` 按序全画（接口可能下发多份规章，第一份是主依据）。
             每行 = 标题 + 文号 + （后端给了才写的）相关度 / 命中理由 + 查阅。
             ⚠️ 没有的字段一个都不编 —— 后端只给 title 时，这一行就只有标题。 */
        docMatch?.documents?.map((doc, index) => {
          const docTitle = pickDocField(doc.title)
          const docNo = pickDocNo(doc)
          const docId = pickDocId(doc)
          const docReason = pickDocField(doc.reason)
          return (
            <div className="tc-line tc-line-doc" key={docId != null ? `doc-${docId}` : `doc-${index}-${docTitle ?? ''}`}>
              <FileText size={14} aria-hidden="true" />
              <span>
                {docTitle || '校内规章制度'}
                {docNo ? ` （${docNo}）` : ''}
                {typeof doc.relevance === 'number'
                  ? <em className="tc-doc-score">匹配度 {Math.round(Number(doc.relevance) * 100)}%</em>
                  : null}
                {docReason
                  ? <small className="tc-doc-reason">{docReason}</small>
                  : null}
              </span>
              <button
                type="button"
                onClick={() => {
                  // 后端给了规章主键就带 `?doc=` 直达该份规章（知识库页已支持），
                  // 没给才退回按标题搜索 —— 兜底路径下命中与否取决于列表接口。
                  onClose()
                  navigate(docId != null ? `/knowledge?doc=${encodeURIComponent(String(docId))}` : `/knowledge?query=${encodeURIComponent(docTitle || effectiveTitle)}`)
                }}
              >
                <span>查阅</span><ExternalLink size={12} />
              </button>
            </div>
          )
        })
        : (
        /* ⚠️ 口径澄清（用户反馈 3）：「模板匹配成功」≠「政策依据与申请资格都已核实」。
           所以这里明确写成**规章匹配结果**，并说明它和模板匹配是两件事，
           免得用户把「匹配到办事模板」理解成资格已通过。
           「没匹配到」与「匹配失败」也要分开写 —— 前者可以继续发起，
           后者是接口问题，用户可以重试，而不是以为学校真没这条规定。 */
        <p className="tc-preview-line">
          <PackageOpen size={14} aria-hidden="true" />
          {docState === 'loading'
            ? '正在按事项名称匹配校内规章…'
            : docState === 'error'
              ? '规章匹配服务暂时不可用；这不影响发起，受理机构会在审核时核对政策与资格。'
              : '暂未匹配到直接相关的校内规章；这不影响发起，受理机构会在审核时核对政策与资格。'}
        </p>
      )}
    </div>

    {/* ② 所需材料（原「智能装配清单与预填材料」） */}
    <div className="tc-group">
      <div className="tc-group-head">
        <h3>所需材料</h3>
        {/* 右侧只报真实口径：接口下发了多少项、其中几项必交
            （设计稿写的「已预生成 N 项 / 待用户上传 M 项」，我们没有生成表格的接口）。 */}
        <span>{matchedRequirements.length ? `共 ${matchedRequirements.length} 项${requiredCount ? ` · ${requiredCount} 项必交` : ''}` : ''}</span>
      </div>
      {matchedRequirements.length ? (
        /* 材料行：左侧文件类型片 + 名称 + 必交标记 + 一行说明。
           ⚠️ 设计稿每行右侧有「预览表单 / 从学籍库调取原底片 / 上传新照片」三个动作，
           我们一个都做不了（没有生成表格与学籍底片的接口，材料只能**建单之后**按材料项关联），
           所以不摆按钮，改成在说明行里交代上传时机 —— 摆一个点了没反应的按钮比没有按钮更糟。 */
        <ul className="tc-checklist">
          {matchedRequirements.map((item) => {
            const kind = materialKind(item.allowed_content_types)
            const types = typeText(item.allowed_content_types)
            return (
              <li key={item.requirement_key || item.name}>
                <span className="tc-material-chip">{kind}</span>
                <div className="tc-material-main">
                  <div className="tc-material-title">
                    <span className="tc-material-name">{item.name}</span>
                    <em className={item.is_required ? 'need' : ''}>{item.is_required ? '必交' : '选交'}</em>
                  </div>
                  <small>
                    {/* 单文件上限**优先用接口给的 `max_size_bytes`**（模板对照片类往往限到 2MB，
                        与 50MB 差一个量级，写死 50MB 会承诺做不到的事）；
                        接口没给才退回前端通用的 `MAX_FILE_MB`（= 上传校验用的那一档）。 */}
                    {types ? `支持 ${types}` : '格式不限'}，单个不超过 {sizeLimitText(item.max_size_bytes)}
                    {/* 时机口径统一成「发起后需完成」（用户反馈 1）：
                        与上面待补条里材料侧的写法一致，也不再用「提交后」这种
                        与「发起」混着说的词。 */}
                    <span className="tc-material-when">· 发起后需完成</span>
                  </small>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        /* 空态压成**一行带图标的提示**（原先是 44px 的虚线占位块，用户要求省纵向空间） */
        <p className="tc-preview-line">
          <PackageOpen size={14} aria-hidden="true" />
          {awaitingPick
            ? '点选上方的办事模板候选，即可看到它要求的材料清单'
            : '将按所选事项的流程模板自动生成材料清单'}
        </p>
      )}
      {/* ⚠️ 原先这里有一块黄色的「还需要你补充确认」清单，只有问句、**没有任何入口**
          （用户反馈 1 的核心抱怨）。它已上移到输入框下方，改成带输入框 / 上传说明的
          `.tc-todo` 待办条，这里不再重复一遍。 */}
    </div>

    {/* ③ 预计办理流程（原「拟定全流程审批节点」） */}
    <div className="tc-group">
      <div className="tc-group-head">
        <h3>预计办理流程</h3>
        <span>{matchedSteps.length ? `共 ${matchedSteps.length} 个节点${actionStepCount ? ` · ${actionStepCount} 个需你操作` : ''}` : ''}</span>
      </div>
      {matchedSteps.length ? (
        /* 节点：序号圆 + 节点名 + 状态胶囊，首个节点强调（无卡片外框，靠序号圆与胶囊分级）。
           ⚠️ 2026-09-15 六改（用户反馈 2）：这只是**预览**，任务还没建 ——
           原来写「当前 · 需你操作 / 待流转」，读起来像任务已经在跑。现在：
           首节点「发起后由你完成」、其后「由 X 受理 / 承办」，
           并**去掉「用户要求的三段式示例」里那步「提交补办材料」的"当前"语义**。
           设计稿里的「预计 24h 内 / 2 个工作日办结」我们没有时限字段，一律不写。 */
        <ol className="tc-steps">
          {matchedSteps.map((step, index) => {
            const first = index === 0
            const org = organizationNameOf(detailMatch?.template_key)
            return (
              <li key={step.step_id ?? `${index}-${step.name}`} className={first ? 'current' : ''}>
                <div className="tc-node-head">
                  <i>{step.step_order ?? index + 1}</i>
                  <span>{step.name}</span>
                  <em className={first ? 'now' : ''}>
                    {first ? '发起后由你完成' : '发起后由办理部门流转'}
                  </em>
                </div>
                {/* 第二节起的「办理部门」：机构名解析不到就**整行不渲染**（不编机构名）。
                    首节点由用户自己完成，所以也不写机构。 */}
                {!first && org && <small>{org}</small>}
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="tc-preview-line">
          <Route size={14} aria-hidden="true" />
          本次未匹配到流程模板，提交后由受理机构按通用流程受理。
        </p>
      )}
    </div>
  </>)


  const renderMatchHint = () => {
    // 两个接口是同一次回车触发的两条链路，任一在途都算「还在匹配」（见 `anyMatching`）
    if (anyMatching) return <em className="tc-field-hint">正在匹配办事模板与办理依据…</em>
    if (matchState === 'empty') return <em className="tc-field-hint">没有匹配到办事模板，可直接按当前标题提交，或换个说法再回车</em>
    if (matchState === 'error') return <em className="tc-field-hint warn">模板匹配没成功（AI 服务报错或网络异常），可直接手写标题提交；再按一次回车重试</em>
    return null
  }

  /**
   * 手动申报还差哪一步才能提交（用户要求：提交按钮未完成时**禁用**，旁注说清差什么）。
   * `null` = 可以提交。顺序即用户填表顺序：事务 → 业务大类 → 申报事由。
   */
  const manualBlocker: 'template' | 'category' | 'reason' | null =
    mode !== 'manual'
      ? null
      : !pickedTemplate ? 'template'
        : !categoryId ? 'category'
          : !reason.trim() ? 'reason'
            : null

  /**
   * 智能协作还差哪一步（2026-09-15 用户要求「统一等待/匹配/可发起三态」）：
   *  · 没填名称     → `title`：按钮不可点，旁注说「先填要办的事」
   *  · 名称在途匹配 → `matching`：按钮不可点，旁注说「正在匹配办事模板」
   *  · 匹配到候选但没点选 → `pick`：按用户口径「必须匹配到有效事项才能发起」，
   *    这里也要拦住 —— 候选只是建议，采用哪一份由用户点选决定。
   *  · 没命中也放行：`/tasks` 支持只带标题建单（后端按标题走通用流程），
   *    硬卡住会把一条本来能走通的路堵死；那种情况旁注会写明「未命中模板」。
   */
  const aiBlocker: 'title' | 'matching' | 'pick' | null =
    mode !== 'ai'
      ? null
      : !effectiveTitle ? 'title'
        : anyMatching ? 'matching'
          : awaitingPick ? 'pick'
            : null

  /** 提交按钮的拦截原因（两种模式统一）——`null` 才可点。 */
  const blocker = mode === 'manual' ? manualBlocker : aiBlocker

  /**
   * 底栏左侧图标的语义档位：`busy` 转圈、`warn` 琥珀提醒（有待办 / 任务停在草稿等你决定）、
   * `ok` 绿勾（当前条件下没有需要用户动手的事）。
   * ⚠️ 2026-09-15 用户要求：「未关联会话」是**普通状态**，不是完成 —— 只有名称已填、匹配有结果、
   * 没有待办时才算 ok，别让绿勾在空表上就先亮起来（那会让底部与顶部状态自相矛盾）。
   */
  const footTone: 'busy' | 'warn' | 'ok' =
    busy ? 'busy' : settled || blocker ? 'warn' : 'ok'

  /**
   * 底部一行操作提示（用户要求：详细解释挪到上部会话选择框附近，底部只说当前状态）。
   * 两模式共用一套措辞：能发起时写「将按 X 发起…」，不能发起时写「还差什么」。
   *
   * ⚠️ 2026-09-15 用户反馈 4：这里**不再复述「已采用…」**（与结果栏、结果标题三处重复），
   * 成功的事实归结果栏一处，底注只回答「现在点下去会发生什么」。
   */
  const footNote = (() => {
    if (busy) return '正在建档归流…'
    if (settled) return '任务已建为草稿，等待你确认下一步。'
    if (mode === 'manual') {
      if (manualBlocker === 'template') return '请先选定要办理的事务：材料清单与审批节点由它决定。'
      if (manualBlocker === 'category') return '已选定事务，还差所属业务大类，选完即可提交。'
      if (manualBlocker === 'reason') return '已选定事务与业务大类，还差申报事由，填完即可提交。'
      return files.length
        ? `将按「${pickedTemplate?.name ?? ''}」发起，已选 ${files.length} 项附件，提交时自动上传并挂到材料项。`
        : `将按「${pickedTemplate?.name ?? ''}」发起；未选择附件，提交后由受理机构初核。`
    }
    if (aiBlocker === 'title') return '先填写你要办理的事务，再点「匹配事项」或按回车。'
    if (aiBlocker === 'matching') return '正在匹配办事模板与办理依据，匹配完成后即可发起。'
    if (aiBlocker === 'pick') return '已匹配到候选模板，点选上方一项确认采用后即可发起。'
    if (adopted) {
      /* 采用之后的底注只说「点下去会发生什么」。有补充项时顺带交代它们去哪 ——
         免得用户以为「没填完不能发起」，也免得他找不到入口（用户反馈 1 的延伸）。
         ⚠️ 这里**保持 `adopted`（AI 模式专用）而不是 `detailsOpen`**：手动模式的底注在上一段
         就按「事务名 + 附件数」写全了，走到这里的一定是 AI 模式。 */
      const bits = [
        '将按此预览发起',
        materialAsks.length ? `${materialAsks.length} 项材料发起后上传` : '',
        todoAsks.length ? '补充说明可在任务详情继续完善' : '',
      ].filter(Boolean)
      return `${bits.join('；')}。`
    }
    return `未命中办事模板；将按「${effectiveTitle}」发起，由受理机构按通用流程受理。`
  })()

  /**
   * 初始那句「匹配后展示办理依据、所需材料与审批流程」的显示条件（用户反馈 4）：
   * 一旦有了结果（命中 / 未命中 / 报错）就撤掉 —— 那时结果栏与预览区已经把这三项摊开了，
   * 留着只是再占一行、再重复一遍。
   */
  const showInitialHint =
    !detailsOpen && !awaitingPick && matchState !== 'empty' && matchState !== 'error'

  return (
    <div className="task-create-layer">
      <div className="task-create-backdrop" onClick={onClose} />
      {/* 手动模式挂 `manual` 类：整块表单抬到白色承载板上、底栏实白（前景分层，见 tasks.css） */}
      <div className={`task-create${mode === 'manual' ? ' manual' : ''}`} role="dialog" aria-modal="true" aria-label="发起校园事务办事流程">
        <header className="tc-head">
          <div className="tc-head-main">
            {/* 图标随模式换：智能协作是渐变深墨（对齐 v15 设计稿的 AI 图标），手动申报保持纯深墨。
                ⚠️ 图标角上**不再挂脉动绿点**（2026-09-14 用户要求）：页头那枚「N 个智能体协同中」
                胶囊里已经有一颗脉动点，紧挨着的图标再挂一颗就是同一件事说两遍。 */}
            <span className={`tc-head-icon${mode === 'ai' ? ' ai' : ''}`}>
              {mode === 'ai' ? <Sparkles size={22} /> : <Waypoints size={22} />}
            </span>
            <div className="tc-head-copy">
              <div className="tc-head-title">
                {/* 标题：AI 模式叫「发起校园事务申请」，手动模式仍是「…办事流程」（用户 2026-09-15 文案表） */}
                <h2>{mode === 'ai' ? '发起校园事务申请' : '发起校园事务办事流程'}</h2>
                {/* ⚠️ 页头这里**不再挂「N 个智能体协同中」胶囊**（2026-09-15 用户要求）：
                    标题旁、分析中枢、协作管线三处都在说智能体状态，重复三遍。
                    智能体数量只保留在协作管线那一处（点开可看是谁）。 */}
              </div>
              {/* 副标题随模式走（对齐设计稿两版的各自文案）：
                  2026-09-15 用户第 5 条要求「减少标题区的横向噪音」—— 智能协作那版原来写
                  「基于意图推理与智能体端到端拟合 · 自动装配材料与审批链路」，是一句堆术语的长句，
                  收成一句人话（手动的副标题本轮同样已缩）。 */}
              <p>
                {mode === 'ai'
                  ? '描述你要办的事，智能匹配办事模板与材料清单'
                  : '按学校规范提交校园事务申请，并上传相关材料'}
              </p>            </div>
          </div>
          {/* 模式切换：**悬停/点击弹出的菜单**（2026-09-14 用户要求）。
              原先是常驻的双段控件（左右各半宽），占掉页头右侧近 300px，而「换一种发起方式」
              是次要操作。收起后只剩「当前模式 + 推荐角标 + ▾」，两个模式的说明回到菜单里。
              悬停开是为了快，点击/聚焦开是为了键盘与触摸屏；鼠标移出整块（含菜单）自动收。 */}
          <div className="tc-head-side">
            <div
              className={`tc-mode${modeOpen ? ' open' : ''}`}
              onMouseEnter={() => setModeOpen(true)}
              onMouseLeave={() => setModeOpen(false)}
            >
              <button
                type="button"
                className="tc-mode-trigger"
                aria-haspopup="true"
                aria-expanded={modeOpen}
                onClick={() => setModeOpen(true)}
                onFocus={() => setModeOpen(true)}
              >
                <span className={`tc-mode-icon ${mode === 'ai' ? 'ink' : 'muted'}`}>
                  {mode === 'ai' ? <Sparkles size={13} /> : <ClipboardList size={13} />}
                </span>
                <span className="tc-mode-text">{mode === 'ai' ? '智能协作' : '手动申报'}</span>
                {/* 「推荐」角标：当前就是智能体协同时挂在触发器上（就是它被推荐的证据），
                    菜单里那一项也恒挂 —— 收进菜单不等于把这个引导弄丢。 */}
                {mode === 'ai' && <em className="tc-mode-badge">推荐</em>}
                <ChevronDown size={13} className="tc-mode-caret" aria-hidden="true" />
              </button>
              {modeOpen && (
                <div className="tc-mode-menu">
                  <button
                    type="button"
                    className={`tc-mode-tab${mode === 'ai' ? ' active' : ''}`}
                    onClick={() => { setMode('ai'); setModeOpen(false) }}
                  >
                    <span className="tc-mode-icon ink"><Sparkles size={13} /></span>
                    <span className="tc-mode-copy">
                      <span className="tc-mode-name">智能协作<em className="tc-mode-badge">推荐</em></span>
                      <small>意图解析 · 自动比对装配</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`tc-mode-tab${mode === 'manual' ? ' active' : ''}`}
                    onClick={() => { setMode('manual'); setModeOpen(false) }}
                  >
                    <span className="tc-mode-icon muted"><ClipboardList size={13} /></span>
                    <span className="tc-mode-copy">
                      <span className="tc-mode-name">手动申报</span>
                      <small>标准表单 · 手动填写</small>
                    </span>
                  </button>
                </div>
              )}
            </div>
            <button type="button" className="tc-close" onClick={onClose} aria-label="关闭 (Esc)" title="关闭 (Esc)"><X size={18} /></button>
          </div>
        </header>

        <div className="tc-body" ref={bodyRef}>
          {mode === 'ai' ? (
            <div className="tc-view">
              {/* 分析中枢（对齐 v15 设计稿的 AgentAnalysisHub）：
                  状态行（中枢胶囊 + 装配结果）+ 会话工具 + 协作管线 + 原始问题回溯。
                  2026-09-15 用户要求「顶部协作区再压缩」：标题旁那枚「N 个智能体协同中」胶囊
                  已删（三处说同一件事），智能体状态**只保留在协作管线这一处**。 */}
              <section className={`tc-strip${detailsOpen ? ' compact' : ''}`}>
                <div className="tc-strip-head">
                  <div className="tc-hub-status">
                    {/* 文案「AI 协同分析中枢」→「智能办理助手」（用户文案表） */}
                    <span className="tc-hub-pill"><i className="tc-ping" />智能办理助手</span>
                    <span className="tc-hub-sep" aria-hidden="true">|</span>
                    <span className="tc-hub-meta">
                      {/* 状态行只说「当前这一步在做什么」，与底部旁注同一套三态口径：
                          没填名称 = 已就绪 / 匹配中 = 正在匹配 / 有结果 = 装配了什么。
                          智能体数量归下面的协作管线（同一句话说两遍＝用户点名的「信息重复」）。
                          ⚠️ 匹配中的判断用 `anyMatching`（**两个接口任一在途都算**）：
                          规章匹配与模板匹配是同一次回车触发的两条链路，只认 `matchState` 的话，
                          模板先回来就会写成「已装配 N 项材料」而依据还在转圈 —— 状态行说早了。 */}
                      {anyMatching
                        ? '正在匹配办事模板与办理依据…'
                        : assembly || (effectiveTitle ? '等待匹配（按回车或点「匹配事项」）' : '已就绪，等待你填写事项')}
                    </span>
                  </div>
                  <div className="tc-strip-tools">
                    {/* 会话选择器（对齐 v15 设计稿）：紧凑一行高 + `appearance:none` + 自绘箭头。
                        原来是 38px 的原生 select，比旁边的图标按钮高一截、箭头也是系统样式，
                        整行看着不像一套控件；文案也按设计稿改成「联动最新会话：<标题>」。
                        ⚠️ 类名保留 `tc-select`（工装 `verify-optional-conversation.mjs` 按它取会话下拉），
                        尺寸与外观由 `.tc-select-mini` 覆盖。 */}
                    <span className="tc-select-wrap">
                      <select
                        className="tc-select tc-select-mini"
                        value={conversationId}
                        onChange={(event) => setConversationId(event.target.value)}
                        aria-label="选择近期会话（可选）"
                      >
                        <option value="">
                          {conversations.length ? '不关联会话（自行填写事项名称）' : '暂无可关联的会话'}
                        </option>
                        {conversations.map((item) => (
                          <option key={item.id} value={item.id}>
                            🔗 联动最新会话：{item.title}{relative(item.updated_at) ? `（${relative(item.updated_at)}）` : ''}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={13} className="tc-select-arrow" aria-hidden="true" />
                    </span>
                    {/* 刷新收成图标按钮（对齐设计稿）：它只对「已选会话」有意义，
                        文字版「刷新提取」占掉半行宽度，信息量却是零。 */}
                    <button
                      type="button"
                      className="tc-icon-btn"
                      aria-label="重新提取"
                      title="从所选会话重新提取原始提问"
                      disabled={!conversationId || messagesLoading}
                      onClick={() => setReloadKey((value) => value + 1)}
                    >
                      <RefreshCw size={14} className={messagesLoading ? 'tc-spin' : ''} />
                    </button>
                  </div>
                </div>

                {/* 会话工具的说明（2026-09-15 用户第 5 条：**详细解释放到会话选择框附近**）：
                    底部只留一行当前操作提示，这里承担「关联会话有什么用 / 不关联会怎样」的解释。 */}
                <em className="tc-field-hint">
                  {selected
                    ? `已关联「${selected.title}」：将用它的问答上下文辅助匹配事项，并在下方回溯原始提问。`
                    : '关联会话是可选的：选中一条历史会话，会用其中的问答上下文辅助匹配事项；不关联则直接按你填写的事务名称办理。'}
                </em>

                {/* 09-23：「协作管线」整块（在线智能体数 + 逐枚 Agent 芯片 + 展开列表）已删。
                    它读的是 /agents 下发的多智能体清单；全站只剩一个主智能体，没有管线可排。 */}
                {/* 原始问题回溯：**只在真的关联了会话时才渲染**（2026-09-14 用户要求）。
                    不关联会话时这一格整块不显示 —— 那时它只会写着「未关联会话；选择一条历史会话即可回溯…」，
                    而这句话做的事（说明怎么用）已经由下拉的默认项「不关联会话（自行填写事项名称）」承担了。 */}
                {conversationId && (
                  <p className="tc-recall">
                    <span>原始问题回溯：</span>
                    {messagesLoading
                      ? '正在读取会话消息…'
                      : question
                        ? `“${question}”`
                        : '所选会话中没有可回溯的提问记录。'}
                  </p>
                )}
              </section>

              {/* 起点：**整条流程的第一个输入**，视觉上要看得出来是起点（用户要求）。
                  所以给它更高的框（46px）、更大的字（14px/600）、白底 + 略深的描边，
                  并把示例写进 placeholder —— 后面三块都只是「按它生成的结果」。 */}
              <label className="tc-field tc-lead">
                <span className="tc-label">
                  {/* 文案「拟发起事项名称」→「你要办理什么事务？」（用户文案表） */}
                  <span>你要办理什么事务？ <b>*</b></span>
                  {/* ⚠️ 这里原有的那枚绿色「已匹配标准办事模板 · 置信度 N%」**已删**（用户反馈 3/4）：
                      它是四处「成功」信号里最响的一处，而「匹配到哪个事项、谁受理」要等结果栏才看清。
                      唯一的结果位是下面的 `.tc-matchbar`。 */}
                </span>
                {/* 输入框 + **显式「匹配事项」按钮**（2026-09-15 用户要求）：
                    以前只有「按回车匹配」这句说明，入口太隐蔽 —— 现在右侧给一枚明确的按钮，
                    回车仍然可用（两条入口打同一个 `runMatch`）。 */}
                {/* ⚠️ 这里**不再挂绿色勾/转圈**（用户反馈 4 的收敛）：输入框右侧那枚绿勾是第 4 处
                    「成功」信号，而它表达的「框里有字」并不是匹配结果 —— 匹配状态由下方结果栏统一承担。 */}
                <span className="tc-input-row">
                  <span className="tc-input-wrap lead">
                    {/* 输入框内左侧的文档图标：提示这里填的是「一份要办的事」。 */}
                    <FileText size={16} className="tc-input-lead" aria-hidden="true" />
                    <input
                      value={title}
                      onChange={(event) => changeTitle(event.target.value)}
                      onFocus={focusTitle}
                      onKeyDown={titleKeyDown}
                      onBlur={() => setSuggestOpen(false)}
                      placeholder="如：申请国家奖学金、办理休学证明"
                      role="combobox"
                      aria-expanded={suggestOpen && visibleSuggestions.length > 0}
                      aria-autocomplete="list"
                    />
                    {/* 右侧状态位：**只剩「匹配中」的转圈**。
                        ⚠️ 那枚「框里有字就打卡」的绿勾已删（用户反馈 4）：它曾与
                        绿色匹配标签 /「已生成下列预览」/ 底部「已采用」一起构成四处成功信号，
                        且它表达的其实是「输入框非空」，与匹配结果无关。匹配状态统一由下方结果栏承担。 */}
                    {anyMatching && (
                      <Loader2 size={15} className="tc-input-ok loading" aria-label="正在匹配办事模板" />
                    )}
                    {/* 候选块是浮层，锚在 `.tc-input-wrap` 上（它是 relative）。
                        因为是 absolute、不占文档流高度，绿勾的 50% 居中仍以输入框高度为准，不会跑偏。 */}
                    {renderSuggest()}
                  </span>
                  <button
                    type="button"
                    className="tc-match-btn"
                    /* 加载中的禁用看**两个状态**：模板匹配（`matchState`）与规章匹配（`docState`）
                       是同一次触发的两个接口，只要还有一个在途就不该重复发起 ——
                       否则连点两次会各打 4 个请求（用户看到的是转圈闪两轮）。 */
                    disabled={!titleInput.trim() || anyMatching}
                    onClick={() => runMatch(titleInput)}
                  >
                    {anyMatching ? <Loader2 size={14} className="tc-spin" /> : <Search size={14} />}
                    匹配事项
                  </button>
                </span>
                {/* 状态 / 原因由 `renderMatchHint` 说；这里只留**一句**说明（原来除了回车提示，
                    下面还各写一遍三块面板的引导，用户要求合并成一句）。
                    ⚠️ 初始那句「匹配后展示办理依据、所需材料与审批流程」在采用 / 有结果后**撤掉**
                    （用户反馈 4：把空间留给真正需要确认的内容）—— 那时结果栏已经把这三项摊开了。 */}
                {renderMatchHint()}
                {showInitialHint && <em className="tc-field-hint">匹配后展示办理依据、所需材料与审批流程。</em>}
              </label>

              {/* ===== 匹配结果栏（2026-09-15 用户反馈 3）=====
                  用户要求改「**一条明确的结果栏**」：已匹配：<事项名> / <受理单位> / 更换事项。
                  原来表达「成功」的有四处（输入框旁的绿色标签 / 输入框绿勾 /「已生成下列预览」/ 底部「已采用」），
                  现在**只留这一条**——它是全屏唯一的结果位，置信度百分比彻底不渲染。
                  ⚠️ 必须在 `.tc-lead` **之后**（页面上是输入框的下一条 / DOM 里是它的兄弟节点）：
                  早先放在 `.tc-lead` 内部、又落在 `.tc-todo` 之后时，出现过它被 `.tc-todo` 的
                  `margin-top` 叠到输入框上方一排的错位（截图验证过）。 */}
              {(detailsOpen || awaitingPick || matchState === 'empty' || matchState === 'error') && (
                <div className="tc-matchbar">
                  {detailsOpen ? (
                    <>
                      <BadgeCheck size={15} aria-hidden="true" />
                      <span className="tc-match-facts">
                        <span className="tc-match-label">已匹配：</span>
                        <span className="tc-match-name">{(detailMatch ?? matchResult)?.template_name || pickedTemplate?.name || effectiveTitle}</span>
                        {/* 受理单位：清单接口的责任机构 → 匹配响应的组织提示，都没有就不写 */}
                        {matchOrganization && (
                          <span className="tc-match-org"><Building2 size={12} aria-hidden="true" />{matchOrganization}受理</span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          /* 「更换事项」= 回到本次输入重新匹配一次（与「匹配事项」同一个 `runMatch`），
                             而不是清空重来 —— 用户想换的是**匹配结果**，不是已填的事项名称。 */
                          runMatch(titleInput)
                        }}
                      >
                        更换事项
                      </button>
                    </>
                  ) : (
                    <>
                      <Search size={15} aria-hidden="true" />
                      <span className="tc-match-facts">
                        <span className="tc-match-label">
                          {awaitingPick ? '已匹配到候选模板，点选上方一项以采用：' : '未匹配到办事模板'}
                        </span>
                      </span>
                      {awaitingPick
                        ? null
                        : <button type="button" onClick={() => runMatch(titleInput)}>重新匹配</button>}
                    </>
                  )}
                </div>
              )}

              {/* ===== 「发起后需完成」条（2026-09-15 用户反馈 1）=====
                  用户指出的是**指引冲突**：待补项写「请说明补办原因」「请上传近期证件照」，
                  下面却没有任何输入框 / 上传按钮；而材料说明又写「提交后在任务详情上传」。
                  两种指引同时出现，用户不知道现在该干什么。取舍：
                   · **文字类补充**（请说明…原因 / 请确认…）→ 就在这里给输入框，随建单提交进 `reason`。
                     它不阻塞发起，任务详情里仍有编辑入口（「可以发起后继续补充」）。
                   · **材料类补充**（请上传近期证件照…）→ 归材料侧，只写「发起后需完成」，
                     发起前**一个上传口都不开**（附件只有建单之后才能挂到材料项上）。
                  ⚠️ 这里**不再是黄色的 `tc-asks` 清单**，而是「有入口的待办」。 */}
              {mode === 'ai' && adopted && (todoAsks.length > 0 || materialAsks.length > 0) && (
                <div className="tc-todo">
                  <b className="tc-todo-head">
                    <CircleAlert size={13} aria-hidden="true" />
                    还需要你补充确认
                    <em>材料在发起后上传，补充说明现在填也可以</em>
                  </b>
                  {todoAsks.map((ask, index) => (
                    <label key={ask}>
                      <b>{clarifyLabel(ask)}</b>
                      {index === 0 ? (
                        <input
                          value={clarifyText}
                          onChange={(event) => setClarifyText(event.target.value)}
                          placeholder="在此填写，可留到发起后补充"
                        />
                      ) : (
                        /* 追问项多于一条时只给第一项配输入框：接口给的是一组问句，
                           一一对应成多个字段超出任务模型（tasks 只有一个事由字段），
                           剩下的如实列出来，发起后在任务详情里一并补充。 */
                        <span className="tc-todo-upload"><FileText size={13} aria-hidden="true" />在任务详情中补充说明</span>
                      )}
                    </label>
                  ))}
                  {materialAsks.length > 0 && (
                    /* 材料侧统一口径「发起后需完成」：与「所需材料」里每行的时机说明一致，
                       不再出现「请上传」这种发起前做不到的指令。 */
                    <>
                      {todoAsks.length === 0 && <label><b>以下材料发起后需完成</b></label>}
                      <span className="tc-todo-upload">
                        <Upload size={13} aria-hidden="true" />
                        <b>{materialAsks.length} 项材料需上传</b>
                        <span>发起后在任务详情逐项上传</span>
                      </span>
                      <ul>
                        {materialAsks.map((ask) => <li key={ask}>{ask}<em> · 发起后需完成</em></li>)}
                      </ul>
                    </>
                  )}
                </div>
              )}

              {/* ===== 智能预填结果 =====
                  2026-09-15 用户要求（第 4 条）：**三个空态合并成一个紧凑预览区** ——
                  原来每项只有一句话却各占一条通宽区域，又空又散。现在：
                  没明细时只渲染一块浅底总览（`.tc-preview` 列三个条目），
                  匹配成功后**才**展开成下面三块真实明细（沿用普通分组 + 分割线，不套新大卡片）。
                  ⚠️ 措辞纪律（用户本次特别点出）：「预览 / 待提交后生成」必须分清 ——
                  提交前能拿到的写「预览」，提交后才确定的必须写明生成时机，不承诺做不到的事。 */}
              <div className="tc-results" ref={resultsRef}>
                {/* 结果标题（用户反馈 4 的滚动目标）：匹配采用后它是**成功信号的最后一处**，
                    所以措辞去掉「已按 X 生成」这种完成式 —— 上面那条结果栏已经把
                    「匹配到哪个事项、谁受理」说全了，这里只负责说明「下面是预览」。 */}
                <p className="tc-results-cap">
                  <Sparkles size={13} aria-hidden="true" />
                  {detailsOpen
                    ? '以下为发起前的预览，提交后以受理机构的实际要求为准'
                    : awaitingPick
                      ? '必须点选上方一项，明细才会展开'
                      : anyMatching
                        ? '正在匹配，稍后展示预览'
                        : '预览 · 匹配事项后展示办理依据、所需材料与审批流程'}
                </p>

                {!detailsOpen && (
                  /* 空态总览：一块浅底区域列三项（办理依据 / 所需材料 / 预计办理流程），
                     点选候选或匹配命中后由下面三块明细接管。
                     ⚠️ 这里的「正在匹配」**只看 `anyMatching`**，不写 `docState === 'loading'`：
                     匹配在途时 `docState` 就是 loading → 上面 `detailsOpen`（含 `docState !== 'idle'`）
                     已经成立、这一块**根本不会渲染**，那个判断是死代码（tsc 的 TS2367 直接点出来了）。 */
                  <div className="tc-preview">
                    <div className="tc-preview-item">
                      <span className="tc-preview-ico"><FileText size={14} aria-hidden="true" /></span>
                      <div>
                        <b>办理依据</b>
                        <small>{anyMatching ? '正在匹配校内规章与办事依据…' : '匹配后展示适用的校内规章与办事依据'}</small>
                      </div>
                    </div>
                    <div className="tc-preview-item">
                      <span className="tc-preview-ico"><PackageOpen size={14} aria-hidden="true" /></span>
                      <div>
                        <b>所需材料</b>
                        <small>匹配后列出待提交的材料项与格式要求</small>
                      </div>
                    </div>
                    <div className="tc-preview-item">
                      <span className="tc-preview-ico"><Route size={14} aria-hidden="true" /></span>
                      <div>
                        <b>预计办理流程</b>
                        <small>匹配后展示审批节点与流转顺序</small>
                      </div>
                    </div>
                  </div>
                )}

                {awaitingPick && (
                  /* 这段与结果栏说的是同一件事（「要去点选候选」），所以**只在空态预览块存在时保留**，
                     且措辞中性 —— 用户反馈 4 要求把四处「成功/已完成」收敛成一处结果栏。 */
                  <p className="tc-preview-line">
                    <PackageOpen size={14} aria-hidden="true" />
                    点选上方任一项后，这里会替换成它的材料清单与审批节点。
                  </p>
                )}

                {/* 三块明细（办理依据 / 所需材料 / 预计办理流程）—— 实现已抽成 `renderDetailGroups()`，
                    两种模式共用同一份；这里只在 AI 模式已采用 / 手动模式已命中时渲染。 */}
                {detailsOpen && renderDetailGroups()}
              </div>
            </div>
          ) : (
            <div className="tc-view">
              {/* 手动申报整表抬到一块白色承载板上（用户要求「前景分层」）：
                  弹窗外壳浅灰 → 白板（内容层） → 实白底栏（操作层），边界分明。
                  只作用于手动模式；智能协作维持玻璃底的既有设计，不加板。 */}
              <div className="tc-sheet">
              {/* 模式说明：不再是一张浅灰卡（用户要求减少容器），只是一行带图标的说明。
                  切换入口已经挪到页头右上角，这里只回答「这个模式要做什么」。 */}
              <p className="tc-intro">
                <span className="tc-intro-icon"><FileText size={15} /></span>
                <span>
                  <b>手动申报</b>
                  先选定要办理的事务，再按该事务的材料清单提交申报事由与证明材料
                </span>
              </p>

              {/* ① 选择申报事项与业务归口 —— 事务是手动申报的**唯一入口**（见下方 select 注释） */}
              <section className="tc-section">
                <header className="tc-section-head">
                  <h3><i className="tc-section-no">1</i>选择申报事项与业务归口</h3>
                  {/* 步骤完成状态**紧跟标题同一行**（用户要求：数字圆点、标题、完成状态一行排布），
                      只由真实表单状态推导 —— 事务与业务大类都选定才算这步完成，没完成就不渲染。 */}
                  {!!pickedTemplate && !!categoryId && !anyMatching && (
                    <em className="tc-section-done"><CheckCircle2 size={12} />已完成</em>
                  )}
                  {/* 手动模式的「正在匹配」指示：这一步有下拉、也可能什么都不显示就一直在匹配，
                      所以**匹配优先于「已完成」**（两个都占这一行，同时显示会挤成一行看不清）。 */}
                  {anyMatching && (
                    <em className="tc-section-busy">
                      <Loader2 size={12} className="tc-spin" />
                      正在匹配办理依据与材料…
                    </em>
                  )}
                  {/* 右侧元信息位：只有真的选定事务后才有编号可显示（= 后端下发的 template_key），
                      未选定时留空，不摆一个占位的假编号。 */}
                  {pickedTemplate?.template_key && (
                    <span className="tc-section-code">模板编号：{pickedTemplate.template_key}</span>
                  )}
                </header>

                {/* 要办理的事务 —— 手动申报的**唯一入口**，也是整条流程的第一个动作，
                    所以这格 select 比别处更高更亮（46px 白底描边，同 AI 模式的起点输入框）。
                    用户要求「只能处理模板里的事务」：事务必须从学校已配置的办事模板里选；
                    标题、材料清单、审批节点全部由它派生。 */}
                <label className="tc-field">
                  <span className="tc-label">
                    <span>要办理的事务 <b>*</b></span>
                    <em className="plain">只能从学校已配置的办事模板中选择</em>
                  </span>
                  <span className="tc-select-wrap fluid">
                    <select
                      className="tc-select wide tc-select-template lead"
                      value={templateKey}
                      disabled={settled !== null}
                      onChange={(event) => selectTemplate(event.target.value)}
                      onFocus={() => ensureTemplates()}
                    >
                      {/* 占位文案写**动作**而不是示例清单（用户要求：别让人以为已经选了内容） */}
                      <option value="">{usableTemplates.length ? '请选择要办理的事务' : '暂无可选事务（事务清单为空）'}</option>
                      {usableTemplates.map((item) => (
                        <option key={item.template_key} value={item.template_key}>{item.name}</option>
                      ))}
                    </select>
                    <ChevronDown size={15} className="tc-select-arrow" aria-hidden="true" />
                  </span>
                  {templatesState === 'loading' && <em className="tc-field-hint">正在读取可办事务…</em>}
                  {templatesState === 'error' && <em className="tc-field-hint warn">
                    可办事务没取到（接口报错或网络异常）。手动申报必须选定一个事务，请重试；或改用智能协作。
                    <button type="button" onClick={() => ensureTemplates(true)}>重试</button>
                  </em>}
                  {templatesState === 'ready' && usableTemplates.length === 0 && <em className="tc-field-hint warn">
                    后端没有返回可用事务（模板缺失或 template_key 为空），暂时无法手动申报；可改用智能协作。
                    <button type="button" onClick={() => ensureTemplates(true)}>重试</button>
                  </em>}
                  {templatesState === 'ready' && usableTemplates.length > 0 && templates.length > usableTemplates.length && (
                    <em className="tc-field-hint">有 {templates.length - usableTemplates.length} 个模板缺少 template_key，无法作为事务选择（后端数据问题）</em>
                  )}
                </label>

                {/* 事务摘要：事务是这个模式的骨架，选定后必须立刻给出可见的后果，
                    否则「决定材料清单与审批节点」就只是一句没有兑现的提示语。 */}
                {pickedTemplate && (
                  <div className="tc-template-summary">
                    <BadgeCheck size={15} />
                    <div>
                      <b>已选定事务：{pickedTemplate.name}</b>
                      <span>{templateSummary || pickedTemplate.description || '事务已选定'}</span>
                    </div>
                    {/* 手动模式的匹配入口（2026-09-15 与 AI 模式口径统一）：
                        事务是下拉选的、**没有输入框可回车**，所以给一枚等价按钮 ——
                        点它就把这个事务的办理依据与材料/节点各打一遍（见 `runManualMatch`，
                        两个接口与 AI 模式那一对不同，因为这里手里有确定的 `template_key`）。
                        放在摘要卡里（而不是塞到某个面板里），是因为它是「对这个事务做一次智能解析」的入口，
                        跟着事务走最自然。 */}
                    <button
                      type="button"
                      className="tc-match-btn compact"
                      disabled={!effectiveTitle || manualMatchState === 'loading' || settled !== null}
                      onClick={() => runManualMatch(pickedTemplate)}
                    >
                      {manualMatchState === 'loading' ? <Loader2 size={13} className="tc-spin" /> : <Search size={13} />}
                      {manualMatchState === 'loading' ? '正在匹配…' : '匹配办理依据与材料'}
                    </button>
                  </div>
                )}

                {/* 业务大类：单独一行（用户要求去掉横向并排 —— 视线不用左右跳，窄屏也天然适配） */}
                <label className="tc-field">
                  <span className="tc-label"><span>所属业务大类 <b>*</b></span></span>
                  <select className="tc-select wide tc-select-category" value={categoryId} disabled={settled !== null} onChange={(event) => setCategoryId(event.target.value)}>
                    <option value="">{categories.length ? '选择业务大类' : '分类暂不可用'}</option>
                    {/* 只显示分类名：原型里没有这个括号，而 document_count 是知识库的「依据篇数」，
                        跟办事申报没有关系，反而像在暗示「选依据多的那一类」。 */}
                    {categories.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>

                {/* 系统生成的两段信息**合并成一行辅助条**（用户要求：事项申报标题 + 申请人信息
                    各占一整行太浪费，都是自动生成内容）。浅灰底 + 中灰文字 ——
                    读起来是「系统带出的资料」，不是「禁用/待填的输入框」。
                    只放真有的字段：标题 = 所选事务名；申请人 = 登录会话的姓名/账号/部门/角色
                    （学号、班级、手机号接口里没有，照旧不写）。 */}
                <div className="tc-meta-line" aria-label="系统生成的申报信息（事项标题与申请人）">
                  <span className={`tc-meta-item${pickedTemplate ? '' : ' is-empty'}`}>
                    <i>事项标题</i>
                    <b className="tc-meta-title">{pickedTemplate?.name ?? '选定事务后自动填入'}</b>
                  </span>
                  {user && (
                    <>
                      <span className="tc-meta-sep" aria-hidden="true" />
                      <span className="tc-meta-item">
                        <i>申请人</i>
                        <b>{user.name}</b>
                        <small>（{user.account}）</small>
                        {user.department && <small>· {user.department}</small>}
                        {roleLabel && <em className="tc-meta-role">{roleLabel}</em>}
                      </span>
                    </>
                  )}
                </div>
              </section>

              {/* ② 申请事由与详细说明 */}
              <section className="tc-section">
                <header className="tc-section-head">
                  <h3><i className="tc-section-no">2</i>申请事由与详细说明</h3>
                  {/* 完成状态紧跟标题；字数计量留在行尾最右（原先挤在字段标签右边，
                      和「必填 *」抢同一行的注意力）。 */}
                  {reason.trim().length > 0 && (
                    <em className="tc-section-done"><CheckCircle2 size={12} />已完成</em>
                  )}
                  <span className="tc-section-count">已录入 {reason.length} / 500 字</span>
                </header>
                <label className="tc-field">
                  <span className="tc-label"><span>申报事由与情况说明 <b>*</b></span></span>
                  <textarea
                    className="tc-reason"
                    value={reason}
                    maxLength={500}
                    disabled={settled !== null}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="请清晰陈述申报背景、符合何项文件的申请条件、以及需要学校协助的事项…"
                  />
                </label>
              </section>

              {/* ③ 证明材料清单与附件上传 */}
              <section className="tc-section">
                <header className="tc-section-head">
                  <h3><i className="tc-section-no">3</i>证明材料清单与附件上传</h3>
                  {/* 已加文件数紧跟标题；格式与大小上限下沉进上传区的次级文案（用户要求），
                      标题行不再重复一遍。 */}
                  {files.length > 0 && (
                    <em className="tc-section-done"><CheckCircle2 size={12} />已添加 {files.length} 个文件</em>
                  )}
                </header>
                <div className="tc-field">
                  {files.length > 0 && (
                    <ul className="tc-files">
                      {files.map((item, index) => (
                        <li key={`${item.file.name}-${index}`} className={item.status}>
                          {/* 文件图标做成 28px 方角片（对齐设计稿每行左侧的那枚图标），
                              不再是裸图标 —— 裸图标在「净白行」里读不出是同一类文件。 */}
                          <span className="tc-file-icon"><FileText size={15} /></span>
                          <span className="tc-file-name">{item.file.name}</span>
                          <small>{sizeText(item.file.size)}</small>
                          {/* 逐项状态：原型里每行都有「已就绪」，之前实现把这列丢了，
                              多文件串行上传时用户看不出哪一项没上去。 */}
                          <em className="tc-file-state">
                            {item.status === 'uploading' && <Loader2 size={12} className="tc-spin" />}
                            {item.status === 'linked' && <CheckCircle2 size={12} />}
                            {(item.status === 'unlinked' || item.status === 'failed') && <CircleAlert size={12} />}
                            {ATTACHMENT_TEXT[item.status]}
                          </em>
                          {settled === null && (
                            <button type="button" className="tc-file-remove" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>
                              <Trash2 size={13} />删除
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {settled === null && (
                    <>
                      <div
                        className="tc-dropzone"
                        onClick={() => fileRef.current?.click()}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files) }}
                      >
                        {/* 压成一行高的紧凑操作条（用户要求：高度约旧版六成，别抢申报事由的戏），
                            文案两级：主句是动作，次句交代格式与大小上限。 */}
                        <span className="tc-dropzone-icon"><Upload size={16} /></span>
                        <span className="tc-dropzone-text">
                          <b>点击上传或拖拽文件</b>
                          <small>支持 Word / Excel / PDF / JPG / ZIP，单个不超过 {MAX_FILE_MB}MB</small>
                        </span>
                      </div>
                      <input ref={fileRef} className="tc-file-input" type="file" multiple onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />
                    </>
                  )}
                  <em className="tc-field-hint">
                    {pickedTemplate
                      ? `按「${pickedTemplate.name}」的要求准备材料；条目明细在任务创建后下发，可在任务详情里逐项上传与核验。`
                      : '材料清单由所选事务决定，请先在上面选定要办理的事务。'}
                  </em>
                </div>
              </section>

              {/* ④ 智能匹配结果（2026-09-15 新增，与 AI 模式的明细区同构）——
                  手动申报从「只能自己看学校的事务清单」升级成「选完事务也能让后端解析一遍」：
                  上面那张摘要卡的「匹配办理依据与材料」按钮把它打出来，结果就落在这里。
                  ⚠️ **必须放进手动模式这半边**：早先三块明细只写在 `mode === 'ai'` 分支里，
                  所以手动模式点了按钮会看到「接口都发出去了、页面上什么都没有」。
                  展示的内容与 AI 模式完全一致（同一份 `renderDetailGroups()`），只是这里**总是渲染**
                  一个外壳：没匹配过时它是空态总览，匹配过之后被三块明细接管。 */}
              <section className="tc-section">
                <header className="tc-section-head">
                  <h3><i className="tc-section-no">4</i>办理依据与流程预览</h3>
                  {/* 右侧只报真实口径：命中的材料项数 / 审批节点数（都来自本次匹配）。
                      没匹配过就留空，不摆一个 0。 */}
                  {!!detailMatch && (
                    <span className="tc-section-code">
                      {[
                        matchedRequirements.length ? `${matchedRequirements.length} 项材料` : '',
                        matchedSteps.length ? `${matchedSteps.length} 个节点` : '',
                      ].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </header>
                {detailsOpen ? (
                  <>
                    {renderDetailGroups()}
                    {/* 手动模式那句「这一份是怎么来的」——降级说明 / 缺字段提示都落这里。
                        只报后端真给了的事实：走了降级就说降级，缺字段就说缺字段，不编。 */}
                    {manualMatchNote && <em className="tc-field-hint">{manualMatchNote}</em>}
                  </>
                ) : (
                  /* 空态：与 AI 模式的 `.tc-preview` 同构，只是三条都明确指向那个按钮。
                     措辞不承诺做不到的事 —— 材料条目本来就要建单后才下发（见上面那句 hint）。 */
                  <div className="tc-preview">
                    <div className="tc-preview-item">
                      <span className="tc-preview-ico"><FileText size={14} aria-hidden="true" /></span>
                      <div>
                        <b>办理依据</b>
                        <small>{anyMatching ? '正在匹配校内规章与办事依据…' : '点「匹配办理依据与材料」后展示适用的校内规章'}</small>
                      </div>
                    </div>
                    <div className="tc-preview-item">
                      <span className="tc-preview-ico"><PackageOpen size={14} aria-hidden="true" /></span>
                      <div>
                        <b>所需材料</b>
                        <small>匹配后列出该事务的材料项与格式要求</small>
                      </div>
                    </div>
                    <div className="tc-preview-item">
                      <span className="tc-preview-ico"><Route size={14} aria-hidden="true" /></span>
                      <div>
                        <b>预计办理流程</b>
                        <small>匹配后展示审批节点与流转顺序</small>
                      </div>
                    </div>
                  </div>
                )}
              </section>
              </div>
            </div>
          )}

          {settled && (
            <p className="tc-settled">
              <CircleAlert size={15} />
              <span>
                任务已建为草稿，但 {settled.notes.filter((note) => !note.includes('事由')).join(' · ') || '部分附件未挂上'}。
                材料项齐备前不会自动提交；可以先留作草稿，或仍然提交由受理机构初核。
              </span>
            </p>
          )}
          {error && <p className="tc-error"><CircleAlert size={14} />{error}</p>}
        </div>

        <footer className="tc-foot">
          <div className="tc-foot-actions">
            {/* 校验提示**紧贴提交按钮**（用户要求二改）：夹在「存为草稿」与主按钮中间，
                还差哪一步一眼就落在提交键旁边，而不是远在左下角。
                2026-09-15 三改（用户第 5 条）：文案缩短成**一行当前操作提示**（详细解释已上移到
                会话选择框附近）；提示 `flex:1` 吃掉中间全部宽度、**文字左边缘与正文对齐**
                （`.tc-foot-actions` 整组铺满宽度 + 提示左起，见 tasks.css），
                不再折两行、也不再把按钮区挤在角落；图标跟着语义走（待办琥珀 / 完成绿勾），
                空表时不再先亮绿勾。 */}
            <p className={`tc-foot-note${footTone === 'warn' ? ' warn' : ''}`}>
              {footTone === 'busy'
                ? <Loader2 size={16} className="tc-spin" />
                : footTone === 'warn' ? <CircleAlert size={16} /> : <CheckCircle2 size={16} />}
              <span>{footNote}</span>
            </p>
            {settled ? (
              <button type="button" className="tc-ghost" disabled={busy} onClick={() => onCreated(settled.task, `草稿已保存 · ${settled.notes.join(' · ')}`)}>
                留作草稿，稍后补
              </button>
            ) : (
              /* 手动申报：事务没选就不造死草稿（草稿补不回来），按钮直接禁用、由旁边提示说原因 */
              <button type="button" className="tc-ghost" disabled={busy || (mode === 'manual' && !pickedTemplate)} onClick={() => void submit(true)}>存为草稿</button>
            )}
            {settled ? (
              <button type="button" className="tc-primary" disabled={busy} onClick={() => void submitSettled()}>
                仍然提交<ArrowRight size={15} />
              </button>
            ) : (
              <>
                {/* 主按钮只留动词（「确认发起并启动智能流转」太长），后半句降级成旁边的小字。 */}
                {mode === 'ai' && <span className="tc-primary-note">将启动智能流转</span>}
                {/* 手动申报：**没填完就禁用**（用户要求），缺什么由旁边提示说；AI 模式仍是点击时校验兜底。
                    未完成时按钮是「浅灰底 + 深灰字」，条件齐了变回深墨（见 tasks.css）。 */}
                <button type="button" className="tc-primary" disabled={busy || !!blocker} onClick={() => void submit(false)}>
                  {mode === 'ai' ? '确认发起' : '提交申报表单'}
                  <ArrowRight size={15} />
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
