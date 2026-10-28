import { ApiBusinessError, http } from './http'
import { isMock, mockDelay } from '../stores/dataMode'
import { mockAuditLogs, mockAuditSummary } from '../mocks/data'
import { AUDIT_ACTION, AUDIT_RESOURCE_TYPE } from '../design/semantics'
import type { ApiSuccess, AuditLog, AuditLogQuery, AuditLogWire, AuditSummary, Paged } from '../types/api'

/**
 * 操作日志与合规轨迹 —— 文档第 15 章 `GET /admin/audit-logs`（管理员权限）。
 *
 * 接口**只**支持 `operator_id` / `action` / `resource_type` / `from` / `to` 与分页参数
 * （见后端 `AutoLogDto`）。原型上的四个下拉里，「业务功能模块」对应 `resource_type`、
 * 「操作行为」对应 `action`；另外两个没有对应参数，页面里各有标注。
 *
 * ⚠️ 两个 live 下静默失效的坑（后端未实现，已登记 09-21）：
 *   1. `keyword` 在后端 DTO 里**根本没这个字段** → 搜索框被静默忽略（不报错，返回全量）；
 *   2. 顶部四项概览指标后端也没有对应接口 → live 下 `summary` 恒为 undefined，页面按缺省措辞渲染。
 */

/** 下拉里代表「全部」的哨兵值，它不是一个真实的筛选条件。 */
const ALL_OPTION = 'all'

/**
 * 把值为「全部」的筛选项摘掉。
 *
 * 为什么必须摘：后端把 `operator_id` / `resource_type` / `action` 一律当作**精确匹配条件**
 * （`AuditLogsServiceImpl` 里是 `.eq(x != null, ...)`，判据只有「非 null」），
 * 所以传 `all` 下去**不是「不过滤」**，而是变成一个永远匹配不上的条件：
 *   - `resource_type=all` / `action=all` → 查出 0 行（页面表现为「筛选后永远空表」）；
 *   - `operator_id=all` 更糟 —— 后端 DTO 里这个字段是 `Long`，`all` 在**参数绑定期**就炸，
 *     请求直接 400，连查询都进不去。
 * 也就是说「全部」在本接口语义里等价于**不传该参数**。
 */
const dropAll = (value?: string) => {
  const trimmed = value?.trim()
  return !trimmed || trimmed === ALL_OPTION ? undefined : trimmed
}

/** `/admin/audit-logs` 的查询串构造。查询与导出共用一份，保证两边摘哨兵的规则不会跑偏。 */
const auditParams = (query: AuditLogQuery) => {
  const { page = 1, page_size = 6, keyword = '', operator_id, action, resource_type, result, from, to } = query
  return {
    page,
    page_size,
    keyword: keyword || undefined,
    operator_id: dropAll(operator_id),
    action: dropAll(action),
    resource_type: dropAll(resource_type),
    // ✅ 2026-09-23 后端补上了 result 参数。之前这个位置没有它，
    // 页面上的「执行结果状态」下拉只能置灰（错接到 action 上会必然 0 行）。
    result: dropAll(result),
    from,
    to,
  }
}

/**
 * 线上形状 → 展示形状。
 *
 * 🔴 **这一层是必须的**：`mockAuditLogs` 是**已经归一化过的展示数据**
 * （`module` 直接是中文、`action` 直接是中文动作名，还自带 `operator_account` / `client_name` /
 * `target_name` / `target_meta`），而线上返回的是**原始枚举**
 * （`resource_type: 'knowledge_document'`、`action: 'user.login'`、`resource_id: 25`）。
 *
 * 之前 live 分支把线上 body 直接**断言**成 `AuditLog` 返回 —— 断言不报错、TypeScript 也查不出来，
 * 于是页面六列里五列静默空白：所属模块整列空、操作行为显示 `user.login` 原码、目标对象 `—`、
 * 客户端环境空、操作人第二行只剩一个孤零零的 `·`（09-21 真机复现）。
 *
 * 后端没有的字段**不编**：`operator_account` / `operator_role` / `client_name` 保持缺省，
 * 交给页面措辞降级（`—` 或 `ID <operator_id>`），不拿别的字段顶替
 * —— `resource_id` 那套「三级降级」取错值的教训就在这。
 */
