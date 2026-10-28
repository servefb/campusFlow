import { useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import { fetchWorkspaceFileRaw } from '../services/workspace'
import { formatAttachmentSize } from '../services/attachments'

/**
 * 图片附件胶囊（10-07）：用户消息上方回显的附件里，图片这一类可以
 *   · **悬停出缩略图** —— mouseenter 时才走 raw 接口拉本体（懒加载），模块级缓存 objectURL，
 *     同一张图反复悬停/点击不重复请求；拉不到就静默不显示（点击面板里会给明确错误）；
 *   · **点击进右侧边栏** —— 复用「已修改的文件」那套面板（图片直接渲染）。
 * 附件保存在工作文件夹的 uploads/ 子目录（后端口径），path 即 /user/uploads/<文件名>。
 *
 * 位置自适应（10-07 二改，用户报「第一条展示不出来」）：缩略图默认浮在胶囊**上方**，
 * 但第一条消息贴近滚动区顶部时会被裁掉 —— 悬停瞬间量一下胶囊到视口顶的距离，
 * 不足一个缩略图高度就翻到**下方**（is-flip，CSS 切 top/bottom）。
 * 不用原生 title 提示：它悬停半秒就弹出、正好盖在缩略图上，改为 aria-label。
 */
const thumbCache = new Map<string, string>()

/** 缩略图限高（与 CSS 的 max-height 同源），翻转判定用 */
const THUMB_MAX_HEIGHT = 320

export function AttachmentImageChip({ name, size, workspace, onOpen }: {
  name: string
  size: number
  workspace: string
  onOpen: () => void
}) {
  const key = `${workspace}|${name}`
  const [url, setUrl] = useState<string | null>(() => thumbCache.get(key) ?? null)
  const [hover, setHover] = useState(false)
  const [flip, setFlip] = useState(false)
  const chipRef = useRef<HTMLButtonElement | null>(null)
  const loadingRef = useRef(false)

  const load = () => {
    if (url || loadingRef.current || !workspace) return
    loadingRef.current = true
    fetchWorkspaceFileRaw(workspace, `uploads/${name}`)
      .then((response) => {
        const objectUrl = URL.createObjectURL(response.data)
        thumbCache.set(key, objectUrl)
        setUrl(objectUrl)
      })
      .catch(() => {
        /* 静默：缩略图是锦上添花 */
      })
      .finally(() => {
        loadingRef.current = false
      })
  }

  return (
    <button
      type="button"
      ref={chipRef}
      className={`convo-user-file is-image${flip ? ' is-flip' : ''}`}
      aria-label={`查看图片附件 ${name}`}
      onMouseEnter={() => {
        setHover(true)
        load()
        // 上方空间不够（第一条消息贴着滚动区顶部）就翻到下方，别让缩略图被裁掉
        const rect = chipRef.current?.getBoundingClientRect()
        if (rect) setFlip(rect.top < THUMB_MAX_HEIGHT + 16)
      }}
      onMouseLeave={() => setHover(false)}
      onClick={onOpen}
    >
      <Paperclip size={11} />
      <b>{name}</b>
      <small>{formatAttachmentSize(size)}</small>
      {hover && url ? <img className="convo-user-thumb" src={url} alt="" /> : null}
    </button>
  )
}
