import { aiHttp } from './http'
import { isMock, mockDelay } from '../stores/dataMode'
import {
  mockKnowledgeCategories,
  mockKnowledgeDocs,
  mockPendingFiles,
  nextMockIngestDocumentId,
  nextMockIngestVersionId,
} from '../mocks/data'
import type {
  KnowledgeIngestPayload,
  KnowledgeIngestResult,
  KnowledgeIngestState,
  KnowledgeIngestStatus,
  PendingKnowledgeFile,
  PySuccess,
} from '../types/api'

/**
 * 知识库入库 —— 由 **AI 服务**（`/api/v2`，Python）提供，不是 Java。
 *
 * 服务划分（接口文档 5.1）：管理后台的读接口全在业务服务 `/api/v1`，但
 * 「确认把这份文件变成可检索的知识」是 RAG 侧的动作（下载 → 解析分块 → 抽元数据
 * → 写 Chroma 向量），只有 AI 服务能做，所以走 `aiHttp`。两边共用同一套 JWT
 * （同一个 `jwt_secret_key`），token 不用换。
 *
 * 三条契约要点：
 *  1. **上传 ≠ 入库**。`POST /knowledge/ingest` 是唯一的入库入口，
 *     分类由管理员在这时指定，不再由 LLM 猜。
 *  2. **只传 fileId + categoryId**。MinIO 的桶名与 `object_key` 由后端按 fileId
 *     读 `files` 表补全 —— 前端拿不到它们，也不该去拼对象存储的布局。
 *  3. **不等 Java 回执**。入库状态以 AI 服务的 `knowledge_documents.status` /
 *     `knowledge_document_versions.status` 为唯一事实来源，前端轮询
 *     `GET /knowledge/ingest/{fileId}`。
 */

/* ---------- mock 状态 ---------------------------------------------------- */

/**
 * mock 下每个文件的入库状态。
 *
 * 让 processing 真的持续几拍再转 ready：秒回 ready 会把「处理中」这一态从评审
 * 视野里抹掉，而这恰恰是本项目最容易出问题的一段（后台任务、僵死判定、重试）。
 */
const MOCK_TICKS_TO_READY = 3

interface MockIngest {
  status: KnowledgeIngestStatus
  documentId: number | null
  versionId: number | null
  title: string | null
  chunkCount: number | null
  error: string | null
  ticks: number
}

const mockIngests = new Map<number, MockIngest>()

const mockIngestOf = (fileId: number): MockIngest => {
  const existing = mockIngests.get(fileId)
  if (existing) return existing
  const seed = mockPendingFiles.find((item) => item.fileId === fileId)
  const state: MockIngest = {
    status: (seed?.ingestStatus as KnowledgeIngestStatus) ?? 'none',
    documentId: seed?.documentId ?? null,
    versionId: seed?.versionId ?? null,
    title: seed?.title ?? null,
    chunkCount: seed?.chunkCount ?? null,
    error: seed?.ingestStatus === 'failed' ? '解析失败：该 PDF 为扫描件，未提取到可用文本' : null,
    ticks: 0,
  }
  mockIngests.set(fileId, state)
  return state
}

/**
 * 造一个「像 axios 错误」的对象。
 *
 * 必须带 `isAxiosError`：`apiErrorMessage()` 用 `axios.isAxiosError()` 判定，
 * mock 里直接 `throw new Error(...)` 会被它当成未知异常、丢掉后端文案
 * （包括 409 那句「需显式重试」）。这是 mock 与真实环境行为对齐的关键一处。
 *
 * 导出给 `services/knowledge.ts` 复用（那边的 mock 分支同样要抛 404 / 409，
 * 各自的判定路径必须一致，不能一边抛 axios 形状、另一边抛裸 Error）。
 */
export const mockHttpError = (status: number, message: string, reason?: string) => {
  const error = new Error(message) as Error & { isAxiosError?: boolean; response?: unknown }
  error.isAxiosError = true
  error.response = { status, data: { code: status, message, data: { reason } } }
  return error
}

/**
 * mock 下的「入库完成」：把文档真的加进知识库列表。
 *
 * 不加这一步的话，点完入库、轮询到 ready，回到列表却什么都没有 ——
 * 评审时看着像「只改了个状态」，而真实环境里文档此时确实已经能检索到了。
 */
