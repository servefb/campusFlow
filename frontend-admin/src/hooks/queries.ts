import { useQuery } from '@tanstack/react-query'
import * as metricsApi from '../services/metrics'
import * as knowledgeApi from '../services/knowledge'
import * as ingestApi from '../services/ingest'
import * as auditApi from '../services/audit'
import * as usersApi from '../services/users'
import * as settingsApi from '../services/settings'
import * as newsApi from '../services/news'
import * as notificationsApi from '../services/notifications'
import * as fileReviewApi from '../services/fileReview'
import { useDataModeStore } from '../stores/dataMode'
import type {
  AgentMetrics,
  AuditLogQuery,
  HotQuestions,
  KnowledgeHealth,
  OverviewMetrics,
  TrendMetrics,
} from '../types/api'
/**
 * 查询钩子集中在这里，好处是 queryKey 统一带上数据源模式：
 * 切换 mock/live 时所有查询自动失效重取，页面不用各自监听。
 */

const useModeKey = () => useDataModeStore((state) => state.mode)

export const useOverview = (range: string) => {
  const mode = useModeKey()
  return useQuery({
    queryKey: ['overview', range, mode],
    queryFn: async () => (await metricsApi.getOverview(range)).data,
    select: (data): OverviewMetrics => data,
  })
}

export const useTrends = (range: string, interval: string) => {
  const mode = useModeKey()
  return useQuery({
    queryKey: ['trends', range, interval, mode],
    queryFn: async () => (await metricsApi.getTrends(range, interval)).data,
    select: (data): TrendMetrics => data,
  })
}

export const useAgentMetrics = (range: string) => {
  const mode = useModeKey()
  return useQuery({
    queryKey: ['agent-metrics', range, mode],
    queryFn: async () => (await metricsApi.getAgentMetrics(range)).data,
    select: (data): AgentMetrics => data,
  })
}

export const useKnowledgeHealth = () => {
  const mode = useModeKey()
  return useQuery({
    queryKey: ['knowledge-health', mode],
    queryFn: async () => (await metricsApi.getKnowledgeHealth()).data,
    select: (data): KnowledgeHealth => data,
  })
}

export const useHotQuestions = (range: string) => {
  const mode = useModeKey()
  return useQuery({
    queryKey: ['hot-questions', range, mode],
    queryFn: async () => (await metricsApi.getHotQuestions(range)).data,
    select: (data): HotQuestions => data,
  })
}

/**
 * 文件审核列表（RESERVED · GET /admin/files，契约草案见《接口对接说明》2.2）。
 *
 * 「内容审核」页 2026-10-15 起改审**文件**（`files` 表扫描链路），原来的
 * `/admin/reviews` 答复复核队列已从管理端撤除（后端接口保留闲置，
 * `services/metrics.ts` 的 getReviews 一族暂留作契约存档，无页面引用）。
 */
export const useFileReviews = (params: Parameters<typeof fileReviewApi.getFileReviews>[0]) => {
  const mode = useModeKey()
  return useQuery({
    queryKey: ['file-reviews', params, mode],
    queryFn: async () => (await fileReviewApi.getFileReviews(params)).data,
    placeholderData: (previous) => previous,
  })
}

export const useKnowledgeDocuments = (params: Parameters<typeof knowledgeApi.getKnowledgeDocuments>[0]) => {
  const mode = useModeKey()
  return useQuery({
    queryKey: ['knowledge-documents', params, mode],
    queryFn: async () => (await knowledgeApi.getKnowledgeDocuments(params)).data,
    placeholderData: (previous) => previous,
  })
}

export const useKnowledgeConflicts = () => {
  const mode = useModeKey()
  return useQuery({
    queryKey: ['knowledge-conflicts', mode],
    queryFn: async () => (await knowledgeApi.getKnowledgeConflicts()).data,
    placeholderData: (previous) => previous,
  })
}

