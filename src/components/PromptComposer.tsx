import { useEffect, useRef, useState, type RefObject } from 'react'
import { AlignLeft, AlignJustify, ArrowUp, Brain, BrainCircuit, Check, CircleOff, FileText, FolderOpen, Gauge, Hand, Loader2, OctagonAlert, Paperclip, Play, Scale, ShieldCheck, Smile, Square, WandSparkles, X } from 'lucide-react'
import { WorkspaceFolderPicker } from './WorkspaceFolderPicker'
import { useAskMode } from '../services/askMode'
import { setPermissionMode, usePermissionMode } from '../services/permissionMode'
import { setWorkspace, useWorkspace } from '../services/workspaceSelection'
// 自定义参数（09-19）：回答偏好 + 深度思考等级，localStorage 持久化、两页共享
import { setAnswerStyle, setThinkingLevel, useAnswerStyle, useThinkingLevel, type AnswerStyle, type ThinkingLevel } from '../services/answerPrefs'
// 附件（09-20 二阶）：选/拖进来的文件**不预上传**，提问时以本体走 multipart 的 `files` 字段；store 全局，扛得住欢迎页 → 会话页的跳转
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES, addAttachments, formatAttachmentSize, formatAttachmentTokens, removeAttachment, useAttachments } from '../services/attachments'
// 工作区 chip 只显示最后一级文件夹名 —— 与侧边栏工作区分组同一口径
import { workspaceName } from '../utils/workspacePath'

const DEFAULT_PLACEHOLDER = '向 Campus Flow 提问，描述你想解决的校园事务 ……'

/** 权限档位的展示名（入口按钮与弹层共用同一套叫法）。 */
const PERM_LABELS: Record<'ask' | 'auto' | 'full', string> = {
  ask: '请求批准',
  auto: '帮我批准',
  full: '完全访问权限',
}

/** 自定义参数弹层的两组成项（09-19 用户拍板：回答偏好 + 深度思考四档 off/low/high/max）。 */
const ANSWER_STYLE_OPTIONS: Array<{ value: AnswerStyle; label: string; description: string; icon: typeof AlignLeft }> = [
  { value: 'concise', label: '简洁', description: '直接给结论，少铺垫', icon: AlignLeft },
  { value: 'balanced', label: '平衡', description: '兼顾要点与必要的解释', icon: Scale },
  { value: 'detailed', label: '详细', description: '充分展开，附依据与解释', icon: AlignJustify },
]
const THINKING_LEVEL_OPTIONS: Array<{ value: ThinkingLevel; label: string; description: string; icon: typeof Brain }> = [
  { value: 'off', label: 'Off', description: '不额外思考，直接回答', icon: CircleOff },
  { value: 'low', label: 'Low', description: '快速梳理要点后作答', icon: Gauge },
  { value: 'high', label: 'High', description: '复杂问题深入推理', icon: Brain },
  { value: 'max', label: 'Max', description: '最强强度推理，最慢但最深', icon: BrainCircuit },
]

/** Max 档滑杆上的粒子（坐标为轨道内百分比，size/px）。
    全部 14 颗是**被陨石甩出的余烬**：单程**沿轨道向后（向左）**飘散、冷却消失（动画见 CSS params-ember）。
    y 全部收进 38~62 的**轨道带内**（19 改）：早先 y 散布在 -8~94、位移还带 -8px 纵向分量，
    实机读成「一堆点上下乱跑」，用户拍板「粒子往后跑啊，往下跑什么」——
    余烬是**顺着轨道往后滑**的，不是四散炸开的，所以不给纵向自由度。
    起点都落在轨道中右段（x≥28，向左滑 58px 不越出轨道外），delay 均匀铺满整个 4s 周期
    （0 ~ 3.64，步长 0.28）→ 源源不断的尾迹流，而不是一批同起同落。
    star 只改形状（四角星闪的炽热碎块），行为与圆点一致。09-19：20 → 14 颗（用户拍板「少甩点」）。 */
