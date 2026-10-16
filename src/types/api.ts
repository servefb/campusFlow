export type UserRole = 'student' | 'teacher' | 'admin'

export interface User {
  /** MySQL BIGINT identifiers are returned as JSON numbers by the API. */
  id: string | number
  account: string
  name: string
  role: UserRole
  department?: string
  avatar_url?: string | null
  /**
   * 由 GET /users/me 返回的权限标识，登录响应中不存在。
   * ⚠️ 前端鉴权一律走 `role`（ProtectedRoute）；本字段仅作接口契约保留，
   * 设置页已移除展示，管理员界面的权限渲染待单独设计后再取用。
   */
  permissions?: string[]
}

export interface ApiSuccess<T> {
  code: 0
  message: string
  data: T
  request_id: string
}

export interface ApiErrorDetail {
  field?: string
  reason: string
}

export interface ApiErrorBody {
  code: number
  message: string
  details?: ApiErrorDetail[]
  request_id?: string
  retry_after?: number
}

export interface LoginResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  user: User
}

export type TaskStatus = 'draft' | 'in_progress' | 'material_required' | 'under_review' | 'completed' | 'cancelled'

export interface TaskListItem {
  id: string | number
  task_no: string
  title: string
  status: TaskStatus
  current_step?: string | null
  current_step_order?: number | null
  /** 当前步骤实例的状态（task_step_instances.status），取值见 TaskStepStatus。 */
  current_step_status?: TaskStepStatus | null
  /** 任务步骤实例总数；后端不再返回 progress，进度由前端按 total_steps 推导（见 utils/taskProgress.ts）。 */
  total_steps?: number | null
  updated_at: string
  created_at?: string
  responsible_organization?: { id?: string | number; name?: string } | null
}

export interface TaskListData {
  items: TaskListItem[]
  page: number
  page_size: number
  total: number
  has_more: boolean
}

export interface TaskSummary {
  all: number
  draft?: number
  in_progress: number
  material_required: number
  under_review?: number
  completed: number
  cancelled?: number
}

export type TaskStepStatus = 'pending' | 'active' | 'completed' | 'rejected' | 'skipped'

export interface TaskStep {
  id: string | number
  step_order: number
  name: string
  status: TaskStepStatus
  organization?: { id?: string | number; name?: string } | null
  assignee?: { id?: string | number; name?: string } | null
  result?: Record<string, unknown>
  started_at?: string | null
  completed_at?: string | null
  due_at?: string | null
}

export interface TaskDetail {
  id: string | number
  template_key?: string | null
  title: string
  status: TaskStatus
  version: number
  current_step?: { key?: string; name: string; status: TaskStepStatus } | null
  steps: TaskStep[]
  form_data: Record<string, unknown>
  created_at: string
  updated_at: string
}

/** `POST /tasks` 的响应体。创建出来的任务初始状态是 `draft`，要提交需再调 `POST /tasks/{id}/submit`。 */
export interface TaskCreated {
  id: string | number
  title: string
  status: TaskStatus
  version: number
  current_step?: string | null
  created_at: string
}

export interface TaskRequirement {
  id: string | number
  name: string
  description?: string | null
  required: boolean
  allowed_types: string[]
  max_size_mb: number
  status: 'accepted' | 'passed' | 'missing' | 'rejected' | 'pending' | string
  material_id: string | number | null
}

/**
 * 可用办事模板。两个来源共用这一种结构：
 *  · **全量清单** `GET /v1/tasks/templates`（手动申报模式的模板下拉，契约见接口文档 A.5.13）
 *  · **按标题匹配** `POST /v2/tasks/templates/match`（事项名称输入的联想候选，请求体只有 `title`）
 * 选中后把 `template_key` 随建单一并提交，后端据此下发材料要求与审批步骤
 * （不选则只有标题，材料清单可能为空）。
 */
export interface TaskTemplate {
  id: string | number
  /** 对应 `task_templates.template_key`，建单时原样回传。 */
  template_key: string
  name: string
  description?: string | null
  responsible_organization_name?: string | null
  requirement_count?: number | null
  step_count?: number | null
}

/**
 * `POST /v2/tasks/templates/match` 的响应体（2026-09-14 按后端真实返回定型）。
 * ⚠️ 字段名叫 `items`，但里面装的是**单个匹配结果对象**，不是数组 —— 别按列表接口处理。
 * 命中时还会带回 `requirements` / `steps`（建单前的材料清单与审批节点）、
 * `missing_fields` / `clarifying_questions`（模板里还缺哪些字段、该问用户什么），
 * 这些正是 `GET /v1/tasks/templates` 不下发的部分。
 */
