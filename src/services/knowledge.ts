import { aiHttp, ensureApiSuccess, http, makeIdempotencyKey } from './http'
import { mockHttpError } from './ingest'
import { isMock, mockDelay } from '../stores/dataMode'
import { mockConflicts, mockKnowledgeCategories, mockKnowledgeDocs, nextMockDocId } from '../mocks/data'
import type {
  ApiSuccess,
  KnowledgeCategory,
  KnowledgeConflict,
  KnowledgeConflictWire,
  KnowledgeDoc,
  KnowledgeDocCreatePayload,
  KnowledgeDocCreateResult,
  KnowledgeDocumentAction,
  KnowledgeIngestResult,
  KnowledgeJob,
  Paged,
  PySuccess,
} from '../types/api'

/**
 * 知识库治理 —— 文档 11.2，归业务服务 /api/v1。
 *
 * ✅ **2026-09-23：三个曾被后端忽略的筛选参数都已生效**（`query` / `category` / `status`），
 * 页面上的「后端未生效」提示已随之撤掉。此前的实测结论是：
 * different 关键词返回逐字节相同响应，`category`、`status` 被 DTO 直接丢掉。
 * 现在后端 `KnowledgeDocumentDto` 三个参数俱全，且都是「不给 = 不筛」。
 */

/**
 * 把后端返回项归一化成**页面唯一认的那套字段名**。
 *
 * 为什么非要有这一步：后端实测返回 `document_no` / `issuer`，而 mock 数据和页面
 * 渲染按 `doc_no` / `department` 写。没有归一化，同一份数据在 mock 下显示正常、
 * 切到 live 就整列空白 —— 这正是 2026-09-21 那次「列表字段都空着」报障的根因。
 * 只在渲染处写 `??` 是不够的：每个渲染点都得记得写，漏一个就再空一列。
 *
 * 归一化**只做同义异名合并**。语义不同的字段（`published_at` 印发时间 vs
 * `updated_at` 最近改动）保持独立，由页面决定怎么展示，绝不在这里悄悄顶替 ——
 * 把印发时间当更新时间显示，比显示「—」更糟。
 */
const normalizeKnowledgeDoc = (doc: KnowledgeDoc): KnowledgeDoc => ({
  ...doc,
  doc_no: doc.doc_no ?? doc.document_no,
  department: doc.department ?? doc.issuer,
})

export async function getKnowledgeDocuments(params: {
  query?: string
  status?: string
  /** 按分类名筛选。✅ 2026-09-23 起后端支持（服务端把分类名解析成 category_id 再筛）。 */
  category?: string
  page?: number
  page_size?: number
} = {}): Promise<ApiSuccess<Paged<KnowledgeDoc>>> {
  const { query = '', status = 'all', category, page = 1, page_size = 8 } = params
  if (isMock()) {
    await mockDelay()
    const keyword = query.trim().toLowerCase()
    const filtered = mockKnowledgeDocs.filter((doc) => {
      const statusOk = status === 'all' || doc.status === status
      if (!statusOk) return false
      // 分类筛选按展示名匹配（category_name 缺失时退回 category 字段）
      if (category && (doc.category_name ?? doc.category) !== category) return false
      if (!keyword) return true
      // 契约要求「标题 / 文号 / 正文任一命中即返回」，mock 至少覆盖标题与文号
      return (
        doc.title.toLowerCase().includes(keyword) ||
        (doc.doc_no ?? '').toLowerCase().includes(keyword) ||
        (doc.category ?? '').includes(query.trim())
      )
    })
    const start = (page - 1) * page_size
    const items = filtered.slice(start, start + page_size)
    return {
      code: 0,
      message: 'ok',
      data: { items, page, page_size, total: filtered.length, has_more: start + items.length < filtered.length },
      request_id: 'mock_knowledge_documents',
    }
  }
  /*
   * 「移除知识库」页签归 **AI 服务 v2**（2026-10-15 与后端对齐的口径）：
   * 「已移出」的唯一可信判据是向量库（Milvus）里向量已删，那份真相只有 Python 侧掌握，
   * 所以已移出列表由 v2 出 —— 走专用路径 `/knowledge/documents/removed`。
   * 🔴 前端**不传任何状态参数**：接口按 id 口径设计，后端自行查询；
   * 分页与检索词照发，后端用不上的可忽略。响应包络与文档列表一致，缺的字段照常降级。
   */
  if (status === 'removed') {
    const { data } = await aiHttp.get<PySuccess<Paged<KnowledgeDoc>>>('/knowledge/documents/removed', {
      params: { query: query || undefined, category: category || undefined, page, page_size },
    })
    const payload = data.data
    // PySuccess 的 code 是宽泛 number、ApiSuccess 是字面量 0 —— 与本文件其他 v2 调用同款形状断言
    return {
      ...data,
      // PySuccess 包络不带 request_id，ApiSuccess 需要 —— 缺了就标明来源，不算编数据
      request_id: (data as { request_id?: string }).request_id ?? 'v2_knowledge_documents_removed',
      data: {
        items: (payload?.items ?? []).map((doc) =>
          // 接口语义保证列表里只有已移出的文档：后端没回 status 时按端点语义补，
          // 免得状态徽章整列「未回传」——这是端点语义推导，不是编数据。
          normalizeKnowledgeDoc({ ...doc, status: doc.status ?? 'removed' }),
        ),
        page: payload?.page ?? page,
        page_size: payload?.page_size ?? page_size,
        total: payload?.total ?? 0,
        has_more: payload?.has_more ?? false,
      },
    } as ApiSuccess<Paged<KnowledgeDoc>>
  }
  const { data } = await http.get<ApiSuccess<Paged<KnowledgeDoc>>>('/knowledge/documents', {
    params: {
      query: query || undefined,
      status: status === 'all' ? undefined : status,
      category: category || undefined,
      page,
      page_size,
    },
  })
  return { ...data, data: { ...data.data, items: (data.data?.items ?? []).map(normalizeKnowledgeDoc) } }
}

