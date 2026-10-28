import { ApiBusinessError, ensureApiSuccess, http, makeIdempotencyKey } from './http'
import { isMock, mockDelay } from '../stores/dataMode'
import {
  createMockNews,
  deleteMockNews,
  mockNews,
  mockNewsCategories,
  mockNewsSources,
  touchMockNewsSource,
  updateMockNews,
} from '../mocks/data'
import type {
  ApiSuccess,
  NewsAdminCreatePayload,
  NewsAdminDeleteResult,
  NewsAdminUpdatePayload,
  NewsAdminWriteResult,
  NewsCategory,
  NewsItem,
  NewsSource,
  NewsSourceUpdatePayload,
  NewsSourceUpdateResult,
  NewsSyncResult,
  Paged,
} from '../types/api'

/**
 * 校园新闻 —— 文档第 12 章，归业务服务 /api/v1。
 *
 * 两个约定容易写错，写在这里免得各页各写一套：
 *
 * 1. 分类筛选要传 `campus_news.category` 的**分类名称**，不是 `/news/categories`
 *    返回的 `key`（文档 12.1 明确写了「不要传 categories[].key 作为筛选值」）。
 *    示例里两者同值，所以传错也看不出来 —— 真实后端一旦不同值就会静默筛空。
 * 2. `sort` 是布尔值：`true` 按发布时间正序、`false` 倒序，未传默认 `false`。
 *    不要写成 `sort=desc` 这类字符串。
 *
 * 另外：新闻源相关接口都是**管理员**接口（文档 22 行权限表「新闻源治理」），
 * 普通用户令牌调用会 403，这是预期行为，不要当成接口坏了。
 */

/** 新闻源列表 `GET /news/admin/sources`（文档 A.7.9）。 */
export async function getNewsSources(
  params: { page?: number; page_size?: number } = {},
): Promise<ApiSuccess<Paged<NewsSource>>> {
  const { page = 1, page_size = 20 } = params
  if (isMock()) {
    await mockDelay()
    const start = (page - 1) * page_size
    const items = mockNewsSources.slice(start, start + page_size)
    return {
      code: 0,
      message: 'ok',
      data: { items, page, page_size, total: mockNewsSources.length, has_more: start + items.length < mockNewsSources.length },
      request_id: 'mock_news_sources',
    }
  }
  return (await http.get<ApiSuccess<Paged<NewsSource>>>('/news/admin/sources', { params: { page, page_size } })).data
}

/**
 * 更新抓取规则 `PATCH /news/admin/sources/{id}`（文档 A.7.10）。
 * 只提交用户真正改过的字段：后端按字段做局部更新，整对象回写容易把 selector 覆盖成 null。
 */
export async function updateNewsSource(
  id: number | string,
  payload: NewsSourceUpdatePayload,
): Promise<ApiSuccess<NewsSourceUpdateResult>> {
  if (isMock()) {
    await mockDelay(280)
    const next = touchMockNewsSource(Number(id), payload)
    return {
      code: 0,
      message: '新闻源已更新',
      data: {
        id: Number(id),
        status: String(next?.status ?? payload.status ?? 'active'),
        sync_interval_minutes: next?.sync_interval_minutes,
        updated_at: new Date().toISOString(),
      },
      request_id: 'mock_news_source_patch',
    }
  }
  return ensureApiSuccess(
    (await http.patch<ApiSuccess<NewsSourceUpdateResult>>(`/news/admin/sources/${id}`, payload)).data,
    '新闻源更新失败',
  )
}

/**
 * 立即同步 `POST /news/admin/sources/{id}/sync`（文档 A.7.11）。
 * 返回 `sync_job_id` 表示同步任务已入队，**不代表抓取已完成**，
 * 所以文案只能是「已创建同步任务」，不能写成「同步完成」。
 *
 * 🔴 这个接口在**当前代码库下必然失败**，而且失败得不像失败 —— 见下面三行：
 *   `data: null` + `code: 501` + **HTTP 200**（`BusinessException` 不带 `@ResponseStatus`）。
 *   不过 `ensureApiSuccess` 的话，`result.data.sync_job_id` 会抛 `TypeError`，
 *   页面只能报一句「创建失败」，把「本来就没实现抓取」说成「你的操作出错了」。
 *   另外两种真实拒绝同理：源已停用 `409`、源没配地址 `400`。
 */
