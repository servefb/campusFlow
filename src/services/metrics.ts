import { ensureApiSuccess, http } from './http'
import { isMock, mockDelay } from '../stores/dataMode'
import {
  getMockOverview,
  mockAgents,
  mockHotQuestions,
  mockKnowledgeHealth,
  mockReviewDetailExtra,
  mockReviews,
  mockResolvedReviews,
  mockTrend,
} from '../mocks/data'
import type {
  AgentMetrics,
  ApiSuccess,
  HotQuestions,
  KnowledgeHealth,
  MetricMeta,
  OverviewMetrics,
  Paged,
  ReviewAction,
  ReviewItem,
  ReviewResolvePayload,
  TrendMetrics,
} from '../types/api'

/**
 * 管理员看板与人工复核 —— 文档第 14 章，全部归业务服务 /api/v1。
 *
 * 实现进度（文档 18.1，2026-09-14 实测）：
 *   GET  /admin/metrics/*        已声明；AI 服务未启动不影响本组
 *   GET  /admin/reviews          已声明
 *   POST /admin/reviews/{id}/resolve  已声明
 * 指标元信息 `data_complete=false` 时前端不得把缺失值渲染成 0 —— 见类型定义。
 */

const meta = <T extends Partial<MetricMeta>>(extra: T) =>
  ({ updated_at: new Date().toISOString(), data_complete: true, ...extra }) as MetricMeta & T

/* ---------- 指标 ---------------------------------------------------------- */

export async function getOverview(range = 'today'): Promise<ApiSuccess<OverviewMetrics>> {
  if (isMock()) {
    await mockDelay()
    /*
     * 别再写成 `{ ...mockOverview, range }` —— 那样只覆盖 `range` 字段，
     * 六个指标数字不随窗口变，mock 下切档读数纹丝不动：
     * 看起来是「功能正常的空转」，实际是把 range 这个参数吞掉了。
     */
    return { code: 0, message: 'ok', data: getMockOverview(range), request_id: 'mock_overview' }
  }
  return (await http.get<ApiSuccess<OverviewMetrics>>('/admin/metrics/overview', { params: { range } })).data
}

export async function getTrends(range = 'today', interval = 'hour'): Promise<ApiSuccess<TrendMetrics>> {
  if (isMock()) {
    await mockDelay()
    return {
      code: 0,
      message: 'ok',
      data: { ...meta({ range, interval }), items: mockTrend },
      request_id: 'mock_trends',
    }
  }
  return (await http.get<ApiSuccess<TrendMetrics>>('/admin/metrics/trends', { params: { range, interval } })).data
}

export async function getAgentMetrics(range = 'today'): Promise<ApiSuccess<AgentMetrics>> {
  if (isMock()) {
    await mockDelay()
    return { code: 0, message: 'ok', data: { ...meta({ range }), items: mockAgents }, request_id: 'mock_agents' }
  }
  return (await http.get<ApiSuccess<AgentMetrics>>('/admin/metrics/agents', { params: { range } })).data
}

export async function getKnowledgeHealth(): Promise<ApiSuccess<KnowledgeHealth>> {
  if (isMock()) {
    await mockDelay()
    return { code: 0, message: 'ok', data: mockKnowledgeHealth, request_id: 'mock_knowledge_health' }
  }
  return (await http.get<ApiSuccess<KnowledgeHealth>>('/admin/metrics/knowledge-health')).data
}

export async function getHotQuestions(range = 'today'): Promise<ApiSuccess<HotQuestions>> {
  if (isMock()) {
    await mockDelay()
    return {
      code: 0,
      message: 'ok',
      data: { ...meta({ range }), items: mockHotQuestions },
      request_id: 'mock_hot_questions',
    }
  }
  return (await http.get<ApiSuccess<HotQuestions>>('/admin/metrics/hot-questions', { params: { range } })).data
}

/* ---------- 人工复核 ------------------------------------------------------ */