/**
 * 线上形状 → 展示形状。
 *
 * 🔴 与 `services/audit.ts` 的 `normalizeAuditLog()` 是**同型**的一次归一化，理由也一样：
 * `mockConflicts` 是**展示型**数据（`title` / `target_doc` / `summary` / 双版本文本都是 mock 造的），
 * 而线上只有库表真实字段（`document_title` / `conflicting_document_title` / `description` / …）。
 *
 * 少了这一层会怎样：live 下冲突卡的「目标文件」「冲突描述」同时显示成空白，
 * 而 TypeScript **查不出来** —— 结构断言过了，字段全 `undefined`，页面安静地渲染空 div。
 * 这正是 09-21 审计日志六列里五列空白那次报障的同一种成因。
 *
 * 后端没有的三个字段（`confidence` / `source_version` / `proposed_version`）
 * **一律不填**：`knowledge_conflicts` 表里没有这些列，AI 服务也没写过。
 * 页面据此降级成「未回传」；填一个假置信度比留空危险得多。
 */
const normalizeKnowledgeConflict = (raw: KnowledgeConflictWire): KnowledgeConflict => ({
  id: raw.id,
  document_id: raw.document_id,
  title: raw.document_title ?? undefined,
  target_doc: raw.conflicting_document_title ?? undefined,
  summary: raw.description ?? undefined,
  severity: raw.severity,
  conflict_type: raw.conflict_type,
  status: raw.status,
  resolution: raw.resolution,
  resolved_by_name: raw.resolved_by_name,
  resolved_at: raw.resolved_at,
  created_at: raw.created_at ?? undefined,
})

/**
 * 条款冲突列表 `GET /knowledge/admin/conflicts`（✅ 2026-09-23 起后端提供）。
 *
 * <h3>默认只看「待处理」</h3>
 * 这页面板的语义是**待办**（管理员来这里处理分歧），所以缺省 `status='pending'`。
 * 后端缺省是「不过滤」，那是 REST 惯例，但页面照用会让面板显示一条**已处置**的旧冲突
 * —— 顶部还写着「N 处语义对齐分歧」，数字与内容对不上。
 * 要看全部显式传 `status: 'all'`（后端会把 `all` 当哨兵摘掉，等价于不筛）。
 */
export async function getKnowledgeConflicts(
  params: { status?: string; page?: number; page_size?: number } = {},
): Promise<ApiSuccess<Paged<KnowledgeConflict>>> {
  const { status = 'pending', page = 1, page_size = 20 } = params
  if (isMock()) {
    await mockDelay()
    // mock 是契约的第二份实现：筛选逻辑必须与后端一致，否则「mock 正常、live 空表」
    const filtered = mockConflicts.filter((item) => status === 'all' || (item.status ?? 'pending') === status)
    const start = (page - 1) * page_size
    const items = filtered.slice(start, start + page_size)
    return {
      code: 0,
      message: 'ok',
      data: { items, page, page_size, total: filtered.length, has_more: start + items.length < filtered.length },
      request_id: 'mock_knowledge_conflicts',
    }
  }
  const { data } = await http.get<ApiSuccess<Paged<KnowledgeConflictWire>>>('/knowledge/admin/conflicts', {
    params: { status: status === 'all' ? undefined : status, page, page_size },
  })
  // 空结果回 200 + 空列表（后端已改），这里仍做一次形状容错：`data` 为 null 时兜成空页
  const payload = data.data
  return {
    ...data,
    data: {
      items: (payload?.items ?? []).map(normalizeKnowledgeConflict),
      page: payload?.page ?? page,
      page_size: payload?.page_size ?? page_size,
      total: payload?.total ?? 0,
      has_more: payload?.has_more ?? false,
    },
  }
}