/** 分类下拉：`GET /knowledge/categories`。缓存 5 分钟，分类变更频率极低。 */
export const useKnowledgeCategories = () => {
  const mode = useModeKey()
  return useQuery({
    queryKey: ['knowledge-categories', mode],
    queryFn: async () => (await knowledgeApi.getKnowledgeCategories()).data,
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * 待入库文件：`GET /knowledge/pending-files`（**AI 服务** `/api/v2`，不是 Java）。
 *
 * 有文件正在入库时自动轮询：入库是分钟级后台任务，管理员点完「加入知识库」
 * 通常会关掉弹窗，此时列表就是唯一能看到进度的地方。没这一步，状态会一直停在
 * 「处理中」直到手动刷新 —— 而「点了没反应」正是这次改造要消灭的体验。
 */
export const usePendingKnowledgeFiles = () => {
  const mode = useModeKey()
  return useQuery({
    queryKey: ['knowledge-pending-files', mode],
    queryFn: async () => (await ingestApi.getPendingKnowledgeFiles()).data,
    placeholderData: (previous) => previous,
    refetchInterval: (query) => {
      const data = query.state.data as { items?: Array<{ ingestStatus: string }> } | undefined
      return data?.items?.some((item) => item.ingestStatus === 'processing') ? 4000 : false
    },
  })
}

export const useAuditLogs = (query: AuditLogQuery) => {
  const mode = useModeKey()
  return useQuery({
    queryKey: ['audit-logs', query, mode],
    queryFn: async () => (await auditApi.getAuditLogs(query)).data,
    placeholderData: (previous) => previous,
  })
}

export const useUserStats = () => {
  const mode = useModeKey()
  return useQuery({
    queryKey: ['user-stats', mode],
    queryFn: async () => (await usersApi.getUserStats()).data,
  })
}

export const useRoles = () => {
  const mode = useModeKey()
  return useQuery({
    queryKey: ['roles', mode],
    queryFn: async () => (await usersApi.getRoles()).data,
  })
}

export const useAdminUsers = (params: Parameters<typeof usersApi.getAdminUsers>[0]) => {
  const mode = useModeKey()
  return useQuery({
    queryKey: ['admin-users', params, mode],
    queryFn: async () => (await usersApi.getAdminUsers(params)).data,
    placeholderData: (previous) => previous,
  })
}

export const useSystemSettings = () => {
  const mode = useModeKey()
  return useQuery({
    queryKey: ['system-settings', mode],
    queryFn: async () => (await settingsApi.getSystemSettings()).data,
  })
}

/**
 * 新闻源的 queryKey 只放页码这类稳定标量。
 * 注意别把 `new Date()` 之类的每次渲染都变的值塞进参数对象 ——
 * 那会让 queryKey 每渲染必变、直接变成请求风暴（本项目操作日志页栽过一次）。
 */
export const useNewsSources = (params: Parameters<typeof newsApi.getNewsSources>[0] = {}) => {
  const mode = useModeKey()
  return useQuery({
    queryKey: ['news-sources', params, mode],
    queryFn: async () => (await newsApi.getNewsSources(params)).data,
    placeholderData: (previous) => previous,
  })
}

export const useNewsList = (params: Parameters<typeof newsApi.getNewsList>[0]) => {
  const mode = useModeKey()
  return useQuery({
    queryKey: ['news-list', params, mode],
    queryFn: async () => (await newsApi.getNewsList(params)).data,
    placeholderData: (previous) => previous,
  })
}

/** 新闻分类：变更频率极低，缓存 5 分钟。 */
export const useNewsCategories = () => {
  const mode = useModeKey()
  return useQuery({
    queryKey: ['news-categories', mode],
    queryFn: async () => (await newsApi.getNewsCategories()).data,
    staleTime: 5 * 60 * 1000,
  })
}

/** 管理端广播通知列表（/admin/notifications，后端未提供 · mock 第二实现）。 */
export const useAdminNotifications = (params: Parameters<typeof notificationsApi.getAdminNotifications>[0] = {}) => {
  const mode = useModeKey()
  return useQuery({
    queryKey: ['admin-notifications', params, mode],
    queryFn: async () => (await notificationsApi.getAdminNotifications(params)).data,
    placeholderData: (previous) => previous,
  })
}
