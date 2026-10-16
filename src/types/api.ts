/** 与《校园事务智能助手后端接口文档》第 3 章通用约定一一对应的响应包络。 */

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

export interface Paged<T> {
  items: T[]
  page: number
  page_size: number
  total: number
  has_more: boolean
}

/** 指标类接口统一携带的元信息（文档第 14 章）。 */
export interface MetricMeta {
  range?: string
  interval?: string
  updated_at: string
  /** false 时缺失值不得渲染成真实的 0 —— 见文档「data_complete」要求。 */
  data_complete: boolean
}

/* ---------- 管理员看板 ---------------------------------------------------- */

export interface OverviewMetrics extends MetricMeta {
  metrics: {
    question_count?: number
    average_response_ms?: number
    citation_hit_rate?: number
    helpful_rate?: number
    /** 以下为原型扩展口径，后端未提供时前端按 undefined 处理 */
    auto_resolved_rate?: number
    human_review_pending?: number
    /**
     * 环比（2026-09-23 后端补齐）：相对**等长的上一个窗口**的变化率，`0.164` = +16.4%。
     *
     * ⚠️ 「今日」的上一窗口是「昨日 00:00 → 昨日此刻」，不是昨日一整天。
     * 上一窗口没有可比数据时后端回 null（不是 0）—— 0 会被读成「与上期持平」，
     * 所以这里必须判 `!= null` 再渲染，不能 `?? 0`。
     */
    question_count_delta?: number | null
    average_response_ms_delta?: number | null
  }
}

export interface TrendPoint {
  time: string
  question_count: number
  /**
   * 该采样桶内回答的平均耗时（毫秒）。
   *
   * ⚠️ **可空**：后端只对有 `elapsed_ms` 的回答求均值，某一格正好没有这类数据时回 null。
   * 用 0 顶替会在图上画出一个「响应时长 0 秒」的谷底，而那一格其实是**没测到**。
   * 用它的地方必须先过滤掉非数字（页面里的 `latencySeries` 已经这么做）。
   */
  average_response_ms?: number | null
  /** 原型「服务使用趋势」的三条线，后端补齐前为 undefined */
  ai_resolved?: number
  human_routed?: number
}

export interface TrendMetrics extends MetricMeta {
  items: TrendPoint[]
}

export interface AgentMetric {
  agent_key: string
  /** 中文展示名；后端只回 agent_key 时前端按字典兜底 */
  agent_name?: string
  call_count: number
  failure_rate: number
  average_elapsed_ms: number
  p95_elapsed_ms: number
}

export interface AgentMetrics extends MetricMeta {
  items: AgentMetric[]
}

export interface KnowledgeHealth extends MetricMeta {
  /**
   * 在库文档构成。`removed`（已移出）**不计入 total** —— 移出后向量已删、
   * 不在检索池内，记录仅作追溯；它是库外计数，与 ready/processing/failed/offline 四项分开。
   * 后端尚未回传该字段（已登记缺口），缺时页面不渲染数字。
   */
  documents: { ready?: number; processing?: number; failed?: number; offline?: number; removed?: number; total?: number }
  fulltext_index: {
    indexed_sections?: number
    pending_sections?: number
    last_completed_at?: string | null
    index_name?: string
  }
  pending_conflicts: number
  /** 原型扩展：Milvus 向量库与检索质量指标 */
  vector?: {
    engine?: string
    similarity?: number
    chunks?: number
    chunk_capacity?: number
    embedding_model?: string
  }
}

export interface HotQuestion {
  rank: number
  question: string
  count: number
  /**
   * 分类名。
   *
   * ⚠️ **后端给不出来**（2026-09-23 实测）：`messages` 表没有分类列，引用链
   * （消息 → citation → 文档 → 分类）在本库数据里也不成立 ——
   * `messages.parent_message_id` 全为 NULL，接不上提问与回答。
   * 所以后端恒回 null，页面**不得**渲染空的分类标签（那看着像标签被截断了）。
   */
  category?: string | null
  /**
   * 该问题的好评率。同样给不出来：评价挂在 assistant 消息上，与提问之间没有可靠外键。
   * 缺失时隐藏，不显示 0%。
   */
  helpful_rate?: number
}

export interface HotQuestions extends MetricMeta {
  items: HotQuestion[]
}

/* ---------- 人工复核 ------------------------------------------------------ */

