import { aiHttp, http, makeIdempotencyKey } from './http'
import type { ApiSuccess, TaskCreated, TaskDetail, TaskDocumentMatch, TaskListData, TaskRequirement, TaskStatus, TaskSummary, TaskTemplate, TaskTemplateMatch, TaskTemplateMatchRequirement, TaskTemplateMatchStep } from '../types/api'

export interface TaskListParams {
  status?: TaskStatus
  keyword?: string
  page?: number
  page_size?: number
  /** 布尔排序：true 按更新时间正序（旧在前），false 按更新时间倒序（新在前）；未传默认 false。 */
  sort?: boolean
}

export const getTasks = (params: TaskListParams = {}) =>
  http.get<ApiSuccess<TaskListData>>('/tasks', { params })

export const getTaskSummary = () =>
  http.get<ApiSuccess<TaskSummary>>('/tasks/summary')

/**
 * 办事模板**全量**清单（A.5.13）：手动申报模式的「办事模板」下拉用。
 * ⚠️ 事项名称的输入联想已**不再走这里**（原先的 `?query=` 模糊匹配已废弃），
 *    改由 `matchTaskTemplates` 打 AI 服务的 `POST /tasks/templates/match`。
 * 拉失败（未实现 / 404 / 网络错误）时下拉降级为「只剩不指定」，不阻断手写标题提交。
 */
export const getTaskTemplates = () =>
  http.get<ApiSuccess<{ items: TaskTemplate[] }>>('/tasks/templates')

/**
 * 事项名称 → 办事模板匹配（AI 服务，`POST /api/v2/tasks/templates/match`）。
 * 请求体**只有 `title`** 一个字段（就是输入框里的原文），匹配规则与排序全在后端。
 * ⚠️ 响应 `data.items` 是**单个匹配结果对象**（不是数组），含 `matched` / `template_key` /
 *    `confidence` / `requirements` / `steps` / `missing_fields` / `clarifying_questions` / `candidates`，
 *    契约见 `types/api.ts` 的 `TaskTemplateMatch`（2026-09-14 按真实返回定型）。
 * 由用户在该输入框**按回车时触发一次**（敲字过程不发请求）；连按回车用请求序号丢弃过期响应。
 * 拉失败（AI 服务未起 / 502 / 网络错误）按「无候选」降级：不弹下拉、给一行提示，不阻断手写标题。
 */
export const matchTaskTemplates = (title: string) =>
  aiHttp.post<ApiSuccess<{ items: TaskTemplateMatch }>>('/tasks/templates/match', { title })

/**
 * 办事模板**按标识**取明细（业务服务，`GET /api/v1/tasks/templates/{template_key}/requirements`）。
 *
 * 手动申报的「匹配办理依据与材料」用它：**事务是下拉选的，没有可匹配的输入**，
 * 所以不能像 AI 模式那样把名字当 `title` 再匹配一遍（那属于拿模板名猜自己，白跑一次 AI）。
 * 这里把已在手的那把 key 直接交给后端，换回该模板的**材料要求与审批节点**。
 *
 * ⚠️ **后端尚未实现**（2026-09-15 实测 `/v3/api-docs` 无此路由；8080 未起时无法复验）。
 *    前端已按「接口没通」降级：失败就退回 AI 的 `matchTaskTemplates(事项名)`，再不行则说明原因，
 *    绝不用库里那份 `requirement_count` 去编造材料项（它只够显示「· N 项材料」）。
 * ⚠️ 形状与 A.5.14 的 `requirements[]` / `steps[]` 有意保持一致（`requirements` / `steps` 两个数组），
 *    两条路的结果可以共用 `TaskTemplateMatch` 那一套渲染。
 */
export const getTemplateRequirements = (templateKey: string, signal?: AbortSignal) =>
  http.get<ApiSuccess<{ requirements?: TaskTemplateMatchRequirement[]; steps?: TaskTemplateMatchStep[] }>>(
    `/tasks/templates/${encodeURIComponent(templateKey)}/requirements`,
    { signal },
  )

/**
 * 办理依据 → 校内规章匹配（AI 服务，`POST /api/v2/tasks/document/match`）。
 * 请求体**只有 `query`** 一个字段（事项名称原文），匹配规则与排序全在后端。
 * ⚠️ 响应 `data.items` 与模板匹配同款：**单个结果对象、不是数组**（按列表处理会拿到 undefined）。
 * ⚠️ 字段名以接口文档为准（`document_id` / `score` / `matched_reason`）；后端若用驼峰，
 *    前端已在下游按两种写法取值，不必再改这里。
 * 失败（AI 服务未起 / 502 / 网络错误 / 接口未实现）按「未匹配到依据」降级：
 * 不阻断手写标题建单，也不影响模板匹配与建单（三条链路各自独立）。
 */
export const matchTaskDocuments = (query: string) =>
  aiHttp.post<ApiSuccess<{ items: TaskDocumentMatch }>>('/tasks/document/match', { query })

