import { useEffect, useMemo, useRef, useState } from 'react'
import { FilePen, Trash2, X } from 'lucide-react'
import { readWorkspaceFile, fetchWorkspaceFileRaw, type WorkspaceFilePreview } from '../services/workspace'
import { apiErrorMessage } from '../services/http'
import { formatAttachmentSize } from '../services/attachments'
import { isDocxPath, isImagePath, extractDocxText } from '../utils/docxText'
import { countDiff, collapseContext, diffLines, DIFF_MAX_CHARS, type DiffOp } from '../utils/lineDiff'

/**
 * 「已修改的文件」右侧边栏（10-07 三改，用户拍板 Codex 式停靠面板）：
 * 点回答末尾清单里的文件胶囊，**右列停靠展开**（网格多出一列，不盖遮罩、聊天区照常可用），
 * 顶部文件 tab + 路径，内容按「diff 红绿行 / 全文行号」两种形态渲染 —— 对照 Codex 的文件查看列。
 *
 * 内容形态分两档：
 *   ① diff 优先（零请求）：SSE `event: tool` 的 args 里，edit_file 带 old_string/new_string、
 *      write_file 带 content —— 点开即渲（行号 + 红绿行 + 折叠上下文），写入=全绿新文件；
 *   ② 降级全文：diff 素材没存到（超大改动 / 老流）才走 `GET /workspace/file` 读现文件内容，
 *      按 Codex 查看器口径渲染成「行号 + 原文」（不再做 Markdown 排版）。
 * 读不了的口径（都不算报错，措辞降级）：
 *   · delete 动作：文件已被删，不发起请求直接说明；
 *   · binary / too_large：后端返回标记 + 空内容，这里给「不支持预览」说明 + 元信息；
 *   · 请求失败（文件不存在 / 路径越界 / 没选工作文件夹）：展示后端 400 的原话。
 */
/** 一次改动携带的 diff 素材（write=新全文；edit=旧串/新串）。超过 DIFF_MAX_CHARS 时调用方不存，走降级。 */
export interface ChangedFileDiff { kind: 'write' | 'edit'; before?: string; after: string }
/** confirmed=false = 候选还没等到 tool_result（典型：ask/auto 档弹权限卡、流在卡处中断）——渲染时隐藏。 */
export interface ChangedFileRef { path: string; action: 'write' | 'edit' | 'delete'; diff?: ChangedFileDiff; confirmed?: boolean; /** 动作文案覆盖（如用户上传的附件 =「已上传」） */ label?: string }

interface Props {
  file: ChangedFileRef | null
  /** 当前选定工作文件夹（`<root>:<相对路径>`，与提问的 workspace_path 同源） */
  workspace: string
  onClose: () => void
}

type State =
  | { kind: 'loading' }
  | { kind: 'deleted' }
  | { kind: 'no-workspace' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: WorkspaceFilePreview }
  /** .docx：raw 取本体 + 浏览器解压出的正文文本（CodeView 渲染） */
  | { kind: 'office'; text: string; size: number }
  /** 图片：raw 取本体 → objectURL 直接渲染（10MB 内；>img 卸载时 revoke） */
  | { kind: 'image'; url: string; size: number }

/** diff 渲染行数上限：超过截断并说明（防一个巨型改动把面板撑成几千行） */
const DIFF_RENDER_LIMIT = 600
/** 全文视图行数上限（同上） */
const CODE_RENDER_LIMIT = 2000

function DiffView({ ops }: { ops: DiffOp[] }) {
  const shown = ops.length > DIFF_RENDER_LIMIT ? ops.slice(0, DIFF_RENDER_LIMIT) : ops
  return (
    <div className="convo-diff">
      {shown.map((op, index) =>
        op.type === 'gap' ? (
          <div className="convo-diff-gap" key={`gap-${index}`}>···</div>
        ) : (
          <div className={`convo-diff-row is-${op.type}`} key={`${op.type}-${op.oldNo ?? ''}-${op.newNo ?? ''}-${index}`}>
            <span className="convo-diff-no">{op.oldNo ?? ''}</span>
            <span className="convo-diff-no">{op.newNo ?? ''}</span>
            <span className="convo-diff-sign">{op.type === 'add' ? '+' : op.type === 'del' ? '−' : ''}</span>
            <span className="convo-diff-text">{op.text || ' '}</span>
          </div>
        ),
      )}
      {shown.length < ops.length ? (
        <div className="convo-diff-gap">剩余 {ops.length - shown.length} 行未展示</div>
      ) : null}
    </div>
  )
}

