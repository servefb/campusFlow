import { http } from './http'
import { isMock, mockDelay } from '../stores/dataMode'
import { registerMockUploadedFile } from '../mocks/data'
import { humanFileSize } from '../utils/format'
import type { ApiSuccess, FileScanStatus, UploadPurpose, UploadedFile } from '../types/api'

/**
 * 文件上传 —— 文档第 9 章「一步式 multipart」。
 *
 * 流程（三步，缺一不可）：
 *   1. `POST /files/presign` 一次请求提交文件本体 + 元数据 → 拿 `file_id`（此时 status=scanning）
 *   2. `GET /files/{file_id}` 轮询扫描状态，status=ready 之前**业务接口不得引用该 file_id**
 *   3. 调用业务接口建档（如 `POST /knowledge/admin/documents` 带 file_id）
 *
 * 第 2 步是文档写死的约束，不是可选的：跳过它直接建档，后端会拒绝或产生脏数据。
 */

/** 上传进度：0–100。拿不到总长度时不回调，避免画一条假进度条。 */
export type UploadProgressHandler = (percent: number) => void

/** 校规资料允许的扩展名与 MIME。前端先挡一道，减少无效请求（后端仍会按实际内容校验 MIME）。 */
export const KNOWLEDGE_UPLOAD_ACCEPT = '.pdf,.doc,.docx,.txt,.md'
export const KNOWLEDGE_UPLOAD_EXTENSIONS = KNOWLEDGE_UPLOAD_ACCEPT.split(',')
export const KNOWLEDGE_UPLOAD_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
]

/**
 * 单文件上限 50MB。
 * 后端还有 `spring.servlet.multipart.max-file-size` / `max-request-size` 两道限制，
 * 联调时以两边较小的那个为准（文档第 9 章注意事项）。
 */
export const KNOWLEDGE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024

/** 前端预校验。通过返回 null，否则返回可直接上屏的中文原因。 */
export function validateKnowledgeFile(file: File): string | null {
  const dot = file.name.lastIndexOf('.')
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : ''
  if (!KNOWLEDGE_UPLOAD_EXTENSIONS.includes(ext)) {
    return `不支持的文件类型「${ext || '无扩展名'}」，请上传 PDF / Word / TXT / Markdown。`
  }
  if (file.size === 0) return '文件内容为空，请重新选择。'
  if (file.size > KNOWLEDGE_UPLOAD_MAX_BYTES) {
    return `文件 ${humanFileSize(file.size)} 超过 ${humanFileSize(KNOWLEDGE_UPLOAD_MAX_BYTES)} 上限。`
  }
  return null
}

/**
 * 上传一个文件，返回 `file_id`。
 *
 * ⚠️ 这里的 `headers` 不能省，也不能依赖「浏览器会自动设 Content-Type」：
 * `http` 实例的默认头是 `application/json; charset=utf-8`，而 axios 1.20 的 transformRequest 里有一条
 *   `if (isFormData) return hasJSONContentType ? JSON.stringify(formDataToJSON(data)) : data`
 * 只要 Content-Type 含 `application/json`，FormData 就会被**序列化成 JSON**。
 * 实测（真实浏览器 + 回显服务端，见 .workbuddy/ct-probe.mjs）服务端收到的是
 *   `{"filename":"probe.txt","content_type":"text/plain","size_bytes":"16","purpose":"…","file":{}}`
 * —— **文件变成一个空对象**，请求还返回 200，不报错、只是没文件，属于最难查的一类。
 * 显式声明 multipart 之后，浏览器会把它补成带 boundary 的真实值：
 *   `multipart/form-data; boundary=----WebKitFormBoundary…`
 * 写法与同契约的 campusflow/src/services/files.ts 保持一致，避免两端各一套。
 */
/**
 * mock 下的扫描进度计数：file_id → 已被查询次数。
 * mock 直接返回 ready 会让「安全扫描」这一步在评审时整个消失，
 * 而这一层存在的意义就是让各阶段状态可见，所以这里模拟前两次为 scanning。
 */