export type ReviewReason =
  | 'low_confidence'
  | 'policy_conflict'
  | 'hallucination'
  | 'sensitive'
  | 'stale_citation'
  | 'security'
  | 'privacy'

export type ReviewStatus = 'pending' | 'resolved' | 'rejected'

export type ReviewRisk = 'high' | 'medium' | 'low'

export interface ReviewItem {
  id: number
  message_id: number
  conversation_id?: number
  reason: ReviewReason | string
  reason_label?: string
  risk?: ReviewRisk
  confidence: number
  question: string
  answer?: string
  status: ReviewStatus | string
  agent_name?: string
  asker_account?: string
  asker_department?: string
  citations?: Array<Record<string, unknown>>
  model?: string
  topic?: string
  created_at: string
}

export type ReviewAction = 'approve' | 'correct' | 'reject'

export interface ReviewResolvePayload {
  action: ReviewAction
  corrected_answer?: string
  citation_ids?: string[]
  comment?: string
}

/* ---------- 知识库治理 ---------------------------------------------------- */

/**
 * 文档状态。`removed` = 已移出知识库：检索向量已删，但文档与分块记录保留留痕
 * （见 `POST /knowledge/documents/{id}/remove` 的契约），所以它仍然会出现在
 * `GET /knowledge/documents` 列表里 —— 治理页据此做「移除知识库」页签。
 */
export type KnowledgeDocStatus = 'draft' | 'processing' | 'ready' | 'failed' | 'offline' | 'archived' | 'removed'

/**
 * `GET /knowledge/documents` 列表项。
 *
 * ⚠️ **2026-09-21 实测后端返回的字段名与早期契约不一致**，逐条标在下面。
 * 页面不要直接读后端原始名，统一走 `services/knowledge.ts` 的 `normalizeKnowledgeDoc()`
 * 归一化后的名字 —— 否则同一份数据 mock 下正常、切 live 就整列空白。
 */
export interface KnowledgeDoc {
  id: number
  title: string
  /**
   * 文号。后端实测返回的是 `document_no`；`doc_no` 是早期契约名（mock 与页面沿用）。
   * 两者都声明，由 service 层合并成 `doc_no`。
   */
  doc_no?: string
  document_no?: string
  /** 分类名。实测后端直接返回中文字符串名（如「奖助学金与荣誉评定」），不是分类 id。 */
  category?: string
  category_name?: string
  /**
   * 文档状态。**2026-09-23 起后端已返回**（此前整列空白，见《接口对接说明.md》B 类缺口）。
   * 值域是 `knowledge_documents.status` 的 6 个库枚举，未知值原样显示、不猜语义。
   */
  status?: KnowledgeDocStatus | string
  /**
   * 当前版本号（形如 `v1.0`）。**2026-09-23 起后端已返回**（取 `is_current=1` 的版本）。
   * 仍保留可选：老库里没有当前版本记录的文档取不到。
   */
  version?: string
  /** ⚠️ 后端实测未返回，副标题的字数/页数会缺失。 */
  word_count?: number
  page_count?: number
  section_count?: number
  /**
   * 责任/发文单位。后端实测返回的是 `issuer`；`department` 是早期契约名。
   * 由 service 层合并成 `department`。
   */
  department?: string
  issuer?: string
  /**
   * 最近一次改动时间。**2026-09-23 起后端已返回**（`knowledge_documents.updated_at`）。
   *
   * ⚠️ 与 `published_at`（印发时间）语义不同，**不要互相顶替**：
   * 「2020 年印发、昨天改过」的文档，两个日期都真实且都有意义。
   * 仍保留可选 —— 页面按缺失降级展示。
   */
  updated_at?: string
  updated_by?: string
  visibility?: string
  process_state?: string
  has_conflict?: boolean
  /**
   * 生效状态。实测值 `current`。后端未钉死枚举（见《接口对接说明.md》），
   * 前端按开放字符串处理：未知值原样显示，不猜语义。
   */
  validity?: string
  /** 印发时间。实测有值，用作「最近更新时间」缺失时的降级展示。 */
  published_at?: string
}