const normalizeAuditLog = (raw: AuditLogWire): AuditLog => {
  const type = AUDIT_RESOURCE_TYPE[raw.resource_type]
  const action = AUDIT_ACTION[raw.action]
  const resourceId = raw.resource_id
  return {
    id: raw.id,
    created_at: raw.created_at,
    operator_id: raw.operator_id ?? undefined,
    operator_name: raw.operator_name ?? '',
    action: raw.action,
    action_label: action?.label,
    action_tone: action?.tone,
    module: raw.resource_type,
    module_label: type?.module,
    target_type: raw.resource_type,
    // 目标对象 = `resource_type` + `resource_id`，两个都是后端真实字段；
    // `resource_id` 为 null 就不写（后端确实没给），由页面显示 `—`。
    target_name:
      resourceId === null || resourceId === undefined
        ? undefined
        : `${type?.noun ?? raw.resource_type} #${resourceId}`,
    ip: raw.ip_address ?? undefined,
    result: raw.result,
  }
}

/**
 * mock 侧的筛选。
 *
 * 抽成独立函数是因为**列表与导出必须筛出同一个集合** ——
 * 各写一份的结局必然是「页面上筛出 3 条、导出却是全部」，而 mock 下没人会去比对
 * （真接口那边靠后端 `buildWrapper` 共用来保证同一件事）。
 */
const filterMockAuditLogs = (query: AuditLogQuery) => {
  const { keyword = '', operator_id, action, resource_type, from, to } = query
  const kw = keyword.trim().toLowerCase()
  return mockAuditLogs.filter((log) => {
    if (kw) {
      const haystack = [log.operator_name, log.operator_account, log.action, log.module, log.target_name, log.ip]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '')
      if (!haystack.includes(kw.replace(/[^\p{L}\p{N}]+/gu, ''))) return false
    }
    /*
     * mock 数据是「展示型」（`module` / `action` 都是中文），而筛选值现在是后端原始枚举
     * → 先在 mock 侧翻译一次，否则切到 mock 档筛选会永远空表。
     * ⚠️ mock 的动作名（「覆盖更新版本」这类）是原型自造的，和真动作码没有对应关系，
     * 所以按动作筛在 mock 下大多匹配不到 —— 这是 mock 数据的问题，不是筛选逻辑的问题。
     */
    if (operator_id && operator_id !== 'all' && log.operator_role !== operator_id) return false
    if (resource_type && resource_type !== 'all' && log.module !== (AUDIT_RESOURCE_TYPE[resource_type]?.module ?? resource_type)) {
      return false
    }
    if (action && action !== 'all' && log.action !== (AUDIT_ACTION[action]?.label ?? action)) return false
    /*
     * 时间比较走 `getTime()`，不要字典序。
     * `from`/`to` 是 `+08:00` 写法、mock 里也可能出现 `Z` 写法，
     * 两种格式的字符串直接比大小会把「更晚的时刻」判成更早（`+` 与 `Z` 的码位都在数字之后），
     * 而且这种错误不报错、只安静地少几行。
     */
    if (from) {
      const fromMs = new Date(from).getTime()
      if (Number.isFinite(fromMs) && new Date(log.created_at).getTime() < fromMs) return false
    }
    if (to) {
      const toMs = new Date(to).getTime()
      if (Number.isFinite(toMs) && new Date(log.created_at).getTime() > toMs) return false
    }
    return true
  })
}

export async function getAuditLogs(query: AuditLogQuery = {}): Promise<ApiSuccess<Paged<AuditLog> & { summary?: AuditSummary }>> {
  const { page = 1, page_size = 6 } = query
  if (isMock()) {
    await mockDelay()
    const filtered = filterMockAuditLogs(query)
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
        summary: { ...mockAuditSummary, total: filtered.length },
      },
      request_id: 'mock_audit_logs',
    }
  }

  const body = (
    await http.get<ApiSuccess<Paged<AuditLogWire> | null>>('/admin/audit-logs', {
      params: auditParams(query),
    })
  ).data

  /*
   * ⚠️ `data` 可能是 **null**：后端一条都没查到时返回的是 `Result.failure(404, 'No records found')`，
   * HTTP 状态仍是 200，所以 axios 不会 reject —— 必须在 `data` 上容错成空页，
   * 否则页面在 `.items` 上直接炸（表现为整页白屏）。
   */
  const pageData = body.data
  return {
    ...body,
    data: {
      items: (pageData?.items ?? []).map(normalizeAuditLog),
      page: pageData?.page ?? page,
      page_size: pageData?.page_size ?? page_size,
      total: pageData?.total ?? 0,
      has_more: pageData?.has_more ?? false,
    },
  }
}