const mockScanTicks = new Map<number, number>()

/**
 * mock 下的 file_id 计数器。
 * 原来用 `700 + random(200)`，会和「待入库」种子的 701–704 撞号 ——
 * 一撞号，新上传的文件就会继承种子里那条的状态（比如直接显示 failed），
 * 排查时极难看出是 mock 的问题。递增可以彻底避开。
 */
let mockFileSeq = 800

export async function uploadFile(
  file: File,
  purpose: UploadPurpose,
  onProgress?: UploadProgressHandler,
): Promise<ApiSuccess<UploadedFile>> {
  if (isMock()) {
    // 模拟分段上传，让进度条在评审时真的动起来
    const steps = 8
    for (let i = 1; i <= steps; i += 1) {
      await mockDelay(110)
      onProgress?.(Math.round((i / steps) * 100))
    }
    await mockDelay(220)
    const fileId = (mockFileSeq += 1)
    mockScanTicks.set(fileId, 0)
    if (purpose === 'knowledge_doc') {
      // 模拟「Java 把上传落进 files 表」这一步。少了它，上传完的文件不会出现在
      // 「待入库」区，整条 上传 → 待入库 → 入库 → 出现在文档列表 的闭环在 mock 下就是断的。
      registerMockUploadedFile({
        fileId,
        fileName: file.name,
        sizeBytes: file.size,
        contentType: file.type,
      })
    }
    return {
      code: 0,
      message: '上传完成，正在进行安全扫描',
      data: {
        file_id: fileId,
        filename: file.name,
        content_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
        purpose,
        status: 'scanning',
      },
      request_id: 'mock_file_upload',
    }
  }

  const form = new FormData()
  form.append('file', file, file.name)
  form.append('filename', file.name)
  form.append('content_type', file.type || 'application/octet-stream')
  form.append('size_bytes', String(file.size))
  form.append('purpose', purpose)

  return (
    await http.post<ApiSuccess<UploadedFile>>('/files/presign', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (event) => {
        if (!onProgress || !event.total) return
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)))
      },
    })
  ).data
}

/** `GET /files/{file_id}` —— 文件元数据与扫描状态。 */
export async function getFile(fileId: number | string): Promise<ApiSuccess<UploadedFile>> {
  if (isMock()) {
    await mockDelay(280)
    const id = Number(fileId)
    const ticks = (mockScanTicks.get(id) ?? 0) + 1
    mockScanTicks.set(id, ticks)
    return {
      code: 0,
      message: 'ok',
      data: {
        file_id: id,
        filename: 'mock.pdf',
        content_type: 'application/pdf',
        size_bytes: 0,
        purpose: 'knowledge_doc',
        status: ticks >= 2 ? 'ready' : 'scanning',
      },
      request_id: 'mock_file_detail',
    }
  }
  return (await http.get<ApiSuccess<UploadedFile>>(`/files/${fileId}`)).data
}

export interface WaitForReadyOptions {
  timeoutMs?: number
  intervalMs?: number
  onTick?: (status: FileScanStatus | string, elapsedMs: number) => void
  signal?: AbortSignal
}

/**
 * 轮询到扫描通过为止。超时不抛异常而是返回 null —— 让调用方决定
 * 「提示排队中、稍后重试」还是「继续」，别把等待包装成失败。
 */
export async function waitForFileReady(
  fileId: number | string,
  { timeoutMs = 30_000, intervalMs = 1200, onTick, signal }: WaitForReadyOptions = {},
): Promise<UploadedFile | null> {
  const startedAt = Date.now()
  for (;;) {
    const { data } = await getFile(fileId)
    onTick?.(data.status, Date.now() - startedAt)

    if (data.status === 'rejected') {
      throw new Error('文件未通过安全扫描或内容审核，请检查内容后重新上传。')
    }
    if (data.status === 'ready') return data
    if (signal?.aborted) return null
    if (Date.now() - startedAt >= timeoutMs) return null

    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs))
  }
}
