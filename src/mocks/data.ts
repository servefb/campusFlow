import type {
  AdminNotification,
  AdminNotificationCreatePayload,
  AdminRole,
  AdminUser,
  AgentMetric,
  AuditLog,
  AuditSummary,
  HotQuestion,
  KnowledgeCategory,
  KnowledgeConflict,
  KnowledgeDoc,
  KnowledgeHealth,
  NewsAdminCreatePayload,
  NewsAdminUpdatePayload,
  NewsCategory,
  NewsItem,
  NewsSource,
  OverviewMetrics,
  PendingKnowledgeFile,
  ReviewItem,
  FileReviewAction,
  FileReviewItem,
  FileReviewResolveResult,
  FileReviewRescanResult,
  SystemSettings,
  TrendPoint,
  UserStats,
} from '../types/api'

/**
 * Mock 数据 —— 数值刻意与 stitch 原型截图保持一致（24,892 次 / 96.8% / 1.18s / 17 件…），
 * 这样 UI 评审时「照着设计稿改」有可比基准。
 * 唯一改动：原型顶栏的时间戳是 2024-10-24，这里换成接口文档的 2026-09 口径。
 */

/**
 * 概览指标的区间数值，按时间窗口分档。
 *
 * 🔴 这里原先只有**一个**常量对象，`services/metrics.ts` 的 mock 分支写成
 * `{ ...mockOverview, range }` —— 只覆盖了 `range` 字段本身，`metrics` 里六个数字原封不动。
 * 表现是 mock 下切「今日 / 最近 7 天 / 最近 30 天」，四张卡读数**一模一样**：
 * 界面看着完全正常，`range` 这个参数其实被 mock 吞掉了。
 * mock 是接口契约的第二份实现，`range` 就是这条契约的一部分，必须跟着变。
 *
 * 口径：`question_count` 是区间累计，窗口越长越大；三个率是区间均值，小幅漂移不突变。
 * `human_review_pending` **不在这里** —— 它是瞬时积压量，与窗口无关，见 `getMockOverview`。
 */
const OVERVIEW_BY_RANGE: Record<string, Omit<OverviewMetrics['metrics'], 'human_review_pending'>> = {
  today: {
    question_count: 24892,
    average_response_ms: 1180,
    citation_hit_rate: 0.986,
    helpful_rate: 0.968,
    auto_resolved_rate: 0.942,
  },
  '7d': {
    question_count: 168470,
    average_response_ms: 1246,
    citation_hit_rate: 0.978,
    helpful_rate: 0.959,
    auto_resolved_rate: 0.931,
  },
  '30d': {
    question_count: 704318,
    average_response_ms: 1312,
    citation_hit_rate: 0.971,
    helpful_rate: 0.951,
    auto_resolved_rate: 0.918,
  },
}

/**
 * 取某一档时间窗口的概览指标。未知 `range` 退回 `today`，与 `getOverview` 的默认参数一致。
 *
 * `human_review_pending` 直接引用 `mockReviews.length` 而不是再写一个 17：
 * 它是「当前待复核工单数」，同一个数在首页有两个来源（看板接口 / 复核队列 total 兜底），
 * 两处各写一个常量，迟早会漂移成互相矛盾的数。
 *
 * 写成函数而非常量对象，是为了能引用文件下方才声明的 `mockReviews`，避开 TDZ。
 */
export const getMockOverview = (range: string): OverviewMetrics => {
  const key = range in OVERVIEW_BY_RANGE ? range : 'today'
  return {
    range: key,
    updated_at: '2026-09-15T14:02:18+08:00',
    data_complete: true,
    // 取出的六个数字必须自带 range 语义，别在这里回显一个假的 range 就完事。
    metrics: { ...OVERVIEW_BY_RANGE[key], human_review_pending: mockReviews.length },
  }
}

/** 30 个采样点，形状对齐原型的「阶梯上升 + 手工作业平台期」。 */
export const mockTrend: TrendPoint[] = (() => {
  const points: TrendPoint[] = []
  for (let hour = 0; hour < 24; hour += 1) {
    const t = `${String(hour).padStart(2, '0')}:00`
    // 白天高、夜里低，14:00 是当天峰值（对应原型「今日 14:00 峰值」）
    const shape = Math.max(0, Math.sin(((hour - 6) / 14) * Math.PI))
    const total = Math.round(120 + shape * 3300)
    const manual = Math.round(total * (0.12 - shape * 0.06))
    const routed = Math.round(total * (0.03 + shape * 0.025))
    points.push({
      time: t,
      question_count: total,
      average_response_ms: 980 + Math.round(shape * 440),
      ai_resolved: total - manual - routed,
      human_routed: routed,
    })
  }
  return points
})()

export const mockAgents: AgentMetric[] = [
  { agent_key: 'policy_agent', agent_name: '校园政策问答', call_count: 14427, failure_rate: 0.006, average_elapsed_ms: 920, p95_elapsed_ms: 1680 },
  { agent_key: 'affairs_agent', agent_name: '办事流程', call_count: 5974, failure_rate: 0.008, average_elapsed_ms: 1240, p95_elapsed_ms: 2260 },
  { agent_key: 'task_agent', agent_name: '任务代办', call_count: 2987, failure_rate: 0.005, average_elapsed_ms: 1080, p95_elapsed_ms: 1840 },
  { agent_key: 'news_agent', agent_name: '校园新闻', call_count: 1494, failure_rate: 0.004, average_elapsed_ms: 640, p95_elapsed_ms: 1120 },
]

export const mockKnowledgeHealth: KnowledgeHealth = {
  updated_at: '2026-09-15T14:00:00+08:00',
  data_complete: true,
  documents: {
    ready: 1380,
    processing: 12,
    failed: 8,
    offline: 28,
    // 已移出（向量已删、记录留痕）不计入 total —— 它不在检索池内，是库外计数。
    // 与 ready+processing+failed+offline = total 的自洽关系互不干扰。
    removed: 6,
    total: 1428,
  },
  fulltext_index: {
    indexed_sections: 824192,
    pending_sections: 16,
    last_completed_at: '2026-09-15T13:48:00+08:00',
    index_name: 'CampusFlow-Knowledge',
  },
  pending_conflicts: 2,
  vector: {
    engine: 'Milvus v2.3.4 · HNSW',
    similarity: 0.9998,
    /*
     * ⚠️ `chunks` 必须 ≤ `chunk_capacity`，且两者单位相同（分片）。
     *
     * 原先写的是 `chunks: 824192` 配 `chunk_capacity: 1000` —— 用量是容量的 824 倍。
     * 系统观察页拿这两个数算容量条，于是屏幕上出现「824.2 GB / 100 GB」还配一条满格绿条。
     * mock 是契约的第二份实现，它自己不自洽，评审时就会被当成真的 Bug 报上来。
     * 现在 824,192 / 1,000,000 = 82.4%，落在「正常水位」区间。
     */
    chunks: 824192,
    chunk_capacity: 1000000,
    embedding_model: 'BGE-large-zh',
  },
}

export const mockHotQuestions: HotQuestion[] = [
  { rank: 1, question: '期末考核及补考申请条件', count: 3120, category: '教务', helpful_rate: 0.982 },
  { rank: 2, question: '校园卡消费卡未缴款处理办法', count: 2840, category: '校园生活', helpful_rate: 0.991 },
  { rank: 3, question: '电动车自行登记及留学转专业流程', count: 2310, category: '学生事务', helpful_rate: 0.924 },
  { rank: 4, question: '研究生国家助学金与校助学金解约', count: 1980, category: '奖助学金', helpful_rate: 0.978 },
  { rank: 5, question: '国家助学贷款毕业确认流程', count: 1450, category: '奖助学金', helpful_rate: 0.968 },
]

/* ---------- 待人工复核队列 ------------------------------------------------- */

const REVIEW_REASON_LABEL: Record<string, string> = {
  policy_conflict: '政策口径冲突',
  security: '安全渗透',
  privacy: '隐私防护',
  low_confidence: '置信度低',
  stale_citation: '时效引用失效',
  hallucination: '幻觉输出',
}

export const REVIEW_REASON_LABELS = REVIEW_REASON_LABEL