/** 全文行号视图（Codex 查看器口径）：行号列 + 原文，等宽字体，长行折行。 */
function CodeView({ content }: { content: string }) {
  const lines = content.split('\n')
  const shown = lines.slice(0, CODE_RENDER_LIMIT)
  return (
    <div className="convo-code">
      {shown.map((line, index) => (
        <div className="convo-code-row" key={index}>
          <span className="convo-code-no">{index + 1}</span>
          <span className="convo-code-text">{line || ' '}</span>
        </div>
      ))}
      {lines.length > shown.length ? (
        <div className="convo-code-gap">剩余 {lines.length - shown.length} 行未展示</div>
      ) : null}
    </div>
  )
}

function FilePreviewPanel({ file, workspace, onClose }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  /** 当前图片的 objectURL：切文件/关闭时 revoke（见 effect 清理） */
  const lastUrlRef = useRef<string | null>(null)

  // ① diff 优先：素材随事件流已经到手，本地算，零请求
  const diff = useMemo(() => {
    if (!file?.diff) return null
    const { kind, before = '', after } = file.diff
    if (before.length + after.length > DIFF_MAX_CHARS) return null
    const ops = collapseContext(kind === 'write' ? diffLines('', after) : diffLines(before, after))
    return { ops, stats: countDiff(ops) }
  }, [file])

  useEffect(() => {
    if (!file) return
    if (file.action === 'delete') {
      setState({ kind: 'deleted' })
      return
    }
    if (diff) {
      setState({ kind: 'loading' }) // 不发请求，渲染直接走 diff 分支
      return
    }
    if (!workspace) {
      setState({ kind: 'no-workspace' })
      return
    }
    let alive = true
    setState({ kind: 'loading' })
    // agent 视角的 /user/ 前缀在后端不认识，换成工作文件夹内的相对路径
    const rel = file.path.startsWith('/user/') ? file.path.slice('/user/'.length) : file.path
    // 上一张图片的 objectURL：切文件/关闭时释放，别攒着
    if (lastUrlRef.current) {
      URL.revokeObjectURL(lastUrlRef.current)
      lastUrlRef.current = null
    }
    // .docx（10-07）：raw 取本体 → 浏览器解压提取正文，段落级行号预览（其余二进制仍走降级说明）
    if (isDocxPath(file.path)) {
      fetchWorkspaceFileRaw(workspace, rel)
        .then(async (response) => {
          if (!alive) return
          const text = await extractDocxText(await response.data.arrayBuffer())
          if (alive) setState({ kind: 'office', text, size: response.data.size })
        })
        .catch((error: unknown) => {
          if (alive) setState({ kind: 'error', message: apiErrorMessage(error, '文件读取失败，请稍后重试') })
        })
      return () => {
        alive = false
      }
    }
    // 图片（10-07）：raw 取本体 → objectURL 直接渲染；不占 raw 的文本解析路径
    if (isImagePath(file.path)) {
      fetchWorkspaceFileRaw(workspace, rel)
        .then((response) => {
          if (!alive) return
          const url = URL.createObjectURL(response.data)
          lastUrlRef.current = url
          if (alive) setState({ kind: 'image', url, size: response.data.size })
        })
        .catch((error: unknown) => {
          if (alive) setState({ kind: 'error', message: apiErrorMessage(error, '文件读取失败，请稍后重试') })
        })
      return () => {
        alive = false
        if (lastUrlRef.current) {
          URL.revokeObjectURL(lastUrlRef.current)
          lastUrlRef.current = null
        }
      }
    }
    readWorkspaceFile(workspace, rel)
      .then((response) => {
        if (alive) setState({ kind: 'ready', data: response.data.data })
      })
      .catch((error: unknown) => {
        if (alive) setState({ kind: 'error', message: apiErrorMessage(error, '文件读取失败，请稍后重试') })
      })
    return () => {
      alive = false
    }
  }, [file, workspace, diff])

  if (!file) return null
  const actionLabel = file.label ?? (file.action === 'delete' ? '已删除' : file.diff?.kind === 'write' ? '新文件' : file.action === 'edit' ? '已修改' : '已写入')
  const relPath = file.path.startsWith('/user/') ? file.path.slice('/user/'.length) : file.path

  return (
    <aside className="convo-file-panel" role="complementary" aria-label="文件改动">
      {/* 文件 tab（Codex 口径）：图标 + 文件名 + 关闭；下面一行是路径与动作元信息 */}
      <div className="convo-file-panel-tabs">
        <span className="convo-file-panel-tab">
          {file.action === 'delete' ? <Trash2 size={13} /> : <FilePen size={13} />}
          <b>{relPath.split('/').pop()}</b>
          <button type="button" className="convo-file-panel-close" onClick={onClose} aria-label="关闭文件边栏">
            <X size={14} />
          </button>
        </span>
      </div>
      <div className="convo-file-panel-meta">
        <span className="convo-file-panel-path" title={relPath}>{relPath}</span>
        <em>
          工作文件夹 · {actionLabel}
          {diff ? ` · +${diff.stats.added} −${diff.stats.removed}` : ''}
          {state.kind === 'ready' ? ` · ${formatAttachmentSize(state.data.size)}` : ''}
          {state.kind === 'office' ? ` · ${formatAttachmentSize(state.size)}` : ''}
          {state.kind === 'image' ? ` · ${formatAttachmentSize(state.size)}` : ''}
          {state.kind === 'ready' && state.data.modified_at ? ` · 修改于 ${state.data.modified_at}` : ''}
        </em>
      </div>
      <div className="convo-file-panel-body">
        {file.action === 'delete' ? (
          <p className="convo-file-panel-note">这个文件已被助手删除，内容无法查看。</p>
        ) : diff ? (
          <DiffView ops={diff.ops} />
        ) : state.kind === 'office' ? (
          state.text ? (
            <CodeView content={state.text} />
          ) : (
            <p className="convo-file-panel-note">（空文档，没有可提取的文本）</p>
          )
        ) : state.kind === 'image' ? (
          <img className="convo-file-panel-image" src={state.url} alt={relPath} />
        ) : (
          <>
            {state.kind === 'loading' ? <p className="convo-file-panel-note">正在读取文件内容…</p> : null}
            {state.kind === 'no-workspace' ? (
              <p className="convo-file-panel-note">还没有选择工作文件夹，无法定位这个文件。在下方输入框旁选好位置后再试。</p>
            ) : null}
            {state.kind === 'error' ? <p className="convo-file-panel-note">{state.message}</p> : null}
            {state.kind === 'ready' && state.data.binary ? (
              <p className="convo-file-panel-note">这是二进制文件，暂不支持查看（{formatAttachmentSize(state.data.size)}）。</p>
            ) : null}
            {state.kind === 'ready' && state.data.too_large ? (
              <p className="convo-file-panel-note">
                文件较大（{formatAttachmentSize(state.data.size)}），超出查看上限，未展示内容。
              </p>
            ) : null}
            {state.kind === 'ready' && !state.data.binary && !state.data.too_large ? (
              state.data.content ? (
                <>
                  {state.data.truncated ? (
                    <p className="convo-file-panel-note">内容较长，仅展示前 20000 字符。</p>
                  ) : null}
                  <CodeView content={state.data.content} />
                </>
              ) : (
                <p className="convo-file-panel-note">（空文件）</p>
              )
            ) : null}
          </>
        )}
      </div>
    </aside>
  )
}

export { FilePreviewPanel }