/**
 * `GET /knowledge/admin/conflicts` 的**线上原始形状**（后端 `KnowledgeConflictVo`）。
 *
 * 🔴 它和展示型的 `KnowledgeConflict` 不是一回事：线上只有 `knowledge_conflicts`
 * 表真实存在、或能 join 出来的字段，**没有** `confidence` / `source_version` /
 * `proposed_version` / `title` / `target_doc` —— 那几项是 mock 自己造的
 * （2026-09-23 逐列核对 `information_schema`：该表只有
 * `conflict_type / severity / description / status / resolution / resolved_*`）。
 *
 * live 分支必须先过 `normalizeKnowledgeConflict()` 再交给页面；
 * 直接断言成 `KnowledgeConflict` 会让整块 diff 面板静默空白（与审计日志那次同型的坑）。
 */
export interface KnowledgeConflictWire {
  id: number
  document_id: number
  /** join `knowledge_documents.title`；文档被删或不存在时为 null。 */
  document_title?: string | null
  conflicting_document_id?: number | null
  conflicting_document_title?: string | null
  conflict_type?: string | null
  severity?: 'high' | 'medium' | 'low'
  description?: string | null
  status?: 'pending' | 'resolved' | 'ignored'
  resolution?: string | null
  resolved_by?: number | null
  resolved_by_name?: string | null
  resolved_at?: string | null
  created_at?: string | null
}

export interface KnowledgeConflict {
  id: number
  document_id: number
  /** 归一化自线上的 `document_title`。 */
  title?: string
  /** 归一化自线上的 `conflicting_document_title`（即「与之冲突的那份」）。 */
  target_doc?: string
  /** 归一化自线上的 `description`。 */
  summary?: string
  reason?: string
  severity?: 'high' | 'medium' | 'low'
  /** 冲突类型码，如 `test_conflict`（varchar(48)、无 CHECK）。 */
  conflict_type?: string | null
  /**
   * 检出置信度。
   *
   * ⚠️ **后端给不出来**：`knowledge_conflicts` 没有这一列，AI 服务也没有写过。
   * live 下恒为 `undefined`，页面必须降级成「未回传」——
   * 不要填一个数字，一个假的 0.96 比「—」危险得多。
   */
  confidence?: number
  /** ⚠️ 同上，仅 mock 有。后端没有「原文片段 / 行号」的存储。 */
  source_version?: {
    label: string
    doc_no?: string
    line?: number
    text: string
  }
  /** ⚠️ 同上，仅 mock 有。后端没有「拟议条文」的存储。 */
  proposed_version?: {
    label: string
    doc_no?: string
    text: string
    source?: string
  }
  /** ✅ 2026-09-23 起后端返回（`pending / resolved / ignored`，库有 CHECK）。 */
  status?: 'pending' | 'resolved' | 'ignored'
  /** 处置结论：动作码，或「动作码：备注」。 */
  resolution?: string | null
  resolved_by_name?: string | null
  resolved_at?: string | null
  created_at?: string
}

/**
 * `POST /knowledge/admin/documents/{id}/publish` / `/offline` 的返回。
 *
 * `previous_status` 是新增的可选字段（2026-09-23）：这两个接口都是幂等的，
 * 只回 `status` 时页面分不清「这次真的改了」和「本来就是」，
 * 于是要么写一句假的「已更新」，要么在什么都没发生时也弹成功提示。
 */
export interface KnowledgeDocumentAction {
  id: number
  status: string
  previous_status?: string | null
}

/**
 * `GET /knowledge/admin/jobs` 的一条解析/索引作业（后端 `KnowledgeJobVo`）。
 *
 * 🔴 **这张表目前没有写入方**（2026-09-23 核对：Java 与 AI 服务都不写
 * `knowledge_jobs` / `knowledge_job_steps`，库里 4 条是种子数据）。
 * 也就是说这个接口能读出真实的行，但**反映不了实时入库进度** ——
 * 入库进度现在还只能靠 `GET /knowledge/ingest/{fileId}` 的 status 轮询。
 * 页面若据此渲染「作业进度」，会画出一个永远不动的进度条。
 */
export interface KnowledgeJob {
  job_id: number
  document_id: number
  document_title?: string | null
  version_id?: number | null
  /** 作业类型，当前库里只有 `ingest`（varchar(32)、无 CHECK）。 */
  job_type?: string | null
  /** `pending / running / completed / failed / cancelled`（库为 enum）。 */
  status: string
  /** `parsing / chunking / fulltext_indexing / publishing`，未开始时为 null。 */
  current_stage?: string | null
  progress: number
  attempt_count?: number | null
  error_code?: string | null
  error?: string | null
  started_at?: string | null
  completed_at?: string | null
  /** 阶段明细；无明细时后端回空数组（不是 null）。 */
  stages: Array<{ stage: string; status: string; progress?: number | null; elapsed_ms: number | null }>
  created_at?: string
}