/**
 * 一次导出的结果。
 *
 * 为什么不是原来的 `{ file_url }`：那是原型时期的**预留形状**（当时后端没有这个接口，
 * 页面按钮写死了一句「导出任务已创建，完成后可在通知中心下载」）。而「异步任务 + 通知中心」
 * 需要一套任务与通知设施，本工程没有产出方。后端最终落地的是**同步 CSV 文件流**，
 * 当场就能存盘 —— 所以契约跟着改成「拿回一个 Blob」。
 */
export interface AuditExportResult {
  blob: Blob
  filename: string
  /** 实际导出行数（不含表头），取自响应头 `X-Export-Rows`。 */
  rows: number
  /** 本次生效的行数上限，取自 `X-Export-Limit`。 */
  limit: number
  /** 是否因触到上限而截断，取自 `X-Export-Truncated`。 */
  truncated: boolean
}

/** 本地日期戳（墙钟）。不用 `toISOString()` —— 那是 UTC，日期会差 8 小时。 */
const localDateStamp = () => {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * 导出审计日志 `GET /admin/audit-logs/export`（✅ 2026-09-23 起后端提供，同步 CSV）。
 *
 * 筛选条件与列表**完全一致**（真接口那边靠后端 `buildWrapper` 共用，mock 这边靠
 * `filterMockAuditLogs` 共用），所以「页面上筛出 3 条、导出的却是全部」不会发生。
 *
 * 🔴 两个必须处理的点：
 *   1. **`responseType: 'blob'` 之下，错误也是 Blob**。后端鉴权失败或参数非法时回的是
 *      JSON 包络（HTTP 200 + 非 0 `code`，本工程一贯行为）。不检查 `Content-Type`
 *      就会把一个装着错误说明的文件存成 `.csv`，打开是乱码。
 *   2. **截断必须能说出口**：行数 / 上限 / 是否截断走响应头（没有 JSON 包络可以放它们），
 *      见 `AuditExportResult`。静默截断会让合规归档少一段且毫无痕迹。
 */
export async function exportAuditLogs(query: AuditLogQuery = {}): Promise<AuditExportResult> {
  const filename = `audit-logs-${localDateStamp()}.csv`
  if (isMock()) {
    await mockDelay(400)
    /*
     * mock 侧生成**真的 CSV**（含 UTF-8 BOM），而不是回一个空的 file_url：
     * 只有这样「点导出 → 浏览器存下文件 → 用 Excel 打开不是乱码」这条链路
     * 在 mock 下也能被验到。
     */
    const rows = filterMockAuditLogs(query)
    const cell = (value: unknown) => {
      if (value === null || value === undefined) return ''
      const text = String(value)
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const lines = ['时间,操作人ID,操作人姓名,动作,资源类型,资源ID,执行结果,IP地址']
    for (const log of rows) {
      lines.push(
        [
          cell(log.created_at),
          cell(log.operator_id),
          cell(log.operator_name),
          cell(log.action),
          cell(log.module),
          cell(log.target_name),
          cell(log.result),
          cell(log.ip),
        ].join(','),
      )
    }
    return {
      blob: new Blob(['\uFEFF' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }),
      filename,
      rows: rows.length,
      limit: 50_000,
      truncated: false,
    }
  }

  const response = await http.get<Blob>('/admin/audit-logs/export', {
    params: auditParams(query),
    // 必须显式声明：默认的 JSON 响应类型会把 CSV 流当对象处理，拿到的是一坨乱码
    responseType: 'blob',
  })

  const contentType = String(response.headers['content-type'] ?? '')
  if (!contentType.includes('text/csv')) {
    const raw = await response.data.text()
    let message = '导出失败'
    try {
      const body = JSON.parse(raw) as { message?: string }
      if (body?.message) message = body.message
    } catch {
      if (raw) message = raw.slice(0, 200)
    }
    throw new ApiBusinessError(-1, message)
  }

  const headerNumber = (name: string, fallback: number) => {
    const value = Number(response.headers[name])
    return Number.isFinite(value) && value >= 0 ? value : fallback
  }
  return {
    blob: response.data,
    filename,
    rows: headerNumber('x-export-rows', 0),
    limit: headerNumber('x-export-limit', 50_000),
    truncated: String(response.headers['x-export-truncated']) === 'true',
  }
}