const publishMockIngestedDoc = (fileId: number, state: MockIngest) => {
  if (state.documentId === null) return
  if (mockKnowledgeDocs.some((doc) => doc.id === state.documentId)) return
  const file = mockPendingFiles.find((item) => item.fileId === fileId)
  mockKnowledgeDocs.unshift({
    id: state.documentId,
    title: state.title ?? file?.fileName ?? `文件 ${fileId}`,
    category: file?.categoryName ?? undefined,
    category_name: file?.categoryName ?? undefined,
    status: 'ready',
    version: 'v1.0',
    section_count: state.chunkCount ?? undefined,
    department: '管理后台上传',
    updated_at: new Date().toISOString(),
    updated_by: '林宪成',
    process_state: '已同步',
    visibility: 'campus',
  })
}

/* ---------- 读：待入库文件 ------------------------------------------------ */

/** 待入库文件 `GET /knowledge/pending-files` —— 上传过、还没成功进知识库的那些。 */
export async function getPendingKnowledgeFiles(
  limit = 50,
): Promise<PySuccess<{ items: PendingKnowledgeFile[] }>> {
  if (isMock()) {
    await mockDelay()
    // 把轮询推进出来的最新状态投影回列表项（mock 的列表是同一批对象）
    mockPendingFiles.forEach((item) => {
      const state = mockIngests.get(item.fileId)
      if (!state) return
      item.ingestStatus = state.status
      item.chunkCount = state.chunkCount
      item.documentId = state.documentId
      item.versionId = state.versionId
      if (state.title) item.title = state.title
    })
    // 已成功入库的不再出现在待入库列表里 —— 后端是在 SQL 里过滤的
    // （`v.status <> 'ready'`），前端 mock 没有这层查询，必须自己过滤，
    // 否则会出现「徽章写着已入库、按钮却让你加入知识库」这种自相矛盾的行。
    return {
      code: 0,
      message: 'ok',
      data: { items: mockPendingFiles.filter((item) => item.ingestStatus !== 'ready') },
    }
  }
  return (
    await aiHttp.get<PySuccess<{ items: PendingKnowledgeFile[] }>>('/knowledge/pending-files', {
      params: { limit },
    })
  ).data
}

/* ---------- 写：确认入库 -------------------------------------------------- */

/**
 * 确认把某个已上传的文件加入知识库 `POST /knowledge/ingest`。
 *
 * 接口秒回，真正的解析与向量化在后端后台跑 —— 所以调用方拿到 `processing`
 * 之后要接着轮询（`waitForKnowledgeIngest`），不能就此认为已经入好了。
 *
 * 可能抛出的两类错误（后端 message 已写清原因，前端直接展示即可）：
 *   409 `retry_required`  —— 上次失败，必须带 `retry=true` 重来
 *   409 `file_not_ready`  —— 安全扫描还没过，稍后再试
 *   400 `invalid_category` —— 分类不存在，应刷新下拉
 */
export async function startKnowledgeIngest(
  payload: KnowledgeIngestPayload,
): Promise<PySuccess<KnowledgeIngestResult>> {
  if (isMock()) {
    await mockDelay(320)
    const state = mockIngestOf(payload.fileId)

    if (state.status === 'processing') {
      return {
        code: 0,
        message: '正在入库中',
        data: {
          fileId: payload.fileId,
          documentId: state.documentId,
          versionId: state.versionId,
          status: 'processing',
          reused: true,
          chunkCount: 0,
          error: null,
        },
      }
    }
    if (state.status === 'ready' && !payload.retry) {
      return {
        code: 0,
        message: '已在知识库中',
        data: {
          fileId: payload.fileId,
          documentId: state.documentId,
          versionId: state.versionId,
          status: 'ready',
          reused: true,
          chunkCount: state.chunkCount,
          error: null,
        },
      }
    }
    if (state.status === 'failed' && !payload.retry) {
      // 与后端行为保持一致：失败必须由管理员显式点「重试」。
      // 不照做的话，「前端转一圈就自动重跑、白烧一遍 LLM」这个问题在 mock 下永远暴露不出来。
      throw mockHttpError(409, '上一次入库失败，需显式重试', 'retry_required')
    }

    const file = mockPendingFiles.find((item) => item.fileId === payload.fileId)
    const category = mockKnowledgeCategories.find((item) => item.id === payload.categoryId)
    if (!category) {
      throw mockHttpError(400, `分类不存在: categoryId=${payload.categoryId}`, 'invalid_category')
    }

    state.documentId = state.documentId ?? nextMockIngestDocumentId()
    state.versionId = state.versionId ?? nextMockIngestVersionId()
    state.title =
      payload.title?.trim() || state.title || file?.fileName.replace(/\.[^.]+$/, '') || '未命名文档'
    state.status = 'processing'
    state.chunkCount = 0
    state.error = null
    state.ticks = 0

    if (file) {
      file.ingestStatus = 'processing'
      file.documentId = state.documentId
      file.versionId = state.versionId
      file.categoryName = category.name
    }
    return {
      code: 0,
      message: '入库已启动',
      data: {
        fileId: payload.fileId,
        documentId: state.documentId,
        versionId: state.versionId,
        status: 'processing',
        reused: false,
        chunkCount: 0,
        error: null,
      },
    }
  }
  return (await aiHttp.post<PySuccess<KnowledgeIngestResult>>('/knowledge/ingest', payload)).data
}

