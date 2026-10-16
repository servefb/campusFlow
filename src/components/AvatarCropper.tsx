import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Loader2, X } from 'lucide-react'

/** 裁剪输出边长：顶栏与设置页都是圆形头像，统一取正方形才不会拉伸变形。 */
const OUTPUT_SIZE = 256
/** 预览框里图片的最大显示尺寸（超出就等比缩小）。 */
const BOX_MAX_W = 420
const BOX_MAX_H = 360
/** 选区最小边长，防止拖没了。 */
const MIN_SIZE = 32
/** 左下角圆形预览的直径（px），换算与 CSS 尺寸必须一致。 */
const PREVIEW_PX = 64

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

export interface AvatarCropResult {
  /** 裁剪结果的 dataURL，用于上传期间的即时预览。 */
  preview: string
  /** 与 preview 同一张图，包装成 File 交给 `uploadFile`。 */
  upload: File
}

/**
 * 头像裁剪弹层：用户在原图上拖动/缩放正方形选区，确认后按选区裁出 OUTPUT_SIZE 的 JPEG。
 *
 * 交互：选区内拖动 = 移动；右下角手柄 = 调整大小（始终保持正方形，且不会拖出图片边界）。
 * 为什么是「固定正方形选区」而不是自由比例：头像最终渲染成圆形，自由比例还得二次裁切，
 * 直接锁正方形能把「选区 → 成品」的对应关系做成一比一，预览所见即所得。
 */
export function AvatarCropper({ src, busy = false, onCancel, onConfirm }: {
  src: string
  busy?: boolean
  onCancel: () => void
  onConfirm: (result: AvatarCropResult) => void
}) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  const [rect, setRect] = useState({ x: 0, y: 0, size: 0 })
  const imageRef = useRef<HTMLImageElement | null>(null)
  const dragRef = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; rect: { x: number; y: number; size: number } } | null>(null)

  /** 图片装载完成后计算显示尺寸，并放一个居中的初始选区。 */
  const handleLoad = useCallback(() => {
    const image = imageRef.current
    if (!image || !image.naturalWidth) return
    const scale = Math.min(BOX_MAX_W / image.naturalWidth, BOX_MAX_H / image.naturalHeight, 1)
    const w = Math.round(image.naturalWidth * scale)
    const h = Math.round(image.naturalHeight * scale)
    const size = Math.round(Math.min(w, h) * 0.8)
    setBox({ w, h })
    setRect({ x: Math.round((w - size) / 2), y: Math.round((h - size) / 2), size })
  }, [])

  const startDrag = (mode: 'move' | 'resize') => (event: React.PointerEvent) => {
    event.preventDefault()
    // 手柄嵌在选区里，不拦冒泡的话父级会把 dragRef 覆盖成 move —— 拖手柄就变成拖选区了
    event.stopPropagation()
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, rect: { ...rect } }
    // 捕获指针：拖出元素边界也持续收到 move/up，不会「拖一半断掉」。
    // 合成事件（自动化测试）没有活动指针，capture 会抛 NotFoundError —— 拖拽逻辑本身不依赖它，故吞掉。
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) } catch { /* ignore */ }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || !box) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    const base = drag.rect
    if (drag.mode === 'move') {
      setRect({ size: base.size, x: clamp(base.x + dx, 0, box.w - base.size), y: clamp(base.y + dy, 0, box.h - base.size) })
      return
    }
    // 缩放以右下角手柄为准，取 dx/dy 里较大的增量，保证「手柄跟手」
    const size = clamp(base.size + Math.max(dx, dy), MIN_SIZE, Math.min(box.w - base.x, box.h - base.y))
    setRect({ ...base, size })
  }

  const endDrag = () => { dragRef.current = null }

  const confirm = () => {
    const image = imageRef.current
    if (!image || !box || !rect.size) return
    // 选区坐标是「显示尺寸」下的，按比例换算回原图坐标再裁
    const scale = image.naturalWidth / box.w
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_SIZE
    canvas.height = OUTPUT_SIZE
    const context = canvas.getContext('2d')
    if (!context) return
    // 透明 PNG 裁成 JPEG 前先铺白底，否则透明区变黑
    context.fillStyle = '#fff'
    context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
    context.drawImage(image, rect.x * scale, rect.y * scale, rect.size * scale, rect.size * scale, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
    const preview = canvas.toDataURL('image/jpeg', 0.9)
    fetch(preview)
      .then((response) => response.blob())
      .then((blob) => onConfirm({ preview, upload: new File([blob], 'avatar.jpg', { type: 'image/jpeg' }) }))
  }

  // Esc 关闭，与常规弹层一致
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onCancel() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  // 圆形预览的换算必须用「像素」而不是百分比 —— background-position 的百分比语义是
  // 「图片的 X% 点对齐容器的 X% 点」（offset = (容器-图片) × 百分比），不是线性偏移，直接按
  // -rect.x × 比例 写会得到错位的预览（实测踩过：预览显示的是图片左侧而非选区）。
  const previewStyle = box && rect.size
    ? {
      width: PREVIEW_PX,
      height: PREVIEW_PX,
      backgroundImage: `url(${src})`,
      backgroundSize: `${(box.w / rect.size) * PREVIEW_PX}px ${(box.h / rect.size) * PREVIEW_PX}px`,
      backgroundPosition: `${(-rect.x / rect.size) * PREVIEW_PX}px ${(-rect.y / rect.size) * PREVIEW_PX}px`,
    }
    : undefined

  return createPortal(
    <div className="avatar-crop-mask" role="dialog" aria-modal="true" aria-label="选择头像区域">
      <div className="avatar-crop">
        <header className="avatar-crop-head">
          <div>
            <strong>选择头像区域</strong>
            <small>拖动选区调整位置，拖右下角圆点调整大小</small>
          </div>
          <button type="button" className="avatar-crop-close" onClick={onCancel} disabled={busy} aria-label="关闭裁剪">
            <X size={16} />
          </button>
        </header>

        <div className="avatar-crop-stage" style={box ? { width: box.w, height: box.h } : undefined}>
          <img ref={imageRef} src={src} alt="待裁剪的图片" onLoad={handleLoad} draggable={false} style={box ? { width: box.w, height: box.h } : undefined} />
          {box && (
            <div
              className="avatar-crop-selection"
              style={{ left: rect.x, top: rect.y, width: rect.size, height: rect.size }}
              onPointerDown={startDrag('move')}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <span className="avatar-crop-grid" aria-hidden="true" />
              <button
                type="button"
                className="avatar-crop-handle"
                onPointerDown={startDrag('resize')}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                aria-label="调整选区大小"
              />
            </div>
          )}
        </div>

        <footer className="avatar-crop-foot">
          <span className="avatar-crop-preview" style={previewStyle} aria-hidden="true" />
          <em>圆形区域即最终效果，上传后按选区裁成 {OUTPUT_SIZE}×{OUTPUT_SIZE}</em>
          <div className="avatar-crop-actions">
            <button type="button" className="soft-button" onClick={onCancel} disabled={busy}>取消</button>
            <button type="button" className="primary-button" onClick={confirm} disabled={busy || !box}>
              {busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />}确认并上传
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