/**
 * 处置一条冲突 `POST /knowledge/admin/conflicts/{id}/resolve`。
 *
 * 三个动作与服务端 `ACTION_TO_STATUS` 一一对应；其中 `defer`（二次核实）在库里落到
 * `ignored` —— 库的 `status` 只有 `pending / resolved / ignored` 三值，没有「挂起」。
 *
 * 后端的拒绝语义（HTTP 200 + 非 0 `code`，所以要过 `ensureApiSuccess`）：
 *   - `400` 动作非法；
 *   - `404` 冲突不存在；
 *   - `409` 已被**别的动作**处置过（同动作重复提交是幂等的，回 200）。
 */
export async function resolveKnowledgeConflict(
  id: number | string,
  action: 'accept_proposed' | 'keep_current' | 'defer',
  comment?: string,
): Promise<ApiSuccess<{ id: number; status: string }>> {
  if (isMock()) {
    await mockDelay(300)
    const target = mockConflicts.find((item) => item.id === Number(id))
    if (!target) throw mockHttpError(404, `冲突不存在：${id}`)
    /*
     * mock 必须真的把状态改掉：不改的话处置成功、列表却没变化，
     * 「点了没用」这个问题在 mock 下永远暴露不出来（live 下却会立刻暴露）。
     */
    target.status = action === 'defer' ? 'ignored' : 'resolved'
    target.resolution = action
    target.resolved_at = new Date().toISOString()
    return {
      code: 0,
      message: '冲突已处理',
      data: { id: Number(id), status: target.status },
      request_id: 'mock_conflict_resolve',
    }
  }
  return ensureApiSuccess<{ id: number; status: string }>(
    (await http.post(`/knowledge/admin/conflicts/${id}/resolve`, { action, comment })).data,
    `冲突处置失败（${action}）`,
  )
}

/**
 * 解析 / 索引作业 `GET /knowledge/admin/jobs`（✅ 2026-09-23 起后端提供）。
 *
 * ⚠️ **这张表目前没有写入方**：Java 侧与 AI 服务都不写 `knowledge_jobs` /
 * `knowledge_job_steps`（09-23 双方代码里都没有这两张表的引用），库里的 4 行是种子数据。
 * 所以它读得出真实的行，但**反映不了实时入库进度** —— 入库进度只能靠
 * `GET /knowledge/ingest/{fileId}` 轮询 status。
 *
 * <h3>为什么接口实现了、页面却没接</h3>
 * 页面里本来就没有「作业列表」这块设计；而如果接上去渲染一个进度条，
 * 它会永远停在那儿不动（因为没人写这张表）——那比不接更糟。
 * 接口保留在这里是为了让后端能力可达，等有了写入方（AI 服务埋点）再接页面。
 */
export async function getKnowledgeJobs(
  params: { status?: string; document_id?: number | string; job_type?: string; page?: number; page_size?: number } = {},
): Promise<ApiSuccess<Paged<KnowledgeJob>>> {
  const { status, document_id, job_type, page = 1, page_size = 20 } = params
  if (isMock()) {
    await mockDelay()
    // mock 无作业数据：与真库「有表但没人写」的现实一致，回空页而不是编几条假的
    return {
      code: 0,
      message: 'ok',
      data: { items: [], page, page_size, total: 0, has_more: false },
      request_id: 'mock_knowledge_jobs',
    }
  }
  const { data } = await http.get<ApiSuccess<Paged<KnowledgeJob>>>('/knowledge/admin/jobs', {
    params: {
      status: status === 'all' ? undefined : status,
      document_id: document_id ?? undefined,
      job_type: job_type || undefined,
      page,
      page_size,
    },
  })
  const payload = data.data
  return {
    ...data,
    data: {
      items: payload?.items ?? [],
      page: payload?.page ?? page,
      page_size: payload?.page_size ?? page_size,
      total: payload?.total ?? 0,
      has_more: payload?.has_more ?? false,
    },
  }
}

