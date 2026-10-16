import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { Badge, Card, EmptyState, Modal, Notice, PageHead, Pager, SkeletonRows } from '../components/ui'
import { UploadKnowledgeModal } from '../components/UploadKnowledgeModal'
import {
  useKnowledgeCategories,
  useKnowledgeConflicts,
  useKnowledgeDocuments,
  useKnowledgeHealth,
  usePendingKnowledgeFiles,
} from '../hooks/queries'
import { apiErrorMessage } from '../services/http'
import {
  offlineKnowledgeDocument,
  publishKnowledgeDocument,
  reindexKnowledgeDocument,
  resolveKnowledgeConflict,
} from '../services/knowledge'
import { removeKnowledgeDocument } from '../services/ingest'
import { DOC_STATUS, PENDING_INGEST_STATUS } from '../design/semantics'
import { formatDate, formatNumber, formatRelative, humanFileSize } from '../utils/format'
import type { KnowledgeDoc, KnowledgeIngestResult, PendingKnowledgeFile } from '../types/api'

/**
 * 工作区页签。全部文档 / 已入库 / 入库失败 / 移除知识库查的是**同一张文档表**，
 * 区别只在 status 参数（不筛 / ready / failed / removed）；待入库是另一个数据源
 * （AI 服务的 pending-files），操作差异大，单独一个页签，但共用同一块主体区域
 * —— 不再各自一张卡。
 *
 * 页签即状态：`ingested` 钉死 ready（解析完成、已写入向量、检索可命中），
 * `removed` 钉死 removed（向量已删、记录留痕，仅供追溯）。被钉死的页签下
 * 状态下拉禁用 —— 摆一个选了却筛不动的控件，比不放更糟。
 */
type WorkTab = 'all' | 'ingested' | 'pending' | 'failed' | 'removed'

/**
 * 各文档页签的空态文案：说清「这个视图为什么空、下一步去哪」。
 * 共用一句「暂无知识文档」会把「没有已入库的文档」和「没有已移出的文档」
 * 说成同一件事 —— 而这两件事的下一步动作完全相反，文案不能偷懒。
 */
const EMPTY_BY_TAB: Record<Exclude<WorkTab, 'pending'>, { title: string; desc: string }> = {
  all: { title: '暂无知识文档', desc: '调整关键词或筛选条件后重试；上传资料后会自动进入解析、切分与索引流程。' },
  ingested: { title: '暂无已入库的文档', desc: '解析完成并写入向量的文档会出现在这里。刚上传的资料请先到「待入库」页签确认分类。' },
  failed: { title: '暂无入库失败的文档', desc: '解析失败的文件会在这里列出；对应的文件可在「待入库」页签重试。' },
  removed: { title: '暂无已移出的文档', desc: '移出知识库只删除检索向量，文档记录会保留在这里供追溯；需要重新入库请到「待入库」页签操作。' },
}