const rawReviews: Array<Omit<ReviewItem, 'reason_label'> & { reason: string }> = [
  {
    id: 8891,
    message_id: 51201,
    conversation_id: 4501,
    reason: 'policy_conflict',
    risk: 'high',
    confidence: 0.71,
    question: '研究生能否校外租房？',
    answer: '根据《研究生在读住宿管理暂行办法》（2019版），只需向宿管中心提交《外宿申请表》即可完成手续，导师不同意一般不影响提交。',
    status: 'pending',
    agent_name: '学工与研工',
    asker_account: '2022****492',
    asker_department: '研二·工学院',
    model: 'DeepSeek-V3',
    topic: '住宿管理',
    created_at: '2026-09-15T13:42:00+08:00',
  },
  {
    id: 8889,
    message_id: 51188,
    reason: 'security',
    risk: 'high',
    confidence: 0.83,
    question: '校内网络端口探测与认证绕过问题',
    answer: '可以在用户端配置 Py thon 脚本请求认证接口，绕开统一认证…',
    status: 'pending',
    agent_name: '网络通办',
    asker_account: '2021****819',
    asker_department: '',
    model: 'DeepSeek-V3',
    topic: '网络安全',
    created_at: '2026-09-15T13:16:00+08:00',
  },
  {
    id: 8884,
    message_id: 51150,
    reason: 'privacy',
    risk: 'medium',
    confidence: 0.76,
    question: '辅导员非公开情况手机号与住址查询',
    answer: '可联系计通学院相关教师帮助查询…',
    status: 'pending',
    agent_name: '计通学院分导',
    asker_account: '2023****105',
    asker_department: '',
    model: 'DeepSeek-V3',
    topic: '隐私防护',
    created_at: '2026-09-15T12:40:00+08:00',
  },
  {
    id: 8879,
    message_id: 51102,
    reason: 'low_confidence',
    risk: 'low',
    confidence: 0.62,
    question: '留学生助教津贴按天发放周期判定依据',
    answer: '当前依据不足，知识库相似度 0.62，低于 0.65 闸值，建议转人工核实…',
    status: 'pending',
    agent_name: '财务资助',
    asker_account: '2024****012',
    asker_department: '',
    model: 'DeepSeek-V3',
    topic: '奖助学金',
    created_at: '2026-09-15T11:05:00+08:00',
  },
  {
    id: 8871,
    message_id: 51044,
    reason: 'hallucination',
    risk: 'high',
    confidence: 0.55,
    question: '休学期间是否保留奖学金资格？',
    answer: '休学期间奖学金资格按当年度评选细则执行，请向学生工作部确认。',
    status: 'pending',
    agent_name: '校园政策问答',
    asker_account: '2023****220',
    asker_department: '自动化学院',
    model: 'DeepSeek-V3',
    topic: '奖助学金',
    created_at: '2026-09-15T10:12:00+08:00',
  },
  {
    id: 8868,
    message_id: 50990,
    reason: 'stale_citation',
    risk: 'medium',
    confidence: 0.68,
    question: '2026 年转专业工作启动时间与材料清单',
    answer: '根据《本科生学籍管理规定（2022修订版）》第 12 条…',
    status: 'pending',
    agent_name: '校园政策问答',
    asker_account: '2024****338',
    asker_department: '经济学院',
    model: 'DeepSeek-V3',
    topic: '教务',
    created_at: '2026-09-15T09:38:00+08:00',
  },
  {
    id: 8862,
    message_id: 50912,
    reason: 'policy_conflict',
    risk: 'medium',
    confidence: 0.74,
    question: '国家奖学金与校级奖学金能否同时申请',
    answer: '同一学年内可以同时申请，但奖金不重复发放…',
    status: 'pending',
    agent_name: '财务资助',
    asker_account: '2023****900',
    asker_department: '外国语学院',
    model: 'DeepSeek-V3',
    topic: '奖助学金',
    created_at: '2026-09-15T08:50:00+08:00',
  },
  {
    id: 8855,
    message_id: 50844,
    reason: 'low_confidence',
    risk: 'low',
    confidence: 0.63,
    question: '留学生宿舍退宿押金结算流程',
    answer: '退宿押金按实际住宿天数结算，多退少补…',
    status: 'pending',
    agent_name: '国际交流',
    asker_account: '2025****117',
    asker_department: '',
    model: 'DeepSeek-V3',
    topic: '校园生活',
    created_at: '2026-09-15T08:02:00+08:00',
  },
  {
    id: 8841,
    message_id: 50712,
    reason: 'security',
    risk: 'high',
    confidence: 0.79,
    question: '校园卡消费卡未缴款能否直接提现',
    answer: '可通过第三方渠道完成提现操作…',
    status: 'pending',
    agent_name: '财务资助',
    asker_account: '2022****671',
    asker_department: '数学学院',
    model: 'DeepSeek-V3',
    topic: '校园生活',
    created_at: '2026-09-14T22:11:00+08:00',
  },
  {
    id: 8830,
    message_id: 50588,
    reason: 'privacy',
    risk: 'medium',
    confidence: 0.72,
    question: '学籍异动名单能否导出为 Excel 发给班级群',
    answer: '可以导出，注意包含学号与身份证字段…',
    status: 'pending',
    agent_name: '教务综合',
    asker_account: '2022****044',
    asker_department: '物理学院',
    model: 'DeepSeek-V3',
    topic: '学籍管理',
    created_at: '2026-09-14T20:30:00+08:00',
  },
  {
    id: 8818,
    message_id: 50410,
    reason: 'stale_citation',
    risk: 'low',
    confidence: 0.66,
    question: '本科生转专业是否需要面试',
    answer: '现行办法未强制要求面试，按学院细则执行…',
    status: 'pending',
    agent_name: '校园政策问答',
    asker_account: '2024****902',
    asker_department: '化学学院',
    model: 'DeepSeek-V3',
    topic: '教务',
    created_at: '2026-09-14T17:20:00+08:00',
  },
  {
    id: 8805,
    message_id: 50288,
    reason: 'hallucination',
    risk: 'high',
    confidence: 0.51,
    question: '助学贷款毕业确认可否由他人代办',
    answer: '可由辅导员统一代办并代签确认书…',
    status: 'pending',
    agent_name: '财务资助',
    asker_account: '2022****118',
    asker_department: '材料学院',
    model: 'DeepSeek-V3',
    topic: '奖助学金',
    created_at: '2026-09-14T15:44:00+08:00',
  },
  {
    id: 8791,
    message_id: 50102,
    reason: 'low_confidence',
    risk: 'low',
    confidence: 0.61,
    question: '交换生学分认定材料提交截止时间',
    answer: '建议在每学期第 8 周前提交，具体以学院通知为准…',
    status: 'pending',
    agent_name: '国际交流',
    asker_account: '2023****455',
    asker_department: '外国语学院',
    model: 'DeepSeek-V3',
    topic: '国际交流',
    created_at: '2026-09-14T11:08:00+08:00',
  },
  {
    id: 8779,
    message_id: 49980,
    reason: 'privacy',
    risk: 'high',
    confidence: 0.77,
    question: '勤工助学岗位申请者家庭经济困难等级如何查询',
    answer: '可登录资助系统查看本院学生困难等级明细…',
    status: 'pending',
    agent_name: '财务资助',
    asker_account: '2022****330',
    asker_department: '计算机学院',
    model: 'DeepSeek-V3',
    topic: '隐私防护',
    created_at: '2026-09-14T09:52:00+08:00',
  },
  {
    id: 8760,
    message_id: 49811,
    reason: 'policy_conflict',
    risk: 'medium',
    confidence: 0.7,
    question: '研究生国家助学金与校助学金能否叠加',
    answer: '两者可叠加发放，按月度合并计入…',
    status: 'pending',
    agent_name: '财务资助',
    asker_account: '2023****707',
    asker_department: '工学院',
    model: 'DeepSeek-V3',
    topic: '奖助学金',
    created_at: '2026-09-13T16:20:00+08:00',
  },
  {
    id: 8744,
    message_id: 49622,
    reason: 'security',
    risk: 'high',
    confidence: 0.81,
    question: '如何获取校内测试环境数据库连接串',
    answer: '测试环境连接串可在内网 Wiki 中找到…',
    status: 'pending',
    agent_name: '网络通办',
    asker_account: '2021****233',
    asker_department: '',
    model: 'DeepSeek-V3',
    topic: '网络安全',
    created_at: '2026-09-13T14:01:00+08:00',
  },
  {
    id: 8738,
    message_id: 49540,
    reason: 'stale_citation',
    risk: 'low',
    confidence: 0.65,
    question: '宿舍违规电器处罚标准',
    answer: '参照《学生宿舍管理规定（2021版）》第 9 条执行…',
    status: 'pending',
    agent_name: '校园政策问答',
    asker_account: '2024****515',
    asker_department: '建筑学院',
    model: 'DeepSeek-V3',
    topic: '校园生活',
    created_at: '2026-09-13T10:33:00+08:00',
  },
]

export const mockReviews: ReviewItem[] = rawReviews.map((item) => ({
  ...item,
  reason_label: REVIEW_REASON_LABEL[item.reason] ?? item.reason,
}))

/** 已处理的复核记录，用于「已通过 / 已驳回」筛选页签。 */
export const mockResolvedReviews: ReviewItem[] = mockReviews.slice(0, 6).map((item, index) => ({
  ...item,
  id: item.id + 100000,
  status: index % 3 === 0 ? 'rejected' : 'resolved',
}))

/* ---------- 复核详情（8891 的完整分析报告） -------------------------------- */

export const mockReviewDetailExtra = {
  8891: {
    trigger: {
      title: '触发策略：时效引用导致政策误导风险',
      body: '知识治理库中检测到被废止的《2019研究生外宿条例》，回答中引用了该失效条款并省略了导师审批与研工部备案环节。',
    },
    model: 'DeepSeek-V3',
    elapsed: '1.1s',
    alignment: {
      cited: { label: '召回条目', code: 'DOC-2019-GRAD-88（已废止）' },
      current: { label: '现行标准法源', code: 'DOC-2023-STU-042（有效）' },
      conflict:
        '核心冲突：最新 2023 规定第 14 条强制约定「必须取得指导教师书面同意书，并在研工部事务大厅签署免责与知情协议」，而智能体输出将引发学生绕过导师审批造成管理风险。',
    },
    suggestion:
      '纠正知识切片引用至《2023研究生在读住宿与休学管理规定》，重写审批流程：明确说明导师签字同意为必要前置条件，且必须完成研工部备案。',
  },
}

/* ---------- 知识库治理 ----------------------------------------------------- */

