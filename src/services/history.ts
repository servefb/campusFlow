import { aiHttp, makeIdempotencyKey } from './http'
import type { ApiSuccess, ConversationSummary } from '../types/api'

export const getHistoryConversations = (params: { keyword?: string; range?: string; page?: number; page_size?: number }) =>
  aiHttp.get<ApiSuccess<{ items: ConversationSummary[]; page: number; page_size: number; total: number; has_more: boolean }>>('/history/conversations', { params })

export const getHistoryConversation = (id: string | number) =>
  aiHttp.get<ApiSuccess<Record<string, unknown>>>(`/history/conversations/${id}`)

export const exportHistoryConversation = (id: string | number, payload: { format?: 'pdf' | 'docx'; include_citations?: boolean } = {}) =>
  aiHttp.post<ApiSuccess<{ export_id: string | number; status: string; format: string }>>(
    `/history/conversations/${id}/export`,
    { format: 'pdf', include_citations: true, ...payload },
    { headers: { 'Idempotency-Key': makeIdempotencyKey() } },
  )

export const exportHistoryConversationsBatch = (conversationIds: Array<string | number>, payload: { format?: 'pdf' | 'docx'; include_citations?: boolean } = {}) =>
  aiHttp.post<ApiSuccess<{ export_id: string | number; conversation_count: number; status: string; format: string }>>(
    '/history/conversations/batch-export',
    { conversation_ids: conversationIds, format: 'pdf', include_citations: true, ...payload },
    { headers: { 'Idempotency-Key': makeIdempotencyKey() } },
  )

export const updateHistoryConversation = (id: string | number, payload: { title?: string; status?: 'active' | 'archived' }) =>
  aiHttp.patch<ApiSuccess<{ id: string | number; title?: string; status?: string; updated_at?: string }>>(`/conversations/${id}`, payload)

export const bookmarkHistoryConversation = (id: string | number) =>
  aiHttp.post<ApiSuccess<{ id: string | number; is_bookmarked: boolean }>>(`/history/conversations/${id}/bookmark`)

export const unbookmarkHistoryConversation = (id: string | number) =>
  aiHttp.delete<ApiSuccess<{ id: string | number; is_bookmarked: boolean }>>(`/history/conversations/${id}/bookmark`)

export const deleteHistoryConversation = (id: string | number) =>
  aiHttp.delete<ApiSuccess<null>>(`/history/conversations/${id}`)
