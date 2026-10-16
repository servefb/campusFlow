import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileText, Loader2, RotateCcw, Sparkles, Upload, X } from 'lucide-react'
import { Badge, Modal, Notice } from './ui'
import { useKnowledgeCategories } from '../hooks/queries'
import { apiErrorMessage } from '../services/http'
import {
  KNOWLEDGE_UPLOAD_ACCEPT,
  KNOWLEDGE_UPLOAD_MAX_BYTES,
  uploadFile,
  validateKnowledgeFile,
  waitForFileReady,
} from '../services/files'
import { startKnowledgeIngest, waitForKnowledgeIngest } from '../services/ingest'
import { humanFileSize } from '../utils/format'
import { useDataModeStore } from '../stores/dataMode'
import type { KnowledgeIngestResult, KnowledgeIngestState, PendingKnowledgeFile } from '../types/api'

/**
 * 「上传校规资料」弹窗 —— **上传与入库必须分成两步**。
 *
 * 为什么要拆（这是本弹窗存在的全部理由）：
 * 上传只表达「把文件存下来」，入库才表达「这份文件可以成为回答依据」。以前上传成功
 * 即自动入库，等于替管理员做了后一个决定 —— 于是草稿、旧版、仅供参考的文件也进了
 * 检索池，而管理员没有任何机会表达「先放着，别入」。拆开之后：
 *
 *   第一步 上传    POST /files/presign（multipart）→ 轮询 GET /files/{id} 到扫描通过
 *   第二步 入库    POST /knowledge/ingest（AI 服务，带人工指定的分类）
 *
 * 两段的边界也是责任边界：第一步的产物是一个文件（fileId），第二步的产物才是
 * 一条可检索的知识。中途退出是**合法状态** —— 文件留在「待入库」区，随时能继续。
 *
 * 三个必须如实反馈的地方：
 *   - 扫描没通过就不能入库（文档第 9 章第 3 条），这里明确拦住而不是让后端报错；
 *   - 入库是分钟级后台任务，提交后要展示进度而不是让按钮一直转；
 *   - 失败必须给出原因和「重试」，且重试要显式带上 retry —— 后端对 failed 状态
 *     默认返回 409，就是为了防「前端转一圈就自动重跑、白烧一遍 LLM」。
 */

type Phase =
  | 'pick' // 选文件
  | 'uploading' // 传到对象存储
  | 'scanning' // 安全扫描
  | 'confirm' // ★ 闸门：确认入库 + 指定分类
  | 'ingesting' // 已提交，轮询入库进度
  | 'done' // 入库完成
  | 'failed' // 入库失败

/** 去掉扩展名，作为标题默认值。 */
const titleFromFilename = (name: string) => name.replace(/\.[^.]+$/, '').trim()