export const mockConflicts: KnowledgeConflict[] = [
  {
    id: 1,
    document_id: 8,
    status: 'pending',
    title: '旧条例（2022版 学籍管理）',
    target_doc: '《本科生学籍管理规定（2024修订版）》',
    summary: '与《转专业实施细则第 12 条》存在准入逻辑分歧',
    severity: 'high',
    confidence: 0.962,
    source_version: {
      label: '旧条例（2022版 学籍管理）',
      doc_no: 'chunk-std-affair-088921',
      line: 114,
      text: '申请转专业的学生，必须先完成第一学年全部教学计划课程，并须无任何课程不及格或违纪记录。若有违纪记录直接取消资格。',
    },
    proposed_version: {
      label: '拟发布新版（2024秋季教务处）',
      doc_no: '教务处学生〔2024〕39 号',
      text: '申请转专业的学生，通过选修课程完成不行性门槛；核心必修课平均绩点达到 2.8 以上即可申请，不限制选修挂科历史。重修通过视同合格。',
      source: '拟稿拟稿：教务处教学〔2024〕39 号文 · 待确认发布',
    },
    created_at: '2026-09-15T11:20:00+08:00',
  },
  {
    id: 2,
    document_id: 7,
    status: 'pending',
    title: '研究生在读住宿与休学管理规定',
    target_doc: '《宿舍管理条例（2019 试行版）》',
    summary: '第 14 条导师签字要求与现行口径不一致',
    severity: 'medium',
    confidence: 0.884,
    source_version: {
      label: '2019 试行版',
      doc_no: 'DOC-2019-GRAD-88',
      line: 42,
      text: '外宿只需向宿管中心提交申请表即可完成手续，导师不同意不影响提交。',
    },
    proposed_version: {
      label: '2023 修订版',
      doc_no: 'DOC-2023-STU-042',
      text: '必须取得指导教师书面同意书，并在研工部事务大厅签署免责与知情协议后完成备案。',
      source: '拟稿：研工部学生〔2023〕42 号文',
    },
    created_at: '2026-09-15T09:45:00+08:00',
  },
]

/**
 * 知识文档 mock。
 *
 * ⚠️ `validity`（生效状态）必须跟着加：它是 2026-09-21 从后端真实响应里接出来的字段，
 * 表格里占一整列。mock 不补的话，评审时切到 mock 模式这一列整列是「—」，
 * 看着像功能没做 —— 而 live 下明明有值。
 */
export const mockKnowledgeDocs: KnowledgeDoc[] = [
  { id: 1, title: '本科生学籍管理规定（2024修订版）', doc_no: 'DOC-JW-2024-001', category: '教务', category_name: '教务', status: 'ready', version: 'v3.2', word_count: 26110, page_count: 156, section_count: 28, department: '教务处', updated_at: '2026-09-15T09:30:00+08:00', updated_by: '张世宏', process_state: '已同步', visibility: 'public', validity: 'current' },
  { id: 2, title: '宿舍违规用电处罚细则及安全巡查规范', doc_no: 'DOC-HQ-2024-082', category: '后勤保障', category_name: '后勤保障', status: 'processing', version: 'v1.8', word_count: 8340, page_count: 48, section_count: 12, department: '后勤保障部', updated_at: '2026-09-15T11:15:00+08:00', updated_by: '李思凯', process_state: '处理中', has_conflict: true, validity: 'current' },
  { id: 3, title: '国家奖学金与国家励志奖学金评审工作规程', doc_no: 'DOC-XGC-2024-019', category: '奖助学金', category_name: '奖助学金', status: 'ready', version: 'v4.0', word_count: 15200, page_count: 86, section_count: 21, department: '学生工作部', updated_at: '2026-09-14T16:40:00+08:00', updated_by: '王明', process_state: '已同步', visibility: 'campus', validity: 'current' },
  { id: 4, title: '全日制研究生海外联合培养项目资助办法（实施细则）', doc_no: 'DOC-YJS-2024-112', category: '国际交流', category_name: '国际交流', status: 'offline', version: 'v1.2', word_count: 9900, page_count: 52, section_count: 14, department: '研究生院', updated_at: '2026-09-14T14:20:00+08:00', updated_by: '陈敏', process_state: '已下线', validity: 'superseded' },
  { id: 5, title: '校园一卡通补办与虚拟卡离线充值消费指引', doc_no: 'DOC-XXH-2024-045', category: '校园生活', category_name: '校园生活', status: 'ready', version: 'v2.4', word_count: 4120, page_count: 22, section_count: 8, department: '信息化办公室', updated_at: '2026-09-13T08:00:00+08:00', updated_by: '赵启明', process_state: '已同步', visibility: 'public', validity: 'current' },
  { id: 6, title: '关于维护校园秩序与大型社团集会审批条例', doc_no: 'DOC-BWC-2023-011', category: '校园安全', category_name: '校园安全', status: 'ready', version: 'v3.0', word_count: 11280, page_count: 64, section_count: 17, department: '保卫处', updated_at: '2026-09-12T10:12:00+08:00', updated_by: '孙振宇', process_state: '已同步', visibility: 'campus', validity: 'current' },
  { id: 7, title: '研究生在读住宿与休学管理规定', doc_no: 'DOC-2023-STU-042', category: '学生事务', category_name: '学生事务', status: 'ready', version: 'v5.1', word_count: 14360, page_count: 78, section_count: 19, department: '研究生工作部', updated_at: '2026-09-11T15:30:00+08:00', updated_by: '林宪成', process_state: '已同步', visibility: 'campus', validity: 'current' },
  { id: 8, title: '本科生转专业实施细则', doc_no: 'DOC-JW-2024-039', category: '教务', category_name: '教务', status: 'draft', version: 'v0.9', word_count: 6100, page_count: 34, section_count: 11, department: '教务处', updated_at: '2026-09-10T17:05:00+08:00', updated_by: '教务处教学科', process_state: '待发布', has_conflict: true, validity: 'draft' },
  /*
   * 下面两条是**页签样本**，不是为了凑数：
   * 改造前样本里一条 failed / removed 都没有 —— 「入库失败」页签徽章写着健康度的 8 篇、
   * 表格却是空的；移出知识库后文档直接消失，无处可查。两个页签因此在演示数据里等于不存在。
   */
  { id: 9, title: '校园机动车门禁授权管理细则（扫描版）', doc_no: 'DOC-BWC-2024-077', category: '校园安全', category_name: '校园安全', status: 'failed', version: 'v1.1', word_count: 3240, page_count: 18, section_count: 6, department: '保卫处', updated_at: '2026-09-15T10:26:00+08:00', updated_by: '孙振宇', process_state: '解析失败', visibility: 'campus', validity: 'current' },
  { id: 10, title: '学生社团活动场地临时租用办法（2023 试行）', doc_no: 'DOC-STU-2023-116', category: '学生事务', category_name: '学生事务', status: 'removed', version: 'v2.0', word_count: 7650, page_count: 40, section_count: 13, department: '学生工作部', updated_at: '2026-09-13T16:20:00+08:00', updated_by: '林宪成', process_state: '已移出', visibility: 'campus', validity: 'superseded' },
]

/* ---------- 审计日志 ------------------------------------------------------- */

/*
 * ⚠️ 时间戳必须跟着「当下」走，不能写死成绝对时间。
 *
 * 原先这 22 条写的是绝对的 2026-09-10 ~ 09-15。操作日志页默认时间范围是「最近 7 天」——
 * 到了 09-23，全部条目都落在窗口之外，**mock 档的操作日志页变成一张空表**
 * （截图里那句「没有符合条件的审计记录」就是这么来的）。
 * 接口没问题、筛选逻辑也没问题，是 mock 自己跟自己的默认查询对不上：
 * mock 是契约的第二份实现，它必须自洽，而不是「某一天之前自洽」。
 *
 * 所以下面 rawLogs 里保留的是**叙事用的相对关系**（谁比谁早多久），
 * 导出时统一平移到「距现在 2 小时」为最新一条 —— 任何日期打开都落在合理窗口内。
 */
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000

/** 输出 Asia/Shanghai 墙钟 + 显式 `+08:00`（不要 `toISOString()` 的 `Z`，见 services 层的说明）。 */
const toShanghaiISO = (at: Date): string => {
  const wall = new Date(at.getTime() + SHANGHAI_OFFSET_MS)
  const p = (value: number, width = 2) => String(value).padStart(width, '0')
  return (
    `${wall.getUTCFullYear()}-${p(wall.getUTCMonth() + 1)}-${p(wall.getUTCDate())}` +
    `T${p(wall.getUTCHours())}:${p(wall.getUTCMinutes())}:${p(wall.getUTCSeconds())}+08:00`
  )
}

/** 原叙事里最新一条的时刻，作为平移的基准。 */
const LOG_ANCHOR_MS = new Date('2026-09-15T16:42:18+08:00').getTime()
/** 平移后「最新一条」落在距现在多久 —— 留 2 小时，「今天」档也能出数据。 */
const LOG_ANCHOR_AGE_MS = 2 * 3600 * 1000
const shiftLogTime = (iso: string): string =>
  toShanghaiISO(new Date(Date.now() - LOG_ANCHOR_AGE_MS - (LOG_ANCHOR_MS - new Date(iso).getTime())))

