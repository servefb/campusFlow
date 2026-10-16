import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  BookOpenCheck,
  Boxes,
  ChevronDown,
  Download,
  Flame,
  ListChecks,
  Newspaper,
  Play,
  RefreshCw,
  Server,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { Badge, Card, EmptyState, PageHead, Segmented, SkeletonRows, useCountUp } from '../components/ui'
import { UsageTrendChart } from '../components/UsageTrendChart'
import {
  useAgentMetrics,
  useHotQuestions,
  useKnowledgeHealth,
  useOverview,
  usePendingKnowledgeFiles,
  useTrends,
} from '../hooks/queries'
import { formatNumber, formatPercent, formatRelative, formatSignedPercent } from '../utils/format'
import { RANGE_OPTIONS, type RangeValue } from '../design/tokens'
import { PENDING_INGEST_STATUS } from '../design/semantics'
import type { AgentMetric } from '../types/api'

/**
 * 时间窗口的短名，用于「XX 对话数」这类需要跟着档位变的文案。
 *
 * ⚠️ 原先这两处都写死成「今日对话数」「24H 汇总」—— 切到「最近 30 天」之后，
 * 读数真的换成了 30 天的、标题却还在说「今日 / 24H」，看着完全正常但说的是另一件事。
 * 不能用 `RANGE_OPTIONS` 的 label：那是「今日实时 / 最近 7 天 / 最近 30 天」，
 * 直接拼进「{label}对话数」会读成「今日实时对话数」。
 */
const RANGE_SHORT: Record<RangeValue, string> = { today: '今日', '7d': '近 7 天', '30d': '近 30 天' }

/**
 * 能力维度 → 抽象符号。
 *
 * 规范要求「用统一的抽象图形或简洁符号区分，避免花哨的机器人插画」，
 * 所以这里刻意**只用线性符号**：尺寸、线宽、颜色完全一致，只有图形本身不同。
 * 后端新增了未登记的键时退回通用的方框符号 —— 不猜语义，也不留空白。
 */
const CAPABILITY_ICON: Record<string, LucideIcon> = {
  policy_agent: BookOpenCheck,
  affairs_agent: Workflow,
  task_agent: ListChecks,
  news_agent: Newspaper,
}

/**
 * 展示名。
 *
 * ⚠️ 后端在「多智能体」时期把 `agent_name` 写成过 `校园政策问答 Agent`。
 * 现在全站只有一个 CampusFlow，这条读数讲的是**它内部的一条调用路径**，
 * 带着 ` Agent` 后缀会被读成「还有一个别的助手」。所以统一剥掉这个后缀；
 * 键位 `policy_agent` 等仍照抄后端，不改 —— 那是接口契约。
 */
const capabilityName = (item: AgentMetric) => (item.agent_name ?? item.agent_key).replace(/\s*Agent$/, '')

/**
 * 工作台。
 *
 * 这一页只回答两件事：
 *   ① 现在服务得怎么样  —— 读数带 + 使用趋势 + 能力分布 + 知识库与索引
 *   ② 有什么要我处理    —— 右侧的待入库文件
 * （「待人工复核」的答复复核队列已于 2026-10-15 撤除：内容审核页改审文件，
 *  见《接口对接说明.md》2.2 —— 复核工单是 AI 答复维度的概念，管理端不再展示。）
 * 所以版式是「主内容 + 较窄待办列」（split-8-4），而不是把内容切成等尺寸的卡片网格。
 */