export function KnowledgeGovernancePage() {
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [workTab, setWorkTab] = useState<WorkTab>('all')
  const [status, setStatus] = useState<string>('all')
  const [category, setCategory] = useState<string>('all')
  const [keyword, setKeyword] = useState(searchParams.get('query') ?? '')
  const [debounced, setDebounced] = useState(keyword)
  const [page, setPage] = useState(1)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [feedback, setFeedback] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  /** 从「待入库」区点进来的文件 —— 有值时弹窗跳过上传段，直接进确认入库段。 */
  const [ingestTarget, setIngestTarget] = useState<PendingKnowledgeFile | null>(null)
  /** 等待二次确认的「移出知识库」目标。删向量不可逆，不能点一下就执行。 */
  const [removeTarget, setRemoveTarget] = useState<KnowledgeDoc | null>(null)

  // 检索防抖，避免每敲一个字打一次接口
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(keyword)
      setPage(1)
    }, 320)
    return () => clearTimeout(timer)
  }, [keyword])

  /**
   * 文档表查询。页签钉状态：已入库 = status 固定 ready，入库失败 = failed，
   * 移除知识库 = removed；全部文档才看状态下拉。页签切换 / 筛选变化都回第一页。
   */
  const pinnedStatus = workTab === 'failed' ? 'failed' : workTab === 'ingested' ? 'ready' : workTab === 'removed' ? 'removed' : null
  const effStatus = pinnedStatus ?? status
  const docs = useKnowledgeDocuments({ query: debounced, status: effStatus, category: category === 'all' ? undefined : category, page, page_size: 8 })
  const conflicts = useKnowledgeConflicts()
  const health = useKnowledgeHealth()
  /** 分类数走 `GET /knowledge/categories`——指标卡里的「6 个大类」原先也是写死的。 */
  const categories = useKnowledgeCategories()
  /**
   * 待入库文件来自 **AI 服务**（`/api/v2/knowledge/pending-files`），不是 Java。
   * 它是「上传了但还没确认入库」的唯一可见入口 —— 没有它，管理员关了上传弹窗之后
   * 就再也找不到那份文件（文件只在对象存储里，文档表里没有记录）。
   */
  const pending = usePendingKnowledgeFiles()
  const pendingItems = pending.data?.items ?? []

  const activeConflict = conflicts.data?.items?.[0]

  const handleConflict = async (action: 'accept_proposed' | 'keep_current' | 'defer') => {
    if (!activeConflict) return
    setBusyId(activeConflict.id)
    setFeedback('')
    try {
      const result = await resolveKnowledgeConflict(activeConflict.id, action)
      await conflicts.refetch()
      /*
       * 处置**只改冲突记录的状态**（pending → resolved / ignored），不动文档内容、
       * 不动检索向量 —— 之前那句「已按拟发布新版重建切片，并向 CampusFlow 广播撤回旧口径」
       * 描述的是一个不存在的机制（后端没有重建调用，也没有广播），照抄会让管理员
       * 以为旧条款已经从 AI 回答里消失了。
       */
      const closed = result.data.status === 'resolved' ? '已按结论关闭' : '已挂起（ignored）'
      setFeedback(`冲突 #${result.data.id} ${closed}。处置仅记录结论，不会改动文档内容与检索向量。`)
    } catch (error) {
      setFeedback(apiErrorMessage(error, '冲突处理失败'))
    } finally {
      setBusyId(null)
    }
  }

  const handlePublish = async (doc: KnowledgeDoc) => {
    setBusyId(doc.id)
    setFeedback('')
    try {
      const result = await publishKnowledgeDocument(doc.id)
      await docs.refetch()
      // 后端幂等时会回 previous_status：已经是上线状态就说「本来就在线」，不假报「已上线」
      setFeedback(
        result.data.previous_status && result.data.previous_status === result.data.status
          ? `《${doc.title}》本就处于上线状态，未做改动。`
          : `《${doc.title}》已上线当前版本，检索侧立即可见。`,
      )
    } catch (error) {
      setFeedback(apiErrorMessage(error, '上线失败'))
    } finally {
      setBusyId(null)
    }
  }

  /** 下线：把文档从检索匹配池摘出去（匹配池只查 `status='ready'` 的文档）。 */
  const handleOffline = async (doc: KnowledgeDoc) => {
    setBusyId(doc.id)
    setFeedback('')
    try {
      await offlineKnowledgeDocument(doc.id)
      await docs.refetch()
      setFeedback(`《${doc.title}》已下线，CampusFlow 不再引用它的检索内容。`)
    } catch (error) {
      setFeedback(apiErrorMessage(error, '下线失败'))
    } finally {
      setBusyId(null)
    }
  }

  /**
   * 重建索引：走 **AI 服务 v2**（`POST /knowledge/documents/{id}/reindex`），
   * 复用 ingest 链路真跑一遍解析 → 分块 → 向量。秒回（后台异步），之后状态会变回 processing。
   * Java 侧没有解析器，一个同路径的 v1 接口只能假成功 —— 所以这里必须直调 v2。
   */
  const handleReindex = async (doc: KnowledgeDoc) => {
    setBusyId(doc.id)
    setFeedback('')
    try {
      await reindexKnowledgeDocument(doc.id)
      refreshAfterIngest()
      setFeedback(`《${doc.title}》已提交重建索引，正在后台重新解析与写入向量（状态：解析中）。`)
    } catch (error) {
      setFeedback(apiErrorMessage(error, '重建索引失败'))
    } finally {
      setBusyId(null)
    }
  }

  /**
   * 入库会同时改动三处视图：文档列表多一条、待入库区少一条、健康度计数变化。
   *
   * 这里统一用 invalidate 而不是各自 refetch()：文档列表那份查询带着当前的分页与
   * 筛选参数，refetch 只会刷新「本次渲染的这一份」，参数一变就是另一个 queryKey；
   * invalidate 前缀能把所有参数组合下的那几份一起失效。
   */
  const refreshAfterIngest = () => {
    void queryClient.invalidateQueries({ queryKey: ['knowledge-documents'] })
    void queryClient.invalidateQueries({ queryKey: ['knowledge-pending-files'] })
    void queryClient.invalidateQueries({ queryKey: ['knowledge-health'] })
  }

  /**
   * 入库有了终态（成功或失败）之后的反馈。
   *
   * 成功时先复位筛选再刷新，保证新文档一定落在可见的第一页 —— 否则管理员点完
   * 「加入知识库」，列表还停在某个筛选状态下，看着像没入库成功。
   */
  const handleIngested = (result: KnowledgeIngestResult, filename: string) => {
    if (result.status === 'ready') {
      setKeyword('')
      setDebounced('')
      setStatus('all')
      setPage(1)
      setFeedback(
        `《${filename}》已加入知识库（document_id ${result.documentId}，分块 ${result.chunkCount ?? '—'} 个）。` +
          `已完成解析、切分与向量化，CampusFlow现在可以检索到它。`,
      )
    } else {
      setFeedback(
        `《${filename}》入库失败：${result.error || '后端未返回失败原因'}。` +
          `可在上方「待入库」区点「重试」——重试会复用同一条版本记录，不会堆版本号。`,
      )
    }
    refreshAfterIngest()
  }

  /**
   * 第一步（上传）完成后的回调。
   *
   * 此刻文件已经落到 files 表，必须立刻刷新待入库区 —— 管理员接下来若选
   * 「暂不入库」或直接关窗，不刷新的话他会以为文件根本没传上去。
   */
  const handleUploaded = () => {
    void queryClient.invalidateQueries({ queryKey: ['knowledge-pending-files'] })
  }

  const closeUpload = () => {
    setUploadOpen(false)
    setIngestTarget(null)
    // 兜底刷新：上传后「暂不入库」、入库中「转到后台运行」、直接关窗这几条路径
    // 都不会走到 onIngested，关窗时统一刷一次，保证待入库区反映最新状态。
    void queryClient.invalidateQueries({ queryKey: ['knowledge-pending-files'] })
  }

  /** 待入库项点「加入知识库」：带上下文打开弹窗，跳过上传段直接确认分类。 */
  const handleStartIngest = (file: PendingKnowledgeFile) => {
    setIngestTarget(file)
    setUploadOpen(true)
  }

  /** 移出知识库：删向量 + 状态置 removed。需二次确认（向量删了不能撤销）。 */
  const handleRemove = async () => {
    if (!removeTarget) return
    const doc = removeTarget
    setRemoveTarget(null)
    setBusyId(doc.id)
    setFeedback('')
    try {
      await removeKnowledgeDocument(doc.id)
      await docs.refetch()
      refreshAfterIngest()
      setFeedback(
        `《${doc.title}》已移出知识库：检索向量已删除，数据库记录保留以便追溯，` +
          `可在「移除知识库」页签查看。对应的文件回到了「待入库」区，需要时可以重新加入。`,
      )
    } catch (error) {
      setFeedback(apiErrorMessage(error, '移出知识库失败'))
    } finally {
      setBusyId(null)
    }
  }

  /**
   * 指标卡脚注只写**后端真给了**的字段。
   *
   * 改造前这四张卡里三张在编数字：文档总数写死 `?? 1428` + 「↑14.0% 较上周期 +14 篇」，
   * 知识分类写死「6 大类 / 48 个细分目录」，向量健康度写死「99.4% / 18ms 延迟」。
   * 而 `knowledge-health` 明明回了 `documents` 的构成、`vector.similarity`、`vector.engine`，
   * 页面却把它们全丢掉、换成常量 —— 联调时后端少回一个字段，卡片照样显示「增长 14%」，
   * 这是比空白更难发现的一类错：**空白会被当成 bug，假数字会被当成事实**。
   * 对接说明 2.1 已约定 `data_complete=false` 时缺失不得渲染成数字，这里按同一条执行。
   */
  /**
   * 旧版为四张指标卡准备的脚注（docFoot / categoryFoot）随主档构图一起退役：
   * 构成明细已由概览行的「已入库 / 入库失败」直接呈现，不再重复一遍。
   */
  const docCounts = health.data?.documents
  const categoryList = categories.data
  /** 分类数按 `parent_id` 分层算，不把「平表行数」当成大类数。 */
  const topCategories = categoryList?.filter((item) => item.parent_id == null)

  const vector = health.data?.vector
  const vectorFoot = vector?.engine ?? '索引引擎未回传'

  /**
   * 主档分布条的数据：只画接口真给了 `document_count` 的大类，按数量降序取前 4，
   * 其余合并成一段。全缺就不画 —— 分布是测量不是装饰，绝不示意。
   * 段宽用 flexGrow（真实占比），颜色用墨色单色阶深→浅即名次（语义色不当分类色）。
   */
  const distSegments = (topCategories ?? [])
    .filter((item) => item.document_count != null)
    .sort((a, b) => (b.document_count ?? 0) - (a.document_count ?? 0))
  const distShown = distSegments.slice(0, 4)
  const distRest = distSegments.slice(4)
  const distRestCount = distRest.reduce((sum, item) => sum + (item.document_count ?? 0), 0)

  return (
    <>
      {/*
        标题区只回答三个问题：这是哪、干什么、主行动是什么。
        接口路径 / 数据源状态是调试信息，已移出标题区（2026-09-22 评审）；
        索引引擎的详细运维数据搬去了系统观察页，这里只留一颗状态药丸 + 详情入口。
      */}
      <PageHead
        crumb="知识资产"
        title="知识库治理"
        lede="管理校园资料、文档入库与检索索引。"
        tools={
          <>
            <span
              className="health-pill"
              title={vector?.similarity != null ? `引擎 ${vectorFoot} · 相似度 ${(vector.similarity * 100).toFixed(2)}%` : '向量索引状态未回传'}
            >
              <i className="pulse-dot" />
              向量索引 {vector?.similarity != null ? '正常' : '未回传'}
            </span>
            <Link className="btn btn-ghost btn-sm" to="/observatory">
              索引详情
            </Link>
            <button className="btn btn-primary btn-sm" onClick={() => setUploadOpen(true)}>
              <Upload size={14} /> 上传资料
            </button>
          </>
        }
      />

      <UploadKnowledgeModal
        open={uploadOpen}
        presetFile={ingestTarget}
        onClose={closeUpload}
        onUploaded={handleUploaded}
        onIngested={handleIngested}
      />

      {/* 移出知识库的二次确认。删向量不可逆，不做成「点一下就执行」。 */}
      <Modal
        open={removeTarget !== null}
        title="移出知识库"
        sub="此操作会删除该文档的检索向量"
        onClose={() => setRemoveTarget(null)}
        footer={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => setRemoveTarget(null)}>
              取消
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleRemove}>
              <Trash2 size={14} /> 确认移出
            </button>
          </>
        }
      >
        <p>
          将把《{removeTarget?.title}》移出知识库：<b>检索向量会被删除</b>，CampusFlow不再引用它。
        </p>
        <Notice tone="amber">
          数据库中的文档与分块记录会保留（状态记为 removed），便于追溯是谁在什么时候移出的；
          对应文件会回到「待入库」区，之后可以重新加入。
        </Notice>
      </Modal>

      {/*
        ① 概览行：六个读数一条带，高度 ~80px，不再撑半屏。
        「已入库 / 待入库 / 入库失败 / 已移出」是按钮 —— 点它就是切下方工作区的页签，
        概览行和工作区由此联动（概览数字来自接口真字段：health.documents 与 pending 列表；
        后端没回传 removed 计数时该格显示「—」，不拿常量顶替）。
        `documents` 后面必须是 `?.`：后端少回一层就是整页白屏（无 ErrorBoundary）。
      */}
      <section className="stat-brief">
        <div className="brief-cell">
          <span className="brief-label">在库文档</span>
          <span className="brief-num">
            {formatNumber(docCounts?.total)}
            <small>篇</small>
          </span>
        </div>
        {/*
          概览格即页签入口：点格子切到对应工作区。每个动作都带回第一页 ——
          否则停在第 3 页时切过去，新筛选下的第 3 页大概率是空的，像「切了没反应」。
        */}
        <button
          type="button"
          className={`brief-cell${workTab === 'ingested' ? ' on' : ''}`}
          onClick={() => { setWorkTab('ingested'); setPage(1) }}
          title="已成功入库、可被检索命中的文档"
        >
          <span className="brief-label">已入库</span>
          <span className="brief-num">{formatNumber(docCounts?.ready)}</span>
        </button>
        <button
          type="button"
          className={`brief-cell${workTab === 'pending' ? ' on' : ''}`}
          onClick={() => { setWorkTab('pending'); setPage(1) }}
          title="已上传、还没确认入库的文件"
        >
          <span className="brief-label">待入库</span>
          <span className="brief-num">
            {formatNumber(pendingItems.length)}
            <small>份</small>
          </span>
        </button>
        <button
          type="button"
          className={`brief-cell${workTab === 'failed' ? ' on' : ''}`}
          onClick={() => { setWorkTab('failed'); setPage(1) }}
          title="解析失败的文档"
        >
          <span className="brief-label">入库失败</span>
          <span className="brief-num">{formatNumber(docCounts?.failed)}</span>
        </button>
        <button
          type="button"
          className={`brief-cell${workTab === 'removed' ? ' on' : ''}`}
          onClick={() => { setWorkTab('removed'); setPage(1) }}
          title="已移出知识库的文档：检索向量已删除，记录保留供追溯"
        >
          <span className="brief-label">已移出</span>
          <span className="brief-num">{formatNumber(docCounts?.removed)}</span>
        </button>
        <div className="brief-cell">
          <span className="brief-label">知识分类</span>
          <span className="brief-num">
            {formatNumber(topCategories?.length)}
            <small>类</small>
          </span>
        </div>
      </section>

      {feedback && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="amber">{feedback}</Notice>
        </div>
      )}

      {/* 新旧条款冲突检测与差异审查 */}
      {activeConflict && (
        <Card
          className="conflict-card"
          title={
            <>
              <AlertTriangle size={16} style={{ color: 'var(--coral)' }} /> 新旧条款冲突检测与差异审查
              <Badge tone="coral">{formatNumber(conflicts.data?.total ?? 0)} 处语义对齐分歧</Badge>
            </>
          }
          sub={
            // 标题与冲突对象都来自接口；live 下 target_doc 常为 null（conflicting_document_id 没人填）
            `冲突对象：${activeConflict.title ?? `文档 #${activeConflict.document_id}`}` +
            (activeConflict.target_doc ? ` × ${activeConflict.target_doc}` : '')
          }
          extra={
            /*
             * 检出置信度：`knowledge_conflicts` 表没有这一列（也从未有人写入过），
             * live 下恒缺 —— 渲染「未回传」，别拿 mock 的 0.96 冒充。
             * 原先这里还写死了「检出模型: Bge-reranker-Large」，同样没有数据来源，已删。
             */
            <span className="hint mono">置信度 {activeConflict.confidence != null ? `${(activeConflict.confidence * 100).toFixed(1)}%` : '未回传'}</span>
          }
        >
          {/*
            双版本文本只有 mock 有：库里没有「原文片段 / 行号 / 拟议条文」的存储，
            AI 服务也没回传过 —— live 下两侧都渲染「未回传」，让缺口可见，
            而不是拿两条编造的条例文本冒充真实差异。
          */}
          <div className="diff-grid">
            <div className="diff-pane source">
              <div className="diff-pane-head">
                <b>{activeConflict.source_version?.label ?? '现行条款'}</b>
                <span className="mono">
                  {activeConflict.source_version?.line != null ? `LINE ${activeConflict.source_version.line}` : ''}
                </span>
              </div>
              {activeConflict.source_version ? (
                <p className="diff-text strike">{activeConflict.source_version.text}</p>
              ) : (
                <p className="diff-text hint">原文片段未回传（后端没有片段存储）。</p>
              )}
              <div className="diff-pane-foot">
                <span className="hint">向量 MUID：{activeConflict.source_version?.doc_no ?? '—'}</span>
              </div>
            </div>

            <div className="diff-pane proposed">
              <div className="diff-pane-head">
                <b>{activeConflict.proposed_version?.label ?? '拟发布新版'}</b>
                <Badge tone="emerald">PROPOSED</Badge>
              </div>
              {activeConflict.proposed_version ? (
                <p className="diff-text">{activeConflict.proposed_version.text}</p>
              ) : (
                <p className="diff-text hint">拟议条文未回传（后端没有片段存储）。</p>
              )}
              <div className="diff-pane-foot">
                <span className="hint">拟稿来源：{activeConflict.proposed_version?.source ?? '—'}</span>
              </div>
            </div>
          </div>

          <div className="conflict-actions">
            <span className="hint">
              处置会记录结论并关闭本条冲突；文档内容与检索向量的更新由发布新版流程另行完成，此处不自动执行。
            </span>
            <div className="toolbar-spacer" />
            <button className="btn btn-ghost btn-sm" disabled={busyId !== null} onClick={() => handleConflict('keep_current')}>
              保留原条款
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busyId !== null} onClick={() => handleConflict('defer')}>
              交教务处二次核实
            </button>
            <button className="btn btn-primary btn-sm" disabled={busyId !== null} onClick={() => handleConflict('accept_proposed')}>
              <CheckCircle2 size={14} /> 采纳新版条款
            </button>
          </div>
        </Card>
      )}

      {!activeConflict && conflicts.isSuccess && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="emerald" icon={<CheckCircle2 size={15} />}>
            当前没有待处理的条款冲突。
          </Notice>
        </div>
      )}

      {/*
        ③ 工作区：一块主体区域，三个页签共用。
        全部文档 / 入库失败是同一张文档表（页签即状态筛选）；
        待入库是 AI 服务的另一个数据源、操作差异大，所以独立页签 ——
        查找、入库、重试都在这同一块工作区里完成，不再在多张卡之间找入口。
      */}
      <Card pad={false}>
        <div className="work-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={workTab === 'all'}
            className={`work-tab${workTab === 'all' ? ' on' : ''}`}
            onClick={() => { setWorkTab('all'); setPage(1) }}
          >
            全部文档
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workTab === 'ingested'}
            className={`work-tab${workTab === 'ingested' ? ' on' : ''}`}
            onClick={() => { setWorkTab('ingested'); setPage(1) }}
          >
            已入库
            {(docCounts?.ready ?? 0) > 0 && <span className="count">{formatNumber(docCounts?.ready)}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workTab === 'pending'}
            className={`work-tab${workTab === 'pending' ? ' on' : ''}`}
            onClick={() => { setWorkTab('pending'); setPage(1) }}
          >
            待入库
            {pendingItems.length > 0 && <span className="count">{formatNumber(pendingItems.length)}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workTab === 'failed'}
            className={`work-tab${workTab === 'failed' ? ' on' : ''}`}
            onClick={() => { setWorkTab('failed'); setPage(1) }}
          >
            入库失败
            {(docCounts?.failed ?? 0) > 0 && <span className="count">{formatNumber(docCounts?.failed)}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workTab === 'removed'}
            className={`work-tab${workTab === 'removed' ? ' on' : ''}`}
            onClick={() => { setWorkTab('removed'); setPage(1) }}
          >
            移除知识库
            {(docCounts?.removed ?? 0) > 0 && <span className="count">{formatNumber(docCounts?.removed)}</span>}
          </button>
        </div>

        {/* 已入库页签的说明：讲清这个视图的边界（已下线的去哪看），别让管理员以为文档丢了 */}
        {workTab === 'ingested' && (
          <p className="hint" style={{ padding: '12px 16px 0', margin: 0 }}>
            已成功解析、切分并写入向量索引的文档 —— CampusFlow 检索时引用的就是这些。
            已下线（仍在库、暂不参与检索）与解析中的文档，请在「全部文档」页签按入库状态查看。
          </p>
        )}

        {workTab === 'pending' && (
          <div>
            <p className="hint" style={{ padding: '12px 16px 0', margin: 0 }}>
              已上传到对象存储、但还没进入检索池的文件。确认分类后才会被解析、切分并写入向量索引。
            </p>
            {pending.isLoading && <SkeletonRows rows={2} />}

            {pending.isError && (
              <Notice tone="amber" icon={<AlertTriangle size={15} />}>
                待入库列表拉取失败（{apiErrorMessage(pending.error, 'AI 服务 /api/v2 未响应')}）。
                这部分走的是 AI 服务，与上面文档列表的 Java 服务不是同一个 ——
                若文档列表正常而这里报错，先确认 Python 服务是否已启动。
              </Notice>
            )}

            {pending.isSuccess && !pendingItems.length && (
              <p className="hint" style={{ margin: 0 }}>
                没有待入库的文件。上传资料后会先落到这里，由你决定哪些该进知识库。
              </p>
            )}

            {!!pendingItems.length && (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>文件</th>
                      <th>大小</th>
                      <th>上传时间</th>
                      <th>入库状态</th>
                      <th className="num">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingItems.map((file) => {
                      const meta =
                        PENDING_INGEST_STATUS[file.ingestStatus] ?? {
                          tone: 'slate' as const,
                          label: file.ingestStatus,
                        }
                      const scanReady = file.scanStatus === 'ready'
                      const processing = file.ingestStatus === 'processing'
                      const actionLabel =
                        file.ingestStatus === 'failed'
                          ? '重试'
                          : file.ingestStatus === 'removed'
                            ? '重新加入'
                            : '加入知识库'
                      return (
                        <tr key={file.fileId}>
                          <td>
                            <div className="cell-stack">
                              <span className="t-title" title={`file_id ${file.fileId}`}>
                                {file.title || file.fileName}
                              </span>
                              <span className="mono hint">
                                {[
                                  file.categoryName,
                                  file.chunkCount ? `${file.chunkCount} 个分块` : null,
                                  file.extension ? file.extension.toUpperCase() : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ') || '—'}
                              </span>
                            </div>
                          </td>
                          <td className="nowrap">{humanFileSize(file.sizeBytes)}</td>
                          <td>{file.uploadedAt ? formatRelative(file.uploadedAt) : '—'}</td>
                          <td>
                            {/*
                              扫描未通过时同时露出「入库状态」和「扫描中」两个徽章：
                              只显示前者会让管理员以为可以入库，点了却被后端拒绝（409 file_not_ready）。
                            */}
                            <Badge tone={meta.tone} dot={processing}>
                              {meta.label}
                            </Badge>
                            {!scanReady && (
                              <div style={{ marginTop: 5 }}>
                                <Badge tone="slate">安全扫描中</Badge>
                              </div>
                            )}
                          </td>
                          <td className="actions">
                            {processing ? (
                              <span className="hint">入库中…</span>
                            ) : (
                              <button
                                className="act primary"
                                disabled={!scanReady}
                                title={scanReady ? undefined : '安全扫描通过后才能入库（文档第 9 章第 3 条）'}
                                onClick={() => handleStartIngest(file)}
                              >
                                {file.ingestStatus === 'failed' ? <RotateCcw size={13} /> : <Sparkles size={13} />}
                                {actionLabel}
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 文档表四个页签（全部 / 已入库 / 入库失败 / 移除知识库）共用这块筛选与表格 */}
        {workTab !== 'pending' && (
          <>
            <div className="filter-bar">
              <div className="search-input" style={{ flex: 1, minWidth: 240 }}>
                <Search size={15} />
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="按文档标题、编号或关键词检索规章…"
                  aria-label="检索知识文档"
                />
              </div>
              <label className="inline-field">
                <span className="label-sm">分类</span>
                <select
                  className="field"
                  value={category}
                  onChange={(event) => { setCategory(event.target.value); setPage(1) }}
                >
                  <option value="all">全部分类</option>
                  {(topCategories ?? []).map((item) => (
                    <option key={item.id} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-field">
                <span className="label-sm">入库状态</span>
                <select
                  className="field"
                  value={pinnedStatus ?? status}
                  disabled={pinnedStatus !== null}
                  onChange={(event) => { setStatus(event.target.value); setPage(1) }}
                >
                  <option value="all">全部</option>
                  <option value="ready">已入库</option>
                  <option value="processing">解析中</option>
                  <option value="failed">入库失败</option>
                  <option value="offline">已下线</option>
                  <option value="removed">已移出</option>
                </select>
              </label>
              {pinnedStatus !== null && (
                <button className="btn btn-ghost btn-sm" onClick={() => { setWorkTab('all'); setPage(1) }}>
                  <RotateCcw size={14} /> 返回全部文档
                </button>
              )}
              <div className="toolbar-spacer" />
              {/*
                批量重建没有接口（AI 服务只支持逐份 reindex），且逐份真跑解析是重操作，
                不适合无差别全量 —— 行内「重建索引」是唯一入口，这里不放死按钮。
              */}
              <span className="hint">重建索引请逐份执行：在文档行内点「重建索引」。</span>
            </div>

            {/* 文档表：编号/版本/分词用等宽，状态走徽章 */}
            {docs.isLoading && <SkeletonRows rows={8} />}
            {docs.isSuccess && !docs.data?.items?.length && (
              <EmptyState
                title={debounced ? `没有匹配「${debounced}」的文档` : EMPTY_BY_TAB[workTab].title}
                desc={debounced ? '调整关键词或筛选条件后重试。' : EMPTY_BY_TAB[workTab].desc}
              />
            )}
            {!!docs.data?.items?.length && (
              <div className="table-wrap">
                {/*
                  ② 表格是这页的主体：文件名是主信息，一行只留一层次要信息（文号），
                  生效状态 / 版本单位 / 字数页数这些低频字段从行里拿掉 ——
                  行高 52px，先看名字，再看状态，不看技术字段。
                */}
                <table className="data">
                  <thead>
                    <tr>
                      <th>文件</th>
                      <th style={{ width: 150 }}>所属分类</th>
                      <th style={{ width: 140 }}>入库状态</th>
                      <th style={{ width: 150 }}>更新时间</th>
                      <th className="num" style={{ width: 180 }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.data.items.map((doc) => {
                      /*
                       * `status` 后端实测不返回。缺字段时渲染「未回传」文字，
                       * 不渲染空徽章方块。
                       */
                      const meta = doc.status
                        ? (DOC_STATUS[doc.status] ?? { tone: 'slate' as const, label: doc.status })
                        : null
                      return (
                        <tr key={doc.id}>
                          <td>
                            <div className="cell-stack">
                              <span className="t-title">{doc.title}</span>
                              {doc.doc_no && <span className="mono hint">{doc.doc_no}</span>}
                            </div>
                          </td>
                          <td>
                            <Badge tone="slate">{doc.category_name ?? doc.category ?? '—'}</Badge>
                          </td>
                          <td>
                            {meta ? (
                              <Badge tone={meta.tone} dot={doc.status === 'processing'}>
                                {doc.process_state ?? meta.label}
                              </Badge>
                            ) : (
                              <span className="hint">未回传</span>
                            )}
                            {doc.has_conflict && (
                              <div style={{ marginTop: 5 }}>
                                <Badge tone="coral">冲突待处理</Badge>
                              </div>
                            )}
                          </td>
                          <td>
                            {doc.updated_at ? (
                              formatRelative(doc.updated_at)
                            ) : doc.published_at ? (
                              <span className="hint">{formatDate(doc.published_at)} · 印发</span>
                            ) : (
                              <span className="hint">—</span>
                            )}
                          </td>
                          <td className="actions">
                            {/*
                              已移出的文档没有任何可执行动作（向量已删，也不能对文档本身
                              直接重加 —— 重加入口在「待入库」页签的文件上）。给一句去向
                              说明，别留个空格子让人以为按钮没加载出来。
                            */}
                            {doc.status === 'removed' ? (
                              <span className="hint" title="移出只删除检索向量；重新入库请到「待入库」页签对对应文件操作">
                                记录留痕 · 待入库可重加
                              </span>
                            ) : (
                              <>
                                {(doc.status === 'draft' || doc.status === 'offline') && (
                                  <button className="act primary" disabled={busyId === doc.id} onClick={() => handlePublish(doc)}>
                                    上线
                                  </button>
                                )}
                                {doc.status === 'ready' && (
                                  <button
                                    className="act"
                                    disabled={busyId === doc.id}
                                    onClick={() => handleOffline(doc)}
                                    title="从检索匹配池摘除，CampusFlow 不再引用它的内容"
                                  >
                                    下线
                                  </button>
                                )}
                                {(doc.status === 'ready' || doc.status === 'failed') && (
                                  <button
                                    className="act"
                                    disabled={busyId === doc.id}
                                    onClick={() => handleReindex(doc)}
                                    title="复用当前版本，重新解析、分块并写入向量（AI 服务执行）"
                                  >
                                    重建索引
                                  </button>
                                )}
                                <button
                                  className="act"
                                  disabled={busyId === doc.id}
                                  onClick={() => setRemoveTarget(doc)}
                                  title="删除该文档的检索向量，CampusFlow不再引用它"
                                >
                                  <Trash2 size={13} /> 移出知识库
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

                <div className="table-foot">
                  <span>
                    显示第 {docs.data?.items?.length ? (page - 1) * 8 + 1 : 0} – {(page - 1) * 8 + (docs.data?.items?.length ?? 0)} 条，共 {docs.data?.total ?? 0} 条记录
                  </span>
                  <Pager page={page} pageSize={8} total={docs.data?.total ?? 0} onChange={setPage} />
                </div>
              </>
            )}
          </Card>

      {/*
        ① 的另一半：分类占比条不常驻首屏 —— 只有十几篇文档时它对当前操作帮助有限，
        折进「分类统计」，需要看馆藏构成的人自己展开。
      */}
      <details className="cat-fold">
        <summary>分类统计 · {formatNumber(topCategories?.length)} 个大类</summary>
        <div className="cat-fold-body">
          {distSegments.length > 0 ? (
            <>
              <div className="dist-strip" aria-hidden="true">
                {distShown.map((item, index) => (
                  <i
                    key={item.id}
                    title={`${item.name} ${item.document_count} 篇`}
                    style={{ flexGrow: item.document_count!, opacity: 1 - index * 0.18 }}
                  />
                ))}
                {distRest.length > 0 && (
                  <i title={`其他 ${distRest.length} 类 ${distRestCount} 篇`} style={{ flexGrow: distRestCount, opacity: 0.28 }} />
                )}
              </div>
              <div className="dist-legend">
                {distShown.map((item) => (
                  <span key={item.id}>
                    {item.name}
                    <b>{formatNumber(item.document_count)}</b>
                  </span>
                ))}
                {distRest.length > 0 && (
                  <span>
                    其他 {distRest.length} 类
                    <b>{formatNumber(distRestCount)}</b>
                  </span>
                )}
              </div>
            </>
          ) : (
            <p className="hint" style={{ margin: 0 }}>各分类文档数未回传，分布暂不可画。</p>
          )}
        </div>
      </details>
    </>
  )
}