export interface TaskTemplateMatch {
  matched: boolean
  template_key?: string | null
  /**
   * 模板的**数字主键**（`task_templates.id`）。
   * 建单时随 `templateId` 一起提交 —— 后端落 `tasks.template_id` 不必再按 key 反查。
   */
  template_id?: number | null
  template_name?: string | null
  /** 0~1 的匹配置信度。 */
  confidence?: number | null
  /** 后端给的匹配类型（`exact` / `fuzzy` …）；未识别的枚举原样透传。 */
  match_type?: string | null
  /** 命中理由，一句话。 */
  reason?: string | null
  /** 从标题里抽出来的结构化信息。 */
  extracted?: {
    task_title?: string | null
    keywords?: string[] | null
    organization_hint?: string | null
    materials_mentioned?: string[] | null
    time_hint?: string | null
  } | null
  /** 模板要求但标题里没提到的字段 key（如 `reason` / `photo`）。 */
  missing_fields?: string[] | null
  /** 针对 `missing_fields` 的问句，可直接展示给用户。 */
  clarifying_questions?: string[] | null
  fallback_required?: boolean | null
  admin_refine_required?: boolean | null
  steps?: TaskTemplateMatchStep[] | null
  requirements?: TaskTemplateMatchRequirement[] | null
  /** 其它候选（含命中项），`confidence` 降序。 */
  candidates?: TaskTemplateMatchCandidate[] | null
}

export interface TaskTemplateMatchCandidate {
  template_key: string
  /** 模板数字主键（`task_templates.id`）；命中项与候选都带时，前端优选用它建单。 */
  template_id?: number | null
  template_name: string
  confidence?: number | null
  reason?: string | null
}

/**
 * `POST /v2/tasks/document/match` 的返回项（2026-09-15 接入）。
 *
 * 「办理依据」那一块的数据来源：AI 服务按事项名称匹配**校内规章 / 办事依据**。
 * ⚠️ 与模板匹配同款：字段名叫 `items`，装的却是**单个结果对象**（`{ items: TaskDocumentMatch }`），别按列表读。
 * ⚠️ 字段名已按 **2026-09-15 真实响应**核对（用户贴回的实际返回）：
 *    命中的规章在 `documents`（**数组**，可多份），得分叫 `relevance`、理由叫 `reason` ——
 *    全部下划线口径。别再按早期猜测的 `score` / `matched_reason` / 单文档平铺读。
 */
export interface TaskDocumentMatch {
  /** 是否匹配到规章。`false`（或整条缺失、`documents` 为空）时前端只说「暂未匹配到依据」。 */
  matched?: boolean | null
  /** AI 从事项名称里抽出的检索关键词（实测如 `["课程退补选","退补选申请","选课管理"]`）。 */
  query_keywords?: string[] | null
  /** 命中的规章 —— ⚠️ **数组**，可能不止一份；前端按序渲染，第一份是主依据。 */
  documents?: TaskDocumentMatchDocument[] | null
  /** AI 认为用户还缺的信息（实测如 `["学生培养层次（如本科生/研究生）", …]`）。暂不渲染，先收着。 */
  missing_fields?: string[] | null
  /** AI 的追问（实测如 `["你是本科生还是研究生？", …]`）。暂不渲染，先收着。 */
  clarifying_questions?: string[] | null
  /** 整体匹配说明（区别于每份文档自己的 `reason`）。 */
  reason?: string | null
}

/** `TaskDocumentMatch.documents[]` 的元素：一份命中的校内规章。 */
export interface TaskDocumentMatchDocument {
  /** 规章数字主键（`knowledge_documents.id`），点「查阅」时优先用它跳知识库详情。 */
  document_id?: number | string | null
  /** 文号，形如 `校教字〔2026〕15号`。 */
  document_no?: string | null
  title?: string | null
  /** 分类，实测如 `教务与培养管理`。 */
  category?: string | null
  /** 发文层级，实测值 `school`。 */
  issuer_level?: string | null
  /** 效力状态，实测值 `current`（现行有效）。 */
  validity?: string | null
  /** 相关度 0~1（0.96 → 前端渲染「匹配度 96%」）。 */
  relevance?: number | null
  /** 该份规章的命中理由，一句话。 */
  reason?: string | null
}

export interface TaskTemplateMatchStep {
  step_id?: string | number | null
  step_order?: number | null
  /** 办理机构 id（`organizations.id`）→ 落 `task_step_instances.organization_id`。 */
  organization_id?: string | number | null
  name: string
  /** 该节点是否需要用户本人操作（否则是机构内部流转）。 */
  requires_user_action?: boolean | null
}

export interface TaskTemplateMatchRequirement {
  requirement_key?: string | null
  name: string
  /** MIME 类型清单（`application/pdf` / `image/jpeg` …），可为空表示不限。 */
  allowed_content_types?: string[] | null
  /** 单个文件大小上限，**字节**（→ 材料要求的 `max_size_bytes`）。 */
  max_size_bytes?: number | null
  is_required?: boolean | null
}

export interface KnowledgeCategory {
  id: string | number
  name: string
  document_count: number
}

/** 文档数字签名：`signature.verified` 为真表示摘要校验通过。 */
export interface KnowledgeSignature {
  algorithm?: string | null
  digest?: string | null
  verified?: boolean
}