const rawLogs: Array<Pick<AuditLog, 'id' | 'created_at' | 'operator_name' | 'operator_account' | 'operator_role' | 'action' | 'module' | 'target_name' | 'target_meta' | 'ip' | 'client_name' | 'env' | 'result'>> = [
  { id: 1, created_at: '2026-09-15T16:42:18+08:00', operator_name: '林宪成', operator_account: 'ENP-001', operator_role: '超管', action: '覆盖更新版本', module: '知识库治理', target_name: '《本科生转专业管理条例（2024秋·…）》v2.1', ip: '10.12.88.42', client_name: '校内网 · 教务行政楼', env: '生产' },
  { id: 2, created_at: '2026-09-15T16:15:02+08:00', operator_name: '陈雪怡', operator_account: 'AUD-104', operator_role: '审核员', action: '强制驳回并纠错', module: '内容审核', target_name: '工单 #AUD-2024-8891', target_meta: '已驳回', ip: '10.12.89.105', client_name: '教务办固定终端', env: '生产' },
  { id: 3, created_at: '2026-09-15T15:30:44+08:00', operator_name: '系统定时调度器', operator_account: 'CronJob', operator_role: 'Crawler-Daemon', action: '自动爬取教务通知', module: '知识库同步', target_name: '抓取源: jwc.univ.edu.cn +14 源', ip: '127.0.0.1', client_name: '本机任务容器 (Async)', env: '生产' },
  { id: 4, created_at: '2026-09-15T14:02:11+08:00', operator_name: '张建国', operator_account: 'ADM-829', operator_role: '角色审计', action: '临时禁用违规账号', module: '用户管理', target_name: '学号: 2023110822', target_meta: 'Suspended', ip: '10.15.20.14', client_name: '信息中心 VPN 接入', env: '生产' },
  { id: 5, created_at: '2026-09-15T11:45:00+08:00', operator_name: '李老师', operator_account: 'EDU-881', operator_role: '院系运营', action: '尝试删除全局基础文档', module: '知识库治理', target_name: '《校纪校规总纲》', target_meta: '不可变 · 已拦截', ip: '202.108.22.5', client_name: '外网直连（未认证源）', env: '生产', result: 'blocked' },
  { id: 6, created_at: '2026-09-15T09:18:32+08:00', operator_name: '林宪成', operator_account: 'ENP-001', operator_role: '超管', action: '调整模型降级阈值', module: '系统配置', target_name: 'CampusFlow-Router 调度流 Config-V4', ip: '10.12.88.42', client_name: '校内网 · 教务行政楼', env: '生产' },
  { id: 7, created_at: '2026-09-14T22:40:03+08:00', operator_name: '系统定时调度器', operator_account: 'CronJob', operator_role: 'Index-Rebuilder', action: '重建全量向量索引', module: '知识库同步', target_name: '索引: CampusFlow-Knowledge', ip: '127.0.0.1', client_name: '本机任务容器 (Async)', env: '生产' },
  { id: 8, created_at: '2026-09-14T20:12:47+08:00', operator_name: '王海涛', operator_account: 'ADM-731', operator_role: '合规审计', action: '导出操作日志明细', module: '操作日志', target_name: '范围: 最近 7 天 · 1,482 条', ip: '10.12.88.19', client_name: '校内网 · 行政楼', env: '生产' },
  { id: 9, created_at: '2026-09-14T18:06:20+08:00', operator_name: '陈雪怡', operator_account: 'AUD-104', operator_role: '审核员', action: '批量通过复核工单', module: '内容审核', target_name: '工单 14 件', target_meta: '已通过', ip: '10.12.89.105', client_name: '教务办固定终端', env: '生产' },
  { id: 10, created_at: '2026-09-14T16:33:09+08:00', operator_name: '张建国', operator_account: 'ADM-829', operator_role: '角色审计', action: '新增管理员账号', module: '用户管理', target_name: 'xing.yu@univ.edu.cn', target_meta: '待激活', ip: '10.15.20.14', client_name: '信息中心 VPN 接入', env: '生产' },
  { id: 11, created_at: '2026-09-14T14:20:55+08:00', operator_name: '林宪成', operator_account: 'ENP-001', operator_role: '超管', action: '下线知识文档', module: '知识库治理', target_name: '《全日制研究生海外联合培养项目资助办法》', target_meta: '已下线', ip: '10.12.88.42', client_name: '校内网 · 教务行政楼', env: '生产' },
  { id: 12, created_at: '2026-09-14T10:08:31+08:00', operator_name: '李老师', operator_account: 'EDU-881', operator_role: '院系运营', action: '查看本院系问答明细', module: '系统观察', target_name: '范围: 计算机科学与技术学院', ip: '202.108.22.5', client_name: '外网直连（未认证源）', env: '生产', result: 'denied' },
  { id: 13, created_at: '2026-09-13T17:55:12+08:00', operator_name: '王海涛', operator_account: 'ADM-731', operator_role: '合规审计', action: '解冻被锁定账号', module: '用户管理', target_name: '学号: 2022031805', target_meta: 'Active', ip: '10.12.88.19', client_name: '校内网 · 行政楼', env: '生产' },
  { id: 14, created_at: '2026-09-13T15:02:44+08:00', operator_name: '林宪成', operator_account: 'ENP-001', operator_role: '超管', action: '发布新版政策切片', module: '知识库治理', target_name: '《研究生在读住宿与休学管理规定》v5.1', ip: '10.12.88.42', client_name: '校内网 · 教务行政楼', env: '生产' },
  { id: 15, created_at: '2026-09-13T11:30:06+08:00', operator_name: '陈雪怡', operator_account: 'AUD-104', operator_role: '审核员', action: '标记幻觉输出', module: '内容审核', target_name: '工单 #AUD-2024-8805', target_meta: '高风险', ip: '10.12.89.105', client_name: '教务办固定终端', env: '生产' },
  { id: 16, created_at: '2026-09-13T09:14:38+08:00', operator_name: '系统定时调度器', operator_account: 'CronJob', operator_role: 'Log-Rotator', action: '归档历史审计日志', module: '系统配置', target_name: '范围: 90 天前', ip: '127.0.0.1', client_name: '本机任务容器 (Async)', env: '生产' },
  { id: 17, created_at: '2026-09-12T18:47:21+08:00', operator_name: '张建国', operator_account: 'ADM-829', operator_role: '角色审计', action: '调整角色权限矩阵', module: '用户管理', target_name: '角色: 知识库治理管理员', ip: '10.15.20.14', client_name: '信息中心 VPN 接入', env: '生产' },
  { id: 18, created_at: '2026-09-12T14:22:10+08:00', operator_name: '王海涛', operator_account: 'ADM-731', operator_role: '合规审计', action: '开启双因子强制校验', module: '系统配置', target_name: '管理员会话策略', ip: '10.12.88.19', client_name: '校内网 · 行政楼', env: '生产' },
  { id: 19, created_at: '2026-09-12T10:05:52+08:00', operator_name: '李老师', operator_account: 'EDU-881', operator_role: '院系运营', action: '更新本院系知识文档', module: '知识库治理', target_name: '《计算机学院实验室安全须知》', ip: '202.108.22.5', client_name: '外网直连（未认证源）', env: '生产' },
  { id: 20, created_at: '2026-09-11T16:39:14+08:00', operator_name: '林宪成', operator_account: 'ENP-001', operator_role: '超管', action: '解冻被锁定账号', module: '用户管理', target_name: '学号: 2022010834', target_meta: 'Active', ip: '10.12.88.42', client_name: '校内网 · 教务行政楼', env: '生产' },
  { id: 21, created_at: '2026-09-11T09:50:03+08:00', operator_name: '陈雪怡', operator_account: 'AUD-104', operator_role: '审核员', action: '纠正并重新生成答复', module: '内容审核', target_name: '工单 #AUD-2024-8891', target_meta: '已纠正', ip: '10.12.89.105', client_name: '教务办固定终端', env: '生产' },
  { id: 22, created_at: '2026-09-10T15:28:47+08:00', operator_name: '系统定时调度器', operator_account: 'CronJob', operator_role: 'Log-Rotator', action: '生成合规月报', module: '系统配置', target_name: '周期: 2026-08', ip: '127.0.0.1', client_name: '本机任务容器 (Async)', env: '生产' },
]

const ACTION_TONE: Record<string, AuditLog['action_tone']> = {
  覆盖更新版本: 'ink',
  强制驳回并纠错: 'coral',
  自动爬取教务通知: 'emerald',
  临时禁用违规账号: 'coral',
  尝试删除全局基础文档: 'coral',
  调整模型降级阈值: 'ink',
  重建全量向量索引: 'emerald',
  导出操作日志明细: 'ink',
  批量通过复核工单: 'emerald',
  新增管理员账号: 'emerald',
  下线知识文档: 'amber',
  查看本院系问答明细: 'amber',
  解冻被锁定账号: 'emerald',
  发布新版政策切片: 'emerald',
  标记幻觉输出: 'coral',
  归档历史审计日志: 'slate',
  调整角色权限矩阵: 'ink',
  开启双因子强制校验: 'ink',
  更新本院系知识文档: 'ink',
  纠正并重新生成答复: 'amber',
  生成合规月报: 'slate',
}

const MODULE_LABEL: Record<string, string> = {
  知识库治理: '知识库治理',
  内容审核: '内容审核',
  知识库同步: '知识库同步',
  用户管理: '用户管理',
  系统配置: '系统配置',
  操作日志: '操作日志',
  系统观察: '系统观察',
}

export const mockAuditLogs: AuditLog[] = rawLogs.map((log) => ({
  ...log,
  // 绝对时间 → 相对当下（见上方 rawLogs 前的说明）
  created_at: shiftLogTime(log.created_at),
  result: log.result ?? 'ok',
  action_label: log.action,
  action_tone: ACTION_TONE[log.action] ?? 'ink',
  module_label: MODULE_LABEL[log.module] ?? log.module,
  target_type: log.module,
  detail: `${log.operator_name} 在 ${log.client_name} 执行「${log.action}」`,
}))

export const mockAuditSummary: AuditSummary = {
  today_events: 1482,
  today_events_delta: 0.12,
  high_risk_blocked: 4,
  auto_task_rate: 0.684,
  retention_days: 90,
  total: 1482,
}

/* ---------- 用户与角色（后端未提供） -------------------------------------- */

export const mockUserStats: UserStats = {
  total: 38420,
  active_today: 6210,
  active_ratio: 0.161,
  admin_seats: 24,
  admin_ratio: 0.358,
  pending_identity: 142,
}

export const mockRoles: AdminRole[] = [
  {
    key: 'super_admin',
    name: '超级管理员',
    kind: '系统角色',
    member_count: 4,
    description: '全域最高控制权，涵盖智能体总控编排、大模型级切换、密钥管理、安全审计与数据库底层治理。',
    capabilities: ['全部 16 项特权', 'MFA 强制绑定'],
    scope_note: '配置角色策略',
  },
  {
    key: 'knowledge_governor',
    name: '知识库治理管理员',
    kind: '业务角色',
    member_count: 6,
    description: '校园规章、办事指引文档编目、向量快切分配置与知识同步审核。',
    capabilities: ['知识编目 / Diff 审查', '覆盖 教务处与学工处 数据'],
  },
  {
    key: 'content_auditor',
    name: '内容合规审核员',
    kind: '业务角色',
    member_count: 8,
    description: '实时干预学生提问敏感词触发、CampusFlow 异常幻觉复核与高风险问答驳回。',
    capabilities: ['工单闭环 / 风险拦截', '响应 SLA < 5m'],
  },
  {
    key: 'department_viewer',
    name: '院系运营查看者',
    kind: '受限角色',
    member_count: 6,
    description: '仅限查看所属二级学院师生咨询热词、服务调用频度与问题聚类分类。',
    capabilities: ['报表只读权限', '院系级数据隔离'],
  },
]

