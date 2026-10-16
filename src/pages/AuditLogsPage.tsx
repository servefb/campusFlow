import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Calendar,
  Download,
  FileText,
  Filter,
  Lock,
  RotateCcw,
  Search,
  ShieldCheck,
  Terminal,
} from 'lucide-react'
import { Card, EmptyState, Notice, PageHead, Pager, Segmented, SkeletonRows } from '../components/ui'
import { useAuditLogs } from '../hooks/queries'
import { AUDIT_ACTIONS, AUDIT_MODULES, AUDIT_RESULTS, OPERATOR_GROUPS } from '../design/semantics'
import { exportAuditLogs } from '../services/audit'
import { apiErrorMessage } from '../services/http'
import { saveBlob } from '../utils/download'
import { formatDateTime, formatNumber, formatPercent, formatSignedPercent } from '../utils/format'
import type { AuditLog } from '../types/api'

type RangeKey = 'today' | '7d' | '30d' | 'custom'

/**
 * 时间范围 → from/to（文档第 A.10.3 节的写法：`2026-09-01T00:00:00+08:00`）。
 *
 * 🔴 **不要用 `toISOString()`。** 它给的是 UTC + `Z` 后缀，而接口的 `from`/`to` 在后端是 `String`、
 * **原样进 SQL**（`created_at BETWEEN ? AND ?`，中途没有任何时区换算）。MySQL 8.0.29 不认 `Z`：
 * `CAST('2026-09-21T22:26:31.136Z' AS DATETIME(3))` 会把 `Z` 当垃圾字符截掉、把 UTC 的时分秒
 * **当成本地墙钟**（另附一条 `Warning 1292 Truncated incorrect datetime value`，接口层零报错）。
 * 窗口因此整体前移 8 小时 —— 实测「最近 7 天」真库本意 13 条、查出 **0 条**，最近 8 小时的活动全被排除。
 *
 * 为什么要发**显式偏移**而不是只发墙钟：偏移是时区无关的写法 —— 只要库的会话时区是 +08:00，
 * 浏览器在哪个时区都落在同一个时刻；只发墙钟则要求「浏览器时区 == 库的会话时区」，
 * 把系统时区改到别处（或库换到 UTC 容器）就会错，而且一样是静默的。
 */
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000

/** 把某个时刻写成 Asia/Shanghai 的墙钟 + 显式 `+08:00`。中国无夏令时，偏移恒为 8 小时。 */
const toShanghaiISO = (at: Date): string => {
  const wall = new Date(at.getTime() + SHANGHAI_OFFSET_MS)
  const p = (value: number, width = 2) => String(value).padStart(width, '0')
  return (
    `${wall.getUTCFullYear()}-${p(wall.getUTCMonth() + 1)}-${p(wall.getUTCDate())}` +
    `T${p(wall.getUTCHours())}:${p(wall.getUTCMinutes())}:${p(wall.getUTCSeconds())}` +
    `.${p(wall.getUTCMilliseconds(), 3)}+08:00`
  )
}

/** 上海时间的「今天 00:00」对应哪一刻 —— 'today' 的起点不能被浏览器时区带跑。 */
const shanghaiStartOfToday = (now: Date): Date => {
  const wall = new Date(now.getTime() + SHANGHAI_OFFSET_MS)
  return new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) - SHANGHAI_OFFSET_MS)
}

const rangeToBounds = (range: RangeKey): { from?: string; to?: string } => {
  const now = new Date()
  if (range === 'today') {
    return { from: toShanghaiISO(shanghaiStartOfToday(now)), to: toShanghaiISO(now) }
  }
  const days = range === '7d' ? 7 : 30
  return { from: toShanghaiISO(new Date(now.getTime() - days * 24 * 3600 * 1000)), to: toShanghaiISO(now) }
}