/**
 * 上线当前版本 `POST /knowledge/admin/documents/{id}/publish`（✅ 2026-09-23 起后端提供）。
 *
 * 后端会拒绝三种情况（HTTP 200 + 非 0 `code`，所以必须过 `ensureApiSuccess`）：
 *   - `404` 文档不存在（含已软删）；
 *   - `409` 已归档（`archived` 是终态，不允许回到检索池）；
 *   - `409` 当前版本还没就绪 —— 文档状态置 `ready` 而版本不是 `ready` 的话，
 *     列表显示「可检索」但实际引用不到内容，所以后端宁可拒绝。
 *
 * 重复上线是幂等的（回 200，`previous_status` 与 `status` 相同）。
 */
export async function publishKnowledgeDocument(id: number | string): Promise<ApiSuccess<KnowledgeDocumentAction>> {
  if (isMock()) {
    await mockDelay(300)
    const target = mockKnowledgeDocs.find((doc) => doc.id === Number(id))
    if (!target) throw mockHttpError(404, `文档不存在：${id}`)
    const previous = target.status
    if (previous === 'archived') {
      throw mockHttpError(409, '文档已归档（archived），不能重新上线。请改为发布新版本。')
    }
    // mock 要真的改状态：不改的话「提示上线成功、列表还是草稿」在 mock 下永远暴露不出来
    target.status = 'ready'
    target.process_state = '已同步'
    return {
      code: 0,
      message: '已上线',
      data: { id: Number(id), status: 'ready', previous_status: previous },
      request_id: 'mock_publish',
    }
  }
  return ensureApiSuccess<KnowledgeDocumentAction>(
    (await http.post(`/knowledge/admin/documents/${id}/publish`, {})).data,
    '上线失败',
  )
}

/**
 * 下线文档 `POST /knowledge/admin/documents/{id}/offline`（✅ 2026-09-23 起后端提供）。
 *
 * 下线是**真生效**的：检索侧的匹配池筛的是 `knowledge_documents.status='ready'`
 * （见 AI 服务 `repositories/tasks_templates_match.py`），所以置成 `offline` 之后
 * 这份文档不会再被任何问答引用。文档本身与历史引用留痕都不动。
 */
export async function offlineKnowledgeDocument(id: number | string): Promise<ApiSuccess<KnowledgeDocumentAction>> {
  if (isMock()) {
    await mockDelay(300)
    const target = mockKnowledgeDocs.find((doc) => doc.id === Number(id))
    if (!target) throw mockHttpError(404, `文档不存在：${id}`)
    const previous = target.status
    if (previous === 'archived') throw mockHttpError(409, '文档已归档（archived），无需下线')
    target.status = 'offline'
    return {
      code: 0,
      message: '已下线',
      data: { id: Number(id), status: 'offline', previous_status: previous },
      request_id: 'mock_offline',
    }
  }
  return ensureApiSuccess<KnowledgeDocumentAction>(
    (await http.post(`/knowledge/admin/documents/${id}/offline`, {})).data,
    '下线失败',
  )
}

/**
 * 重建索引 —— 🔴 **这个接口在 AI 服务（`/api/v2`），不在 Java 的 `/api/v1`**。
 *
 * 为什么：重建索引要真的跑解析器、重新分块、重写向量，那套代码（`ingest_service.run_ingest`）
 * 只在 AI 服务里。Java 侧就算挂一个同名路径，也只能返回「任务已创建」然后什么都不做 ——
 * 本工程已经在「新闻同步」上犯过这个错（那里最后改成如实回 501）。
 * 所以它归 v2，与「确认入库」同一类：**都是 RAG 侧的写操作**。
 *
 * ⚠️ 与上线 / 下线 / 处理冲突（只改数据库状态，留在 v1 的 `/knowledge/admin/*`）不是一个位置，
 * 别为了让路径看起来整齐把它搬过去。
 *
 * 返回与 `POST /knowledge/ingest` 同构，**秒回**：真正的解析在后台跑，
 * 拿到的 `status` 是 `processing`，要继续轮询 `GET /knowledge/ingest/{fileId}`。
 * ⚠️ 其中的 `reused` 恒为 `true`，含义是「复用了已有版本记录」（不新建版本、不涨版本号），
 * 不是「复用了已有任务」。
 */
