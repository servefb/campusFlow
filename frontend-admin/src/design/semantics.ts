import type { BadgeTone } from '../design/tokens'
import type { FileReviewState, ReviewRisk } from '../types/api'

/**
 * 语义映射表 —— 状态值与展示色的唯一来源。
 * 组件里不要再内联写 `item.risk === 'high' ? 'coral' : ...`，
 * 一律从这里取，保证同一状态在所有页面同色（设计系统要求「同状态必同色」）。
 */

/**
 * 复核风险等级 → 徽章色。
 * ⚠️ 与下面的 `FILE_REVIEW_STATE` 不是一回事：这是**问答复核工单**（/admin/reviews，
 * content_reviews 表）的风险档位，那是**上传文件**的审核四态。
 * 2026-10-15 内容审核页改审文件后管理端已无页面引用它 —— 随 `services/metrics.ts`
 * 的 getReviews 一族保留作契约存档（答复复核后端接口闲置），恢复页面时直接取用。
 */
export const RISK_TONE: Record<ReviewRisk, BadgeTone> = {
  high: 'coral',
  medium: 'amber',
  low: 'emerald',
}

/**
 * 文件审核态 → 徽章色 + 中文（内容审核页四态）。
 *
 * `manual` 与 `rejected` 同走珊瑚红但语义不同：前者是「等着人判」的待办，
 * 后者是「已经拦掉了」的终态 —— 两者都需要被看见，故不给 rejected 降灰。
 * `scanning` 是进行态，琥珀色；`ready` 放行，松绿。
 */
export const FILE_REVIEW_STATE: Record<FileReviewState, { tone: BadgeTone; label: string }> = {
  scanning: { tone: 'amber', label: '扫描中' },
  manual: { tone: 'coral', label: '转人工' },
  ready: { tone: 'emerald', label: '已通过' },
  rejected: { tone: 'coral', label: '已驳回' },
}

/** `files.purpose` 业务用途（接口文档第 9 章登记表）。未登记的值原样显示。 */
export const UPLOAD_PURPOSE: Record<string, string> = {
  knowledge_doc: '知识库文档',
  task_material: '办事材料',
  avatar: '用户头像',
}

/**
 * `scan_result.reason_code` → 中文 + 是否「转人工」。
 *
 * 取值来自后端 `FileScanServiceImpl` 的三个出口与 `FileScanRetryServiceImpl`
 * 的 `HUMAN_REVIEW_CODES`（`needs_review` / `content_truncated` —— 补偿重投
 * 必须跳过它们，因为再扫一遍还是同一个结论，出路是人）。
 * `manual_reject` / `manual_approve` 是本契约草案新增的人工处置码。
 * 查不到的原因码**原样显示**，不猜语义。
 */
export const FILE_REASON_CODE: Record<string, { label: string; human: boolean }> = {
  needs_review: { label: '审核器无定论', human: true },
  content_truncated: { label: '超长仅部分送审', human: true },
  no_whitelist: { label: '未配 MIME 白名单', human: true },
  scanner_unavailable: { label: '病毒扫描器不可用', human: true },
  extract_failed: { label: '正文抽取失败', human: true },
  no_image_moderator: { label: '未配图片审核引擎', human: true },
  storage_unavailable: { label: '对象存储不可用', human: true },
  mime_mismatch: { label: 'MIME 类型不符', human: false },
  virus: { label: '检测到恶意文件', human: false },
  moderation: { label: '内容审核未通过', human: false },
  manual_reject: { label: '人工驳回', human: false },
  manual_approve: { label: '人工通过', human: false },
}

/** `scan_result.virus.verdict`（后端 ClamAvScanner.Verdict 枚举的小写）→ 中文 + 语义色。 */
export const VIRUS_VERDICT: Record<string, { label: string; tone: BadgeTone }> = {
  clean: { label: '未检出威胁', tone: 'emerald' },
  infected: { label: '检出威胁', tone: 'coral' },
  unavailable: { label: '扫描器不可用', tone: 'amber' },
}