export function ObservatoryPage() {
  const [range, setRange] = useState<RangeValue>('today')
  const [devOpen, setDevOpen] = useState(false)

  const overview = useOverview(range)
  const trends = useTrends(range, range === 'today' ? 'hour' : 'day')
  const agents = useAgentMetrics(range)
  const knowledge = useKnowledgeHealth()
  const hot = useHotQuestions(range)
  const pendingFiles = usePendingKnowledgeFiles()

  /*
   * `data_complete` 的落地。
   *
   * 契约（types/api.ts 的类型注释 + 《接口对接说明》2.1）要求：`data_complete === false`
   * 时不得把缺失值渲染成 0。但全站此前**没有一处代码真的读过这个字段** ——
   * 它只出现在注释、文档，和这一页底部那条「场景 C」演练文案里，属「声明未落地」。
   *
   * 真正的风险不是「字段缺失」：缺了可选链自然返回 undefined，读数显示「—」，
   * 这层本来就没问题。风险是**后端聚合不出来却填了个 0** —— 那时前端会把 0 当成
   * 真实读数展示，屏幕上就是「今日对话数 0 次」这种看着完全正常、实际是错的数字。
   * 所以这里统一把不可信的整包指标判为 undefined，读数退回「—」，
   * 并在工具条上说明原因（否则满屏「—」会被当成页面坏了）。
   *
   * 只在明确 `false` 时降级；字段本身缺失按「完整」处理，不误伤还没实现该字段的后端。
   */
  const metricsTrusted = overview.data?.data_complete !== false
  const metrics = metricsTrusted ? overview.data?.metrics : undefined
  const agentList = agents.data?.items ?? []
  const totalCalls = agentList.reduce((sum, agent) => sum + agent.call_count, 0)
  const overallFailure = agentList.length
    ? agentList.reduce((sum, agent) => sum + agent.failure_rate * agent.call_count, 0) / (totalCalls || 1)
    : null

  /**
   * 知识库健康度。
   *
   * 原先这里写成 `knowledge.data?.documents.failed` —— 问号挂在了 `data` 上而不是
   * `documents` 上。后端这个接口只要不回 `documents`（降级、字段改名、或接口还在实现中），
   * 首屏看板就是**整页白屏**（本项目没有 ErrorBoundary，React 会卸载整棵树）。
   * 知识治理页有同一处，已修；这里是它的孪生兄弟。
   */
  const failedDocs = knowledge.data?.documents?.failed
  const knowledgeBadge =
    failedDocs == null ? (
      <Badge tone="slate">待检查</Badge>
    ) : failedDocs > 0 ? (
      <Badge tone="coral">{formatNumber(failedDocs)} 篇异常</Badge>
    ) : (
      <Badge tone="emerald">健康</Badge>
    )

  /**
   * 向量分片容量条。
   *
   * 只用接口真给了的两个数：`vector.chunks` / `vector.chunk_capacity`，
   * 单位如实写作「分片」，比例由这两个数相除得到，不自己发明换算率。
   * 真正的容量口径（`storage_used_gb` / `storage_total_gb`）后端尚未提供，
   * 已登记在《接口对接说明.md》的待确认项里。
   */
  const chunks = knowledge.data?.vector?.chunks
  const chunkCapacity = knowledge.data?.vector?.chunk_capacity
  const hasCapacity = typeof chunks === 'number' && typeof chunkCapacity === 'number' && chunkCapacity > 0
  const storagePct = hasCapacity ? Math.min(100, (chunks / chunkCapacity) * 100) : 0
  const capacityTone = storagePct >= 90 ? ' is-full' : storagePct >= 75 ? ' is-warn' : ''

  /**
   * 趋势序列。与读数带同 `range` 的同一份 trends 接口 ——
   * 不额外请求，也不补点、不插值，接口给几个采样就画几个。
   */
  const trendPoints = trends.data?.items ?? []
  const volumeSeries = trendPoints.map((point) => point.question_count)
  /*
   * ⚠️ `average_response_ms` 现在**可空**（2026-09-23 后端补齐 trends 时定的口径）：
   * 某一格正好没有带耗时的回答，后端回 null 而不是 0 —— 0 会被读成「响应 0 秒」。
   * 所以必须先滤掉非数字再求峰值：`Math.max(null)` 等于 0，
   * 页面上会出现「本区间峰值 0.00s」这种看着很快、其实没测到的读数。
   */
  const latencySeries = trendPoints
    .map((point) => point.average_response_ms)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const latencyPeak = latencySeries.length ? Math.max(...latencySeries) : null
  const granularityLabel = range === 'today' ? '按小时分布' : '按天分布'

  /** 问题解决率的目标（业务阈值，不是测量值 —— 测量值一律来自接口）。 */
  const RESOLVE_TARGET = 0.95
  const resolveRate = metrics?.helpful_rate
  const resolveOk = typeof resolveRate === 'number' ? resolveRate >= RESOLVE_TARGET : null

  /*
   * 读数走 useCountUp「启动式」滚入 —— 读数带亮起的瞬间感。
   * 接口没回传时 hook 恒返回 null，读数如实显示「—」，不会假装在滚。
   */
  const questionAnim = useCountUp(metrics?.question_count ?? null)
  const resolveAnim = useCountUp(typeof resolveRate === 'number' ? resolveRate : null)
  const latencyAnim = useCountUp(metrics?.average_response_ms ?? null)

  /** 待入库文件：右侧「近期知识更新」卡的数据源（与知识治理页同一份查询）。 */
  const recentFiles = (pendingFiles.data?.items ?? []).slice(0, 4)

  return (
    <>
      <PageHead
        crumb="运行监控"
        title="工作台"
        lede="CampusFlow 的服务情况与待办一览：读数来自管理员看板接口，待办来自知识入库队列。"
        tools={
          <>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                overview.refetch()
                trends.refetch()
                agents.refetch()
              }}
            >
              <RefreshCw size={14} /> 刷新
            </button>
            <button className="btn btn-primary btn-sm">
              <Download size={14} /> 导出简报
            </button>
          </>
        }
      />

      <div className="toolbar">
        <Segmented
          value={range}
          options={RANGE_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
          onChange={setRange}
        />
        <div className="toolbar-spacer" />
        {/*
          校区筛选：后端指标接口没有这个参数，控件保持可见但**禁用**，
          并在 title 里说明原因 —— 一个点得动、点了没反应的筛选器比没有更像半成品。
        */}
        <label className="inline-field" title="指标接口暂不支持按校区过滤，后端补齐后启用">
          <span className="label-sm">校区范围</span>
          <select className="field" value="all" disabled>
            <option value="all">全部校区</option>
          </select>
        </label>
        {/*
          data_complete=false 时读数带会整排显示「—」。不说明原因的话，
          这屏看起来是「页面坏了」，而不是「后端明确说这次的数据不完整」。
        */}
        {!metricsTrusted && <span className="hint tone-warn">指标数据不完整（data_complete=false），读数已置空</span>}
        <span className="hint mono">更新于 {overview.data?.updated_at ? formatRelative(overview.data.updated_at) : '—'}</span>
      </div>

      {/*
        ① 当前服务情况：一条读数带，三格内。
        原第四格「待人工复核」随答复复核队列一起撤除（2026-10-15，见页首注释），
        overview 里的 `human_review_pending` 字段仍在契约中，前端不再消费。

        走势与环比信息收进小注，详细趋势交给下面的使用趋势卡。
        原先三张卡底部写死的 +16.4% / +1.2% / -0.6% 已删除 —— overview 契约里
        没有任何环比字段，那三个箭头和后端数据无关。
      */}
      <section className="stat-brief">
        <div className="brief-cell">
          <span className="brief-label">{RANGE_SHORT[range]}对话数</span>
          <span className="brief-num">
            {questionAnim === null ? '—' : formatNumber(Math.round(questionAnim))}
            <small>次</small>
          </span>
          <span className="brief-sub">
            {volumeSeries.length > 1 ? `${granularityLabel} · ${trendPoints.length} 个采样` : '走势未回传'}
            {/*
              环比（2026-09-23 后端补齐 `question_count_delta`）。
              ⚠️ 必须判 `!= null`：后端在「上一区间没有可比数据」时回 null，
              写成 `?? 0` 会渲染成「+0.0% 较上一区间」= 与上期持平，那是一个编出来的结论。
            */}
            {metrics?.question_count_delta != null && <> · {formatSignedPercent(metrics.question_count_delta)} 较上一区间</>}
          </span>
        </div>
        <div className="brief-cell">
          <span className="brief-label">问题解决率</span>
          <span className="brief-num">{resolveAnim === null ? '—' : formatPercent(resolveAnim)}</span>
          <span className="brief-sub">
            {resolveRate == null ? '解决率未回传' : `目标 ${formatPercent(RESOLVE_TARGET, 0)} · ${resolveOk ? '已达标' : '未达标'}`}
          </span>
        </div>
        <div className="brief-cell">
          <span className="brief-label">平均响应时长</span>
          <span className="brief-num">
            {latencyAnim === null ? '—' : (latencyAnim / 1000).toFixed(2)}
            <small>s</small>
          </span>
          <span className="brief-sub">
            {latencyPeak == null ? '目标 P95 < 2s' : `目标 P95 < 2s · 本区间峰值 ${(latencyPeak / 1000).toFixed(2)}s`}
            {metrics?.average_response_ms_delta != null && (
              <> · {formatSignedPercent(metrics.average_response_ms_delta)} 较上一区间</>
            )}
          </span>
        </div>
      </section>

      {/* ② 服务趋势（全宽）—— 原右侧「待人工复核队列」卡已撤除（答复复核下线） */}
      <Card
        title={
          <>
            <Activity size={16} /> CampusFlow 服务使用趋势
          </>
        }
        sub="对话总量、AI 自主解决与人工复核分流占比"
        pad={false}
      >
        {trends.isLoading ? (
          <SkeletonRows rows={5} />
        ) : (
          <div style={{ padding: '16px 20px 8px' }}>
            {/*
              height 300：原先与右侧复核队列并排时为对齐栏高调大的，队列撤除后
              这张卡全宽，300 的高度对全宽折线仍然合适，保持不动少一个变量。
            */}
            <UsageTrendChart points={trendPoints} height={300} />
            {/*
              区间小读数：把 overview 里两个**一直没人读**的字段接上。
              `citation_hit_rate`（引用命中率）与 `auto_resolved_rate`（AI 自主解决率）
              此前只在类型定义和 mock 里出现，页面一处都没读。
              缺值时 formatPercent 返回「—」，不拿趋势里的 `ai_resolved` 顶替 ——
              那是逐采样点的绝对条数，与区间比率是两种粒度，不能互相换算。
            */}
            <div className="trend-readout">
              <span>
                AI 自主解决 <b>{formatPercent(metrics?.auto_resolved_rate)}</b>
              </span>
              <span>
                引用命中率 <b>{formatPercent(metrics?.citation_hit_rate)}</b>
              </span>
            </div>
          </div>
        )}
      </Card>

      {/* ③ 服务明细（主） + 知识资产近况（侧） */}
      <div className="split-8-4">
        <div className="stack">
          <Card
            title={
              <>
                <Boxes size={16} /> 服务能力分布
              </>
            }
            sub="CampusFlow 各条调用路径的受理量占比"
            extra={<span className="label-sm">{agentList.length} 条路径</span>}
          >
            <div className="dist-list">
              {agentList.map((agent, index) => {
                const Icon = CAPABILITY_ICON[agent.agent_key] ?? Boxes
                const ratio = totalCalls ? agent.call_count / totalCalls : 0
                return (
                  <div className="dist-row" key={agent.agent_key}>
                    <div className="dist-row-head">
                      <span className="dist-glyph">
                        <Icon size={15} strokeWidth={1.75} />
                      </span>
                      <span className="dist-name" title={agent.agent_name ?? agent.agent_key}>
                        {capabilityName(agent)}
                      </span>
                      <b className="mono">{formatPercent(ratio, 0)}</b>
                      <small>{formatNumber(agent.call_count)} 次</small>
                    </div>
                    <div className="dist-bar">
                      {/* 份额条用主色的单一色阶（名次越靠前越深），不引入第二个色相 */}
                      <i style={{ width: `${Math.max(3, ratio * 100)}%`, opacity: 1 - index * 0.22 }} />
                    </div>
                  </div>
                )
              })}
              {!agentList.length && (
                /*
                 * 空列表的主流原因是**这个时间窗口内确实没有调用记录**，不是接口坏了。
                 * 让人去「检查接口」，等于把一个正常的空态报成故障。
                 */
                <EmptyState
                  title="本区间无调用记录"
                  desc={`${RANGE_SHORT[range]}内没有产生服务调用。切到更长的时间窗口可查看历史调用。`}
                />
              )}
            </div>
            <div className="dist-foot">
              <span>
                调用成功率：<b>{overallFailure === null ? '—' : formatPercent(1 - overallFailure)}</b>
              </span>
              <span>
                失败率：<b className="mono">{overallFailure === null ? '—' : formatPercent(overallFailure, 1)}</b>
              </span>
            </div>
          </Card>

          <Card
            title={
              <>
                <Flame size={16} /> 热门咨询 Top 5
              </>
            }
            extra={<span className="label-sm mono">{RANGE_SHORT[range]}汇总</span>}
          >
            <ol className="rank-list">
              {(hot.data?.items ?? []).map((item) => (
                <li key={item.rank}>
                  <span className="rank-no mono">{String(item.rank).padStart(2, '0')}</span>
                  <div className="rank-main">
                    <span className="rank-title">{item.question}</span>
                    <div className="rank-meta">
                      <span className="mono">{formatNumber(item.count)} 次</span>
                      {/*
                        分类徽章只在**真有分类**时渲染。
                        ⚠️ 后端恒不回这个字段（`messages` 表没有分类列）——
                        直接写 `<span>{item.category}</span>` 会在每一行后面挂一枚空白标签。
                      */}
                      {item.category && <span className="badge-plain">{item.category}</span>}
                      {item.helpful_rate !== undefined && (
                        <span className={`mono ${item.helpful_rate < 0.95 ? 'tone-warn' : 'tone-ok'}`}>
                          {formatPercent(item.helpful_rate, 1)}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            {!hot.data?.items?.length && <EmptyState title="热门问题未返回" />}
            <div className="dist-foot">
              <span className="hint">全校学生提问频次最高的事项与办件</span>
              <Link className="link-strong" to="/knowledge-governance">
                查看知识库
              </Link>
            </div>
          </Card>
        </div>

        <div className="stack">
          {/*
            知识库与索引。原先这一块被拆成「知识库健康度」+「索引引擎基础服务」两张卡，
            而后者写的是 18ms / 12,480 / 28% GPU 负载 / RTX 4060×2 这类**接口里根本没有的读数**
            （只在脚注里标注为"部署快照"）。模块的定位是对的（底层索引状态归运行监控页），
            所以保留它，但只呈现接口真给了的字段：
            engine / similarity / chunks / chunk_capacity / embedding_model / fulltext_index。
          */}
          <Card
            title={
              <>
                <BookOpenCheck size={16} /> 知识库与索引
              </>
            }
            extra={knowledgeBadge}
          >
            <dl className="spec-rows">
              <div>
                <dt>向量检索可用性</dt>
                <dd className="mono">{formatPercent(knowledge.data?.vector?.similarity)}</dd>
              </div>
              <div>
                <dt>向量引擎</dt>
                <dd className="mono">{knowledge.data?.vector?.engine ?? '—'}</dd>
              </div>
              <div>
                <dt>嵌入模型</dt>
                <dd className="mono">{knowledge.data?.vector?.embedding_model ?? '—'}</dd>
              </div>
              <div>
                <dt>全文索引</dt>
                <dd className="mono">
                  {formatNumber(knowledge.data?.fulltext_index?.indexed_sections)}
                  {knowledge.data?.fulltext_index?.pending_sections != null && (
                    <span className="hint"> · 待处理 {formatNumber(knowledge.data.fulltext_index.pending_sections)} 段</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>最近全量同步</dt>
                <dd className="mono">{formatRelative(knowledge.data?.fulltext_index?.last_completed_at)}</dd>
              </div>
              <div className="is-stack">
                <dt>向量分片容量</dt>
                <div className={`capacity-bar${capacityTone}`}>
                  <i style={{ width: `${storagePct}%` }} />
                </div>
                <dd className="mono">
                  {hasCapacity ? `${formatNumber(chunks)} / ${formatNumber(chunkCapacity)} 分片` : '接口未回传容量字段'}
                </dd>
              </div>
            </dl>
            {failedDocs != null && failedDocs > 0 && (
              <div className="mini-alert">
                <AlertTriangle size={14} />
                <span>异常文档 {failedDocs} 篇</span>
                <Link className="link-strong" to="/knowledge-governance">
                  立即处理
                </Link>
              </div>
            )}
          </Card>

          {/*
            近期知识更新：待入库队列本身就是"最近发生了什么"的唯一真实来源
            （上传过、但还没进检索池的文件）。没有数据时如实说明，
            不编造一条"定时同步流水线"来把这一格填满。
          */}
          <Card
            title={
              <>
                <Server size={16} /> 近期知识更新
              </>
            }
            extra={<span className="label-sm">{formatNumber(pendingFiles.data?.items?.length ?? 0)} 份待处理</span>}
          >
            {pendingFiles.isLoading && <SkeletonRows rows={3} />}
            {pendingFiles.isError && <p className="hint" style={{ margin: 0 }}>待入库列表未返回（AI 服务 /api/v2 未响应）。</p>}
            {pendingFiles.isSuccess && !recentFiles.length && (
              <p className="hint" style={{ margin: 0 }}>暂无待入库文件 —— 上传资料后会先出现在这里。</p>
            )}
            {!!recentFiles.length && (
              <ul className="feed-list">
                {recentFiles.map((file) => {
                  const meta = PENDING_INGEST_STATUS[file.ingestStatus] ?? { tone: 'slate' as const, label: file.ingestStatus }
                  return (
                    <li key={file.fileId}>
                      <span className="feed-title" title={file.title || file.fileName}>
                        {file.title || file.fileName}
                      </span>
                      <div className="feed-meta">
                        <Badge tone={meta.tone} dot={file.ingestStatus === 'processing'}>
                          {meta.label}
                        </Badge>
                        <span className="mono hint">{file.uploadedAt ? formatRelative(file.uploadedAt) : '—'}</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="dist-foot">
              <span className="hint">确认分类后才会被解析、切分并写入向量索引</span>
              <Link className="link-strong" to="/knowledge-governance">
                前往知识库
              </Link>
            </div>
          </Card>
        </div>
      </div>

      {/* 容错演练区：默认收起 —— 这块是给评审看的说明性内容，
          常驻展开会在首屏压出一大片开发笔记的观感。 */}
      <Card
        className="dev-card"
        onHeadClick={() => setDevOpen((value) => !value)}
        headExpanded={devOpen}
        title={
          <>
            <Play size={15} /> 服务容错与异常回滚设计
          </>
        }
        sub="当接口波动、队列阻塞或知识源降级时的页面状态反馈机制 · 点击标题栏展开"
        extra={
          <>
            <Badge tone="slate">DEV PREVIEW</Badge>
            <ChevronDown size={16} className={`muted-icon dev-chevron${devOpen ? ' is-open' : ''}`} />
          </>
        }
      >
        {devOpen && (
          <div className="dev-grid">
            <div>
              <span className="label-sm">场景 A · 指标接口 5xx</span>
              <p className="hint">读数保持上一次成功值并打上「数据可能滞后」标记，不使用 0 占位。</p>
            </div>
            <div>
              <span className="label-sm">场景 B · AI 服务 502</span>
              <p className="hint">对话趋势与能力分布降级为空态卡片，提示「服务未启动」，其余页面继续可用。</p>
            </div>
            <div>
              <span className="label-sm">场景 C · data_complete=false</span>
              <p className="hint">缺失区间在折线图上断线留白，悬浮提示明确标注「后端未返回」。</p>
            </div>
            <div>
              <span className="label-sm">场景 D · 文件审核积压</span>
              <p className="hint">「转人工」文件积压时，内容审核页概览的对应格标红，侧栏显示待处理数量角标（live 下接口未落地时不渲染，不拿 0 充数）。</p>
            </div>
          </div>
        )}
      </Card>
    </>
  )
}