/* ---------- 审计日志 ------------------------------------------------------ */

/**
 * `GET /admin/audit-logs` 的**线上原始形状**（文档 A.10.3 示例 = 后端 `AutoLogVo` 的全部字段）。
 *
 * 🔴 它和展示型的 `AuditLog` 不是一回事：线上只给**原始枚举**
 * （`resource_type: 'knowledge_document'`、`action: 'user.login'`、`result: 'success'`、`resource_id: 25`），
 * **没有** `module_label` / `action_label` / `target_name` / `client_name` / `operator_account` /
 * `operator_role` 这些字段 —— 那些原本只是 `mockAuditLogs` 自己归一化出来的。
 *
 * live 分支必须先过 `normalizeAuditLog` 再交给页面。早先直接把线上 body **断言**成 `AuditLog`
 * 返回，断言不报错、TypeScript 也查不出来，页面于是六列里五列读不到值、静默空白（09-21 真机复现）。
 */
export interface AuditLogWire {
  id: number
  operator_id: number | null
  operator_name: string | null
  action: string
  resource_type: string
  resource_id: number | null
  result: string
  ip_address: string | null
  created_at: string
}

export interface AuditLog {
  id: number
  created_at: string
  /** mock 给角色名、线上给数字用户 id，两种都可能出现 → 别假设它是 string */
  operator_id?: string | number
  operator_name: string
  operator_account?: string
  operator_role?: string
  action: string
  action_label?: string
  action_tone?: 'ink' | 'emerald' | 'coral' | 'amber' | 'slate'
  module: string
  module_label?: string
  target_type?: string
  target_name?: string
  target_meta?: string
  ip?: string
  client_name?: string
  env?: string
  result?: string
  detail?: string
}

export interface AuditLogQuery {
  page?: number
  page_size?: number
  keyword?: string
  operator_id?: string
  action?: string
  resource_type?: string
  /**
   * 执行结果：`success` / `failure`（`audit_logs.result` 建表 CHECK 只有这两个值）。
   *
   * ✅ 2026-09-23 起后端支持。此前没有这个参数，页面上的「执行结果状态」下拉只能置灰。
   */
  result?: string
  from?: string
  to?: string
}

export interface AuditSummary {
  today_events: number
  today_events_delta: number
  high_risk_blocked: number
  auto_task_rate: number
  retention_days: number
  total: number
}

/* ---------- 用户与角色（后端未提供，前端预留） ---------------------------- */

export interface AdminUser {
  id: number
  name: string
  account: string
  email?: string
  department?: string
  role_key: string
  role_name: string
  status: 'active' | 'pending' | 'locked' | 'disabled'
  last_login_at?: string | null
  last_login_ip?: string | null
  network?: string
  identity_note?: string
}

export interface AdminRole {
  key: string
  name: string
  kind?: string
  member_count: number
  description: string
  capabilities: string[]
  scope_note?: string
}

export interface RoleMatrix {
  updated_at: string
  policy_version: string
  permissions: Array<{ key: string; name: string; group: string; roles: string[] }>
}

export interface UserStats {
  total: number
  active_today: number
  active_ratio: number
  admin_seats: number
  admin_ratio: number
  pending_identity: number
}

/* ---------- 系统设置（后端未提供，前端预留） ------------------------------ */

export interface SecuritySettings {
  admin_idle_logout_minutes: number
  admin_mfa_enabled: boolean
  ip_allowlist_enabled: boolean
  ip_allowlist: string
  immutable_log_enabled: boolean
  retention_days: number
  updated_at: string
  updated_by: string
}

export interface RagSettings {
  active_model: string
  max_context_tokens: number
  top_k: number
  similarity_threshold: number
  escalation_enabled: boolean
  escalation_min_score: number
  auto_block_hallucination: boolean
  auto_route_unresolved: boolean
  updated_at: string
  updated_by: string
}

export interface SystemSettings {
  security: SecuritySettings
  rag: RagSettings
  environment: string
  audit_note: string
}

