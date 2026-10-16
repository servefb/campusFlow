import { useSyncExternalStore } from 'react'

/**
 * 提问输入框的附件（09-19）。
 *
 * 🔴 **二阶改版（用户拍板）：文件本体随消息走，不再换 file_id。**
 * 上一版是「先 `POST /files/presign` 拿 `file_id`，再把 id 数组塞进 `attachment_ids`」——
 * 用户明确否掉：AI 服务的对话请求模型里本来就是
 * `files: list[UploadFile]`（见 Python 侧 `src/models/meassage.py`），
 * 文件应该以 **multipart 的 `files` 字段**随本轮提问一起发过去，`attachment_ids` 这个字段整个去掉。
 * 所以这里退回成**纯本地的待发文件列表**：不预上传、没有 uploading/error 三态、没有重试。
 *
 * 为什么放全局 store 而不是组件 state：两页共用同一个输入框，欢迎页选好文件后是 `navigate`
 * 跳到会话页才发请求的（见 AssistantPage），组件当场卸载 —— 附件必须活过这次跳转。
 * 与 workspace / permissionMode 同一套 `useSyncExternalStore` 模式，但**不落 localStorage**：
 * 存的是用户本机文件的引用，刷新后 File 句柄就没了、还原不出来，留着只剩个空壳。
 */

/**
 * 单文件上限（09-19 用户拍板）：**按「装不装得进模型上下文」定，不按磁盘大小定**。
 * 模型窗口 1M token，留一半给对话历史与本轮回答 → 单个附件卡 **50 万 token**。
 * 文件是二进制、拿不到真 token，用混合 UTF-8 文本的经验值折算：**~3 字节/token**
 * （中文 1 字 = 3 字节 ≈ 1 token，英文 ~4 字符/token），所以 50 万 token ≈ 1.4MB。
 * ⚠️ 与任务材料上传（TaskCreateModal 的 MAX_FILE_MB = 50）**故意不同口径**：
 * 材料是给 Java 侧存档的，附件是要塞进模型上下文的 —— 别再想把两处对齐。
 */
export const MAX_ATTACHMENT_TOKENS = 500_000

/** 字节 → token 折算系数（混合文本经验值）。口径要调只改这一处。 */
export const ATTACHMENT_BYTES_PER_TOKEN = 3

/**
 * 🔴 **防 OOM 硬闸门（字节）**：服务端要把文件读进内存做解析/切分，单个文件一大就是内存尖峰 ——
 * 这条与上下文预算无关，所以**单独存在、只许降不许升**，也**不按文件类型放宽**
 * （别给 PDF / 图片开一条更宽的线：体积大≠token 少，但在内存里一样大）。
 * 真要提高它，先去确认服务端是不是流式读文件。
 */
export const MAX_ATTACHMENT_BYTES_HARD = 1_500_000

/** 生效上限 = 上下文预算与 OOM 闸门**取小**（当前两者相等，故 = 1.4MB）。别在别处再写死数字。 */
export const MAX_ATTACHMENT_BYTES = Math.min(MAX_ATTACHMENT_TOKENS * ATTACHMENT_BYTES_PER_TOKEN, MAX_ATTACHMENT_BYTES_HARD)

/** 允许的扩展名（拖拽进来的文件拿不到 `accept`，得自己判一遍）。 */
const ACCEPT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md', '.csv', '.json']

/** 文件选择框的 accept（拖拽与选择框共用同一套白名单，两边别各写一份）。 */
export const ATTACHMENT_ACCEPT = [...ACCEPT_EXTENSIONS, 'image/*'].join(',')

/** 待发附件：文件本体就留在内存里，发送时原样进 multipart。 */
export interface ComposerAttachment {
  /** 前端本地 key（同一批里要能区分移除哪一个） */
  key: string
  name: string
  size: number
  /** 原始 File —— 发送时 append 进 FormData，不做任何转码 */
  file: File
}

let items: ComposerAttachment[] = []
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 快照必须是稳定引用：每次改动都换新数组（不要原地 push），否则 useSyncExternalStore 不重渲染。 */
const getSnapshot = () => items
const emit = () => listeners.forEach((listener) => listener())

/** 内容是否在白名单内：MIME 为空时（拖拽本地文件常见）退回看扩展名。 */
const isAccepted = (file: File) => {
  const type = (file.type || '').toLowerCase()
  if (type.startsWith('image/') || type === 'application/pdf' || type.startsWith('text/')) return true
  const name = file.name.toLowerCase()
  return ACCEPT_EXTENSIONS.some((ext) => name.endsWith(ext))
}

/** 体积展示：与任务材料上传同一口径（1 MB 以下按 KB，至少显示 1 KB）。 */
export const formatAttachmentSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

/** 体积 → 估算 token（向上取整）。 */
export const estimateAttachmentTokens = (bytes: number) => Math.ceil(bytes / ATTACHMENT_BYTES_PER_TOKEN)

/** token 展示：上万后换「万 token」，比一长串数字好读。 */
export const formatAttachmentTokens = (bytes: number) => {
  const tokens = estimateAttachmentTokens(bytes)
  return tokens >= 10_000 ? `${Math.round(tokens / 10_000)} 万 token` : `${tokens} token`
}

let seed = 0

/**
 * 批量加入附件：**只做本地校验**（格式 + 体积，都是同步可判定的），所以不需要「上传中」这种中间态。
 * 返回被拒文件的原因清单，由调用方提示用户。
 */
export const addAttachments = (files: File[]): string[] => {
  const rejected: string[] = []
  const accepted: ComposerAttachment[] = []
  for (const file of files) {
    if (!isAccepted(file)) {
      rejected.push(`「${file.name}」格式不支持`)
      continue
    }
    // 超限的**根本不收**：不建胶囊、也不进请求体，省掉「发出去才失败」的烂体验。
    // ⚠️ 生效线是「内存硬闸门」与「上下文预算」**取小**后的 MAX_ATTACHMENT_BYTES，
    // 文案里的 token 数也从它反推 —— 这样提示永远和实际拦人的那条线一致，不会自相矛盾。
    if (file.size > MAX_ATTACHMENT_BYTES) {
      rejected.push(
        `「${file.name}」太大（约 ${formatAttachmentTokens(file.size)}，上限 ${formatAttachmentTokens(MAX_ATTACHMENT_BYTES)} / ${formatAttachmentSize(MAX_ATTACHMENT_BYTES)}）`,
      )
      continue
    }
    accepted.push({ key: `att-${Date.now()}-${seed++}`, name: file.name, size: file.size, file })
  }
  if (accepted.length) {
    items = [...items, ...accepted]
    emit()
  }
  return rejected
}

export const removeAttachment = (key: string) => {
  if (!items.some((item) => item.key === key)) return
  items = items.filter((item) => item.key !== key)
  emit()
}

/** 发完一轮就该清干净：文件已经随消息发过去了，留在输入框里会被误当成下一轮的附件。 */
export const clearAttachments = () => {
  if (!items.length) return
  items = []
  emit()
}

export const getAttachments = () => items

/**
 * 发送时取文件本体：按加入顺序 append 进 FormData 的 `files` 字段。
 * 追问续跑（ask_user 作答）**不带** —— 那是同一轮的续写，带上等于把同一批文件重复登记一次。
 */
export const getAttachmentFiles = () => items.map((item) => item.file)

/** 输入框订阅用：与 workspace 等 store 同形，两页读到同一份。 */
export const useAttachments = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
