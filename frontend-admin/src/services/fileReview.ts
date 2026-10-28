import { ApiBusinessError, ensureApiSuccess, http } from './http'
import { isMock, mockDelay } from '../stores/dataMode'
import { applyMockFileResolve, applyMockFileRescan, mockFileReviews } from '../mocks/data'
import type {
  ApiSuccess,
  FileReviewItem,
  FileReviewResolvePayload,
  FileReviewResolveResult,
  FileReviewRescanResult,
  FileReviewState,
  Paged,
} from '../types/api'

/* ============================================================================
 * ⚠️ 预留接口 —— 后端未提供，本文件为契约占位（mock 是契约的第二实现）
 * ============================================================================
 *
 * 「内容审核」管理页的真身：**文件审核台**（用户 2026-10-15 拍板）——
 * 审的是上传文件（`files` 表），不是智能体答复。后端已有的部分：
 *   · 异步扫描链路：上传落 `files` 表 → RabbitMQ `file.scan.queue` →
 *     MIME 校验 → ClamAV 病毒扫描 → TMS 内容审核 → 写回 `files.status` / `scan_result`
 *     （`FileListener` → `FileScanServiceImpl`，状态出口 uploaded/scanning/ready/rejected）；
 *   · 审核器判不出结论（needs_review / content_truncated）会**保持 scanning 转人工**，
 *     且补偿重投 job 明确跳过这两个码（`FileScanRetryServiceImpl.HUMAN_REVIEW_CODES`）
 *     —— 那两类的出路就是人，本页就是承接它们的管理台。
 *
 * 缺的是管理端入口（当前只有 `GET /files/{fileId}` 单条查询，无列表、无人工处置）。
 * 路径草案（接后端时全局搜索 RESERVED 找全部待确认点，详见《接口对接说明.md》2.2）：
 *   GET  /admin/files?state=&purpose=&page=&page_size=   文件审核列表（含 scan_result）
 *   POST /admin/files/{id}/resolve                       人工处置（approve→ready / reject→rejected）
 *   POST /admin/files/{id}/rescan                        重新入扫描队列（ready 拒绝，409）
 *
 * 派生态口径（`state` 参数，库里没有这一列）：
 *   ready    = status ready
 *   rejected = status rejected
 *   manual   = status scanning 且 reason_code ∈ HUMAN_REVIEW_CODES（等人）
 *   scanning = 其余 scanning / uploaded（等补偿重投或链路未跑完）
 * 后端实现时要么按这个口径在 SQL 里派生，要么回原始 status+reason_code 由前端派生
 * （`fileReviewStateOf` 已是唯一实现，两种都能接）。
 */

/** 转人工原因码 —— 与后端 `FileScanRetryServiceImpl.HUMAN_REVIEW_CODES` 同源。 */
export const FILE_HUMAN_REVIEW_CODES: readonly string[] = ['needs_review', 'content_truncated']

/**
 * 派生审核态。放在 service 层而不是组件里：列表筛选（mock 过滤 / live 传参）
 * 与详情展示必须用同一套规则，漏一处就会出现「筛出来是转人工、点开却显示扫描中」。
 */
export const fileReviewStateOf = (item: FileReviewItem): FileReviewState => {
  if (item.status === 'ready') return 'ready'
  if (item.status === 'rejected') return 'rejected'
  const code = item.scan_result?.reason_code
  if (item.status === 'scanning' && code && FILE_HUMAN_REVIEW_CODES.includes(code)) return 'manual'
  return 'scanning'
}

/** RESERVED · GET /admin/files —— 文件审核列表（按派生态 / 用途筛选，上传时间倒序）。 */
export async function getFileReviews(params: {
  state?: FileReviewState | 'all'
  purpose?: string
  page?: number
  page_size?: number
} = {}): Promise<ApiSuccess<Paged<FileReviewItem>>> {
  const { state = 'all', purpose = 'all', page = 1, page_size = 8 } = params
  if (isMock()) {
    await mockDelay()
    const filtered = [...mockFileReviews]
      .filter((item) => (state === 'all' ? true : fileReviewStateOf(item) === state))
      .filter((item) => (purpose === 'all' ? true : item.purpose === purpose))
      .sort((a, b) => Date.parse(b.uploaded_at ?? '') - Date.parse(a.uploaded_at ?? ''))
    const start = (page - 1) * page_size
    const items = filtered.slice(start, start + page_size)
    return {
      code: 0,
      message: 'ok',
      data: {
        items,
        page,
        page_size,
        total: filtered.length,
        has_more: start + items.length < filtered.length,
      },
      request_id: 'mock_file_reviews',
    }
  }
  return (
    await http.get<ApiSuccess<Paged<FileReviewItem>>>('/admin/files', {
      params: {
        state: state === 'all' ? undefined : state,
        purpose: purpose === 'all' ? undefined : purpose,
        page,
        page_size,
      },
    })
  ).data
}

/**
 * RESERVED · POST /admin/files/{id}/resolve —— 人工处置。
 * 语义对齐复核工单那套约定：同 id 同 action 重放返回现状；ready 状态下再处置回 409。
 * `Idempotency-Key` 必带（处置是写操作，重试不能产生第二次效果）。
 */
export async function resolveFileReview(
  id: number | string,
  payload: FileReviewResolvePayload,
  idempotencyKey: string,
): Promise<ApiSuccess<FileReviewResolveResult>> {
  if (isMock()) {
    await mockDelay(320)
    const result = applyMockFileResolve(Number(id), payload.action, payload.comment)
    if (!result) throw new ApiBusinessError(404, `文件不存在（或已删除）：${id}`)
    return { code: 0, message: payload.action === 'approve' ? '已通过' : '已驳回', data: result, request_id: 'mock_file_resolve' }
  }
  return ensureApiSuccess(
    (
      await http.post<ApiSuccess<FileReviewResolveResult>>(`/admin/files/${id}/resolve`, payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
      })
    ).data,
    '处置提交失败，请稍后重试',
  )
}

/**
 * RESERVED · POST /admin/files/{id}/rescan —— 重新入扫描队列。
 * 只对 rejected / scanning（含转人工）开放：ready 已由链路放行，重扫没有意义（409）。
 * 重扫后状态回 scanning、旧结论作废只留补偿计数 —— 转人工的件会离开人工队列。
 */
export async function rescanFile(id: number | string, idempotencyKey: string): Promise<ApiSuccess<FileReviewRescanResult>> {
  if (isMock()) {
    await mockDelay(280)
    const result = applyMockFileRescan(Number(id))
    if (result === null) throw new ApiBusinessError(404, `文件不存在（或已删除）：${id}`)
    if (result === 'ready_conflict') throw new ApiBusinessError(409, '该文件已通过审核，无需重新扫描')
    return { code: 0, message: '已重新加入扫描队列', data: result, request_id: 'mock_file_rescan' }
  }
  return ensureApiSuccess(
    (
      await http.post<ApiSuccess<FileReviewRescanResult>>(`/admin/files/${id}/rescan`, {}, {
        headers: { 'Idempotency-Key': idempotencyKey },
      })
    ).data,
    '重新扫描失败，请稍后重试',
  )
}