/* ---------- 文件上传（文档第 9 章） ---------------------------------------- */

/**
 * `files.purpose` 业务用途标识（文档第 9 章登记表）。
 * 新增用途必须先在接口文档登记，避免各端各写一套字符串。
 */
export type UploadPurpose =
  | 'knowledge_doc' // 管理后台上传校规资料 ← 本文档新增，需后端登记
  | 'task_material' // 办事任务材料
  | 'avatar' // 用户头像

/** 扫描状态：ready 之前业务接口不得引用该 file_id（文档第 9 章第 3 条）。 */
export type FileScanStatus = 'scanning' | 'ready' | 'rejected'

/** `POST /files/presign` 的返回体 —— 一步式上传，不再返回 upload_url。 */
export interface UploadedFile {
  file_id: number
  filename: string
  content_type: string
  size_bytes: number
  purpose: string
  status: FileScanStatus | string
}

/* ---------- 文件内容审核（契约草案，见《接口对接说明》2.2） ------------------ */

/**
 * `files.status` 原始值。后端 `FileScanServiceImpl` 的三个出口 + 落库未开扫：
 *   uploaded → 已落库、扫描任务还没取走
 *   scanning → 链路进行中，或判不出结论保持该态等人（见 scan_result.reason_code）
 *   ready   → MIME / 病毒 / 内容审核全过
 *   rejected → 链路判负（类型不符 / 恶意文件 / 内容审核未通过）
 */
export type FileReviewStatus = 'uploaded' | 'scanning' | 'ready' | 'rejected' | string

/**
 * 内容审核页的四个筛选态（由 status + reason_code 派生，不是库里的列）。
 *
 * 🔴 `scanning` 与 `manual` 在库里是同一个 `status='scanning'`，区别全在
 * `scan_result.reason_code`：命中 `needs_review` / `content_truncated` 的
 * 是「自动链路审过了但给不出结论，出路是人」，其余（扫描器不可用、投递失败…）
 * 是「链路还没跑完，出路是补偿重投」。`FileScanRetryServiceImpl` 正是按这个
 * 集合决定跳过哪些行不重投 —— 派生规则与后端同源，见 `services/fileReview.ts`。
 */
export type FileReviewState = 'scanning' | 'manual' | 'ready' | 'rejected'

/** scan_result.mime —— 声明类型 / 探测类型 / 是否命中白名单。 */
export interface FileScanMime {
  declared: string
  detected: string
  matched: boolean
}

/** scan_result.virus —— ClamAV 结论。verdict: clean / infected / unavailable。 */
export interface FileScanVirus {
  verdict: string
  engine: string
  signature: string
  detail: string
}

/** scan_result.moderation 的每一步（文本链或图片链的一枚审核器）。 */
export interface FileScanModerationStep {
  engine: string
  passed: boolean
  riskLevel: string
  label: string
  reason: string
}

/** 补偿重投计数（files 表没有重试列，后端寄存在 scan_result.compensation）。 */
export interface FileScanCompensation {
  attempts: number
  last_attempt_at: string
}

/** 人工处置记录（本契约草案新增，后端实现时写入）。 */
export interface FileScanManual {
  action: 'approve' | 'reject'
  by: string
  at: string
  comment?: string
}

/**
 * `files.scan_result`（json 列）的形状 —— 字段全部对齐后端
 * `FileScanServiceImpl` 的组装逻辑，未知字段原样透传。
 */
export interface FileScanResult {
  mime?: FileScanMime
  virus?: FileScanVirus
  moderation?: FileScanModerationStep[] | { skipped: boolean; reason: string }
  reason_code?: string
  reason?: string
  scanned_at?: string
  duration_ms?: number
  compensation?: FileScanCompensation
  manual?: FileScanManual
}

/** `GET /admin/files` 列表项（契约草案）。 */
export interface FileReviewItem {
  id: number
  owner_id?: number | null
  purpose: UploadPurpose | string
  original_name: string
  content_type: string
  size_bytes: number
  sha256?: string
  status: FileReviewStatus
  scan_result: FileScanResult | null
  uploaded_at: string | null
  updated_at?: string | null
}

/** 人工处置动作。approve = 放行（转 ready），reject = 阻断（转 rejected）。 */
export type FileReviewAction = 'approve' | 'reject'

export interface FileReviewResolvePayload {
  action: FileReviewAction
  comment?: string
}