export async function syncNewsSource(id: number | string): Promise<ApiSuccess<NewsSyncResult>> {
  if (isMock()) {
    await mockDelay(320)
    touchMockNewsSource(Number(id), { last_synced_at: new Date().toISOString() })
    return {
      code: 0,
      message: '同步任务已创建',
      data: { sync_job_id: 1, source_id: Number(id), status: 'queued' },
      request_id: 'mock_news_source_sync',
    }
  }
  return ensureApiSuccess(
    (
      await http.post<ApiSuccess<NewsSyncResult>>(
        `/news/admin/sources/${id}/sync`,
        {},
        // 触发抓取是有副作用的写操作，按文档 3.2 需要幂等键，避免连点造出多个同步任务
        { headers: { 'Idempotency-Key': makeIdempotencyKey() } },
      )
    ).data,
    '同步任务创建失败',
  )
}

/** 新闻流列表 `GET /news`（文档 A.7.2）。`category` 传分类名称，`sort` 传布尔值。 */
export async function getNewsList(
  params: { category?: string; query?: string; page?: number; page_size?: number; sort?: boolean } = {},
): Promise<ApiSuccess<Paged<NewsItem>>> {
  const { category = 'all', query = '', page = 1, page_size = 6, sort = false } = params
  if (isMock()) {
    await mockDelay()
    const keyword = query.trim().toLowerCase()
    const filtered = mockNews.filter((item) => {
      if (category !== 'all' && item.category !== category) return false
      if (!keyword) return true
      return (
        item.title.toLowerCase().includes(keyword) ||
        (item.summary ?? '').toLowerCase().includes(keyword) ||
        (item.department ?? '').toLowerCase().includes(keyword)
      )
    })
    // sort=true 正序（最早在前），false 倒序（最新在前）
    const sorted = [...filtered].sort((a, b) => {
      const left = a.published_at ? Date.parse(a.published_at) : 0
      const right = b.published_at ? Date.parse(b.published_at) : 0
      return sort ? left - right : right - left
    })
    const start = (page - 1) * page_size
    const items = sorted.slice(start, start + page_size)
    return {
      code: 0,
      message: 'ok',
      data: { items, page, page_size, total: sorted.length, has_more: start + items.length < sorted.length },
      request_id: 'mock_news_list',
    }
  }
  return (
    await http.get<ApiSuccess<Paged<NewsItem>>>('/news', {
      params: {
        category: category === 'all' ? undefined : category,
        query: query || undefined,
        page,
        page_size,
        sort,
      },
    })
  ).data
}

/** 新闻分类与数量 `GET /news/categories`（文档 A.7.3）。 */
export async function getNewsCategories(): Promise<ApiSuccess<NewsCategory[]>> {
  if (isMock()) {
    await mockDelay()
    return { code: 0, message: 'ok', data: mockNewsCategories, request_id: 'mock_news_categories' }
  }
  const { data } = await http.get<ApiSuccess<NewsCategory[] | Paged<NewsCategory>>>('/news/categories')
  /*
   * 契约没钉死是裸数组还是分页包络，两种都兜住，避免后端换形状就白屏。
   * 但第三种形状报错而不是兜成 `[]` —— 兜成空数组会让指标卡写「0 个分类」，
   * 那是宣称「系统里没有分类」，与「后端没回传」是两回事。
   * 同款处理见 `services/knowledge.ts` 的 `getKnowledgeCategories`。
   */
  const payload = data.data
  if (Array.isArray(payload)) return { ...data, data: payload }
  if (payload && Array.isArray(payload.items)) return { ...data, data: payload.items }
  throw new Error('GET /news/categories 响应形状无法解析：既不是数组，也不含 items')
}