/** `scan_result.moderation[].label`（后端 Moderation.Verdict.label）→ 中文。未登记值原样显示。 */
export const MODERATION_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  pass: { label: '通过', tone: 'emerald' },
  needs_review: { label: '无定论', tone: 'amber' },
  block: { label: '拦截', tone: 'coral' },
}

/** 知识文档状态 → 徽章色 + 中文 */
export const DOC_STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  ready: { tone: 'emerald', label: '已同步' },
  processing: { tone: 'amber', label: '处理中' },
  failed: { tone: 'coral', label: '解析失败' },
  offline: { tone: 'slate', label: '已下线' },
  archived: { tone: 'slate', label: '已归档' },
  /** 已移出知识库：向量已删、记录留痕。正常状态不是故障，用 slate 不染红。 */
  removed: { tone: 'slate', label: '已移出' },
  draft: { tone: 'slate', label: '待发布' },
}

/**
 * 待入库文件的**入库**状态 → 徽章色 + 中文。
 *
 * 注意这是「文件」维度的状态，与上面的 `DOC_STATUS`（文档维度）不是一回事：
 * 一个文件还没入库时压根没有对应文档，所以查不到就退化成 `none` 而不是报错。
 * `none` / `removed` 用 slate 而非 coral —— 它们都是**正常状态**，不是故障，
 * 标成红色会让管理员以为出了问题。
 */
export const PENDING_INGEST_STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  none: { tone: 'slate', label: '未入库' },
  processing: { tone: 'amber', label: '入库中' },
  ready: { tone: 'emerald', label: '已入库' },
  failed: { tone: 'coral', label: '入库失败' },
  removed: { tone: 'slate', label: '曾移出' },
}

/**
 * 知识文档**生效状态**（`GET /knowledge/documents` 的 `validity`）→ 徽章色 + 中文。
 *
 * 后端目前只实测出 `current` 一个值，其余是登记在《接口对接说明.md》的待确认枚举。
 * 查不到的值在页面里**原样显示**，不猜语义 —— 与 `NEWS_SOURCE_STATUS` 同一套处理。
 */
export const DOC_VALIDITY: Record<string, { tone: BadgeTone; label: string }> = {
  current: { tone: 'emerald', label: '现行有效' },
  superseded: { tone: 'slate', label: '已被取代' },
  repealed: { tone: 'coral', label: '已废止' },
  draft: { tone: 'amber', label: '征求意见' },
}

/** 管理员账号状态 → 徽章色 + 中文 */
export const USER_STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  active: { tone: 'emerald', label: '正常' },
  pending: { tone: 'amber', label: '待激活' },
  locked: { tone: 'coral', label: '已锁定' },
  disabled: { tone: 'slate', label: '已停用' },
}

/**
 * 新闻源状态 → 徽章色 + 中文。
 * `active` 是接口文档 A.7.9 的示例值；`paused` 是「停用某个源」的新登记值，
 * 已列入《接口对接说明.md》待后端确认。查不到的状态在页面里原样显示，不猜语义。
 */
export const NEWS_SOURCE_STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  active: { tone: 'emerald', label: '抓取中' },
  paused: { tone: 'slate', label: '已暂停' },
}

/** 服务健康度 → 徽章色 */
export const HEALTH_TONE: Record<string, BadgeTone> = {
  online: 'emerald',
  busy: 'amber',
  degraded: 'amber',
  offline: 'slate',
}

/**
 * 操作者身份分组 → 审计筛选的 `operator_id` 取值。
 *
 * ⚠️ **目前和后端对不上，已登记需求（09-21），暂按产品口径保留原样**：
 * 后端 `AutoLogDto.operator_id` 是 `Long`（数字用户 id），传这里的角色名会在**参数绑定期直接 400**；
 * 想按角色筛，后端得先加 `role` 参数。
 * 另外这几个角色名（超管 / 审核员 / 院系运营…）是原型自造的 —— 真库里
 * `audit_logs.operator_role` 与 `users.role` 的枚举只有 `student` / `teacher` / `admin` 三个值。
 * 也就是说**后端加 role 参数那天，这里的 `value` 也得一起换成这三个枚举**，否则照样查出 0 行。
 */