export interface FileReviewResolveResult {
  id: number
  status: FileReviewStatus
  action: FileReviewAction
  resolved_at: string
}

export interface FileReviewRescanResult {
  id: number
  status: 'scanning'
  requeued_at: string
}

/** `POST /knowledge/admin/documents` 请求体（文档 A.6.8）。 */
export interface KnowledgeDocCreatePayload {
  title: string
  document_no?: string
  issuer_id?: number
  category_id?: number
  visibility?: 'public' | 'campus' | 'internal'
  effective_from?: string
  file_id: number
}

export interface KnowledgeDocCreateResult {
  document_id: number
  status: string
  job_id: number
  version?: string
}

/** `GET /knowledge/categories` —— 分类及文档数量。 */
export interface KnowledgeCategory {
  id: number
  name: string
  parent_id?: number | null
  document_count?: number
}

/* ---------- 知识库入库（AI 服务 /api/v2，Python 提供） --------------------- */

/**
 * Python 服务的响应信封**与 Java 不同构**：只有 `code` / `message` / `data`，
 * 没有 `request_id`（`src/models/common_responce.py` 的 result 类）。
 * 别硬套 `ApiSuccess` —— 那会逼后端加一个前端从不读的字段。
 */
export interface PySuccess<T> {
  code: number
  message: string
  data: T
}

/**
 * 入库状态。这是「文件」维度的状态，不是「文档」维度的：
 *   none       —— 上传了但从未确认入库（列表里点「加入知识库」）
 *   processing —— 已确认，解析/分块/向量化进行中
 *   ready      —— 已入库，可被检索命中
 *   failed     —— 上次失败，可点「重试」
 *   removed    —— 曾入库后被移出
 */
export type KnowledgeIngestStatus = 'none' | 'processing' | 'ready' | 'failed' | 'removed'

/** `POST /knowledge/ingest` 请求体 —— 管理员真正要决定的只有「哪份文件、归哪一类」。 */
export interface KnowledgeIngestPayload {
  /** Java 侧的文件 id（`files.id`），同时是幂等键。 */
  fileId: number
  /** 人工指定的分类 id，取自 Java 的 `GET /knowledge/categories`。 */
  categoryId: number
  /** 可选：人工指定标题，优先级高于 LLM 从正文抽取的结果。 */
  title?: string
  documentNo?: string
  versionNo?: string
  /** 失败后重试、或已入库想重跑时必须显式带上，否则后端返回 409。 */
  retry?: boolean
}

/** `POST /knowledge/ingest` 返回体 —— 秒回，真正的活在后端后台跑。 */
export interface KnowledgeIngestResult {
  fileId: number
  documentId: number | null
  versionId: number | null
  status: KnowledgeIngestStatus | string
  /** true 表示这次没有新起任务（已在处理中或已入库，命中了幂等）。 */
  reused: boolean
  chunkCount?: number | null
  error?: string | null
}

/** `GET /knowledge/ingest/{fileId}` 返回体 —— 前端轮询用。 */
export interface KnowledgeIngestState {
  fileId: number
  status: KnowledgeIngestStatus | string
  documentId: number | null
  versionId: number | null
  title: string | null
  categoryCode: string | null
  chunkCount: number | null
  pageCount: number | null
  parserName: string | null
  error: string | null
  updatedAt: string | null
}

/**
 * `GET /knowledge/pending-files` 列表项 —— 上传过但还没进知识库的文件。
 *
 * 只含 `purpose=knowledge_doc` 的上传，所以头像、办事材料、新闻封面不会出现。
 * 上传时拿不到 `object_key`、也不需要它：MinIO 定位由后端按 fileId 读 files 表补全。
 */
export interface PendingKnowledgeFile {
  fileId: number
  fileName: string
  /** 已入库文档的标题；未入库时为 null。 */
  title: string | null
  sizeBytes: number
  contentType?: string
  /** 小写扩展名，不含点，例如 `pdf`。 */
  extension: string
  /** files.status：ready 之前不得引用该 file（文档第 9 章第 3 条）。 */
  scanStatus: string
  uploadedAt: string | null
  ingestStatus: KnowledgeIngestStatus | string
  documentId: number | null
  versionId: number | null
  chunkCount: number | null
  categoryCode: string | null
  categoryName: string | null
}

/* ---------- 校园新闻（文档第 12 章） -------------------------------------- */