export function AuditLogsPage() {
  const [range, setRange] = useState<RangeKey>('7d')
  const [keyword, setKeyword] = useState('')
  const [debounced, setDebounced] = useState('')
  const [operator, setOperator] = useState('all')
  const [module, setModule] = useState('all')
  /*
   * 这是接口的 `action` 参数：后端是 `域.动作` 的**动作码**（`user.login`），精确匹配。
   * 原先这个位置放的是「执行结果状态」的下拉值（`ok` / `blocked` / `denied`）——
   * 那是为了让 mock 里 `log.result !== action` 那条过滤跑通才接上的，live 下选任何一项都必然查出 0 行。
   */
  const [action, setAction] = useState('all')
  /*
   * 「执行结果状态」筛选。
   *
   * ✅ 2026-09-23 后端补上了 `result` 参数，这个控件终于能真筛了。
   * 此前它有两个错误状态：先是错接到 `action` 上（选任何一项都必然 0 行），
   * 后来改成**置灰 + 标注「后端不支持」**。现在真接了 `result`（`all` 哨兵由
   * `services/audit.ts` 的 `dropAll` 摘掉，不会发出去）。
   */
  const [result, setResult] = useState('all')
  const [page, setPage] = useState(1)
  const [exportNote, setExportNote] = useState('')
  /**
   * 导出的提示语气与忙碌态。
   *
   * 之前这里只有一个 `exportNote`，且按钮是**写死的成功文案**
   * （`setExportNote('导出任务已创建，完成后可在通知中心下载。')`）——
   * 一个从来没发出过请求的假成功，而「通知中心」在本工程并不存在。
   */
  const [exportTone, setExportTone] = useState<'emerald' | 'coral'>('emerald')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(keyword)
      setPage(1)
    }, 320)
    return () => clearTimeout(timer)
  }, [keyword])

  /*
   * 必须 memo 住：`rangeToBounds` 每次调用都取 `new Date()`，直接写在 render 体内会让
   * `useAuditLogs` 的 queryKey 每次都变 → 取数成功 → setState → 再 render → key 又变 → **无限重取**
   * （实测 live 模式 5 秒发出 468 次请求，相邻两条的时间戳差 7ms）。只该随 `range` 变。
   */
  const bounds = useMemo(() => rangeToBounds(range), [range])
  const logs = useAuditLogs({
    page,
    page_size: 8,
    keyword: debounced,
    operator_id: operator,
    resource_type: module,
    action,
    result,
    from: bounds.from,
    to: bounds.to,
  })

  const summary = logs.data?.summary
  const items = logs.data?.items ?? []

  /**
   * 导出当前筛选下的审计日志。
   *
   * 用**与列表完全相同**的筛选条件（同一套 `bounds` 与筛选 state），
   * 否则会出现「页面上筛出 3 条、导出的却是全部」——而这种偏差没人会去比对。
   * 注意**不带分页参数**：导出要的是全量，不是当前这一页。
   */
  const handleExport = async () => {
    setExporting(true)
    setExportNote('')
    try {
      const exported = await exportAuditLogs({
        keyword: debounced,
        operator_id: operator,
        resource_type: module,
        action,
        result,
        from: bounds.from,
        to: bounds.to,
      })
      saveBlob(exported.blob, exported.filename)
      setExportTone('emerald')
      setExportNote(
        `已导出 ${formatNumber(exported.rows)} 条审计记录（${exported.filename}）。` +
          (exported.truncated
            ? `⚠️ 本次触到 ${formatNumber(exported.limit)} 条上限、文件已被截断，请缩小时间范围后重导。`
            : ''),
      )
    } catch (error) {
      setExportTone('coral')
      setExportNote(apiErrorMessage(error, '导出失败'))
    } finally {
      setExporting(false)
    }
  }

  /*
   * 「今日累计事件」这个读数的来源问题。
   *
   * ⚠️ 后端暂时没有 summary 接口，此处会退到 `logs.data.total` —— 那是**当前筛选窗口**
   * 的总数（默认「最近 7 天」）。把它挂在「今日」这个标签下面是给真数据安了一个不存在的口径：
   * 数是对的，说的却是另一件事，而屏幕上完全看不出来。
   * 所以标签跟着来源走 —— 有 summary 才叫「今日」，兜底就叫「筛选窗口内」，
   * 并把窗口写进小注，读的人才知道这个 1,482 说的是哪一段。
   */
  const RANGE_WINDOW: Record<RangeKey, string> = {
    today: '今日 00:00 起',
    '7d': '近 7 天',
    '30d': '近 30 天',
    custom: '近 30 天',
  }
  const todayEvents = summary?.today_events
  const periodTotal = logs.data?.total
  const eventCount = todayEvents ?? periodTotal
  const resetFilters = () => {
    setKeyword('')
    setOperator('all')
    setModule('all')
    setAction('all')
    setResult('all')
    setRange('7d')
    setPage(1)
  }

  return (
    <>
      <PageHead
        crumb="平台管理"
        title="操作日志与合规轨迹"
        lede="记录所有管理员、审计员及系统自动化调度器的关键操作与合规快照，遵循高校内控审计标准，每一次数据变更与权限调整均可精确溯源。"
        tools={
          <>
            <span className="health-pill">
              <Lock size={13} /> 留存策略：90 天
            </span>
            <button className="btn btn-primary btn-sm" disabled={exporting} onClick={handleExport}>
              <Download size={14} /> {exporting ? '导出中…' : '导出审计日志'}
            </button>
          </>
        }
      />

      {exportNote && (
        <div style={{ marginBottom: 16 }}>
          <Notice
            tone={exportTone}
            icon={exportTone === 'emerald' ? <ShieldCheck size={15} /> : <AlertTriangle size={15} />}
          >
            {exportNote}
          </Notice>
        </div>
      )}

      {/*
        审计台账配一条 stat-brief 概览行（全站统一语汇）：
        今日事件 / 高危阻断（朱砂）/ 自动任务占比 / 存储周期。
        环比（today_events_delta）与人工份额（1 − 自动任务，真实推导）都收进小注，
        meter 不再单独占一大块。全是接口真字段，缺值如实「— / 未回传」。
      */}
      <section className="stat-brief">
        <div className="brief-cell">
          <span className="brief-label">{todayEvents != null ? '今日累计审计事件' : '筛选窗口内事件'}</span>
          <span className="brief-num">
            {formatNumber(eventCount)}
            <small>件</small>
          </span>
          <span className="brief-sub">
            {todayEvents == null ? (
              periodTotal == null ? (
                '未回传'
              ) : (
                `统计窗口：${RANGE_WINDOW[range]} · 取自列表总数`
              )
            ) : summary?.today_events_delta === undefined || summary?.today_events_delta === null ? (
              '环比未回传'
            ) : (
              <span className={`delta ${summary.today_events_delta > 0 ? 'up' : summary.today_events_delta < 0 ? 'down' : 'flat'}`}>
                {summary.today_events_delta > 0 ? '↑' : summary.today_events_delta < 0 ? '↓' : '·'}{' '}
                {formatSignedPercent(summary.today_events_delta)} 较昨日
              </span>
            )}
          </span>
        </div>
        <div className={`brief-cell${(summary?.high_risk_blocked ?? 0) > 0 ? ' tone-coral' : ''}`}>
          <span className="brief-label">高危阻断 / 鉴权失败</span>
          <span className="brief-num">
            {formatNumber(summary?.high_risk_blocked)}
            <small>件</small>
          </span>
          <span className="brief-sub">
            {summary?.high_risk_blocked == null ? '等待 /admin/audit/summary' : '需人工处置'}
          </span>
        </div>
        <div className="brief-cell">
          <span className="brief-label">自动任务占比</span>
          <span className="brief-num">{formatPercent(summary?.auto_task_rate)}</span>
          <span className="brief-sub">
            {summary?.auto_task_rate == null
              ? '未回传 · 等待 /admin/audit/summary'
              : `人工复核 ${formatPercent(1 - summary.auto_task_rate)}（真实推导）`}
          </span>
        </div>
        <div className="brief-cell">
          <span className="brief-label">存储存续周期</span>
          <span className="brief-num">
            {formatNumber(summary?.retention_days)}
            <small>天</small>
          </span>
          <span className="brief-sub">已启动防篡改</span>
        </div>
      </section>

      <Card pad={false}>
        {/*
          检索 + 四维筛选。**接口只支持 operator_id / action / resource_type / from / to**
          （后端 `AutoLogDto`），四个下拉里只有两个能真发出去，另外两个的现状都写在各自 label 上：
          · `keyword` —— 后端 DTO 里**根本没有这个字段** → live 模式下搜索框被静默忽略（不报错、返回全量）；
          · `operator_id` —— 是 `Long`（数字用户 id），传角色名会在参数绑定期直接 400，需要后端补 role 参数；
          · 执行结果 —— 没有对应参数，控件已置灰。
        */}
        <div className="audit-filter">
          <div className="search-input" style={{ width: '100%', maxWidth: 560 }}>
            <Search size={15} />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="按 IP、工号、对象 ID、操作说明模糊查询…"
              aria-label="检索审计日志"
              title="后端 /admin/audit-logs 暂无 keyword 参数，live 模式下此框不会生效（mock 档有效）"
            />
          </div>
          <div className="toolbar-spacer" />
          {/*
            「自定义」原先在选项里，但 `rangeToBounds` 把它当成 30 天处理（`range === '7d' ? 7 : 30`）——
            也就是说点下去会安静地给一个 30 天窗口，既没有日期选择器、也不告诉用户它替你选了 30 天。
            一个名不副实的选项比没有这个选项更糟，所以先摘掉；等日期选择器做出来再加回来。
          */}
          <Segmented
            value={range}
            options={[
              { value: 'today', label: '今天' },
              { value: '7d', label: '最近 7 天' },
              { value: '30d', label: '最近 30 天' },
            ]}
            onChange={(next) => { setRange(next); setPage(1) }}
          />
        </div>

        <div className="audit-filter second">
          <label className="filter-cell">
            <span className="label-sm">操作者身份</span>
            <select
              className="field"
              value={operator}
              onChange={(event) => { setOperator(event.target.value); setPage(1) }}
              title="后端 operator_id 是数字用户 id；按角色筛选需后端新增 role 参数（已登记）"
            >
              {OPERATOR_GROUPS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-cell">
            <span className="label-sm">业务功能模块</span>
            <select className="field" value={module} onChange={(event) => { setModule(event.target.value); setPage(1) }}>
              {AUDIT_MODULES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-cell">
            <span className="label-sm">操作行为</span>
            <select className="field" value={action} onChange={(event) => { setAction(event.target.value); setPage(1) }}>
              {AUDIT_ACTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {/*
            ✅ 2026-09-23：后端补上了 `result` 参数，这个下拉恢复可用。
            它的历史很值得记一笔 —— 曾经被接到 `action` 上（为了让 mock 的
            `log.result !== action` 跑通），live 下选任何一项都必然 0 行；
            后来改成置灰并标注「后端不支持」。现在是第三种状态：真筛。
          */}
          <label className="filter-cell">
            <span className="label-sm">执行结果状态</span>
            <select
              className="field"
              value={result}
              onChange={(event) => {
                setResult(event.target.value)
                setPage(1)
              }}
            >
              {AUDIT_RESULTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="audit-filter third">
          <span className="hint">
            当前活跃约束：<b className="mono">{range === 'today' ? '时间：今日实时' : range === '7d' ? '时间：7 天内' : '时间：30 天内'}</b>
          </span>
          <div className="toolbar-spacer" />
          <button className="btn btn-ghost btn-sm" onClick={resetFilters}>
            <RotateCcw size={13} /> 重置所有筛选
          </button>
        </div>

        {logs.isLoading && <SkeletonRows rows={6} />}
        {logs.isError && (
          <div style={{ padding: 20 }}>
            <Notice tone="coral">
              审计日志加载失败：{apiErrorMessage(logs.error)}
              <p style={{ margin: '6px 0 0' }}>
                `GET /admin/audit-logs` 需要管理员权限。401 表示服务活着只差令牌，403 表示当前账号权限不足。
              </p>
            </Notice>
          </div>
        )}
        {logs.isSuccess && !items.length && (
          <EmptyState
            title="没有符合条件的审计记录"
            desc="放宽时间范围或清空筛选条件后重试。也可以确认一下：这段时间里确实没有产生审计事件。"
            icon={<Filter size={26} />}
          />
        )}

        {!!items.length && (
          <div className="table-wrap">
            <table className="data audit-table">
              <thead>
                <tr>
                  <th style={{ width: 168 }}>时间戳（UTC+8）</th>
                  <th style={{ width: 200 }}>操作人 / 主体</th>
                  <th style={{ width: 130 }}>所属模块</th>
                  <th style={{ width: 160 }}>操作行为</th>
                  <th>目标对象</th>
                  <th style={{ width: 176 }}>客户端环境 / 域</th>
                </tr>
              </thead>
              <tbody>
                {items.map((log) => (
                  <AuditRow key={log.id} log={log} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="table-foot">
          <span>
            显示第 {items.length ? (page - 1) * 6 + 1 : 0} – {(page - 1) * 6 + items.length} 条，共 {formatNumber(logs.data?.total ?? 0)} 条全量存证记录
          </span>
          <Pager page={page} pageSize={6} total={logs.data?.total ?? 0} onChange={setPage} />
        </div>
      </Card>

      <p className="hint" style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Calendar size={13} /> 时间口径为 Asia/Shanghai（UTC+8）。所有时间戳采用等宽字体并右对齐，便于逐行比对。
      </p>
    </>
  )
}

function AuditRow({ log }: { log: AuditLog }) {
  const isSystem = log.operator_account === 'CronJob'
  /* 后端 `result` 只有 success / failure（建表 CHECK）；denied / blocked 是 mock 的取值，一并当异常态。 */
  const failed = log.result === 'failure' || log.result === 'denied' || log.result === 'blocked'
  /*
   * 线上只有 `operator_id` + `operator_name`（后端 `AutoLogVo`），**没有** account / role。
   * 直接拼 `${account} · ${role}` 会渲染出一个孤零零的 `·`（实测截图里那一列就是这样）。
   * 缺失就降级到真实存在的 `ID <operator_id>`，两者都没有才不渲染这一行。
   */
  const operatorMeta =
    [log.operator_account, log.operator_role].filter(Boolean).join(' · ') ||
    (log.operator_id === undefined || log.operator_id === null ? '' : `ID ${log.operator_id}`)

  return (
    <tr>
      <td>
        <span className="mono" style={{ fontSize: 12 }}>
          {formatDateTime(log.created_at)}
        </span>
      </td>
      <td>
        <div className="cell-user">
          <span className="avatar" style={isSystem ? { background: 'var(--surface-muted)' } : undefined}>
            {isSystem ? <Terminal size={13} /> : (log.operator_name || '—').slice(0, 1)}
          </span>
          <div className="cell-stack" style={{ padding: 0 }}>
            <span className="t-title" style={{ fontSize: 12 }}>
              {log.operator_name || '—'}
            </span>
            {operatorMeta && (
              <span className="mono hint" style={{ fontSize: 10 }}>
                {operatorMeta}
              </span>
            )}
          </div>
        </div>
      </td>
      <td>
        {/* title 挂后端原始值：中文是前端字典翻译出来的，悬停要能对回接口真值 */}
        <span
          className="badge-plain"
          title={log.module}
          style={failed ? { borderColor: 'var(--coral-border)', background: 'var(--coral-soft)', color: 'var(--coral-deep)' } : undefined}
        >
          {log.module_label || log.module || '—'}
        </span>
      </td>
      <td>
        <span className={`action-cell tone-${log.action_tone ?? 'ink'}`} title={log.action}>
          <i />
          {log.action_label || log.action || '—'}
        </span>
      </td>
      <td>
        <div className="cell-stack">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <FileText size={12} style={{ color: 'var(--text-muted)', flex: 'none' }} />
            {log.target_name || '—'}
          </span>
          {log.target_meta && (
            <span>
              <span className={`badge-plain${failed ? ' danger' : ''}`}>{log.target_meta}</span>
            </span>
          )}
        </div>
      </td>
      <td>
        <div className="cell-stack">
          <span className="mono" style={{ fontSize: 12 }}>
            {log.ip || '—'}
          </span>
          {/* 后端不外发客户端环境（user_agent 只落库）→ 措辞降级，不留空白格 */}
          <span className="hint" style={{ fontSize: 11 }}>
            {log.client_name || '—'}
          </span>
        </div>
      </td>
    </tr>
  )
}