export const OPERATOR_GROUPS = [
  { value: 'all', label: '全部操作者' },
  { value: '超管', label: '超级管理员' },
  { value: '审核员', label: '合规审核员' },
  { value: 'Crawler-Daemon', label: '系统定时任务' },
  { value: '角色审计', label: '角色审计员' },
  { value: '院系运营', label: '院系运营' },
  { value: '合规审计', label: '合规审计' },
] as const

/**
 * 审计日志 `resource_type`（后端原始枚举）→ 中文模块名 + 目标对象定语。
 *
 * 🔴 取值必须与**后端真枚举一致**，不能拿原型的中文模块名当 value 用：后端是精确匹配
 * （`AuditLogsServiceImpl` 里 `.eq(x != null, ...)`，判据只有「非 null」），传中文 = 永远匹配不上 = 查出 0 行。
 * 这三个值来自真库 `SELECT DISTINCT resource_type FROM audit_logs`（09-21 实测）；
 * 建表语句里它是 `varchar(64)`、**没有 CHECK 约束** → 枚举必然不全，
 * 遇到没登记的值页面**原样显示**原始值，不猜语义（与 `DOC_VALIDITY` / `NEWS_SOURCE_STATUS` 同一套处理）。
 */
export const AUDIT_RESOURCE_TYPE: Record<string, { module: string; noun: string }> = {
  user: { module: '用户管理', noun: '用户' },
  knowledge_document: { module: '知识库治理', noun: '知识文档' },
  task: { module: '任务流转', noun: '任务' },
}

/**
 * 审计日志 `action`（后端是 `域.动作` 的**动作码**）→ 中文 + 语义色。
 * 实测库里的四个值（09-21）。后端是精确匹配、没有前缀通配，所以「变更类 / 删除类」这种
 * **类别**筛选在本接口表达不了 —— 下拉只能列动作码本身。查不到的动作码原样显示。
 */
export const AUDIT_ACTION: Record<string, { label: string; tone: BadgeTone }> = {
  'user.login': { label: '登录系统', tone: 'ink' },
  'knowledge.ingest': { label: '知识入库', tone: 'emerald' },
  'task.create': { label: '新建任务', tone: 'ink' },
  'task.complete': { label: '完成任务', tone: 'emerald' },
}

/** 审计日志 `result` → 中文 + 语义色。取值来自建表 CHECK (`success` / `failure`)。 */
export const AUDIT_RESULT_STATE: Record<string, { label: string; tone: BadgeTone }> = {
  success: { label: '成功执行', tone: 'emerald' },
  failure: { label: '执行失败', tone: 'coral' },
}

/** 下拉模板：`all` 哨兵 + 真实枚举值。哨兵由 `services/audit.ts` 的 `dropAll` 摘掉，不会发出去。 */
const optionsWithAll = <T>(allLabel: string, dict: Record<string, T>, labelOf: (meta: T) => string) => [
  { value: 'all', label: allLabel },
  ...Object.entries(dict).map(([value, meta]) => ({ value, label: labelOf(meta) })),
]

/** 业务功能模块下拉 → 审计筛选的 `resource_type` 取值 */
export const AUDIT_MODULES = optionsWithAll('全部模块', AUDIT_RESOURCE_TYPE, (meta) => meta.module)

/** 操作行为下拉 → 审计筛选的 `action` 取值（动作码，精确匹配） */
export const AUDIT_ACTIONS = optionsWithAll('全部动作', AUDIT_ACTION, (meta) => meta.label)

/**
 * 执行结果状态下拉 → **后端没有对应的查询参数**（接口只支持 operator_id / action / resource_type / from / to）。
 * 页面里这个控件现在是**禁用**状态：原先它被接到 `action` 参数上（当年为了让 mock 那条
 * `log.result !== action` 的过滤跑通），live 下选任何一项都必然查出 0 行。需求已登记（09-21）。
 */
export const AUDIT_RESULTS = optionsWithAll('全量结果（全部）', AUDIT_RESULT_STATE, (meta) => meta.label)