/**
 * 新闻源状态。接口文档只示例了 `active`（文档 A.7.9），
 * 另一个值是「停用某个源」时新登记的，已写入《接口对接说明.md》待后端确认。
 * 前端按开放字符串处理：未知值原样显示，不猜语义。
 */
export type NewsSourceStatus = 'active' | 'paused' | string

/** 抓取规则的选择器（`PATCH` 请求体的 `selector`，文档 A.7.10）。 */
export interface NewsSourceSelector {
  /** 列表条目选择器，例如 `.notice-list li` */
  list?: string
  /** 标题选择器，例如 `a` */
  title?: string
  /** 发布时间选择器，例如 `.date` */
  published_at?: string
}

/** `GET /news/admin/sources` 列表项（文档 A.7.9）。 */
export interface NewsSource {
  id: number
  name: string
  base_url?: string
  status: NewsSourceStatus
  sync_interval_minutes?: number
  last_synced_at?: string | null
  /** PATCH 可回写；列表未返回时前端不展示，不编造 */
  category?: string
  /** 数据表 `news_sources.source_type`：rss / html / api / manual */
  source_type?: string
  selector?: NewsSourceSelector
}

/** `PATCH /news/admin/sources/{id}` 请求体 —— 只提交用户改过的字段。 */
export interface NewsSourceUpdatePayload {
  status?: string
  sync_interval_minutes?: number
  category?: string
  selector?: NewsSourceSelector
}

/** `PATCH /news/admin/sources/{id}` 返回体（文档 A.7.10）。 */
export interface NewsSourceUpdateResult {
  id: number
  status: string
  sync_interval_minutes?: number
  updated_at: string
}

/** `POST /news/admin/sources/{id}/sync` 返回体（文档 A.7.11）。 */
export interface NewsSyncResult {
  sync_job_id: number
  source_id: number
  status: string
}

/** 新闻流列表项（文档 A.7.2）。 */
export interface NewsItem {
  id: number
  category: string
  department?: string
  title: string
  summary?: string
  published_at?: string | null
  deadline_at?: string | null
  is_bookmarked?: boolean
  /**
   * 以下为 `GET /news` 实际随 PO 整包回传的字段（CampusNewsServiceImpl#list 直接
   * `setItems(records)`，没有做 VO 裁剪），但 mock 流里是裁剪过的 —— 全部可选，
   * mock 下没有就按「未回传」降级，不做强依赖（契约第 1/3 条）。
   */
  /** 草稿正文。列表接口会回传全文，编辑回显用；mock 流未回传时编辑表单留空 = 不改正文。 */
  content?: string
  /** 稿件状态：`draft / published / offline / archived`。本列表只回 published，其余见接口说明缺口登记。 */
  status?: string
  /** 可见范围：public / campus / student / teacher / department / admin。 */
  visibility?: string
  /** 首页轮播置顶位。 */
  is_spotlight?: boolean
}

/* ---------- 管理端新闻发布（POST/PATCH/DELETE /news/admin/news，2026-09-23 后端落地） ---------- */

/** `campus_news.visibility` 枚举（后端 `AdminNewsServiceImpl#ALLOWED_VISIBILITY`，缺省 campus）。 */
export type NewsVisibility = 'public' | 'campus' | 'student' | 'teacher' | 'department' | 'admin'

/** `campus_news.status` 枚举（后端 `ALLOWED_STATUS`）。新建只允许 draft / published 两个起点。 */
export type NewsDocStatus = 'draft' | 'published' | 'offline' | 'archived'

/**
 * `POST /news/admin/news` 请求体。
 *
 * ⚠️ `published_at` 不在请求体里 —— 首次转 published 由服务端写当前时刻，
 * 让客户端决定「什么时候发的」等于允许伪造发布时间（接口对接说明 2.4）。
 * `deadline_at` 格式 `yyyy-MM-dd HH:mm:ss`（后端也接受 `yyyy-MM-dd HH:mm` / 无时区 ISO）。
 */
export interface NewsAdminCreatePayload {
  title: string
  content: string
  category: string
  summary?: string
  visibility?: NewsVisibility
  cover_file_id?: string
  status?: 'draft' | 'published'
  is_spotlight?: boolean
  deadline_at?: string
}