/** 按 fileId 查入库状态 `GET /knowledge/ingest/{fileId}` —— 前端轮询用。 */
export async function getKnowledgeIngestStatus(
  fileId: number | string,
): Promise<PySuccess<KnowledgeIngestState>> {
  if (isMock()) {
    await mockDelay(240)
    const id = Number(fileId)
    const state = mockIngestOf(id)

    if (state.status === 'processing') {
      state.ticks += 1
      if (state.ticks >= MOCK_TICKS_TO_READY) {
        state.status = 'ready'
        state.chunkCount = 42
        publishMockIngestedDoc(id, state)
      }
    }

    return {
      code: 0,
      message: 'ok',
      data: {
        fileId: id,
        status: state.status,
        documentId: state.documentId,
        versionId: state.versionId,
        title: state.title,
        categoryCode: null,
        chunkCount: state.chunkCount,
        pageCount: null,
        parserName: state.status === 'ready' ? 'pypdf' : null,
        error: state.error,
        updatedAt: new Date().toISOString(),
      },
    }
  }
  return (await aiHttp.get<PySuccess<KnowledgeIngestState>>(`/knowledge/ingest/${fileId}`)).data
}

export interface WaitForIngestOptions {
  /** 默认 10 分钟 —— 入库是分钟级任务，给太短会把「慢」误报成「失败」。 */
  timeoutMs?: number
  intervalMs?: number
  onTick?: (state: KnowledgeIngestState, elapsedMs: number) => void
  signal?: AbortSignal
}

/**
 * 轮询到入库终态（ready / failed）为止。
 *
 * 超时返回 null 而不是抛异常：调用方要区分「还没跑完」和「跑失败了」，
 * 把等待包装成失败会让用户看到一条假的错误原因。
 */
export async function waitForKnowledgeIngest(
  fileId: number | string,
  { timeoutMs = 10 * 60_000, intervalMs = 1800, onTick, signal }: WaitForIngestOptions = {},
): Promise<KnowledgeIngestState | null> {
  const startedAt = Date.now()
  for (;;) {
    const { data } = await getKnowledgeIngestStatus(fileId)
    onTick?.(data, Date.now() - startedAt)

    if (data.status === 'ready' || data.status === 'failed') return data
    if (signal?.aborted) return null
    if (Date.now() - startedAt >= timeoutMs) return null

    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs))
  }
}

/** 移出知识库 `POST /knowledge/documents/{documentId}/remove` —— 删向量、保留记录留痕。 */
export async function removeKnowledgeDocument(
  documentId: number | string,
): Promise<PySuccess<{ documentId: number; status: string; removed: boolean }>> {
  if (isMock()) {
    await mockDelay(320)
    const id = Number(documentId)
    const target = mockKnowledgeDocs.find((doc) => doc.id === id)
    if (!target) throw mockHttpError(400, `文档不存在: documentId=${id}`)

    /*
     * 🔴 记录必须保留、只把状态置 `removed` —— 与后端契约一致
     * （删向量、`knowledge_documents` 记录留痕）。原先这里是 `splice` 直接删记录，
     * 于是「移出知识库」之后这份文档从哪都查不到：治理页新加的「移除知识库」页签
     * 在 mock 下永远空着，而 live 下明明是有的 —— mock 与契约脱节，
     * 「点了移出就彻底消失」这个问题在演示里永远复现不出来。
     */
    target.status = 'removed'
    target.process_state = '已移出'
    // 移出之后这份文件还能重新加入，所以在「待入库」区恢复出来 ——
    // 否则管理员会以为文件跟着文档一起没了。
    const file = mockPendingFiles.find((item) => item.documentId === id)
    if (file) {
      file.ingestStatus = 'removed'
      file.title = target.title
    } else {
      const state = [...mockIngests.values()].find((item) => item.documentId === id)
      if (state) state.status = 'removed'
    }
    return { code: 0, message: '已移出知识库', data: { documentId: id, status: 'removed', removed: true } }
  }
  return (
    await aiHttp.post<PySuccess<{ documentId: number; status: string; removed: boolean }>>(
      `/knowledge/documents/${documentId}/remove`,
      {},
    )
  ).data
}
