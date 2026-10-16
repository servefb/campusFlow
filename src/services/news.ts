import { http } from './http'
import type { ApiSuccess } from '../types/api'

export interface NewsApiItem {
  id: string | number
  category?: string
  department?: string | { id?: string | number; name?: string }
  organizationId?: string | number
  sourceId?: string | number
  title: string
  summary?: string
  content?: string
  cover_url?: string | null
  source_url?: string | null
  published_at?: string
  publishedAt?: string
  deadline_at?: string | null
  deadlineAt?: string | null
  is_bookmarked?: boolean
  is_spotlight?: boolean
  recommendation_reason?: string
  ai_highlights?: Record<string, unknown>
}

export interface NewsHomeData {
  spotlight: NewsApiItem | null
  recommendations: NewsApiItem[]
  groups: Array<{ label: string; items: NewsApiItem[] }> | Record<string, NewsApiItem[]>
  categories: Array<{ key: string; name: string; count: number }>
  following_count: number
}

export interface NewsDetail extends NewsApiItem {
  department?: string | { id?: string | number; name?: string }
  content?: string
  source_document_id?: string | number | null
  ai_highlights?: {
    what?: string
    eligible?: string
    action?: string
    materials?: string[]
    [key: string]: unknown
  }
}

export const getNewsHome = (params: {
  category?: string
  query?: string
  department_id?: string
  following?: boolean
  sort?: boolean
}) => http.get<ApiSuccess<NewsHomeData>>('/news/home', { params })

export const getNewsDetail = (newsId: string | number) =>
  http.get<ApiSuccess<NewsDetail>>(`/news/${newsId}`)

export const bookmarkNews = (newsId: string | number) =>
  http.post<ApiSuccess<{ news_id: string | number; is_bookmarked: boolean }>>(`/news/${newsId}/bookmark`)

export const unbookmarkNews = (newsId: string | number) =>
  http.delete<ApiSuccess<{ news_id: string | number; is_bookmarked: boolean }>>(`/news/${newsId}/bookmark`)