export function UploadKnowledgeModal({
  open,
  onClose,
  onUploaded,
  onIngested,
  presetFile,
}: {
  open: boolean
  onClose: () => void
  /**
   * 第一步完成（文件已落到 files 表）时回调。
   *
   * 必须通知出去：此刻文件已经在「待入库」区里了，而管理员接下来很可能选
   * 「暂不入库」或直接关窗 —— 列表不刷新的话，他会以为这份文件没上传成功。
   */
  onUploaded?: (fileId: number, fileName: string) => void
  /** 入库完成（含失败）后回调：页面据此刷新文档列表与待入库列表。 */
  onIngested?: (result: KnowledgeIngestResult, filename: string) => void
  /**
   * 从「待入库」区带进来的文件 —— 已经上传过了，所以跳过第一步直接进确认段。
   * 这条路径存在的意义：管理员上传完没入库（或上次失败）之后，不该被迫重新上传一遍。
   */
  presetFile?: PendingKnowledgeFile | null
}) {
  const mode = useDataModeStore((state) => state.mode)
  const categories = useKnowledgeCategories()
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const [phase, setPhase] = useState<Phase>('pick')
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [progress, setProgress] = useState(0)
  const [stageNote, setStageNote] = useState('')
  const [error, setError] = useState('')

  /** 第一步的产物：fileId 与文件名（第二步不再需要本地 File 对象）。 */
  const [fileId, setFileId] = useState<number | null>(null)
  const [fileName, setFileName] = useState('')
  /** 入库结果（ready 或 failed 后填充）。 */
  const [ingestResult, setIngestResult] = useState<KnowledgeIngestState | null>(null)
  /** 失败后必须显式重试，这个标记决定下一次提交带不带 retry=true。 */
  const [needRetry, setNeedRetry] = useState(false)

  const [title, setTitle] = useState('')
  const [docNo, setDocNo] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')

  /** 只有「请求正在飞」的阶段才禁止关闭：入场前中断会留下状态不明的文件。 */
  const busy = phase === 'uploading' || phase === 'scanning'

  /**
   * 打开时按 props 初始化。带 presetFile 的（从待入库区点进来）直接进确认段；
   * 该文件上次是 failed 的话，一开始就带上重试标记。
   */
  useEffect(() => {
    if (!open) return
    setPhase(presetFile ? 'confirm' : 'pick')
    setFile(null)
    setProgress(0)
    setError('')
    setIngestResult(null)
    setStageNote('')
    setDragOver(false)
    setFileId(presetFile?.fileId ?? null)
    setFileName(presetFile?.fileName ?? '')
    setNeedRetry(presetFile?.ingestStatus === 'failed')
    setTitle(presetFile?.title ?? (presetFile ? titleFromFilename(presetFile.fileName) : ''))
    setDocNo('')
    setCategoryId('')
    setEffectiveFrom('')
    if (inputRef.current) inputRef.current.value = ''
  }, [open, presetFile])

  /** 卸载时中断轮询：否则定时器会继续往已卸载的组件里 setState。 */
  useEffect(() => () => abortRef.current?.abort(), [])

  const handleClose = () => {
    if (busy) return
    // 入库中的关闭**不中断**后台任务，只停止本地轮询 —— 列表页会接着显示进度。
    abortRef.current?.abort()
    onClose()
  }

  const clearFile = () => {
    setFile(null)
    setTitle('')
    setError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  /**
   * 选中文件。校验不通过时只清空文件与标题，**不能顺手清掉刚设的错误文案** ——
   * 否则用户看到的是一个「选了文件却什么都没发生」的界面。
   */
  const accept = (picked: File | undefined | null) => {
    if (!picked) return
    const invalid = validateKnowledgeFile(picked)
    if (invalid) {
      setFile(null)
      setTitle('')
      if (inputRef.current) inputRef.current.value = ''
      setError(invalid)
      return
    }
    setFile(picked)
    setTitle(titleFromFilename(picked.name))
    setError('')
  }

  /** 第一步：上传 + 等安全扫描。完成后**只到确认段**，不自动入库。 */
  const upload = async () => {
    if (!file) return
    const invalid = validateKnowledgeFile(file)
    if (invalid) {
      setError(invalid)
      return
    }

    setError('')
    try {
      setPhase('uploading')
      setProgress(0)
      setStageNote('正在上传文件本体…')

      const uploaded = await uploadFile(file, 'knowledge_doc', setProgress)
      const id = uploaded.data.file_id

      setPhase('scanning')
      const ready = await waitForFileReady(id, {
        timeoutMs: 30_000,
        onTick: (status, elapsed) => {
          if (status === 'ready') return
          setStageNote(`安全扫描中（${Math.round(elapsed / 1000)}s / 30s）· file_id ${id}`)
        },
      })
      if (!ready) {
        setPhase('pick')
        setError(
          `文件已上传（file_id ${id}），但安全扫描 30 秒内未返回 ready，已暂停。` +
            `它已经在「待入库」区里，扫描通过后可以直接加入知识库，不用重新上传。`,
        )
        return
      }

      setFileId(id)
      setFileName(file.name)
      setPhase('confirm')
      onUploaded?.(id, file.name)
    } catch (caught) {
      setPhase('pick')
      setError(apiErrorMessage(caught, '上传失败，请检查网络或后端服务后重试。'))
    }
  }

  /** 第二步：确认入库。分类必选，这是管理员在这里唯一必须做的决定。 */
  const submitIngest = async (retry: boolean) => {
    if (fileId === null) return
    if (!categoryId) {
      setError('请先选择所属分类 —— 分类决定这份文件进入哪个检索集合，不能留空。')
      return
    }

    setError('')
    setIngestResult(null)
    try {
      setPhase('ingesting')
      setStageNote('已提交，正在下载与解析文档…')

      const started = await startKnowledgeIngest({
        fileId,
        categoryId: Number(categoryId),
        title: title.trim() || undefined,
        documentNo: docNo.trim() || undefined,
        retry,
      })
      if (started.data.reused) {
        // 命中幂等：后端没有新起任务。要如实说出来，否则用户看到进度没动静会以为没点上。
        setStageNote('已有记录在处理中，本次未重复创建，继续跟踪同一条…')
      }

      abortRef.current = new AbortController()
      const final = await waitForKnowledgeIngest(fileId, {
        signal: abortRef.current.signal,
        onTick: (state, elapsed) => {
          const seconds = Math.round(elapsed / 1000)
          setStageNote(
            `解析分块与向量化进行中… 已用时 ${seconds}s` +
              (state.chunkCount ? ` · 已生成 ${state.chunkCount} 个片段` : ''),
          )
          if (state.documentId) setIngestResult(state)
        },
      })

      if (!final) {
        // 超时或关闭：不是失败。状态留在 processing，列表页会继续跟。
        setPhase('confirm')
        setStageNote('')
        setError(
          `入库仍在后台进行（file_id ${fileId}），这里先停止等待。` +
            `可以关闭本窗口，在「待入库」区继续查看进度。`,
        )
        setNeedRetry(false)
        return
      }

      setIngestResult(final)
      if (final.status === 'ready') {
        setPhase('done')
        setNeedRetry(false)
        onIngested?.(
          {
            fileId: final.fileId,
            documentId: final.documentId,
            versionId: final.versionId,
            status: final.status,
            reused: false,
            chunkCount: final.chunkCount,
            error: final.error,
          },
          fileName,
        )
      } else {
        setPhase('failed')
        setNeedRetry(true)
        onIngested?.(
          {
            fileId: final.fileId,
            documentId: final.documentId,
            versionId: final.versionId,
            status: final.status,
            reused: false,
            chunkCount: final.chunkCount,
            error: final.error,
          },
          fileName,
        )
      }
    } catch (caught) {
      setPhase('confirm')
      setStageNote('')
      // 409 retry_required / file_not_ready、400 invalid_category 的文案后端已经写清，
      // 原样展示即可，不再包一层「入库失败」把真正的原因盖掉。
      setError(apiErrorMessage(caught, '入库失败，请稍后重试。'))
      setNeedRetry(true)
    }
  }

  const fileMeta = useMemo(() => {
    if (!file) return null
    return `${humanFileSize(file.size)} · ${file.type || '未知类型'}`
  }, [file])

  const footer = (() => {
    if (phase === 'done') {
      return (
        <>
          <button className="btn btn-ghost btn-sm" onClick={() => setPhase('pick')}>
            <RotateCcw size={14} /> 再传一份
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleClose}>
            完成
          </button>
        </>
      )
    }
    if (phase === 'failed') {
      return (
        <>
          <button className="btn btn-ghost btn-sm" onClick={handleClose}>
            关闭
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => submitIngest(true)}>
            <RotateCcw size={14} /> 重试入库
          </button>
        </>
      )
    }
    if (phase === 'confirm') {
      return (
        <>
          <button className="btn btn-ghost btn-sm" onClick={handleClose}>
            {presetFile ? '取消' : '暂不入库'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => submitIngest(needRetry)}>
            <Sparkles size={14} /> {needRetry ? '重试入库' : '加入知识库'}
          </button>
        </>
      )
    }
    if (phase === 'ingesting') {
      return (
        <>
          <button className="btn btn-ghost btn-sm" onClick={handleClose}>
            转到后台运行
          </button>
          <button className="btn btn-primary btn-sm" disabled>
            <Loader2 size={14} className="spin" /> 入库中
          </button>
        </>
      )
    }
    return (
      <>
        <button className="btn btn-ghost btn-sm" onClick={handleClose} disabled={busy}>
          取消
        </button>
        <button className="btn btn-primary btn-sm" onClick={upload} disabled={busy || !file}>
          {busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
          {phase === 'scanning' ? '等待安全扫描' : '上传文件'}
        </button>
      </>
    )
  })()

  const modalSub =
    phase === 'confirm' || phase === 'ingesting' || phase === 'done' || phase === 'failed'
      ? '第二步 · 确认入库（分类由你指定）'
      : '第一步 · 上传到对象存储（此时还不进知识库）'

  return (
    <Modal open={open} title="上传校规资料" sub={modalSub} onClose={handleClose} footer={footer}>
      {phase === 'done' && ingestResult ? (
        <div className="upload-done">
          <CheckCircle2 size={30} />
          <b>《{title || fileName}》已加入知识库</b>
          <div className="upload-done-meta mono">
            <span>document_id：{ingestResult.documentId ?? '—'}</span>
            <span>version_id：{ingestResult.versionId ?? '—'}</span>
            <span>分块数：{ingestResult.chunkCount ?? '—'}</span>
            <span>解析器：{ingestResult.parserName ?? '—'}</span>
          </div>
          <p className="hint">
            文档已完成解析、切分与向量化，CampusFlow 现在可以检索到它了。{' '}
            <span className="api-tag">
              <b>GET</b> /knowledge/ingest/{fileId}
            </span>{' '}
            可以随时复查这份文件对应的入库状态。
          </p>
        </div>
      ) : phase === 'failed' ? (
        <div className="upload-done">
          <AlertTriangle size={30} style={{ color: 'var(--coral)' }} />
          <b>《{title || fileName}》入库失败</b>
          <div className="upload-done-meta mono">
            <span>file_id：{fileId}</span>
            <span>document_id：{ingestResult?.documentId ?? '—'}</span>
            <span>状态：{ingestResult?.status ?? 'failed'}</span>
          </div>
          <Notice tone="coral">
            {ingestResult?.error || '后端未返回失败原因，可查看服务端日志后重试。'}
          </Notice>
          <p className="hint">
            重试会复用同一条版本记录（不会堆版本号），并清掉上次残留的分块与向量。
            需要先改分类的话，直接改上面的下拉再点重试。
          </p>
          <div className="form-grid upload-form" style={{ marginTop: 12 }}>
            <label className="span-2">
              <span className="label-sm">所属分类 *</span>
              <select
                className="field"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="">{categories.isLoading ? '加载中…' : '请选择分类'}</option>
                {(categories.data ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ) : phase === 'confirm' || phase === 'ingesting' ? (
        <>
          <div className="upload-file">
            <span className="upload-file-icon">
              <FileText size={17} />
            </span>
            <div className="upload-file-main">
              <b>{fileName}</b>
              <span className="hint mono">
                file_id {fileId}
                {fileMeta ? ` · ${fileMeta}` : ''}
              </span>
            </div>
            {phase === 'confirm' && !presetFile && (
              <button className="icon-btn" onClick={clearFile} aria-label="移除文件">
                <X size={15} />
              </button>
            )}
          </div>

          <Notice tone="amber" icon={<Sparkles size={15} />}>
            文件已在对象存储里，但<b>还没有</b>进入知识库。点「加入知识库」才会解析、切分并写入向量索引。
          </Notice>

          <div className="form-grid upload-form">
            <label className="span-2">
              <span className="label-sm">文档标题</span>
              <input
                className="field"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="留空则按正文自动提炼"
                disabled={phase === 'ingesting'}
              />
            </label>
            <label>
              <span className="label-sm">文号 / 发文字号</span>
              <input
                className="field"
                value={docNo}
                onChange={(event) => setDocNo(event.target.value)}
                placeholder="校教发〔2026〕12号"
                disabled={phase === 'ingesting'}
              />
            </label>
            <label>
              <span className="label-sm">所属分类 *</span>
              <select
                className="field"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                disabled={phase === 'ingesting'}
              >
                <option value="">{categories.isLoading ? '加载中…' : '请选择分类'}</option>
                {(categories.data ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label-sm">生效日期</span>
              <input
                className="field"
                type="date"
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
                disabled={phase === 'ingesting'}
              />
            </label>
          </div>

          {phase === 'ingesting' && (
            <div className="upload-progress">
              <div className="upload-progress-head">
                <span>{stageNote}</span>
              </div>
              <div className="upload-bar">
                <i style={{ width: '100%' }} className="indet" />
              </div>
            </div>
          )}

          {error && (
            <div className="upload-error">
              <Notice tone="coral" icon={<AlertTriangle size={15} />}>
                {error}
              </Notice>
            </div>
          )}

          <div className="upload-foot-note">
            <span className="hint">
              入库调用 <span className="mono">POST /knowledge/ingest</span>（AI 服务），
              只传 <span className="mono">fileId</span> 与人工指定的{' '}
              <span className="mono">categoryId</span>；对象存储定位由后端按 fileId 补齐。
            </span>
            <Badge tone={mode === 'mock' ? 'slate' : 'emerald'}>{mode === 'mock' ? 'Mock 环境' : '真实接口'}</Badge>
          </div>
        </>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={KNOWLEDGE_UPLOAD_ACCEPT}
            className="upload-input"
            aria-label="选择校规资料文件"
            onChange={(event) => accept(event.target.files?.[0])}
          />

          {file ? (
            <div className="upload-file">
              <span className="upload-file-icon">
                <FileText size={17} />
              </span>
              <div className="upload-file-main">
                <b>{file.name}</b>
                <span className="hint mono">{fileMeta}</span>
              </div>
              <button className="icon-btn" onClick={clearFile} disabled={busy} aria-label="移除文件">
                <X size={15} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={`upload-drop${dragOver ? ' dragover' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragOver(false)
                accept(event.dataTransfer.files?.[0])
              }}
              disabled={busy}
            >
              <Upload size={22} />
              <b>拖拽文件到此处，或点击选择</b>
              <span className="hint">
                支持 PDF / Word / TXT / Markdown，单文件不超过 {humanFileSize(KNOWLEDGE_UPLOAD_MAX_BYTES)}
              </span>
            </button>
          )}

          <Notice tone="slate" icon={<Upload size={15} />}>
            这一步只把文件存起来，<b>不会</b>进入知识库。上传完成后会让你确认分类，
            再决定要不要真的加进去。
          </Notice>

          {busy && (
            <div className="upload-progress">
              <div className="upload-progress-head">
                <span>{stageNote}</span>
                {phase === 'uploading' && <b className="mono">{progress}%</b>}
              </div>
              <div className="upload-bar">
                <i
                  style={{ width: `${phase === 'uploading' ? progress : 100}%` }}
                  className={phase === 'uploading' ? '' : 'indet'}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="upload-error">
              <Notice tone="coral" icon={<AlertTriangle size={15} />}>
                {error}
              </Notice>
            </div>
          )}

          <div className="upload-foot-note">
            <span className="hint">
              上传调用 <span className="mono">POST /files/presign</span>（multipart，字段名 file），
              purpose 为 <span className="mono">knowledge_doc</span>；
              随后轮询 <span className="mono">GET /files/&#123;file_id&#125;</span> 直到安全扫描通过。
            </span>
            <Badge tone={mode === 'mock' ? 'slate' : 'emerald'}>{mode === 'mock' ? 'Mock 环境' : '真实接口'}</Badge>
          </div>
        </>
      )}
    </Modal>
  )
}
