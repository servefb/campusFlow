import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { ChevronRight, Folder, FolderOpen, Loader2, MessageSquarePlus, MoreHorizontal, PanelLeftClose, Pencil, Pin, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { AskModeSwitch } from './AskModeSwitch'
import { useAskMode, setAskMode } from '../services/askMode'
import {
  bookmarkHistoryConversation,
  deleteHistoryConversation,
  getHistoryConversations,
  unbookmarkHistoryConversation,
  updateHistoryConversation,
} from '../services/history'
import { WORKSPACE_PREVIEW, clockLabel, splitByWorkspace } from '../utils/conversationGroups'
import type { ConversationSummary } from '../types/api'

/** 列表条数：侧边栏只做「快速跳回」，完整检索与增删改留给历史档案库（/history）。 */
const CONVERSATION_LIMIT = 12

/**
 * 记住「上次点开的是哪条会话」。
 *
 * 09-18：侧栏同时挂在**两个页面**了（问助手 /workspace + 会话页 /conversations/:id）。
 * 09-18 十六改（用户拍板）：**选中态只跟路由走，不再落 localStorage**。
 * 旧版在问助手页兜底「上次点开的那条」，结果是：新对话（问助手页本身没有打开的会话）
 * 也高亮着上一场 —— 用户：「在我新对话的时候历史这个部分不应该是有选中态」。
 * 问助手页 = 新对话 = 无选中；会话页 = 路由 id = 选中。localStorage 记忆整套删除。
 */

/** ⋯ 菜单的锚点：fixed 定位挂到视口上，位置在点击时量出来。 */
interface MenuAnchor {
  id: string
  top: number
  right: number
}

/** 菜单高度估个准数（3 项 × ~32 + 内边距）—— 用来判断该往下弹还是翻到按钮上方。 */
const MENU_HEIGHT = 112

/** 文件夹折叠态落 localStorage（09-19 十九改）。值 true = 折叠；缺省 = 展开。 */
const FOLD_KEY = 'campusflow:sidebar-fold'
const readFold = (): Record<string, boolean> => {
  try {
    const raw = JSON.parse(window.localStorage.getItem(FOLD_KEY) ?? '{}')
    return raw && typeof raw === 'object' ? (raw as Record<string, boolean>) : {}
  } catch {
    return {} // SSR / 隐私模式读不了就算了，默认全展开
  }
}

/**
 * 问助手页的侧边栏视图（09-18 新增）。
 *
 * 与顶栏形态的关系：**同一批功能的两种摆法，不是两套功能**。展开时顶栏那组按钮
 * （Chat/Agent、新建、智能体管理）撤下、搬到这里；收起时原样回到顶栏。
 *
 * 09-18 七改（用户「这个页面没有同步啊」）：**会话页（/conversations/:id）也挂同一份侧栏**，
 * 两页共用这一个组件 + 同一个展开状态（`utils/sidebarState.ts`），改一处两页都变 ——
 * 这就是「同步」的实现方式，而不是把侧栏在会话页再抄一份。
 * 两页的差别只有入参：`activeId` 在会话页由路由给出（选中行 = 你正打开的那条），
 * `onNew` 在会话页是「回问助手页开一场新的」。本组件不碰 AppShell 的全局导航。
 *
 * 09-19 十八改（用户给了一整份侧栏改版清单）：**收敛视觉焦点、理顺从属关系** ——
 * · 顶部只留一个主焦点：「新建会话」从玻璃气泡卡降回**普通主按钮**（实色墨底）；
 *   Chat/Agent 分段控件去槽去边（`.assistant-sidebar` 作用域内的轻量变体，见 workspace.css）。
 * · 「智能体管理」从 50px 入口卡收敛成一行**轻量入口**（细灰字 + 徽标 + ›），不再有卡片底。
 * · 列表只分两组：「当前工作区」（= 全局选定工作区，与输入框 chip 同源 useWorkspace）
 *   和「最近会话」（其余全部按时间倒序）。**不再把历史会话伪装成文件树** ——
 *   旧版按 work_space 分文件夹、缩进、展开显示，用户：「看起来像文件夹，但下面既像文件
 *   又像历史会话，从属关系读不出来」。文件夹头 / 缩进 / 展开按钮整套删除。
 * · 日期分组降为极轻的一档（小号、浅色、不加字距），只给「最近会话」内部用。
 *
 * 09-19 十九改（用户给了 4 张截图继续调）：
 * · 「智能体管理」整行从列表上方**挪进顶行空位**（Chat/Agent 与收起键之间）——给列表让出一行；
 * · 选中段图标白图标落白底隐形：共用规则 `.ask-mode-item.active svg{color:#fff}` 是给墨底配的，
 *   侧栏白片变体必须覆盖回墨色（CSS 侧补，见 workspace.css）；
 * · 列表层级加回去（用户明确要图 4 那种「文件夹 + 可折叠」效果）：工作区组头 = Folder 图标 +
 *   组名 + 折叠箭头。折叠态记 localStorage（`campusflow:sidebar-fold`），默认全展开。
 *
 * 09-19 二十改（用户给 Codex 侧栏截图：「按照这种风格制作，但是还要有自己的设计」）：
 * · 列表照 Codex 结构重排：**「项目」段平铺全部工作区文件夹**（不再只挑全局选定的那一个），
 *   每夹下直接挂会话行；超过 WORKSPACE_PREVIEW 条先铺 5 条 + 「展开显示」（Codex 同款交互）。
 * · 「最近」段 = 没有工作区的会话**平铺**（时间倒序），日期小标题（今天/昨天/更早）退役 ——
 *   Codex 参考图里没有这一层，日期信息保留在悬停时刻里（clockLabel）。
 * · 自己的设计保留：珊瑚选中态（浅珊瑚底 + 3px 侧线）、墨底「新建会话」主按钮、
 *   悬停才出现的时刻/⋯、文件夹可折叠。
 *
 * 打开时才拉会话列表 —— 收起状态下这个组件不挂载，省一次请求。
 */
export function AssistantSidebar({
  activeId: routeActiveId = null,
  refreshKey = 0,
  pending = null,
  onNew,
  onClose,
}: {
  /**
   * 当前正在看的会话 id —— **由路由给出**（会话页 /conversations/:id 传 `id`）。
   * 问助手页不传（新对话态）→ 没有任何选中行（09-18 十六改，用户拍板）。
   * 09-18 十六改补充：`/conversations/new` 首问的会话由 accepted 事件才拿到真实 id，
   * 而 `history.replaceState` 不触发路由重渲染 —— 所以会话页会把 accepted 拿到的
   * id 通过这个 prop 传进来（见 ConversationPage 的 streamConversationId）。
   */
  activeId?: string | null
  /**
   * 变了就重拉一次列表。会话页首问时：accepted（会话真实创建了）和 done（模型标题落库）
   * 各 bump 一次 —— 不重拉的话，刚发的那条**不在列表里**，选中态无从挂起，
   * 用户要等下次进页面才看得到它（实测踩过）。
   */
  refreshKey?: number
  /**
   * 「刚发出去、后端还没落库」的占位行（09-19 二十四改）。
   *
   * 🔴 真后端**只在整轮回答跑完那一刻**才 INSERT conversations 行
   * （后端 `conversations_repo._agent_stream`：`session.add(con)` + `commit()` 在
   * `astream` 循环之后、`yield done` 之前），所以 `accepted` 触发的那次重拉
   * **永远看不到刚发的这条** —— 侧栏既没有这一行，也没有珊瑚选中态。
   * 用户 09-18 已拍板的口径是「发送那一刻就该选中刚发的那条，不等 AI 响应完」，
   * 但接口侧做不到，于是由会话页把已知信息（accepted 给的 id + 首问文本 + 本轮工作区）
   * 传进来顶一行；`done` 重拉拿到真行（模型起的标题）后，这里按 id 去重自动让位。
   * 只有会话页首问会传，问助手页 / 打开历史会话时为 null。
   */
  pending?: ConversationSummary | null
  onNew: () => void
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [items, setItems] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState('')
  // 选中行 = 路由给的那个 id（会话页）。问助手页没有 → 没有选中行。
  const currentId = routeActiveId
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    getHistoryConversations({ page: 1, page_size: CONVERSATION_LIMIT })
      .then(({ data }) => {
        if (cancelled) return
        setItems(data.data.items ?? [])
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setItems([])
        setFailed(true)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // refreshKey 变了就重拉（首问 accepted / done 各一次）；重拉不清 loading，列表原地换血不闪空。
  }, [refreshKey])

  // 菜单开着时：点别处 / 按 Esc / 滚动 / 改窗口大小都收起来。
  // 监听 click 而不是 pointerdown —— pointerdown 会在同一个手势里先把菜单卸载，
  // 后面那条 click 就落在空气上，菜单项点不动。
  useEffect(() => {
    if (!menu) return
    const close = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      setMenu(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  // 09-19 二十改（Codex 风格）：「项目」段平铺**全部**工作区文件夹，不再只挑全局选定的那一个
  // （旧口径「判定键 = work_space 全等于 useWorkspace() 选定值」随「当前工作区」单组一起退役；
  // useWorkspace 仍服务输入框 chip，与侧栏解耦）。没有工作区的会话全部落到「最近」平铺。
  // ⚠️ 分组前先把占位行并进去：它得跟着「本轮工作区」落进对应文件夹组，才能直接出现在组内第一行。
  // 按 id 去重 —— 真行一到就让位（连带换成模型起的标题），不会出现两行同一条会话。
  const pendingRow = pending && pending.id != null && !items.some((it) => String(it.id) === String(pending.id)) ? pending : null
  const merged = pendingRow ? [pendingRow, ...items] : items
  const { workspaces, rest } = splitByWorkspace(merged)

  const menuItem = menu ? items.find((item) => String(item.id) === menu.id) ?? null : null

  // 文件夹折叠态（09-19 十九改）：键 ws:<路径>，落 localStorage，默认全展开
  const [folded, setFolded] = useState<Record<string, boolean>>(readFold)

  // 顶行液态滑块（09-19 二十三改；09-23 简化为两槽位）：滑块挂在背景组上，
  // 0 = Chat、1 = Agent。最左那格原本是「智能体管理」入口（悬停/聚焦时滑过去的临时反馈），
  // 全站只剩一个主智能体后，入口与那格一起撤掉。
  const askMode = useAskMode()
  const thumbSlot = askMode === 'agent' ? 1 : 0

  // —— 拖动（用户：「再加上一个拖动效果」）——
  // 按住滑块（实际上按的是整块滑动面）左右拖，滑块跟手；松手吸附最近槽位：
  // 0 → Chat、1 → Agent（与点击同一语义）。
  // 实现：pointerdown 在**组**上接管（setPointerCapture），位移超过 4px 才算拖 ——
  // 不超阈值就当普通点击放行，按钮自己的 onClick 照常触发。
  // transform 平时不走 React（走 effect 写 ref），拖动中直接写 px，
  // 避免「setDragging 重渲染把内联 transform 冲回槽位值」的竞态。
  const SLOTS = 2
  const DRAG_THRESHOLD = 4
  const groupRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLSpanElement | null>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; baseLeft: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const thumb = thumbRef.current
    if (!thumb) return
    thumb.style.transition = dragging ? 'none' : ''
    if (!dragging) thumb.style.transform = `translateX(${thumbSlot * 100}%)`
  }, [thumbSlot, dragging])

  const onGroupPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const group = groupRef.current
    const thumb = thumbRef.current
    if (!group || !thumb) return
    const baseLeft = thumb.getBoundingClientRect().left - group.getBoundingClientRect().left - 3
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, baseLeft, moved: false }
    // ⚠️ 这里**不能**立刻 setPointerCapture —— 捕获会把后续 click 的目标也劫持到组元素，
    // 按钮自己的 onClick 就永远收不到（实测 Chat/Agent 点不动）。捕获推迟到
    // 位移超过阈值的那一刻（见 onGroupPointerMove），纯点击全程不捕获、照常触发。
  }

  const onGroupPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const group = groupRef.current
    const thumb = thumbRef.current
    if (!drag || e.pointerId !== drag.pointerId || !group || !thumb) return
    const dx = e.clientX - drag.startX
    if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD) return
    if (!drag.moved) {
      drag.moved = true
      group.setPointerCapture(e.pointerId) // 过了阈值才算拖，此刻才接管指针
      setDragging(true)
    }
    const inner = group.clientWidth - 6 // 左右各 3px 内边距
    const width = inner / SLOTS
    const left = Math.max(0, Math.min(inner - width, drag.baseLeft + dx))
    thumb.style.transform = `translateX(${left}px)`
  }

  const endGroupDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    dragRef.current = null
    if (!drag.moved) return // 纯点击，交给按钮自己的 onClick
    const group = groupRef.current
    if (!group) return
    suppressClickRef.current = true // 拖完松手，别把 pointerup 落点当成一次点击
    const inner = group.clientWidth - 6
    const width = inner / SLOTS
    const left = drag.baseLeft + (e.clientX - drag.startX)
    const slot = Math.max(0, Math.min(SLOTS - 1, Math.round(left / width)))
    setDragging(false) // effect 恢复过渡并吸附回槽位
    if (slot === 0) setAskMode('chat')
    else if (slot === 1) setAskMode('agent')
  }

  const onGroupClickCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    e.preventDefault()
    e.stopPropagation()
  }

  // 没到阈值就拖出滑动面（还没捕获，收不到 pointerup）→ 把待定手势作废，防串到下一次点击
  const onGroupPointerLeave = () => {
    if (dragRef.current && !dragRef.current.moved) dragRef.current = null
  }
  const toggleFold = (key: string) =>
    setFolded((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      try {
        window.localStorage.setItem(FOLD_KEY, JSON.stringify(next))
      } catch {
        /* 写不了（SSR/隐私模式）只影响记忆，不影响本次交互 */
      }
      return next
    })

  // 「展开显示」（09-19 二十改，Codex 同款）：一夹超过 WORKSPACE_PREVIEW 条先铺 5 条，
  // 点「展开显示」铺满。这个状态**不落 localStorage**（Codex 也不记）——刷新回到收着的预览态。
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const toggleExpand = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))

  // 折叠夹头：工作区组（带 Folder 图标，随开合切换开/合形态）。
  // 与 renderConvo 同理：直接调用、不是组件，避免重定义卸载子树。
  const folderHead = (key: string, content: ReactNode, title?: string) => {
    const open = !folded[key]
    return (
      <button
        type="button"
        className={`assistant-sidebar-folder is-ws${open ? ' is-open' : ''}`}
        aria-expanded={open}
        title={title}
        onClick={() => toggleFold(key)}
      >
        {open ? <FolderOpen size={13} aria-hidden="true" /> : <Folder size={13} aria-hidden="true" />}
        {content}
        <ChevronRight size={12} className="assistant-sidebar-folder-chev" aria-hidden="true" />
      </button>
    )
  }

  const patch = (id: string, next: Partial<ConversationSummary>) =>
    setItems((prev) => prev.map((item) => (String(item.id) === id ? { ...item, ...next } : item)))

  const toggleMenu = (event: ReactMouseEvent<HTMLButtonElement>, id: string) => {
    setNotice('')
    if (menu?.id === id) {
      setMenu(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const below = rect.bottom + 4
    setMenu({
      id,
      // 贴着视口下沿时翻到按钮上方，别被裁掉
      top: below + MENU_HEIGHT > window.innerHeight ? Math.max(8, rect.top - 4 - MENU_HEIGHT) : below,
      right: Math.max(8, window.innerWidth - rect.right),
    })
  }

  // 重命名 / 置顶 / 删除都复用历史档案库那套接口，不新造字段
  // （PATCH /conversations/{id}、POST|DELETE /history/conversations/{id}/bookmark、DELETE /history/conversations/{id}）。
  const rename = async (item: ConversationSummary) => {
    setMenu(null)
    const next = window.prompt('修改会话标题', item.title)?.trim()
    if (!next || next === item.title) return
    try {
      await updateHistoryConversation(item.id, { title: next })
      patch(String(item.id), { title: next })
    } catch (requestError) {
      setNotice(requestError instanceof Error ? requestError.message : '标题修改失败，请稍后重试')
    }
  }

  // 置顶即收藏（与历史弹窗同一口径）：先乐观更新，失败再回滚
  const togglePin = async (item: ConversationSummary) => {
    setMenu(null)
    const next = !item.is_bookmarked
    patch(String(item.id), { is_bookmarked: next })
    try {
      if (next) await bookmarkHistoryConversation(item.id)
      else await unbookmarkHistoryConversation(item.id)
    } catch (requestError) {
      patch(String(item.id), { is_bookmarked: !next })
      setNotice(requestError instanceof Error ? requestError.message : '置顶状态更新失败，请稍后重试')
    }
  }

  const removeOne = async (item: ConversationSummary) => {
    setMenu(null)
    if (!window.confirm(`确定删除“${item.title}”吗？删除后不可恢复。`)) return
    try {
      await deleteHistoryConversation(item.id)
      setItems((prev) => prev.filter((record) => String(record.id) !== String(item.id)))
    } catch (requestError) {
      setNotice(requestError instanceof Error ? requestError.message : '会话删除失败，请稍后重试')
    }
  }

  // 会话行要在两组里渲染（当前工作区 / 最近会话），抽成一个渲染函数而不是把标记复制两遍
  // —— 选中态、⋯ 菜单、悬停时刻遮罩都只有这一份。
  // 它不是组件（小写开头、直接调用），所以不会因为重新定义而卸载子树。
  const renderConvo = (item: ConversationSummary) => {
    const id = String(item.id)
    const active = currentId === id
    // 占位行还没落库：重命名/置顶/删除都打不到真行（后端会 404），所以不给它挂 ⋯ 菜单，
    // 也不给「悬停露时刻」那种需要真实 updated_at 的交互添乱。
    const isPending = pendingRow !== null && String(pendingRow.id) === id
    return (
      <div
        className={`assistant-sidebar-convo${active ? ' is-active' : ''}${isPending ? ' is-pending' : ''}${menu?.id === id ? ' is-menu-open' : ''}`}
        key={id}
      >
        <button
          type="button"
          className="assistant-sidebar-convo-open"
          title={item.title}
          aria-current={active ? 'page' : undefined}
          onClick={() => {
            // 选中态不用这里写：navigate 过去会话页由路由 id 决定高亮（09-18 十六改删了 localStorage 记忆）
            navigate(`/conversations/${item.id}`)
          }}
        >
          <span className="assistant-sidebar-convo-title">{item.title}</span>
          <time>{clockLabel(item.updated_at)}</time>
        </button>
        {!isPending && (
          <button
            type="button"
            className="assistant-sidebar-convo-more"
            aria-label={`${item.title} · 更多操作`}
            title="更多操作"
            onClick={(event) => {
              event.stopPropagation()
              toggleMenu(event, id)
            }}
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>
    )
  }

  return (
    <aside className="assistant-sidebar" aria-label="问助手侧边栏">
      {/* 顶行：左 = Chat/Agent 执行模式，右 = 收起侧边栏。
          09-23：原先最左那格「智能体管理」迷你入口随多智能体选择一起撤掉
          （全站只剩一个主智能体，没有可管理/可切换的对象），滑块从三槽位变两槽位。 */}
      <div className="assistant-sidebar-head">
        <div
          className="assistant-sidebar-head-group"
          ref={groupRef}
          onPointerDown={onGroupPointerDown}
          onPointerMove={onGroupPointerMove}
          onPointerUp={endGroupDrag}
          onPointerCancel={endGroupDrag}
          onPointerLeave={onGroupPointerLeave}
          onClickCapture={onGroupClickCapture}
        >
          <AskModeSwitch />
          <span ref={thumbRef} className="assistant-sidebar-head-thumb" aria-hidden="true" />
        </div>
        <button
          type="button"
          className="assistant-sidebar-fold"
          onClick={onClose}
          aria-label="收起侧边栏"
          title="收起侧边栏"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      {/* 主操作：普通主按钮（09-19 十八改）—— 旧版是一颗玻璃气泡卡（glass.css §4c），
          用户：「顶部 Agent、新建会话、智能体管理、当前会话都在抢注意力」。
          现在这一屏唯一的实色按钮就是它，主次一眼可读；材质改动同步落在 glass.css §4c。 */}
      <button type="button" className="assistant-sidebar-new" onClick={onNew}>
        <MessageSquarePlus size={18} />
        <span>新建会话</span>
      </button>

      {/* 会话列表（09-19 二十改，Codex 风格）：两段 ——
          ① 「项目」：全部工作区文件夹平铺，每夹下直接挂会话行；
             超过 WORKSPACE_PREVIEW 条先铺 5 条 + 「展开显示」（Codex 同款交互）；
          ② 「最近」：没有工作区的会话平铺（时间倒序），日期小标题退役。
          自己的设计保留：珊瑚选中态、悬停时刻/⋯、文件夹可折叠（localStorage）。 */}
      <div className="assistant-sidebar-list">
        {notice && <p className="assistant-sidebar-hint">{notice}</p>}
        {loading && (
          <p className="assistant-sidebar-hint">
            <Loader2 size={13} className="history-loading-spin" />
            加载中…
          </p>
        )}
        {!loading && failed && <p className="assistant-sidebar-hint">会话加载失败</p>}
        {!loading && !failed && !items.length && <p className="assistant-sidebar-hint">还没有历史会话</p>}

        {/* 09-19 二十四改：分组**不再等 `!loading`** —— 列表还在拉的时候，
            刚发出去的那条（占位行）只有它自己，得能立刻渲染出来。
            没有占位行时 workspaces/rest 都是空的，条件自然不成立，与旧行为等价。 */}
        {!failed && workspaces.length > 0 && (
          <div className="assistant-sidebar-group">
            <p className="assistant-sidebar-label">工作区</p>
            {workspaces.map((ws) => {
              const foldKey = `ws:${ws.key}`
              const open = !folded[foldKey]
              const showAll = !!expanded[foldKey]
              const visible = showAll ? ws.records : ws.records.slice(0, WORKSPACE_PREVIEW)
              return (
                <div key={foldKey}>
                  {/* title 挂完整路径：标签只有最后一段，末段重名时鼠标停一下能分辨 */}
                  {folderHead(foldKey, <span>{ws.label}</span>, ws.key)}
                  {open && (
                    <div className="assistant-sidebar-fold-body">
                      {visible.map(renderConvo)}
                      {ws.records.length > WORKSPACE_PREVIEW && (
                        <button
                          type="button"
                          className="assistant-sidebar-expand"
                          onClick={() => toggleExpand(foldKey)}
                        >
                          {showAll ? '收起' : '展开显示'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!failed && rest.length > 0 && (
          <div className="assistant-sidebar-group is-recent">
            <p className="assistant-sidebar-label">最近会话</p>
            {rest.map(renderConvo)}
          </div>
        )}
      </div>

      {menu && menuItem && (
        <div
          className="assistant-sidebar-menu"
          ref={menuRef}
          role="menu"
          aria-label="会话操作"
          style={{ top: menu.top, right: menu.right }}
        >
          <button type="button" role="menuitem" onClick={() => void rename(menuItem)}>
            <Pencil size={13} />
            重命名
          </button>
          <button type="button" role="menuitem" onClick={() => void togglePin(menuItem)}>
            <Pin size={13} />
            {menuItem.is_bookmarked ? '取消置顶' : '置顶'}
          </button>
          <button type="button" role="menuitem" className="is-danger" onClick={() => void removeOne(menuItem)}>
            <Trash2 size={13} />
            删除
          </button>
        </div>
      )}
    </aside>
  )
}