/**
 * `PATCH /news/admin/news/{id}` 请求体 —— 所有字段可选，`null` 语义 = 不改。
 * 上下线就是只传 `status`；下线后再上线不会重写 `published_at`（后端刻意保留历史时间）。
 */
export interface NewsAdminUpdatePayload {
  title?: string
  summary?: string
  content?: string
  category?: string
  visibility?: NewsVisibility
  cover_file_id?: string
  status?: NewsDocStatus
  is_spotlight?: boolean
  deadline_at?: string
}

/**
 * `POST/PATCH /news/admin/news` 的返回 `data`（后端 `resultOf` 只回出参事实，
 * 不含正文）。`id` 数据表是 BIGINT，JSON 里按 number 接。
 */
export interface NewsAdminWriteResult {
  id: number
  status: string
  category: string
  visibility: string
  is_spotlight: boolean
  published_at: string | null
  updated_at: string | null
}

/** `DELETE /news/admin/news/{id}` 的返回 `data` —— 软删除（写 `deleted_at`），不是物理删。 */
export interface NewsAdminDeleteResult {
  id: number
  deleted: boolean
  deleted_at: string
}

/* ---------- 管理端通知推送（/admin/notifications，⚠️ 后端未提供，契约已登记接口说明 2.7） ---------- */

/**
 * 广播通知类型。`notifications.notification_type` 建表是 `varchar(48)` 无 CHECK，
 * 现有数据只有任务类系统通知（task_material_required / deadline_reminder / task_completed）；
 * 管理端广播用 `announcement`（公告）与 `system`（系统通知）两个值，待后端登记进枚举表。
 */
export type AdminNotificationType = 'announcement' | 'system'

/**
 * 广播通知行 —— 对应 `notifications` 表里 **`user_id IS NULL`** 的行（发布对象语义：
 * 没有归属用户的通知 = 全员可见，不需要按人 fan-out，学生端查询要带 `OR user_id IS NULL`）。
 */
export interface AdminNotification {
  id: number
  notification_type: string
  title: string
  content: string
  /** 点击通知的跳转地址，可空。 */
  action_url?: string | null
  /** 广播行的已读语义未定（全员共享一行无法按人记已读），可缺省，前端不强依赖。 */
  is_read?: boolean
  created_at: string
  expires_at?: string | null
}

/** `POST /admin/notifications` 请求体。发布时间由服务端写 `created_at`，前端不传。 */
export interface AdminNotificationCreatePayload {
  title: string
  content: string
  notification_type?: AdminNotificationType
  action_url?: string
  /** `yyyy-MM-dd HH:mm:ss`，过期后学生端不再展示；可空 = 长期有效。 */
  expires_at?: string
}

/** `POST /admin/notifications` 的返回 `data`。 */
export interface AdminNotificationCreateResult {
  id: number
  notification_type: string
  title: string
  created_at: string
  expires_at: string | null
}

/** `DELETE /admin/notifications/{id}`（撤回）的返回 `data`。 */
export interface AdminNotificationDeleteResult {
  id: number
  revoked: boolean
  revoked_at: string
}

/** `GET /news/categories` 列表项（文档 A.7.3）。key 与 name 在示例中同值。 */
export interface NewsCategory {
  key: string
  name: string
  count: number
}

/* ---------- 认证（文档第 6 章） -------------------------------------------- */

/** 数据库 `users.role` 枚举（数据库设计.sql:47）。 */
export type AuthRole = 'student' | 'teacher' | 'admin'

/**
 * `POST /auth/login` 的 `data.user`，也是 `GET /users/me` 的 `data`。
 *
 * ⚠️ 两个接口**不同构**：`permissions` 只有 `GET /users/me` 返回（文档 A.1.5 示例里登录响应没有它），
 * 所以管理端登录后必须再回源一次才能拿到权限清单，不能只信登录响应。
 */
export interface AuthUser {
  /** MySQL BIGINT 由后端以 JSON number 返回；A.1.1 示例里又是字符串，两种都接。 */
  id: string | number
  account: string
  name: string
  role: AuthRole
  department?: string
  avatar_url?: string | null
  /** 仅 `GET /users/me` 返回。 */
  permissions?: string[]
}

/** `POST /auth/login` 响应体（文档 6.1 / A.1.1）。 */
export interface LoginResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  user: AuthUser
}

/** `POST /auth/refresh` 响应体（文档 A.1.2）。 */
export interface RefreshTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}