const SLIDER_PARTICLES: Array<{ x: number; y: number; size: number; delay: number; star?: boolean }> = [
  { x: 28, y: 44, size: 4, delay: 0 },
  { x: 36, y: 58, size: 4, delay: 0.28 },
  { x: 44, y: 38, size: 4, delay: 0.56 },
  { x: 52, y: 62, size: 4, delay: 0.84 },
  { x: 60, y: 46, size: 4, delay: 1.12 },
  { x: 68, y: 56, size: 4, delay: 1.4 },
  { x: 76, y: 40, size: 4, delay: 1.68 },
  { x: 82, y: 60, size: 4, delay: 1.96 },
  { x: 88, y: 48, size: 4, delay: 2.24 },
  { x: 94, y: 54, size: 4, delay: 2.52 },
  { x: 90, y: 42, size: 4, delay: 2.8 },
  /* ⚠️ star 的 y 明显小于圆点：top 定位的是**顶边**，11~12px 的星中心天然比 4px 点低 3px 左右，
     按同样 y 摆会整颗往下挂（工装实测 |dy| 5.9~7.1px，超出轨道带）。星取 18~26 才对中轨道中心。 */
  { x: 40, y: 24, size: 11, delay: 3.08, star: true },
  { x: 64, y: 18, size: 12, delay: 3.36, star: true },
  { x: 86, y: 26, size: 11, delay: 3.64, star: true },
]

/** 陨石图标（09-19）：Font Awesome Free 6.7.2 现成 "meteor" 实心图标内联
    （License: CC BY 4.0, Fonticons, Inc.），用户拍板「用现成图标，别自己造」。 */
const MeteorIcon = (props: { className?: string }) => (
  <svg viewBox="0 0 512 512" fill="currentColor" aria-hidden="true" className={props.className}>
    <path d="M493.7 .9L299.4 75.6l2.3-29.3c1-12.8-12.8-21.5-24-15.1L101.3 133.4C38.6 169.7 0 236.6 0 309C0 421.1 90.9 512 203 512c72.4 0 139.4-38.6 175.7-101.3L480.8 234.3c6.5-11.1-2.2-25-15.1-24l-29.3 2.3L511.1 18.3c.6-1.5 .9-3.2 .9-4.8C512 6 506 0 498.5 0c-1.7 0-3.3 .3-4.8 .9zM192 192a128 128 0 1 1 0 256 128 128 0 1 1 0-256zm0 96a32 32 0 1 0 -64 0 32 32 0 1 0 64 0zm16 96a16 16 0 1 0 0-32 16 16 0 1 0 0 32z" />
  </svg>
)

/**
 * 提问输入框（09-16 抽成共享组件）：问助手欢迎页与对话页共用同一个输入框 ——
 * 正文输入、页脚工具与发送。
 * 两页只差「提交后做什么」（欢迎页跳会话页、对话页就地流式），所以这里只负责 UI 与交互，
 * onSubmit 由调用方决定。
 *
 * 09-23：全站只剩一个主智能体，页头那行「当前调度：…」**整体撤掉**（用户拍板）——
 * 没有可切换的对象，写出来只是噪音；自定义参数按钮也早就不在页头了，所以这一行彻底没有存在意义。
 * 现在表单内容只有：附件行 + 正文 + 页脚（工具 / 发送）。
 */