export async function reindexKnowledgeDocument(id: number | string): Promise<PySuccess<KnowledgeIngestResult>> {
  if (isMock()) {
    await mockDelay(300)
    const target = mockKnowledgeDocs.find((doc) => doc.id === Number(id))
    if (!target) throw mockHttpError(404, `文档不存在：${id}`)
    /*
     * mock 里没有「上传文件 → 文档」的关联（真库里靠 versions.source_file_id），
     * 所以 fileId 只能给 0。它不影响页面：页面只用 documentId / status。
     */
    target.status = 'processing'
    target.process_state = '处理中'
    return {
      code: 0,
      message: '重建索引已启动',
      data: {
        fileId: 0,
        documentId: Number(id),
        versionId: 0,
        status: 'processing',
        reused: true,
        chunkCount: 0,
        error: null,
      },
    }
  }
  return (await aiHttp.post<PySuccess<KnowledgeIngestResult>>(`/knowledge/documents/${id}/reindex`, {})).data
}

/** 分类下拉数据 `GET /knowledge/categories`（文档 11.3 / A.6.1） */
export async function getKnowledgeCategories(): Promise<ApiSuccess<KnowledgeCategory[]>> {
  if (isMock()) {
    await mockDelay()
    return { code: 0, message: 'ok', data: mockKnowledgeCategories, request_id: 'mock_knowledge_categories' }
  }
  const { data } = await http.get<ApiSuccess<KnowledgeCategory[] | Paged<KnowledgeCategory>>>('/knowledge/categories')
  /*
   * 契约未钉死是数组还是分页包络，两种都兜住，避免后端换形状就白屏。
   *
   * 但**第三种形状必须报错，不能兜成 `[]`**：`data: {}` 这种「成功的空响应」
   * 被兜成空数组后，指标卡会写「0 个大类 · 分类清单为空」—— 那是宣称
   * 「系统里就是没有分类」，而事实是「后端什么都没说」。两者含义相反，
   * 后者要显示成「未回传」。
   */
  const payload = data.data
  if (Array.isArray(payload)) return { ...data, data: payload }
  if (payload && Array.isArray(payload.items)) return { ...data, data: payload.items }
  throw new Error('GET /knowledge/categories 响应形状无法解析：既不是数组，也不含 items')
}

/**
 * 创建知识文档（上传建档）`POST /knowledge/admin/documents` —— 文档 A.6.8。
 *
 * ⚠️ **前端已不再调用它，保留仅为与接口文档 11.2 的接口表保持一致。**
 *
 * 原因：它把「建档」和「启动解析作业」合成一步，等于管理员一上传就替他把
 * 「这份文件可以成为回答依据」这个决定做掉了。现在入库由 AI 服务的
 * `POST /knowledge/ingest` 负责（见 `services/ingest.ts`），流程变成
 * 「上传 → 管理员确认分类 → 入库」，中途可以不入库。
 *
 * 所以**不要再把它接回上传链路**：两条路径并存会让同一份文件被建两遍
 * （两边写的都是 `knowledge_documents` 同一张表）。
 *
 * 原前置条件（若将来要复用）：`payload.file_id` 必须来自 `POST /files/presign`，
 * 且扫描状态已为 `ready`（文档第 9 章第 3 条）。
 */
export async function createKnowledgeDocument(
  payload: KnowledgeDocCreatePayload,
): Promise<ApiSuccess<KnowledgeDocCreateResult>> {
  if (isMock()) {
    await mockDelay(560)
    const documentId = nextMockDocId()
    const categoryName = mockKnowledgeCategories.find((item) => item.id === payload.category_id)?.name
    // 让 mock 列表真的多出一条：否则「提示上传成功但列表没变化」在评审时像是没接上
    mockKnowledgeDocs.unshift({
      id: documentId,
      title: payload.title,
      doc_no: payload.document_no,
      category: categoryName,
      category_name: categoryName,
      status: 'processing',
      version: 'v1.0',
      department: '管理后台上传',
      updated_at: new Date().toISOString(),
      updated_by: '林宪成',
      process_state: '处理中',
      visibility: payload.visibility ?? 'campus',
    })
    return {
      code: 0,
      message: '文档已创建，处理作业已启动',
      data: { document_id: documentId, status: 'processing', job_id: 97, version: 'v1.0' },
      request_id: 'mock_knowledge_create',
    }
  }
  return (
    await http.post<ApiSuccess<KnowledgeDocCreateResult>>('/knowledge/admin/documents', payload, {
      // 建档会创建文档与解析作业，属幂等要求范围（文档 3.2）
      headers: { 'Idempotency-Key': makeIdempotencyKey() },
    })
  ).data
}