export const mockAdminUsers: AdminUser[] = [
  { id: 1, name: '林宪成', account: '10008892', email: 'lin.xiancheng@univ.edu.cn', department: '信息与网络中心', role_key: 'super_admin', role_name: '超级管理员', status: 'active', last_login_at: '2026-09-15T15:42:00+08:00', last_login_ip: '10.128.4.19', network: '内网', identity_note: '普通 身份' },
  { id: 2, name: '沈清河', account: '10004120', email: 'shen.qh@univ.edu.cn', department: '教务处综合办公室', role_key: 'knowledge_governor', role_name: '知识库治理管理员', status: 'active', last_login_at: '2026-09-15T09:22:00+08:00', last_login_ip: '10.128.88.54', network: '内网', identity_note: '普通 身份' },
  { id: 3, name: '周静依', account: '10006733', email: 'zhou.jy@cs.univ.edu.cn', department: '计算机科学与技术学院学工组', role_key: 'content_auditor', role_name: '内容合规审核员', status: 'active', last_login_at: '2026-09-14T17:45:00+08:00', last_login_ip: '114.242.18.9', network: '校园 VPN', identity_note: '普通 身份' },
  { id: 4, name: '徐浩天', account: '2023301045', email: 'xu.haotian@stu.univ.edu.cn', department: '自动化学院（研一）', role_key: 'department_viewer', role_name: '院系运营查看者', status: 'pending', last_login_at: null, last_login_ip: null, network: '', identity_note: '待激活 · 等待身份核验' },
  { id: 5, name: '董建林', account: '10002014', email: 'dong.jl@retired.univ.edu.cn', department: '管理与经济学院（已离休）', role_key: 'department_viewer', role_name: '院系运营查看者', status: 'locked', last_login_at: null, last_login_ip: null, network: '', identity_note: 'CAS 令牌已注销 · 182 天前' },
  { id: 6, name: '张建国', account: '10002874', email: 'zhang.jg@univ.edu.cn', department: '信息中心 安全审计组', role_key: 'super_admin', role_name: '超级管理员', status: 'active', last_login_at: '2026-09-15T14:02:00+08:00', last_login_ip: '10.15.20.14', network: 'VPN', identity_note: '普通 身份' },
  { id: 7, name: '陈雪怡', account: '10003188', email: 'chen.xy@jwc.univ.edu.cn', department: '教务处 教学质量科', role_key: 'content_auditor', role_name: '内容合规审核员', status: 'active', last_login_at: '2026-09-15T16:15:00+08:00', last_login_ip: '10.12.89.105', network: '内网', identity_note: '普通 身份' },
  { id: 8, name: '王海涛', account: '10004301', email: 'wang.ht@audit.univ.edu.cn', department: '纪检监察 合规审计室', role_key: 'super_admin', role_name: '超级管理员', status: 'active', last_login_at: '2026-09-14T20:12:00+08:00', last_login_ip: '10.12.88.19', network: '内网', identity_note: '普通 身份' },
  { id: 9, name: '李慧敏', account: '10005120', email: 'li.hm@lib.univ.edu.cn', department: '图书馆 数字资源部', role_key: 'knowledge_governor', role_name: '知识库治理管理员', status: 'active', last_login_at: '2026-09-14T10:30:00+08:00', last_login_ip: '10.128.66.31', network: '内网', identity_note: '普通 身份' },
  { id: 10, name: '赵启明', account: '10006022', email: 'zhao.qm@xxh.univ.edu.cn', department: '信息化办公室 应用支持科', role_key: 'knowledge_governor', role_name: '知识库治理管理员', status: 'active', last_login_at: '2026-09-13T08:12:00+08:00', last_login_ip: '10.128.4.77', network: '内网', identity_note: '普通 身份' },
  { id: 11, name: '孙振宇', account: '10007155', email: 'sun.zy@bwc.univ.edu.cn', department: '保卫处 秩序管理科', role_key: 'department_viewer', role_name: '院系运营查看者', status: 'active', last_login_at: '2026-09-12T10:20:00+08:00', last_login_ip: '10.128.9.12', network: '内网', identity_note: '普通 身份' },
  { id: 12, name: '许文倩', account: '2022100208', email: 'xu.wq@stu.univ.edu.cn', department: '外国语学院（大四）', role_key: 'department_viewer', role_name: '院系运营查看者', status: 'disabled', last_login_at: '2026-08-30T15:00:00+08:00', last_login_ip: '10.128.30.8', network: '内网', identity_note: '毕业离校 · 账号停用' },
]

/* ---------- 系统设置（后端未提供） ---------------------------------------- */

export const mockSettings: SystemSettings = {
  security: {
    admin_idle_logout_minutes: 30,
    admin_mfa_enabled: true,
    ip_allowlist_enabled: false,
    ip_allowlist: '10.128.4.0/24\n172.16.0.0/12',
    immutable_log_enabled: true,
    retention_days: 90,
    updated_at: '2026-09-15T11:50:12+08:00',
    updated_by: '林宪成（系统超管）',
  },
  rag: {
    active_model: 'CampusFlow-Qwen2-7B-32k (本地自有版本授权 V7)',
    max_context_tokens: 8192,
    top_k: 5,
    similarity_threshold: 0.75,
    escalation_enabled: true,
    escalation_min_score: 0.65,
    auto_block_hallucination: true,
    auto_route_unresolved: false,
    updated_at: '2026-09-15T11:50:12+08:00',
    updated_by: '林宪成（系统超管）',
  },
  environment: 'CAMPUS_ENV_META',
  audit_note: '所有配置变更均会写入审计日志，并保留最近 90 天记录。',
}

/* ---------- 知识分类（文档 11.3 `GET /knowledge/categories`） -------------- */

/**
 * 与上面 mockKnowledgeDocs 用到的 category 名称保持一致，上传弹窗的分类下拉才有可对照性。
 *
 * ⚠️ `document_count` 之和必须等于 `mockKnowledgeHealth.documents.total`（1428）。
 * 治理页把这两个数放在同一排指标卡上（「文档总数」与「知识分类 › 已归类 N 篇」），
 * 对不上就是当场露馅 —— 原先写的是 1/1/1/1/1/2，和为 7，却与总数 1428 并排显示。
 */
export const mockKnowledgeCategories: KnowledgeCategory[] = [
  { id: 1, name: '教务', document_count: 412 },
  { id: 2, name: '后勤保障', document_count: 286 },
  { id: 3, name: '奖助学金', document_count: 258 },
  { id: 4, name: '学生事务', document_count: 214 },
  { id: 5, name: '校园生活', document_count: 143 },
  { id: 6, name: '校园安全', document_count: 115 },
]

/** 上传建档用的自增 id，mock 下让新文档真的出现在列表里。 */
export const nextMockDocId = () => mockKnowledgeDocs.reduce((max, doc) => Math.max(max, doc.id), 0) + 1

/* ---------- 知识库入库（AI 服务 /api/v2） --------------------------------- */

/**
 * 待入库文件 —— `GET /knowledge/pending-files` 的 mock 种子。
 *
 * 刻意覆盖四种组合，否则这些分支在 UI 评审时根本看不见：
 *   none     → 显示「加入知识库」
 *   failed   → 显示「重试」（验证 409 retry_required 那条路）
 *   scanning → 扫描没走完，按钮禁用并说明原因（不是所有文件都能入库）
 *   removed  → 曾入库后被移出，可重新加入
 */
export const mockPendingFiles: PendingKnowledgeFile[] = [
  {
    fileId: 701,
    fileName: '本科生转专业实施细则（2026修订）.pdf',
    title: null,
    sizeBytes: 2_412_800,
    contentType: 'application/pdf',
    extension: 'pdf',
    scanStatus: 'ready',
    uploadedAt: '2026-09-20T18:40:00+08:00',
    ingestStatus: 'none',
    documentId: null,
    versionId: null,
    chunkCount: null,
    categoryCode: null,
    categoryName: null,
  },
  {
    fileId: 702,
    fileName: '校园快递服务管理规定.docx',
    title: '校园快递服务管理规定',
    sizeBytes: 1_048_576,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: 'docx',
    scanStatus: 'ready',
    uploadedAt: '2026-09-20T17:05:00+08:00',
    ingestStatus: 'failed',
    documentId: 91,
    versionId: 205,
    chunkCount: 0,
    categoryCode: 'logistics',
    categoryName: '后勤保障',
  },
  {
    fileId: 703,
    fileName: '实验室安全准入培训办法.pdf',
    title: null,
    sizeBytes: 3_355_443,
    contentType: 'application/pdf',
    extension: 'pdf',
    scanStatus: 'scanning',
    uploadedAt: '2026-09-20T19:30:00+08:00',
    ingestStatus: 'none',
    documentId: null,
    versionId: null,
    chunkCount: null,
    categoryCode: null,
    categoryName: null,
  },
  {
    fileId: 704,
    fileName: '2021年度公费医疗报销实施细则.pdf',
    title: '2021年度公费医疗报销实施细则',
    sizeBytes: 890_000,
    contentType: 'application/pdf',
    extension: 'pdf',
    scanStatus: 'ready',
    uploadedAt: '2026-09-18T09:12:00+08:00',
    ingestStatus: 'removed',
    documentId: 88,
    versionId: 201,
    chunkCount: 36,
    categoryCode: 'student_affairs',
    categoryName: '学生事务',
  },
]