export function PromptComposer({
  value,
  onChange,
  onSubmit,
  placeholder = DEFAULT_PLACEHOLDER,
  sending = false,
  className,
  textareaRef,
  onStop,
  paused = false,
  onResume,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder?: string
  sending?: boolean
  className?: string
  textareaRef?: RefObject<HTMLTextAreaElement>
  /** 生成中点发送键变为「停止」按钮（09-19）；不传则保持原样（欢迎页没有进行中的轮次） */
  onStop?: () => void
  /**
   * 「暂停」（10-08）：软暂停落地后的按钮态 —— 输入框为空时发送键原位变「继续」，
   * 用户一旦开始输入就切回普通发送键（发出去的消息 = 隐式「继续」+ 把内容当补充）。
   * 不传则保持原样（欢迎页没有可续跑的轮次）。
   */
  paused?: boolean
  onResume?: () => void
}) {
  const innerRef = useRef<HTMLTextAreaElement>(null)
  const ref = textareaRef ?? innerRef
  // 仍要读提问模式：工作区选择与权限控制只在 agent 档可用（页头那行「当前调度」09-23 已撤）
  const mode = useAskMode()
  // 工作区文件夹选择器（09-17）：改为后端导航的模态 —— 浏览器拿不到本机绝对路径，
  // 由后端从「桌面 / D 盘」逐层浏览，选中结果形如 `d:exam`
  const [pickerOpen, setPickerOpen] = useState(false)
  // 工作区是全局会话级状态（09-17）：存 localStorage，主页选定后新建对话/来回切页都保留，
  // 只有手动点 × 或重选才变更 —— 不再经 props 在页面间搬运
  const workspacePath = useWorkspace()
  // 权限控制（09-17）：三档批准方式，localStorage 持久化，两页共享同一个值
  const permMode = usePermissionMode()
  const [permOpen, setPermOpen] = useState(false)
  const permRef = useRef<HTMLDivElement>(null)
  // 自定义参数（09-19）：回答偏好 + 深度思考等级，同为 localStorage 持久化的两页共享值
  const answerStyle = useAnswerStyle()
  const thinkingLevel = useThinkingLevel()
  const [paramsOpen, setParamsOpen] = useState(false)
  const paramsRef = useRef<HTMLDivElement>(null)
  // 附件（09-19）：列表来自全局 store（欢迎页选了文件再跳会话页发问也能带上）。
  // 09-19 二阶：文件不再预上传，所以这里没有 uploading 态、也不因此禁用发送键。
  const attachments = useAttachments()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  /** 被拒文件（格式/体积）的提示语，几秒后自己淡出，不占常驻空间 */
  const [attachHint, setAttachHint] = useState('')

  // 提示语到时自清（只清自己那条，连点两次选文件不会互相掐掉）
  useEffect(() => {
    if (!attachHint) return
    const timer = window.setTimeout(() => setAttachHint(''), 6000)
    return () => window.clearTimeout(timer)
  }, [attachHint])

  /**
   * 拖到输入框**以外**的地方时，浏览器默认会当作「打开这个文件」把页面顶掉 —— 会话当场没了。
   * 所以凡拖的是文件就拦掉默认行为：落到输入框上的由表单自己的 onDrop 接手，
   * 落在别处则什么都不发生（比跳走强）。只拦文件拖拽，不影响页面上别的拖放交互。
   */
  useEffect(() => {
    const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')
    const prevent = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      // 在输入框**外面**松手：表单收不到那个 drop，高亮只能从这里收掉，
      // 否则浮层会一直挂在那儿（拖到浏览器窗口外松手则另有 dragleave 兜底）。
      if (event.type === 'drop') setDragOver(false)
    }
    /** 拖出浏览器窗口再松手：页面上什么事件都没有，只有 relatedTarget 为 null 的 dragleave 能认出来。 */
    const onWindowDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragOver(false)
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    window.addEventListener('dragleave', onWindowDragLeave)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
      window.removeEventListener('dragleave', onWindowDragLeave)
    }
  }, [])

  /** 选文件 / 拖拽共用的收口：加入 store（立刻上传），被拒的当场提示。 */
  const ingestFiles = (files: FileList | null) => {
    if (!files?.length) return
    const rejected = addAttachments(Array.from(files))
    setAttachHint(rejected.length ? `${rejected.join('，')}，未添加` : '')
  }

  // 弹层开着时：点外面 / 按 Esc 关闭（权限弹层与自定义参数弹层共用一套行为，
  // 打开其中一个时顺手关掉另一个，头部不出现两块浮层）
  useEffect(() => {
    if (!permOpen && !paramsOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (permOpen && permRef.current && !permRef.current.contains(event.target as Node)) setPermOpen(false)
      if (paramsOpen && paramsRef.current && !paramsRef.current.contains(event.target as Node)) setParamsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPermOpen(false)
        setParamsOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [permOpen, paramsOpen])

  const pickPermission = (mode: 'ask' | 'auto' | 'full') => {
    setPermissionMode(mode)
    setPermOpen(false)
  }

  // 原 webkitdirectory / showDirectoryPicker 方案已移除：只能拿到文件夹名，
  // 需要用户手动补全绝对路径；现在浏览与路径解析都在后端完成。

  const clearWorkspace = () => {
    setWorkspace('')
  }

  /**
   * 选择工作区（09-17 改版）：打开后端导航的文件夹选择器。
   * 之前用 showDirectoryPicker / webkitdirectory 只能拿到文件夹名，得让用户手动补全成
   * 绝对路径；现在浏览与解析都在后端，前端只提交 `<rootKey>:<相对路径>`。
   */
  const handlePickWorkspace = () => setPickerOpen(true)

  const submit = () => {
    // 回车提交绕得过按钮的 disabled，所以这里再挡一次。
    // 生成中（09-23 五次定稿）：有停止通道的调用方（会话页）放行 —— 页面会把内容
    // **暂存成输入框上方的补充横条**，点横条上的发送键才真正送达执行中的任务；
    // 欢迎页等无 onStop 的调用方维持拦截。
    if (!value.trim() || (sending && !onStop)) return
    onSubmit()
  }

  /**
   * 快捷键粘贴（10-09）：截图（Win+Shift+S / 复制图片）或从资源管理器复制的文件，
   * Ctrl+V 粘到输入框时剪贴板里带的是**文件**——拦下默认行为、整批交给 ingestFiles，
   * 与回形针 / 拖拽两条路共用同一套校验与附件行回显。纯文本粘贴（files 为空）不拦，照常进正文。
   */
  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = event.clipboardData?.files
    if (!files?.length) return
    event.preventDefault()
    ingestFiles(files)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 输入法组词确认的回车不发送；Shift + Enter 保留换行。
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form
      className={`assistant-prompt${className ? ` ${className}` : ''}${dragOver ? ' is-drag-over' : ''}`}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      /* 拖拽落点 = 整个输入框（含正文与页脚按钮），不用瞄准某个小格子；
         只在拖的是**文件**时才拦默认行为，免得把文本拖选也吃掉。
         「拖到框外会打开文件」那条由上面的 window 监听兜住。 */
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return
        event.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(event) => {
        // 在子元素之间移动也会触发 dragleave：只要还停在表单内部就算没离开，否则高亮会一路闪
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setDragOver(false)
      }}
      onDrop={(event) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return
        event.preventDefault()
        setDragOver(false)
        ingestFiles(event.dataTransfer.files)
      }}
    >
      {/* 附件行（09-19 二阶）：文件不预上传，所以这里是**单一形态**——名字 + 体积 + 移除。
          被拒的文件（格式/体积）根本不进这一行，走下面的 assistant-attach-hint 提示。 */}
      {attachments.length > 0 && (
        <div className="assistant-attach-list">
          {attachments.map((item) => (
            <span
              key={item.key}
              className="assistant-attach-chip"
              title={`${item.name} · ${formatAttachmentSize(item.size)}`}
            >
              <span className="attach-chip-icon">
                <FileText size={12} />
              </span>
              <b className="attach-chip-name">{item.name}</b>
              <small className="attach-chip-size">{formatAttachmentSize(item.size)}</small>
              <button
                type="button"
                className="attach-chip-remove"
                aria-label={`移除附件 ${item.name}`}
                title="移除"
                onClick={() => removeAttachment(item.key)}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      {attachHint && <p className="assistant-attach-hint">{attachHint}</p>}

      <textarea
        ref={ref}
        rows={2}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={placeholder}
      />

      <div className="assistant-prompt-foot">
        <div>
          {/* 附件（09-19）：原来这颗回形针只是个装饰 svg，点了没反应；现在它是真入口 ——
              点开系统文件选择器，拖拽则由整个表单承接（两条路共用一个 ingestFiles）。
              样式与相邻的文件夹 / 权限按钮同款（.assistant-foot-tool），加进来的文件走附件行回显。 */}
          <input
            ref={fileInputRef}
            className="assistant-attach-input"
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            onChange={(event) => {
              ingestFiles(event.target.files)
              // 清空 value：不然连着选同一个文件不会再触发 change
              event.target.value = ''
            }}
          />
          <button
            type="button"
            className="assistant-foot-tool"
            title={`添加附件（也可以把文件拖进输入框，或截图后直接 Ctrl+V 粘贴）· 单个上限 ${formatAttachmentSize(MAX_ATTACHMENT_BYTES)}（${formatAttachmentTokens(MAX_ATTACHMENT_BYTES)}）`}
            aria-label="添加附件"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip size={14} />
          </button>
          {/* 两个工具按钮只留图标（09-16 用户拍板：去掉文字与底色），含义走 title 提示 */}
          {/* 工作区选择（09-17）：打开本地文件夹、只取文件夹路径（不上传文件），
              随提问绑定 workspace_path；这两个工具只在 Agent 模式下可点，chat 纯对话禁用置灰 */}
          <button
            type="button"
            className="assistant-foot-tool"
            title={mode === 'agent' ? '选择工作区' : '仅 Agent 模式可用'}
            aria-label="选择工作区"
            disabled={mode !== 'agent'}
            onClick={() => void handlePickWorkspace()}
          >
            <FolderOpen size={14} />
          </button>
          {/* 选中的工作区直接展示在文件夹图标旁边（09-17 用户拍板：不做独立回显条）；
              悬停路径上出现 × 可移除。09-17 改版：值由后端文件夹选择器给出，形如
              `d:exam`（rootKey:相对路径），前端不再需要用户补全绝对路径，故改为只读。
              09-18 用户：「展示的时候就展示一个文件夹名就行」→ **只显示最后一级文件夹名**。
              实测（`_chip-before-after.cjs`，2x）：`d:agent_workspace` 铺全路径并不截断（100px），
              所以这不是「溢出」问题；但更深的路径会被截 —— `d:worker-space/WebstormProjects/campusflow`
              内容要 249px、胶囊只给 232px，而 ellipsis 吃掉的是**尾部**，也就是唯一有用的那段
              （末段文件夹名），留在脸上的是盘符 + 顶层目录。故按用户口径收成末段。
              完整值退到 title，鼠标停上去仍能看到。口径与侧边栏工作区分组共用 `workspaceName`，
              两处显示同一个名字（否则同一块工作区在左栏叫 campusflow、在输入框叫 d:campusflow）。 */}
          {workspacePath && (
            <span className="assistant-workspace-inline" title={`工作区：${workspacePath}`}>
              <b>{workspaceName(workspacePath) || workspacePath}</b>
              <button type="button" className="ws-clear" title="移除工作区" aria-label="移除工作区" onClick={clearWorkspace}>
                <X size={11} />
              </button>
            </span>
          )}
          {/* 权限控制（09-17）：参照 ChatGPT 批准方式选择器的三档弹层，
              「完全访问权限」是高风险档 —— 入口图标与选中项都用警示红；
              选中后在按钮上直接带出当前档位文字，不然看不出选了哪个 */}
          <div className="assistant-perm-select" ref={permRef}>
            <button
              type="button"
              className={`assistant-foot-tool${permMode === 'full' ? ' perm-full' : ''}`}
              title={mode === 'agent' ? '权限控制' : '仅 Agent 模式可用'}
              aria-label="权限控制"
              aria-haspopup="menu"
              aria-expanded={permOpen}
              disabled={mode !== 'agent'}
              onClick={() => setPermOpen((open) => !open)}
            >
              <ShieldCheck size={14} />
              <span className="perm-label">{PERM_LABELS[permMode]}</span>
            </button>
            {permOpen && (
              <div className="assistant-perm-menu" role="menu">
                <header>
                  <span>应如何批准 Campus Flow 操作？</span>
                  <span className="perm-more">了解更多</span>
                </header>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={permMode === 'ask'}
                  className="perm-option"
                  onClick={() => pickPermission('ask')}
                >
                  <span className="perm-icon"><Hand size={14} /></span>
                  <span className="perm-text">
                    <b>请求批准</b>
                    <small>编辑外部文件和使用互联网时始终询问</small>
                  </span>
                  {permMode === 'ask' && <Check size={14} className="perm-check" />}
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={permMode === 'auto'}
                  className="perm-option"
                  onClick={() => pickPermission('auto')}
                >
                  <span className="perm-icon"><Smile size={14} /></span>
                  <span className="perm-text">
                    <b>帮我批准</b>
                    <small>仅对检测到的风险操作请求批准</small>
                  </span>
                  {permMode === 'auto' && <Check size={14} className="perm-check" />}
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={permMode === 'full'}
                  className="perm-option warn"
                  onClick={() => pickPermission('full')}
                >
                  <span className="perm-icon"><OctagonAlert size={14} /></span>
                  <span className="perm-text">
                    <b>完全访问权限</b>
                    <small>可不受限制地访问互联网和你电脑上的任何文件</small>
                  </span>
                  {permMode === 'full' && <Check size={14} className="perm-check" />}
                </button>
              </div>
            )}
          </div>
        </div>
        {/* 「自定义参数」按钮（09-19 三改）：从页头挪到页脚、贴着发送键（用户圈定位置），
            原占位的「Enter 发送」文字删除；点开弹层设回答偏好与深度思考等级。
            按钮固定只显示图标（悬停不弹字），选了非默认值后带出档位文字（状态回显）。
            图标（20 改）：SlidersHorizontal → **WandSparkles**（魔杖 + 星光）。原「三条横排滑杆」
            跟弹层里的 AlignJustify（「详细」）撞脸、又容易被读成列表菜单；用户拍板要魔杖，
            并明确「不要大脑那个」—— 大脑是 High / Max 档的图标，不能挪用到按钮上。
            ⚠️ lucide-react 0.468 里 `Wand2` 已是 `WandSparkles` 的废弃别名，一律用规范名。 */}
        <div className={`assistant-custom-params-select${paramsOpen ? ' open' : ''}`} ref={paramsRef}>
          <button
            type="button"
            className="assistant-custom-params"
            title="自定义参数"
            aria-label="自定义参数"
            aria-haspopup="menu"
            aria-expanded={paramsOpen}
            onClick={() => setParamsOpen((open) => !open)}
          >
            <WandSparkles size={14} />
            {(answerStyle !== 'balanced' || thinkingLevel !== 'off') && (
              <span className="custom-params-value">
                {answerStyle !== 'balanced' ? ANSWER_STYLE_OPTIONS.find((o) => o.value === answerStyle)?.label : ''}
                {answerStyle !== 'balanced' && thinkingLevel !== 'off' ? ' · ' : ''}
                {thinkingLevel !== 'off' ? THINKING_LEVEL_OPTIONS.find((o) => o.value === thinkingLevel)?.label : ''}
              </span>
            )}
            <span className="custom-params-label">自定义参数</span>
          </button>
          {paramsOpen && (
            <div className="assistant-params-menu" role="menu">
              <span className="params-group-label">回答偏好</span>
              {ANSWER_STYLE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={answerStyle === option.value}
                  className="params-option"
                  onClick={() => setAnswerStyle(option.value)}
                >
                  <span className="params-icon"><option.icon size={14} /></span>
                  <span className="params-text">
                    <b>{option.label}</b>
                    <small>{option.description}</small>
                  </span>
                  {answerStyle === option.value && <Check size={14} className="params-check" />}
                </button>
              ))}
              {/* 深度思考（09-19 四改）：滑杆调到 Max 档出现紫蓝渐变 + 白色粒子微光（用户拍板，
                  参照其给的粒子滑杆图）；档位与两端标签直接用英文（Off/low/high/max · Faster/Smarter）。 */}
              <div className="params-slider-head">
                <span className="params-group-label">深度思考</span>
                <b className="params-slider-value">
                  {THINKING_LEVEL_OPTIONS.find((o) => o.value === thinkingLevel)?.label}
                </b>
              </div>
              <div
                /* 档位类名 20 改：is-off / is-low / is-high / is-max 全挂上（原只挂 is-max），
                   温度递进的样式全部由这几个类驱动，见 workspace.css「档位温度递进」段 */
                className={`params-slider-wrap is-${thinkingLevel}`}
                style={{ '--pct': `${(THINKING_LEVEL_OPTIONS.findIndex((o) => o.value === thinkingLevel) / (THINKING_LEVEL_OPTIONS.length - 1)) * 100}%` } as React.CSSProperties}
              >
                <span className="params-slider-ticks" aria-hidden="true">
                  {THINKING_LEVEL_OPTIONS.map((option, index) => (
                    <i key={option.value} className={index === THINKING_LEVEL_OPTIONS.findIndex((o) => o.value === thinkingLevel) ? 'on' : ''} />
                  ))}
                </span>
                {thinkingLevel === 'max' && (
                  <span className="params-slider-particles" aria-hidden="true">
                    {SLIDER_PARTICLES.map((p, index) => (
                      <i
                        key={index}
                        className={p.star ? 'star' : ''}
                        /* 横向略长（size + 2）＝「带速度的火星」形态；🔴 不要改用 rotate/scale 属性做这件事，
                           独立变换属性在 keyframes 的 transform 之后合成，会把 translate 一起转走（19 改踩坑） */
                        style={{ left: `${p.x}%`, top: `${p.y}%`, animationDelay: `${p.delay}s`, width: p.star ? p.size : p.size + 2, height: p.size }}
                      />
                    ))}
                  </span>
                )}
                {/* 陨石尾焰（20 改扩到三档）：Low / High / Max 都有，长度与亮度递进（18 / 26 / 34px），
                    锚在滑块位置、朝 Faster 方向拖尾；--pct 提升到 wrap 上，尾巴与轨道填充共用同一个进度变量。
                    Off 档没有 —— 温度轴的最底端是「冷的石头，不起火」。 */}
                {thinkingLevel !== 'off' && <span className="params-slider-tail" aria-hidden="true" />}
                {/* 陨石图标（09-19 十三改）：Font Awesome 现成 meteor 图标当滑块本体
                    （原生 thumb 隐身保留拖拽命中），left 内联 calc 映射滑块行程 */}
                <span
                  className="params-slider-meteor"
                  aria-hidden="true"
                  style={{ left: `calc((100% - 24px) * ${THINKING_LEVEL_OPTIONS.findIndex((o) => o.value === thinkingLevel) / (THINKING_LEVEL_OPTIONS.length - 1)} + 12px)` }}
                >
                  <MeteorIcon />
                </span>
                <input
                  type="range"
                  className="params-slider"
                  min={0}
                  max={THINKING_LEVEL_OPTIONS.length - 1}
                  step={1}
                  value={THINKING_LEVEL_OPTIONS.findIndex((o) => o.value === thinkingLevel)}
                  aria-label="深度思考等级"
                  aria-valuetext={THINKING_LEVEL_OPTIONS.find((o) => o.value === thinkingLevel)?.label}
                  onChange={(event) => setThinkingLevel(THINKING_LEVEL_OPTIONS[Number(event.target.value)].value)}
                />
              </div>
              <div className="params-slider-ends">
                <span>Faster</span>
                <span>Smarter</span>
              </div>
            </div>
          )}
        </div>
        {/* 09-19 用户拍板：删掉发送键左侧那行「回答生成中…」文字（生成态已由发送键变停止键表达，
            文字是重复噪音）。空出来的右推空间由 .assistant-custom-params-select 的 margin-left:auto 接手。 */}
        {/* 生成中且调用方支持停止时（09-19）：输入框为空 → 发送键原位变停止键；
            有字（09-23 五次定稿）→ 保持发送键形态，点了走「暂存为补充横条」——
            横条出现在输入框上方，点横条上的发送键才送达执行中的任务（不打断）。
            暂停中（10-08）：输入框为空 → 发送键原位变「继续」键（恢复执行）；
            一旦开始输入 → 切回普通发送键（发出去 = 隐式继续 + 内容当补充）。 */}
        {sending && onStop ? (
          value.trim() ? (
            <button
              className="assistant-send"
              type="button"
              aria-label="暂存为补充"
              title="生成中发送：先暂存为补充，点上方横条的发送键送达"
              onClick={onSubmit}
            >
              <ArrowUp size={18} />
            </button>
          ) : (
            <button
              className="assistant-send is-stop"
              type="button"
              aria-label="停止生成"
              title="停止生成"
              onClick={onStop}
            >
              <Square size={11} className="stop-square" />
            </button>
          )
        ) : paused && onResume && !value.trim() ? (
          <button
            className="assistant-send is-resume"
            type="button"
            aria-label="继续"
            title="继续执行暂停的任务"
            onClick={onResume}
          >
            <Play size={16} />
          </button>
        ) : (
          <button
            className="assistant-send"
            type="submit"
            aria-label="发送"
            disabled={!value.trim() || sending}
          >
            {sending ? <Loader2 size={16} className="convo-spin" /> : <ArrowUp size={18} />}
          </button>
        )}
      </div>
      {/* 拖拽高亮（09-19）：覆盖整个输入框的浮层，告诉用户「松手就能加进来」——
          没有它的话文件拖上去毫无反馈，用户会以为不支持拖拽。
          浮层自身 pointer-events:none，不能挡住底下的 onDrop。 */}
      {dragOver && (
        <div className="assistant-drop-hint" aria-hidden="true">
          <Paperclip size={15} />
          松开即可添加文件
        </div>
      )}
      <WorkspaceFolderPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(next) => setWorkspace(next)}
      />
    </form>
  )
}