/** 全文索引状态。真实后端返回驼峰 `updatedAt`，接口文档写的是 `updated_at`。 */
export interface KnowledgeIndexStatus {
  status?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

/** 效力状态。真实后端序列化为大写枚举（`CURRENT` / `STUDENT` 风格），而接口文档的示例是小写；
 *  `services/knowledge.ts` 在响应边界统一归一化（小写 + `archived` → `archive`），页面只认小写。 */
export type KnowledgeValidity = 'current' | 'revised' | 'deprecated' | 'archive'

export interface KnowledgeDocument {
  id: string | number
  title: string
  document_no?: string | null
  issuer?: string | { id?: string | number; name?: string } | null
  category?: string | { id?: string | number; name?: string } | null
  /** 归一化后的小写效力状态；未识别的枚举原样透传，由页面降级显示。 */
  validity: string
  visibility?: string | null
  summary?: string | null
  published_at?: string | null
  /** 驼峰别名：真实后端返回 `publishedAt`，接口文档写 `published_at`。 */
  publishedAt?: string | null
  effective_from?: string | null
  /** 驼峰别名：真实后端返回 `effectiveFrom`。 */
  effectiveFrom?: string | null
  signature?: KnowledgeSignature | null
  index?: KnowledgeIndexStatus | null
  citation_count?: number
}

/** 章节索引里挂的条款引用（只有 id 与短标题，正文要按 section id 单独取）。 */
export interface KnowledgeSectionRef {
  id: string | number
  label?: string | null
  title?: string | null
}

/** `GET /knowledge/documents/{id}/chapters` 的章节条目。 */
export interface KnowledgeChapter {
  id: string | number
  label?: string | null
  title?: string | null
  order?: number
  sections?: KnowledgeSectionRef[]
}

/** `GET /knowledge/documents/{id}/sections/{section_id}` 的条款正文。 */
export interface KnowledgeSection {
  id: string | number
  document_id?: string | number
  chapter_id?: string | number
  /** 完整条号，形如「第三章第七条」。 */
  label?: string | null
  title?: string | null
  content?: string | null
  signature_verified?: boolean
  version?: string | null
}

export interface ConversationSummary {
  id: string | number
  title: string
  agent_name?: string | null
  message_count?: number
  is_bookmarked?: boolean
  related_task_count?: number
  updated_at: string
  /** 该会话最后一条 assistant 回复的预览（截断到约 100 字内）。后端补字段后无需再发详情 GET。 */
  last_reply_preview?: string
  /** 该会话最后一条 assistant 回答引用的条数（不是会话累计、不是文档级反向引用）。 */
  last_reply_citation_count?: number
  /**
   * 会话绑定的工作区（09-18 后端新增，对应 `conversations.work_space`）。
   * 值是路径（前端提交流程给的是 `<盘符>:<相对路径>`，如 `d:worker-space/WebstormProjects/campusflow`），
   * 侧边栏只取**最后一段文件夹名**当分组标签，完整原值当分组键
   * （两条路径末段可能重名，不能拿文件夹名当键并把它们并成一组）。
   * ⚠️ 存量会话没有这个值（后端才加的列）→ 侧边栏直接按**时间**分段（今天 / 昨天 / 更早），
   * **不要在前端编一个默认工作区名**，也不要给它套「未指定工作区」这类标题（09-18 九改用户否掉）。
   */
  work_space?: string | null
}

export interface HistoryMessage {
  id: string | number
  role: string
  content: string
  created_at?: string
  citation_ids?: Array<string | number>
  citation_count?: number
  /** 思考过程（仅 assistant）。后端 messages.reasoning_content 落库后由 A.8.2 下发，老数据为 null。 */
  reasoning_content?: string | null
}

export interface HistoryCitation {
  id: string | number
  title: string
  section_label?: string | null
}

export interface HistoryRelatedTask {
  id: string | number
  title: string
  status: string
}

export interface HistoryConversationDetail {
  id: string | number
  title: string
  is_bookmarked?: boolean
  agent_name?: string | null
  updated_at?: string
  messages?: HistoryMessage[]
  citations?: HistoryCitation[]
  related_tasks?: HistoryRelatedTask[]
}

// ===== 通知（接口文档 §6.4 / A.1.8-A.1.11）=================================
// ⚠️ 后端 NotificationsController 尚未实现（2026-10-09 核实为空壳），这里按契约先行；
//    接口缺字段时前端一律降级措辞，不编造数据（见 services/notifications.ts 的归一化）。

export interface NotificationItem {
  id: string | number
  /** notification_type：契约示例只有 task_update，DB 侧 varchar(48) 未枚举 → 保持 string。 */
  type: string
  title: string
  content?: string | null
  is_read: boolean
  created_at: string
  /** 站内路由（如 /tasks）；仅接受 `/` 开头的内部路径，外链一律不跳。 */
  action_url?: string | null
  resource_type?: string | null
  resource_id?: string | number | null
  read_at?: string | null
}

export interface NotificationListData {
  items: NotificationItem[]
  page: number
  page_size: number
  total: number
  has_more: boolean
}

export interface NotificationUnreadCount {
  unread_count: number
}

export interface NotificationReadResult {
  id: string | number
  is_read: boolean
  read_at?: string | null
}

export interface NotificationReadAllResult {
  updated_count: number
}
