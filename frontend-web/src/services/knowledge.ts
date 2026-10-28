import { aiHttp, http } from './http'
import type {
  ApiSuccess,
  KnowledgeCategory,
  KnowledgeChapter,
  KnowledgeDocument,
  KnowledgeSection,
} from '../types/api'

/**
 * 真实后端与接口文档在知识库上不一致的地方，统一在响应边界收敛，页面不再各自兜底：
 * 1. `validity` / `visibility` 等枚举序列化为**大写**（`CURRENT`、`STUDENT`），文档示例是小写；
 * 2. 时间字段用**驼峰**（`publishedAt`、`effectiveFrom`），文档写的是下划线。
 * `archive` 另有一种 `archived` 写法，一并归一。
 */
const normalizeValidity = (value: unknown) => {
  const key = String(value ?? '').trim().toLowerCase()
  return key === 'archived' ? 'archive' : key
}

/** 下划线 / 驼峰两种写法取先有值的那个。 */
const firstOf = (...values: Array<string | null | undefined>) =>
  values.find((value) => typeof value === 'string' && value.length > 0) ?? null

export const normalizeKnowledgeDocument = (doc: KnowledgeDocument): KnowledgeDocument => ({
  ...doc,
  validity: normalizeValidity(doc.validity),
  published_at: firstOf(doc.published_at, doc.publishedAt),
  effective_from: firstOf(doc.effective_from, doc.effectiveFrom),
})

export const getKnowledgeCategories = () =>
  http.get<ApiSuccess<{ items: KnowledgeCategory[] }>>('/knowledge/categories')

export const getKnowledgeDocuments = (params: {
  query?: string
  category_id?: string | number
  validity?: string
  issuer_level?: string
  sort?: boolean
  page?: number
  page_size?: number
}) =>
  http
    .get<ApiSuccess<{ items: KnowledgeDocument[]; page: number; page_size: number; total: number; has_more: boolean }>>(
      '/knowledge/documents',
      { params },
    )
    .then((response) => {
      response.data.data.items = response.data.data.items.map(normalizeKnowledgeDocument)
      return response
    })

export const getKnowledgeDocument = (id: string | number) =>
  http.get<ApiSuccess<KnowledgeDocument>>(`/knowledge/documents/${id}`).then((response) => {
    response.data.data = normalizeKnowledgeDocument(response.data.data)
    return response
  })

/** 章节索引。`items[].sections[]` 只有条号与短标题，正文要按 section id 单独取。 */
export const getKnowledgeChapters = (id: string | number) =>
  http.get<ApiSuccess<{ document_id?: string | number; items: KnowledgeChapter[] }>>(`/knowledge/documents/${id}/chapters`)

export const getKnowledgeSection = (documentId: string | number, sectionId: string | number) =>
  http.get<ApiSuccess<KnowledgeSection>>(`/knowledge/documents/${documentId}/sections/${sectionId}`)

export const getKnowledgeDownloadUrl = (id: string | number) =>
  http.get<ApiSuccess<{ download_url: string; filename?: string; expires_in?: number }>>(
    `/knowledge/documents/${id}/download-url`,
  )

export const askKnowledgeSection = (sectionId: string | number, payload: { question: string; agent_mode?: string }) =>
  aiHttp.post<ApiSuccess<Record<string, unknown>>>(`/knowledge/sections/${sectionId}/ask`, payload)
