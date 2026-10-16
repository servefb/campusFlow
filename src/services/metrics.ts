import { http } from './http'
import type { ApiSuccess } from '../types/api'

export interface MetricMeta { range?: string; updated_at: string; data_complete: boolean }
export interface OverviewMetrics extends MetricMeta { metrics: Record<string, unknown> }
export interface MetricItems extends MetricMeta { interval?: string; items: Array<Record<string, unknown>> }
export interface KnowledgeHealthMetrics extends MetricMeta { documents: Record<string, unknown>; fulltext_index: Record<string, unknown>; pending_conflicts: number }
export const getOverviewMetrics = (range = '7d') => http.get<ApiSuccess<OverviewMetrics>>('/admin/metrics/overview', { params: { range } })
export const getTrendMetrics = (range = '30d', interval = 'day') => http.get<ApiSuccess<MetricItems>>('/admin/metrics/trends', { params: { range, interval } })
export const getAgentMetrics = (range = '7d') => http.get<ApiSuccess<MetricItems>>('/admin/metrics/agents', { params: { range } })
export const getKnowledgeHealthMetrics = () => http.get<ApiSuccess<KnowledgeHealthMetrics>>('/admin/metrics/knowledge-health')
export const getHotQuestions = (range = '7d') => http.get<ApiSuccess<MetricItems>>('/admin/metrics/hot-questions', { params: { range } })
export const getReviews = (status = 'pending') => http.get<ApiSuccess<{ items: Array<Record<string, unknown>> }>>('/admin/reviews', { params: { status } })
