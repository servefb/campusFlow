import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight, CornerLeftUp, FileText, Folder, Loader2, X } from 'lucide-react'
import {
  browseWorkspaceDir,
  getWorkspaceRoots,
  type WorkspaceEntry,
  type WorkspaceRoot,
} from '../services/workspace'
import { apiErrorMessage } from '../services/http'

/** 文件大小的人类可读写法（选择器里只做展示，帮助确认选对位置）。 */
const formatSize = (bytes?: number) => {
  if (bytes === undefined) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}

/**
 * 工作区文件夹选择器（09-17）：浏览器拿不到本机绝对路径（`<input type="file">` 只给
 * File 对象、File System Access API 只给 handle），所以浏览改由后端导航 ——
 * 从「桌面 / D 盘」开始逐层点选，结果拼成 `<rootKey>:<相对路径>`（如 `d:exam`）交给
 * stream 接口的 workspace_path。绝对路径始终留在后端，前端不接触。
 */
export function WorkspaceFolderPicker({
  open,
  onClose,
  onSelect,
}: {
  open: boolean
  onClose: () => void
  onSelect: (value: string) => void
}) {
  const [roots, setRoots] = useState<WorkspaceRoot[]>([])
  const [rootKey, setRootKey] = useState('')
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<WorkspaceEntry[]>([])
  const [rootsLoading, setRootsLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 打开时取根列表，默认落在第一个根上（记住上次选的根，重开时不用再点）
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError('')
    setRootsLoading(true)
    getWorkspaceRoots()
      .then(({ data }) => {
        if (cancelled) return
        const list = data.data.roots ?? []
        setRoots(list)
        if (list.length) {
          setRootKey((prev) => (list.some((root) => root.key === prev) ? prev : list[0].key))
        }
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, '无法读取可浏览的目录'))
      })
      .finally(() => {
        if (!cancelled) setRootsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // 根或子目录变化时读取该层内容
  useEffect(() => {
    if (!open || !rootKey) return
    let cancelled = false
    setLoading(true)
    setError('')
    browseWorkspaceDir(rootKey, path)
      .then(({ data }) => {
        if (!cancelled) setEntries(data.data.entries ?? [])
      })
      .catch((err) => {
        if (cancelled) return
        setEntries([])
        setError(apiErrorMessage(err, '无法读取该文件夹'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, rootKey, path])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const busy = rootsLoading || loading
  const dirs = entries.filter((entry) => entry.type === 'dir')
  const files = entries.filter((entry) => entry.type === 'file')
  const segments = path ? path.split('/') : []
  const currentRootName = roots.find((root) => root.key === rootKey)?.name ?? ''
  // 盘根本身不能作为工作区：后端 path_jail 不接受文件系统根，且范围也不该是整个盘
  const atDriveRoot = rootKey === 'd' && !path

  const switchRoot = (key: string) => {
    setRootKey(key)
    setPath('')
  }

  const enterDir = (name: string) => setPath(path ? `${path}/${name}` : name)

  const goUp = () => setPath(segments.slice(0, -1).join('/'))

  const confirm = () => {
    if (atDriveRoot) return
    onSelect(`${rootKey}:${path}`)
    onClose()
  }

  // 用 Portal 挂到 body：`position:fixed` 会被祖先的 backdrop-filter / transform 影响
  // （输入框所在的毛玻璃容器就是这类），不 Portal 的话弹窗会贴着输入框而不是视口居中
  return createPortal(
    <div className="ws-picker-layer">
      <div className="ws-picker-backdrop" onClick={onClose} />
      <div className="ws-picker" role="dialog" aria-modal="true" aria-label="选择工作文件夹">
        <header className="ws-picker-head">
          <div className="ws-picker-title">
            <span className="ws-picker-icon">
              <Folder size={16} />
            </span>
            <div>
              <h2>选择工作文件夹</h2>
              <p>AI 只能在这个文件夹内读取与产出文件</p>
            </div>
          </div>
          <button type="button" className="ws-picker-close" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="ws-picker-roots">
          {roots.map((root) => (
            <button
              key={root.key}
              type="button"
              className={`ws-picker-root${root.key === rootKey ? ' active' : ''}`}
              onClick={() => switchRoot(root.key)}
            >
              {root.name}
            </button>
          ))}
        </div>

        <div className="ws-picker-crumbs">
          <button type="button" className="ws-crumb-up" aria-label="上一级" disabled={!path} onClick={goUp}>
            <CornerLeftUp size={13} />
          </button>
          <button type="button" className="ws-crumb" onClick={() => setPath('')}>
            {currentRootName || '根目录'}
          </button>
          {segments.map((segment, index) => (
            <span key={`${segment}-${index}`} className="ws-crumb-seg">
              <ChevronRight size={11} />
              <button
                type="button"
                className="ws-crumb"
                onClick={() => setPath(segments.slice(0, index + 1).join('/'))}
              >
                {segment}
              </button>
            </span>
          ))}
        </div>

        <div className="ws-picker-list">
          {busy && (
            <div className="ws-picker-state">
              <Loader2 size={14} className="convo-spin" /> 正在读取…
            </div>
          )}
          {!busy && error && <div className="ws-picker-state error">{error}</div>}
          {!busy && !error && !rootKey && <div className="ws-picker-state">没有可浏览的目录</div>}
          {!busy && !error && rootKey && !dirs.length && !files.length && (
            <div className="ws-picker-state">这个文件夹是空的（可以直接选择它，或返回上一级）</div>
          )}
          {!busy &&
            !error &&
            dirs.map((dir) => (
              <button key={dir.name} type="button" className="ws-picker-item" onClick={() => enterDir(dir.name)}>
                <Folder size={14} className="ws-picker-item-icon" />
                <span className="ws-picker-item-name">{dir.name}</span>
                <ChevronRight size={13} className="ws-picker-arrow" />
              </button>
            ))}
          {!busy &&
            !error &&
            files.map((file) => (
              <div key={file.name} className="ws-picker-item file">
                <FileText size={14} className="ws-picker-item-icon" />
                <span className="ws-picker-item-name">{file.name}</span>
                <small>{formatSize(file.size)}</small>
              </div>
            ))}
        </div>

        <footer className="ws-picker-foot">
          <span className="ws-picker-picked" title={atDriveRoot ? '盘根不能作为工作文件夹' : `将绑定：${rootKey}:${path}`}>
            {rootKey}:{path}
          </span>
          <div className="ws-picker-actions">
            <button type="button" className="ws-picker-cancel" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="ws-picker-confirm"
              disabled={atDriveRoot}
              title={atDriveRoot ? '请进入具体文件夹后再选择' : '把这个文件夹作为工作区'}
              onClick={confirm}
            >
              <Check size={13} />
              选择此文件夹
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