export async function getReviews(params: {
  status?: string
  page?: number
  page_size?: number
  risk?: string
  reason?: string
} = {}): Promise<ApiSuccess<Paged<ReviewItem>>> {
  const { status = 'pending', page = 1, page_size = 8, risk, reason } = params
  if (isMock()) {
    await mockDelay()
    const source = status === 'pending' ? mockReviews : mockResolvedReviews
    const filters: Array<(r: ReviewItem) => boolean> = []
    /*
     * 这条筛选原先漏了：`source` 只按「是否 pending」二分，
     * 于是 status=rejected 也会把 mockResolvedReviews 整个返回 ——
     * 「已通过」和「已驳回」两个数永远相等，而且都等于两者之和。
     *
     * mock 是接口契约的第二份实现，少一个筛选条件就等于契约少了一条；
     * 页面照它取数时不会报错，只会安静地显示一个错的数字。
     * mockResolvedReviews 里本来就有 `status` 字段，直接用它筛。
     */
    if (status !== 'pending') filters.push((r) => r.status === status)
    if (risk && risk !== 'all') filters.push((r) => r.risk === risk)
    if (reason && reason !== 'all') filters.push((r) => r.reason === reason)
    const filtered = source.filter((item) => filters.every((fn) => fn(item)))
    const start = (page - 1) * page_size
    const items = filtered.slice(start, start + page_size)
    return {
      code: 0,
      message: 'ok',
      data: { items, page, page_size, total: filtered.length, has_more: start + items.length < filtered.length },
      request_id: 'mock_reviews',
    }
  }
  return (
    await http.get<ApiSuccess<Paged<ReviewItem>>>('/admin/reviews', {
      params: { status, page, page_size, risk: risk === 'all' ? undefined : risk, reason: reason === 'all' ? undefined : reason },
    })
  ).data
}

export interface ReviewDetail extends ReviewItem {
  /** 原型「触发策略 / 模型 / 知识对齐与合规分析报告 / 建议操作」四段结构。
   *  后端当前只回 question/answer/citations，这块按可选字段处理，缺失时抽屉降级展示。 */
  extra?: typeof mockReviewDetailExtra[keyof typeof mockReviewDetailExtra]
}

export async function getReviewDetail(id: number | string): Promise<ApiSuccess<ReviewDetail>> {
  if (isMock()) {
    await mockDelay()
    const found = [...mockReviews, ...mockResolvedReviews].find((item) => String(item.id) === String(id))
    if (!found) throw new Error('复核记录不存在')
    const extra = mockReviewDetailExtra[Number(id) as keyof typeof mockReviewDetailExtra]
    return { code: 0, message: 'ok', data: { ...found, extra }, request_id: 'mock_review_detail' }
  }
  /*
   * 🔴 必须过 `ensureApiSuccess`：工单不存在时后端回的是 **200 / code 404 / data null**，
   * 不是真 404。不包的话 react-query 认为查询成功（没抛异常）→ `isError` 是 false →
   * 「工单详情加载失败」那条分支永远不显示，抽屉会渲染成一个字段全空的壳。
   */
  return ensureApiSuccess(
    (await http.get<ApiSuccess<ReviewDetail>>(`/admin/reviews/${id}`)).data,
    '工单详情加载失败',
  )
}

export async function resolveReview(
  id: number | string,
  payload: ReviewResolvePayload,
  idempotencyKey: string,
): Promise<ApiSuccess<{ id: number; status: string; action: ReviewAction; resolved_at: string }>> {
  if (isMock()) {
    await mockDelay(320)
    return {
      code: 0,
      message: '复核已完成',
      data: { id: Number(id), status: payload.action === 'reject' ? 'rejected' : 'resolved', action: payload.action, resolved_at: new Date().toISOString() },
      request_id: 'mock_resolve',
    }
  }
  /*
   * 三种拒绝都是 200 + code：404 工单不存在、400 非法动作 / 订正缺正文、409 已被他人处置。
   * 409 的原文带着「当前状态 + 动作 + 请刷新队列后重试」，比页面兜底的「复核提交失败」有用得多，
   * 所以必须让异常把 message 带出去（见 `http.ts` 顶部关于 200/非 0 code 的说明）。
   */
  return ensureApiSuccess(
    (
      await http.post(`/admin/reviews/${id}/resolve`, payload, { headers: { 'Idempotency-Key': idempotencyKey } })
    ).data,
    '复核提交失败，请稍后重试',
  )
}