/** 入库用的自增 id，与文档 id 分开编号，避免 mock 下两者撞号看不出问题。 */
let mockDocSeq = 90
let mockVerSeq = 210
export const nextMockIngestDocumentId = () => (mockDocSeq += 1)
export const nextMockIngestVersionId = () => (mockVerSeq += 1)

/**
 * mock 下模拟「Java 把上传落到 files 表」这一步。
 *
 * 没有它，上传完的文件不会出现在「待入库」区 ——
 * 于是「上传 → 待入库 → 入库 → 出现在文档列表」整条闭环在 mock 下是断的，
 * 评审时看着像没接上。（真实环境里这一步由 Java 的 `POST /files/presign` 完成。）
 */
export const registerMockUploadedFile = (file: {
  fileId: number
  fileName: string
  sizeBytes: number
  contentType?: string
}) => {
  const dot = file.fileName.lastIndexOf('.')
  mockPendingFiles.unshift({
    fileId: file.fileId,
    fileName: file.fileName,
    title: null,
    sizeBytes: file.sizeBytes,
    contentType: file.contentType,
    extension: dot >= 0 ? file.fileName.slice(dot + 1).toLowerCase() : '',
    scanStatus: 'ready',
    uploadedAt: new Date().toISOString(),
    ingestStatus: 'none',
    documentId: null,
    versionId: null,
    chunkCount: null,
    categoryCode: null,
    categoryName: null,
  })

  /**
   * 同步进「内容审核」（文件审核台）列表：上传即落 `files` 表（真实环境由
   * `POST /files/presign` 完成，扫描链路随后接管）。待入库 mock 已标
   * `scanStatus=ready`，这里保持同一结论 —— 两份数据必须自洽
   * （mock 是契约的第二实现，自己打架会被当成真 Bug）。
   */
  mockFileReviews.unshift({
    id: file.fileId,
    owner_id: 1,
    purpose: 'knowledge_doc',
    original_name: file.fileName,
    content_type: file.contentType || 'application/octet-stream',
    size_bytes: file.sizeBytes,
    status: 'ready',
    scan_result: {
      mime: { declared: file.contentType || '', detected: file.contentType || '', matched: true },
      virus: { verdict: 'clean', engine: 'clamav', signature: '', detail: '' },
      moderation: [{ engine: 'tms-text', passed: true, riskLevel: 'none', label: 'pass', reason: '' }],
      scanned_at: new Date().toISOString(),
      duration_ms: 2380,
    },
    uploaded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
}

/* ---------- 文件内容审核（契约草案 /admin/files，见《接口对接说明》2.2） ------ */

/**
 * 文件审核种子 —— `files` 表 + `files.scan_result`（json 列）的 mock 第二实现。
 *
 * 🔴 字段形状对齐后端 `FileScanServiceImpl` 的组装，**不自造结构**：
 *   mime {declared, detected, matched} / virus {verdict, engine, signature, detail} /
 *   moderation [{engine, passed, riskLevel, label, reason}] 或 {skipped, reason} /
 *   reason_code / reason / scanned_at / duration_ms / compensation {attempts, last_attempt_at}。
 *   注意 `reason_code` 只有 rejected / pending（保持 scanning）两出口才写；
 *   ready 的记录没有它 —— 「没审出问题」与「审过且通过」在数据上是两回事。
 *
 * 覆盖矩阵（派生态见 services/fileReview.ts 的 fileReviewStateOf）：
 *   转人工 ×3   needs_review（文本）/ content_truncated（超长部分送审）/ needs_review（图片 IMS）
 *   扫描中 ×1   scanner_unavailable，带补偿计数（等重投，不是等人）
 *   已通过 ×3   文本链全过 / 图片 IMS 过 / moderation.skipped（无可审核文本 ——
 *               后端刻意不写 passed:true，详情里要能看出「这条没做内容审核」）
 *   已驳回 ×3   mime_mismatch（扩展名伪装）/ virus（EICAR）/ moderation（IMS block）
 */
export const mockFileReviews: FileReviewItem[] = [
  {
    id: 908,
    owner_id: 1,
    purpose: 'knowledge_doc',
    original_name: '校园网使用安全承诺书.pdf',
    content_type: 'application/pdf',
    size_bytes: 812_004,
    sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    status: 'rejected',
    scan_result: {
      mime: { declared: 'application/pdf', detected: 'application/pdf', matched: true },
      virus: {
        verdict: 'infected',
        engine: 'clamav',
        signature: 'Win.Test.EICAR_HDB-1',
        detail: 'stream: Win.Test.EICAR_HDB-1 FOUND',
      },
      reason_code: 'virus',
      reason: '检测到恶意文件：Win.Test.EICAR_HDB-1',
      scanned_at: '2026-10-15T09:41:52+08:00',
      duration_ms: 8940,
    },
    uploaded_at: '2026-10-15T09:41:00+08:00',
    updated_at: '2026-10-15T09:41:52+08:00',
  },
  {
    id: 907,
    owner_id: 3,
    purpose: 'knowledge_doc',
    original_name: '转专业申请材料清单与模板（2026 版）.docx',
    content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size_bytes: 1_204_224,
    sha256: '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
    status: 'scanning',
    scan_result: {
      mime: { declared: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', detected: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', matched: true },
      virus: { verdict: 'clean', engine: 'clamav', signature: '', detail: '' },
      moderation: [
        { engine: 'tms-text', passed: false, riskLevel: 'medium', label: 'needs_review', reason: '第 3 节表述处于政策灰区，自动判定给不出结论' },
      ],
      reason_code: 'needs_review',
      reason: '文本审核器对个别段落给不出结论，转人工复核。',
      scanned_at: '2026-10-15T10:02:11+08:00',
      duration_ms: 5310,
    },
    uploaded_at: '2026-10-15T10:01:00+08:00',
    updated_at: '2026-10-15T10:02:11+08:00',
  },
  {
    id: 906,
    owner_id: 2,
    purpose: 'knowledge_doc',
    original_name: '历年奖学金评定细则汇编（2019-2026）.pdf',
    content_type: 'application/pdf',
    size_bytes: 18_874_368,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    status: 'scanning',
    scan_result: {
      mime: { declared: 'application/pdf', detected: 'application/pdf', matched: true },
      virus: { verdict: 'clean', engine: 'clamav', signature: '', detail: '' },
      moderation: [
        { engine: 'tms-text', passed: true, riskLevel: 'none', label: 'pass', reason: '' },
      ],
      reason_code: 'content_truncated',
      reason: '文档超出单次送审上限，仅审核了抽出的那一段，剩余内容未审，转人工复核。',
      scanned_at: '2026-10-15T08:47:30+08:00',
      duration_ms: 12_760,
    },
    uploaded_at: '2026-10-15T08:45:12+08:00',
    updated_at: '2026-10-15T08:47:30+08:00',
  },
  {
    id: 905,
    owner_id: 4,
    purpose: 'task_material',
    original_name: '宿舍报修现场照片.jpg',
    content_type: 'image/jpeg',
    size_bytes: 3_145_728,
    sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
    status: 'scanning',
    scan_result: {
      mime: { declared: 'image/jpeg', detected: 'image/jpeg', matched: true },
      virus: { verdict: 'clean', engine: 'clamav', signature: '', detail: '' },
      moderation: [
        { engine: 'ims', passed: false, riskLevel: 'medium', label: 'needs_review', reason: '图片审核置信度处于灰区，转人工' },
      ],
      reason_code: 'needs_review',
      reason: '图片审核置信度处于灰区，转人工复核。',
      scanned_at: '2026-10-14T17:22:40+08:00',
      duration_ms: 3120,
    },
    uploaded_at: '2026-10-14T17:21:55+08:00',
    updated_at: '2026-10-14T17:22:40+08:00',
  },
  {
    id: 904,
    owner_id: 1,
    purpose: 'knowledge_doc',
    original_name: '实验室安全准入培训手册（插图版）.pdf',
    content_type: 'application/pdf',
    size_bytes: 9_437_184,
    sha256: '185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969',
    status: 'scanning',
    scan_result: {
      mime: { declared: 'application/pdf', detected: 'application/pdf', matched: true },
      virus: {
        verdict: 'unavailable',
        engine: 'clamav',
        signature: '',
        detail: 'clamd 连接超时（192.168.150.100:3310）',
      },
      reason_code: 'scanner_unavailable',
      reason: '病毒扫描器不可用：clamd 连接超时。保持待扫，等补偿重投。',
      scanned_at: '2026-10-14T22:10:05+08:00',
      duration_ms: 30_120,
      compensation: { attempts: 2, last_attempt_at: '2026-10-15T06:30:00+08:00' },
    },
    uploaded_at: '2026-10-14T22:08:41+08:00',
    updated_at: '2026-10-15T06:30:00+08:00',
  },
  {
    id: 903,
    owner_id: 2,
    purpose: 'knowledge_doc',
    original_name: '学生违纪处分条例（2024 修订）.pdf',
    content_type: 'application/pdf',
    size_bytes: 2_411_520,
    sha256: '62c3f7c4a1e5d2b8f0a9c6e3d1b4a7f2c5e8d1a4b7c0e3f6a9d2c5b8e1a4d7c0',
    status: 'ready',
    scan_result: {
      mime: { declared: 'application/pdf', detected: 'application/pdf', matched: true },
      virus: { verdict: 'clean', engine: 'clamav', signature: '', detail: '' },
      moderation: [
        { engine: 'tms-text', passed: true, riskLevel: 'none', label: 'pass', reason: '' },
        { engine: 'rules', passed: true, riskLevel: 'none', label: 'pass', reason: '' },
      ],
      scanned_at: '2026-10-13T14:31:20+08:00',
      duration_ms: 4210,
    },
    uploaded_at: '2026-10-13T14:30:02+08:00',
    updated_at: '2026-10-13T14:31:20+08:00',
  },
  {
    id: 902,
    owner_id: 5,
    purpose: 'task_material',
    original_name: '社团招新宣传海报（终版）.png',
    content_type: 'image/png',
    size_bytes: 2_097_152,
    sha256: 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
    status: 'rejected',
    scan_result: {
      mime: { declared: 'image/png', detected: 'image/png', matched: true },
      virus: { verdict: 'clean', engine: 'clamav', signature: '', detail: '' },
      moderation: [
        { engine: 'ims', passed: false, riskLevel: 'high', label: 'block', reason: '图片命中违禁类目，机审直接拦截' },
      ],
      reason_code: 'moderation',
      reason: '内容审核未通过：图片命中违禁类目。',
      scanned_at: '2026-10-13T11:08:44+08:00',
      duration_ms: 2760,
    },
    uploaded_at: '2026-10-13T11:08:01+08:00',
    updated_at: '2026-10-13T11:08:44+08:00',
  },
  {
    id: 901,
    owner_id: 6,
    purpose: 'avatar',
    original_name: 'avatar_2026_03.png',
    content_type: 'image/png',
    size_bytes: 184_320,
    sha256: 'bb96ef1ec6d2c8a7b3f5e0d9a2c7b4f1e8d3a6c9b2f5e8d1a4c7b0e3f6a9d2c5',
    status: 'ready',
    scan_result: {
      mime: { declared: 'image/png', detected: 'image/png', matched: true },
      virus: { verdict: 'clean', engine: 'clamav', signature: '', detail: '' },
      moderation: [
        { engine: 'ims', passed: true, riskLevel: 'none', label: 'pass', reason: '' },
      ],
      scanned_at: '2026-10-12T18:00:12+08:00',
      duration_ms: 1470,
    },
    uploaded_at: '2026-10-12T17:59:40+08:00',
    updated_at: '2026-10-12T18:00:12+08:00',
  },
  {
    id: 900,
    owner_id: 3,
    purpose: 'knowledge_doc',
    original_name: '活动经费报销明细（2026-09）.pdf',
    content_type: 'application/pdf',
    size_bytes: 96_256,
    sha256: '38b060a751ac96384e9d8e7c1d2b3a4f5e6d7c8b9a0f1e2d3c4b5a6f7e8d9c0b',
    status: 'rejected',
    scan_result: {
      mime: { declared: 'application/pdf', detected: 'application/zip', matched: false },
      virus: { verdict: 'clean', engine: 'clamav', signature: '', detail: '' },
      reason_code: 'mime_mismatch',
      reason: '声明类型与探测类型不一致：疑似扩展名伪装，文件内容是 zip 归档。',
      scanned_at: '2026-10-12T15:44:30+08:00',
      duration_ms: 380,
    },
    uploaded_at: '2026-10-12T15:44:02+08:00',
    updated_at: '2026-10-12T15:44:30+08:00',
  },
  {
    id: 899,
    owner_id: 1,
    purpose: 'knowledge_doc',
    original_name: '盖章页扫描件（无文字层）.pdf',
    content_type: 'application/pdf',
    size_bytes: 668_467,
    sha256: '4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a',
    status: 'ready',
    scan_result: {
      mime: { declared: 'application/pdf', detected: 'application/pdf', matched: true },
      virus: { verdict: 'clean', engine: 'clamav', signature: '', detail: '' },
      moderation: {
        skipped: true,
        reason: '无可审核文本（空文本或不支持抽取的格式）。未做内容审核，不等于已通过。',
      },
      scanned_at: '2026-10-12T10:22:18+08:00',
      duration_ms: 2210,
    },
    uploaded_at: '2026-10-12T10:21:50+08:00',
    updated_at: '2026-10-12T10:22:18+08:00',
  },
]

/**
 * 人工处置（RESERVED · POST /admin/files/{id}/resolve）的 mock 第二实现：
 * approve → ready / reject → rejected，写 `manual` 处置记录与 `reason_code`，
 * 保留既有 mime / virus / moderation 步骤（处置前的链路结论仍要可追溯）。
 * 找不到记录返回 null（服务层译成 404 业务错误）。
 */
export const applyMockFileResolve = (
  id: number,
  action: FileReviewAction,
  comment?: string,
): FileReviewResolveResult | null => {
  const item = mockFileReviews.find((file) => file.id === id)
  if (!item) return null
  const at = new Date().toISOString()
  item.status = action === 'approve' ? 'ready' : 'rejected'
  item.scan_result = {
    ...(item.scan_result ?? {}),
    reason_code: action === 'approve' ? 'manual_approve' : 'manual_reject',
    reason: comment ?? (action === 'approve' ? '人工复核通过' : '人工复核驳回'),
    scanned_at: at,
    manual: { action, by: '管理员', at, ...(comment ? { comment } : {}) },
  }
  item.updated_at = at
  return { id, status: item.status, action, resolved_at: at }
}

/**
 * 重新扫描（RESERVED · POST /admin/files/{id}/rescan）的 mock 第二实现：
 * 状态回到 scanning、结论作废只保留补偿计数 —— 与后端 `markScanning` 不覆盖
 * `scan_result`、重扫完成时整体覆盖的语义一致（FileScanRetryServiceImpl 的
 * compensation 约定）。已通过（ready）的文件不允许重扫，返回 'ready_conflict'
 * （服务层译成 409：链路已放行，重扫没有意义）。
 */
export const applyMockFileRescan = (id: number): FileReviewRescanResult | 'ready_conflict' | null => {
  const item = mockFileReviews.find((file) => file.id === id)
  if (!item) return null
  if (item.status === 'ready') return 'ready_conflict'
  const at = new Date().toISOString()
  item.status = 'scanning'
  item.scan_result = {
    compensation: {
      attempts: (item.scan_result?.compensation?.attempts ?? 0) + 1,
      last_attempt_at: at,
    },
  }
  item.updated_at = at
  return { id, status: 'scanning', requeued_at: at }
}

/* ---------- 校园新闻（文档第 12 章） --------------------------------------- */

/**
 * 分类口径按文档 A.7.3：`key` 与 `name` 同值，
 * 且筛选参数要传 `name`（文档 12.1 明确「不要传 categories[].key 作为筛选值」）。
 * 这里刻意让两者同值，避免 mock 掩盖掉「传错字段」的问题。
 */
export const mockNewsCategories: NewsCategory[] = [
  { key: '教务', name: '教务', count: 2 },
  { key: '奖助学金', name: '奖助学金', count: 2 },
  { key: '国际交流', name: '国际交流', count: 1 },
  { key: '就业', name: '就业', count: 1 },
  { key: '服务通知', name: '服务通知', count: 1 },
]

export const mockNews: NewsItem[] = [
  {
    id: 89,
    category: '教务',
    department: '教务处',
    title: '2026 年本科生转专业工作正式启动',
    summary: '转专业申请通道现已开放，请符合条件的学生按时提交申请。',
    published_at: '2026-09-04T08:00:00+08:00',
    deadline_at: '2026-09-15T17:00:00+08:00',
    is_bookmarked: true,
    is_spotlight: false,
  },
  {
    id: 92,
    category: '奖助学金',
    department: '学生资助管理中心',
    title: '2026 年度国家奖学金申请通知',
    summary: '线上申请已开放，请申请人准备成绩单与获奖证明。',
    published_at: '2026-09-02T09:00:00+08:00',
    deadline_at: '2026-09-18T17:00:00+08:00',
    is_bookmarked: true,
    is_spotlight: false,
  },
  {
    id: 95,
    category: '教务',
    department: '教务处',
    title: '2026 年秋季学期选课工作安排',
    summary: '本轮选课分预选、正选两个阶段，逾期不再补选。',
    published_at: '2026-09-08T10:20:00+08:00',
    deadline_at: '2026-09-12T23:59:00+08:00',
    is_spotlight: false,
  },
  {
    id: 97,
    category: '国际交流',
    department: '国际交流处',
    title: '2027 年春季学期校际交换生项目报名启动',
    summary: '共 14 所合作院校开放名额，需提交语言成绩与在读证明。',
    published_at: '2026-09-09T14:05:00+08:00',
    deadline_at: '2026-09-26T17:00:00+08:00',
    is_spotlight: false,
  },
  {
    id: 99,
    category: '就业',
    department: '学生就业指导中心',
    title: '2026 届秋季校园双选会参会指南',
    summary: '首批 186 家用人单位进场，需提前在就业系统预约场次。',
    published_at: '2026-09-11T09:30:00+08:00',
    deadline_at: '2026-09-20T17:00:00+08:00',
    is_spotlight: false,
  },
  {
    id: 101,
    category: '服务通知',
    department: '学生工作部',
    title: '一站式学生服务大厅国庆假期服务时间调整',
    summary: '假期前三日仅开放线上办理，线下窗口自 10 月 4 日恢复。',
    published_at: '2026-09-13T16:40:00+08:00',
    deadline_at: null,
    is_spotlight: false,
  },
  {
    id: 103,
    category: '奖助学金',
    department: '学生资助管理中心',
    title: '2026 年国家励志奖学金名额分配公示',
    summary: '各学院名额与评审时间节点公示 5 个工作日，异议可向资助中心提出。',
    published_at: '2026-09-14T11:00:00+08:00',
    deadline_at: '2026-09-21T17:00:00+08:00',
    is_spotlight: false,
  },
]

/**
 * 新闻源。`status` 除文档示例的 `active` 外，还刻意放了一个 `paused`，
 * 让「停用某个源」这条路径在评审时可见 —— 该取值已登记为待后端确认（见《接口对接说明.md》）。
 * 最后一条 `source_type: 'manual'` 对应数据表 `news_sources.source_type` 的 manual，
 * 没有 base_url 也就不参与抓取同步。
 */
export const mockNewsSources: NewsSource[] = [
  {
    id: 88,
    name: '教务处通知公告',
    base_url: 'https://jwc.example.edu.cn/notice',
    source_type: 'html',
    status: 'active',
    sync_interval_minutes: 30,
    last_synced_at: '2026-09-15T15:30:00+08:00',
    category: '教务',
    selector: { list: '.notice-list li', title: 'a', published_at: '.date' },
  },
  {
    id: 91,
    name: '学生工作部公告',
    base_url: 'https://xgb.example.edu.cn/tzgg',
    source_type: 'html',
    status: 'active',
    sync_interval_minutes: 60,
    last_synced_at: '2026-09-15T09:00:00+08:00',
    category: '服务通知',
    selector: { list: '.news-item', title: 'h3 a', published_at: 'span.time' },
  },
  {
    id: 94,
    name: '国际交流处动态',
    base_url: 'https://gjjl.example.edu.cn/rss.xml',
    source_type: 'rss',
    status: 'paused',
    sync_interval_minutes: 120,
    last_synced_at: '2026-09-12T20:00:00+08:00',
    category: '国际交流',
  },
  {
    id: 96,
    name: '就业指导中心招聘速递',
    base_url: 'https://job.example.edu.cn/news',
    source_type: 'html',
    status: 'active',
    sync_interval_minutes: 45,
    last_synced_at: '2026-09-13T11:15:00+08:00',
    category: '就业',
    selector: { list: '.recruit-list > li', title: '.recruit-title', published_at: '.pub-date' },
  },
  {
    id: 98,
    name: '校办综合管理平台（人工录入）',
    source_type: 'manual',
    status: 'active',
    last_synced_at: null,
    category: '教务',
  },
]

/** 同步/改写新闻源后回一个更新时间，mock 下让「刚才改过」这件事看得见。 */
export const touchMockNewsSource = (id: number, patch: Partial<NewsSource>) => {
  const index = mockNewsSources.findIndex((source) => source.id === id)
  if (index < 0) return undefined
  const next = { ...mockNewsSources[index], ...patch }
  mockNewsSources[index] = next
  return next
}

/* ---------- 管理端新闻发布（POST/PATCH/DELETE /news/admin/news 的 mock 第二实现） ---------- */

/**
 * 🔴 live 的 `GET /news` 有硬条件 `status='published'`（CampusNewsServiceImpl#getNewsList），
 * 草稿与已下线稿件在新闻流里**看不见** —— mock 必须复刻这个行为：
 * 「存了草稿却出现在列表里」会把契约演错，让评审得出「后端会展示草稿」的错误结论。
 * 下线/存草稿的条目搬进 `mockNewsHidden`，重新上线再搬回 `mockNews`（会话内可往复），
 * `published_at` 随条目保留 —— 与后端「下线后再上线不重写发布时间」的约定一致。
 */
const mockNewsHidden: NewsItem[] = []

let mockNewsSeq = 110

/** 手工发布的可见范围台账。NewsItem 没有这个展示字段，单独记，PATCH 回显用。 */
const mockNewsVisibility = new Map<number, string>()

/** mock 时间戳统一带 +08:00（种子同款格式），别发 UTC 的 Z —— 契约第 11 条同理。 */
const nowShanghai = () => {
  const shifted = new Date(Date.now() + 8 * 3600 * 1000)
  return `${shifted.toISOString().slice(0, 19)}+08:00`
}

/** 分类计数跟着「已发布条目」走（`/news/categories` 的口径是新闻流可见数），保证 mock 自身自洽（契约第 6 条）。 */
const bumpMockCategoryCount = (category: string, delta: number) => {
  const hit = mockNewsCategories.find((item) => item.name === category)
  if (hit) hit.count = Math.max(0, hit.count + delta)
  else if (delta > 0) mockNewsCategories.push({ key: category, name: category, count: delta })
}

const writeResultOf = (item: NewsItem, status: string) => ({
  id: item.id,
  status,
  category: item.category,
  visibility: mockNewsVisibility.get(item.id) ?? 'campus',
  is_spotlight: !!item.is_spotlight,
  published_at: item.published_at ?? null,
  updated_at: nowShanghai(),
})

export const createMockNews = (payload: NewsAdminCreatePayload) => {
  const item: NewsItem = {
    id: (mockNewsSeq += 1),
    category: payload.category,
    title: payload.title,
    summary: payload.summary,
    deadline_at: payload.deadline_at ?? null,
    is_spotlight: !!payload.is_spotlight,
  }
  const status = payload.status ?? 'draft'
  mockNewsVisibility.set(item.id, payload.visibility ?? 'campus')
  if (status === 'published') {
    // 与后端一致：published_at 由服务端在首次发布时写入，前端传不了
    item.published_at = nowShanghai()
    mockNews.push(item)
    bumpMockCategoryCount(item.category, +1)
  } else {
    item.published_at = null
    mockNewsHidden.push(item)
  }
  return writeResultOf(item, status)
}

export const updateMockNews = (id: number, patch: NewsAdminUpdatePayload) => {
  let item = mockNews.find((entry) => entry.id === id)
  let hidden = false
  if (!item) {
    item = mockNewsHidden.find((entry) => entry.id === id)
    hidden = true
  }
  if (!item) return undefined

  if (patch.title != null) item.title = patch.title
  if (patch.summary != null) item.summary = patch.summary
  if (patch.deadline_at != null) item.deadline_at = patch.deadline_at
  if (patch.is_spotlight != null) item.is_spotlight = patch.is_spotlight
  if (patch.visibility != null) mockNewsVisibility.set(id, patch.visibility)
  if (patch.category != null && patch.category !== item.category && !hidden) {
    bumpMockCategoryCount(item.category, -1)
    item.category = patch.category
    bumpMockCategoryCount(patch.category, +1)
  } else if (patch.category != null) {
    item.category = patch.category
  }

  const status = patch.status
  if (status === 'published') {
    // 首次上线补发布时间；下线后再上线**不重写**（后端刻意保留，防止窜到列表最前面）
    if (!item.published_at) item.published_at = nowShanghai()
    if (hidden) {
      mockNewsHidden.splice(mockNewsHidden.indexOf(item), 1)
      mockNews.push(item)
      bumpMockCategoryCount(item.category, +1)
      hidden = false
    }
  } else if (status === 'offline' && !hidden) {
    mockNews.splice(mockNews.indexOf(item), 1)
    mockNewsHidden.push(item)
    bumpMockCategoryCount(item.category, -1)
    hidden = true
  } else if (status === 'archived' && !hidden) {
    mockNews.splice(mockNews.indexOf(item), 1)
    mockNewsHidden.push(item)
    bumpMockCategoryCount(item.category, -1)
    hidden = true
  }

  return writeResultOf(item, status ?? (hidden ? 'offline' : 'published'))
}

export const deleteMockNews = (id: number) => {
  const item = mockNews.find((entry) => entry.id === id) ?? mockNewsHidden.find((entry) => entry.id === id)
  if (!item) return undefined
  const wasPublished = mockNews.includes(item)
  if (wasPublished) {
    mockNews.splice(mockNews.indexOf(item), 1)
    bumpMockCategoryCount(item.category, -1)
  } else {
    mockNewsHidden.splice(mockNewsHidden.indexOf(item), 1)
  }
  return { id: item.id, deleted: true, deleted_at: nowShanghai() }
}

/* ---------- 管理端通知推送（/admin/notifications 的 mock 第二实现；后端未提供，契约见接口说明 2.7） ---------- */

/**
 * 广播通知 = `notifications` 表里 `user_id IS NULL` 的行（没有归属用户 = 全员可见，
 * 不做按人 fan-out）。种子时间与真库口径对齐：表里现有数据都是 2026-08-30 ~ 09-14
 * 的任务类系统通知，广播行从 100002 号段起（与真库 AUTO_INCREMENT 衔接）。
 */
export const mockAdminNotifications: AdminNotification[] = [
  {
    id: 100002,
    notification_type: 'announcement',
    title: '一站式学生服务大厅搬迁至大学生活动中心一层',
    content: '自 10 月 12 日起，原行政楼 115 室的服务窗口整体搬迁，办事请前往新大厅取号。',
    action_url: '/service-hall',
    is_read: false,
    created_at: '2026-09-28T09:30:00+08:00',
    expires_at: '2026-10-31T18:00:00+08:00',
  },
  {
    id: 100001,
    notification_type: 'announcement',
    title: '校园Flow 智能助手上线试运行',
    content: '全校师生可在学生端体验智能问答、办事指南与知识库检索，欢迎通过「意见反馈」提出建议。',
    action_url: null,
    is_read: false,
    created_at: '2026-09-20T14:00:00+08:00',
    expires_at: null,
  },
  {
    id: 100000,
    notification_type: 'system',
    title: '系统维护通知：10 月 15 日凌晨暂停服务',
    content: '平台将于 10 月 15 日 00:00-06:00 升级数据库，期间智能问答与办事任务暂时不可用。',
    action_url: null,
    is_read: false,
    created_at: '2026-09-26T17:20:00+08:00',
    expires_at: '2026-10-15T06:00:00+08:00',
  },
]

let mockNotificationSeq = 100003

export const createMockNotification = (payload: AdminNotificationCreatePayload) => {
  const item: AdminNotification = {
    id: (mockNotificationSeq += 1),
    notification_type: payload.notification_type ?? 'announcement',
    title: payload.title,
    content: payload.content,
    action_url: payload.action_url ?? null,
    is_read: false,
    created_at: nowShanghai(),
    expires_at: payload.expires_at ?? null,
  }
  // 最新在前，与列表查询的排序一致
  mockAdminNotifications.unshift(item)
  return {
    id: item.id,
    notification_type: item.notification_type,
    title: item.title,
    created_at: item.created_at,
    expires_at: item.expires_at ?? null,
  }
}

export const deleteMockNotification = (id: number) => {
  const index = mockAdminNotifications.findIndex((item) => item.id === id)
  if (index < 0) return undefined
  mockAdminNotifications.splice(index, 1)
  return { id, revoked: true, revoked_at: nowShanghai() }
}