/* ---------- 管理端新闻发布（POST / PATCH / DELETE /news/admin/news，2026-09-23 后端落地） ---------- */

/**
 * 🔴 三个写接口都过 `ensureApiSuccess` —— 业务失败是 HTTP 200 + 非 0 `code`（契约总纲）。
 * 已知的真实失败口径（后端 `AdminNewsServiceImpl`）：
 *   `400` 标题/正文/分类为空、状态或可见范围取值不合法、`没有需要变更的内容`；
 *   `409` 封面文件尚未通过安全扫描；`404`（真 404，`NotFoundException`）新闻不存在或已删除。
 * 页面 catch 后用 `apiErrorMessage` 回显后端原文即可，别自己编笼统文案把原因吃掉。
 *
 * 三个函数都带 `Idempotency-Key`：与 sync/resolve 同一套写操作约定（文档 3.2）。
 * 后端目前没有校验这个头，带上无副作用，但语义上「发通知」值得防连点。
 */

/** 新建稿件：`status` 缺省 draft；published 由服务端补 `published_at`，前端不传发布时间。 */
export async function createNewsItem(
  payload: NewsAdminCreatePayload,
): Promise<ApiSuccess<NewsAdminWriteResult>> {
  if (isMock()) {
    await mockDelay(320)
    return {
      code: 0,
      message: '稿件已创建',
      data: createMockNews(payload),
      request_id: 'mock_news_create',
    }
  }
  return ensureApiSuccess(
    (
      await http.post<ApiSuccess<NewsAdminWriteResult>>('/news/admin/news', payload, {
        headers: { 'Idempotency-Key': makeIdempotencyKey() },
      })
    ).data,
    '发布失败，请稍后重试',
  )
}

/** 改稿 / 上下线 / 置顶：全字段可选，只提交真正改过的字段（`没有需要变更的内容` 是 400）。 */
export async function updateNewsItem(
  id: number | string,
  payload: NewsAdminUpdatePayload,
): Promise<ApiSuccess<NewsAdminWriteResult>> {
  if (isMock()) {
    await mockDelay(280)
    const result = updateMockNews(Number(id), payload)
    if (!result) {
      // 与后端 requireNews 同语义：新闻不存在（或已删除）走 NotFoundException → 真 404
      throw new ApiBusinessError(404, `新闻不存在（或已删除）：${id}`)
    }
    return { code: 0, message: '稿件已更新', data: result, request_id: 'mock_news_update' }
  }
  return ensureApiSuccess(
    (
      await http.patch<ApiSuccess<NewsAdminWriteResult>>(`/news/admin/news/${id}`, payload, {
        headers: { 'Idempotency-Key': makeIdempotencyKey() },
      })
    ).data,
    '稿件更新失败，请稍后重试',
  )
}

/** 软删除（写 `deleted_at`），新闻流里立刻消失；已下线/草稿态的条目同样可删。 */
export async function deleteNewsItem(id: number | string): Promise<ApiSuccess<NewsAdminDeleteResult>> {
  if (isMock()) {
    await mockDelay(280)
    const result = deleteMockNews(Number(id))
    if (!result) {
      throw new ApiBusinessError(404, `新闻不存在（或已删除）：${id}`)
    }
    return { code: 0, message: '稿件已删除', data: result, request_id: 'mock_news_delete' }
  }
  return ensureApiSuccess(
    (
      await http.delete<ApiSuccess<NewsAdminDeleteResult>>(`/news/admin/news/${id}`, {
        headers: { 'Idempotency-Key': makeIdempotencyKey() },
      })
    ).data,
    '删除失败，请稍后重试',
  )
}

/**
 * mock 下让「发布闭环」可被验证：新建 → 出现在流里 / 下线 → 从流里消失。
 * 这两个读取函数只服务验证工装，不进页面。
 */
export const mockNewsStreamSnapshot = () => mockNews.map((item) => ({ ...item }))