/**
 * 建单请求体（`POST /tasks`，A.5.3）。**字段名全驼峰** —— 后端 `CreateTaskDto` 就是驼峰口径。
 *
 * 只传**能落库的东西**，匹配过程元数据一律不带（后端不需要、也没地方存）：
 *  · 基础件：`title` / `templateKey` / **`templateId`** / `conversationId` / `sourceMessageId`；
 *  · **`steps[]`** —— 审批节点，后端**直接写入 `task_step_instances`**（`stepId` → `template_step_id`），
 *    不必再自己按模板生成一遍；
 *  · **`requirements[]`** —— 材料要求，后端**直接写入材料要求记录**；
 *  · 手动申报表单：`categoryId` / `reason`（原先建单后靠 `PATCH /draft` 塞进 `tasks.form_data`）。
 *
 * ⚠️ **刻意不传**：`matchType` / `matchConfidence` / `matchReason` / `extracted*`（关键词、机构线索、
 * 时间线索、提到的材料）/ `missingFields` —— 这些是「怎么匹配上的」的过程数据，`tasks` 表里没有
 * 对应列，传过去只会被丢弃；`missingFields` 若后端要用于标记「待补齐」，再说一声加回来。
 * ⚠️ **手动申报模式不带 `steps` / `requirements`**：模板是下拉选的，而 `GET /tasks/templates`
 * 并不下发这两份明细（A.5.13），前端手里没有 —— 那种情况仍由后端按 `templateKey` 生成。
 */
export interface CreateTaskPayload {
  title: string
  /** 采用的办事模板 key（对应 `task_templates.template_key`）。 */
  templateKey?: string
  /**
   * 采用的模板**数字主键**（`task_templates.id` → 落 `tasks.template_id`）。
   * 来自 A.5.14 响应新增的 `template_id`；与 `templateKey` 一起给，后端不必再按 key 反查。
   */
  templateId?: number | null
  /** 意图来源会话（仅 AI 模式、且用户主动关联时带）。 */
  conversationId?: string | number
  /** 意图来源那条用户消息 id（仅在带 `conversationId` 时出现）。 */
  sourceMessageId?: string | number
  /** 审批节点，后端直接写入 `task_step_instances`。元素字段名沿用 DTO 的驼峰口径（A.5.14 返回的是下划线）。 */
  steps?: Array<{
    /** 对应 `task_template_steps.id` → 落 `task_step_instances.template_step_id`。 */
    stepId?: string | number | null
    stepOrder: number
    /** 办理机构 id（`organizations.id`）→ 落 `task_step_instances.organization_id`。 */
    organizationId?: string | number | null
    name: string
    /** 该节点是否需要用户本人操作（否则是机构内部流转）。 */
    requiresUserAction?: boolean | null
  }>
  /** 材料要求，后端直接写入材料要求记录。 */
  requirements?: Array<{
    requirementKey?: string | null
    name: string
    /** MIME 数组（`application/pdf` …），空数组表示不限类型。 */
    allowedContentTypes?: string[] | null
    /** 单个文件大小上限，**字节**（A.5.14 返回 `max_size_bytes`）。 */
    maxSizeBytes?: number | null
    isRequired?: boolean | null
  }>
  /** 手动申报：业务大类 id。 */
  categoryId?: string | number | null
  /** 手动申报：申报事由。 */
  reason?: string | null
}

/**
 * 创建任务（A.5.3）。必须携带 `Idempotency-Key`（防重复建单）。
 *
 * ⚠️ 字段名沿用**后端 `CreateTaskDto` 的驼峰口径**（09-14 以 `/v3/api-docs` 实测为准）：
 * 发下划线不会报错但会被 Jackson **静默丢弃**（模板绑定等于没传，且很难查）。
 * 别顺手把整个文件统一成一种风格：同一后端里 `TaskQueryDto`（查询串）与 `TaskDetailVo`（响应）
 * 用的是下划线 —— **以各自接口的 api-docs 为准**。
 */
export const createTask = (payload: CreateTaskPayload) =>
  http.post<ApiSuccess<TaskCreated>>('/tasks', payload, { headers: { 'Idempotency-Key': makeIdempotencyKey() } })

export const getTask = (taskId: string | number) =>
  http.get<ApiSuccess<TaskDetail>>(`/tasks/${taskId}`)

export const getTaskTimeline = (taskId: string | number) =>
  http.get<ApiSuccess<{ items: Array<Record<string, unknown>> }>>(`/tasks/${taskId}/timeline`)

/** 办结回执下载地址（短时效，data 里含 download_url / filename / expires_in）。 */
export const getTaskReceiptDownloadUrl = (taskId: string | number) =>
  http.get<ApiSuccess<{ download_url: string; filename: string; expires_in: number }>>(`/tasks/${taskId}/receipt/download-url`)

export const getTaskRequirements = (taskId: string | number) =>
  http.get<ApiSuccess<{ items: TaskRequirement[] }>>(`/tasks/${taskId}/requirements`)

export const saveTaskDraft = (taskId: string | number, payload: { form_data: Record<string, unknown>; version: number }) =>
  http.patch<ApiSuccess<Record<string, unknown>>>(`/tasks/${taskId}/draft`, payload)

export const associateTaskMaterial = (taskId: string | number, payload: { requirement_id: string | number; file_id: string | number }) =>
  http.post<ApiSuccess<Record<string, unknown>>>(`/tasks/${taskId}/materials`, payload)

export const submitTask = (taskId: string | number, payload: { version: number; confirm: boolean }) =>
  http.post<ApiSuccess<Record<string, unknown>>>(`/tasks/${taskId}/submit`, payload, { headers: { 'Idempotency-Key': makeIdempotencyKey() } })
