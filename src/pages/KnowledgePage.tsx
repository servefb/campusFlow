import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Award,
  BadgeCheck,
  Briefcase,
  Building2,
  ChevronDown,
  ChevronRight,
  Download,
  FileQuestion,
  FileText,
  FolderOpen,
  Gavel,
  GripVertical,
  Lightbulb,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Quote,
  School,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Type,
  X,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageTitle, SearchField, StatusBadge } from '../components/ui'
import { apiErrorMessage } from '../services/http'
import {
  getKnowledgeCategories,
  getKnowledgeChapters,
  getKnowledgeDocument,
  getKnowledgeDocuments,
  getKnowledgeDownloadUrl,
  getKnowledgeSection,
} from '../services/knowledge'
import type { KnowledgeCategory, KnowledgeChapter, KnowledgeDocument, KnowledgeSection, KnowledgeSectionRef } from '../types/api'

/**
 * 效力状态 → 徽章文案与色档。`services/knowledge.ts` 已把后端的大写枚举归一成小写；
 * 认不出来的枚举不猜语义，直接走「待返回」文案，且用「待核验」替代原先含糊的「待复」。
 *
 * ⚠️ 配色统一（用户 09-13 反馈「避免红色同时承担选中、警示和品牌色」）：
 *   绿色 = 正常 / 通过 · 琥珀 = 警示 / 变更 · 紫灰 = 失效归档 · 中性灰 = 待返回
 *   珊瑚色（--coral）只用作**选中**与品牌强调，不出现在状态语义里。
 */
type ValidityTone = 'success' | 'warning' | 'archive' | 'pending'
const VALIDITY_BADGE: Record<string, { label: string; tone: ValidityTone; short: string }> = {
  current: { label: '现行有效', tone: 'success', short: '现行' },
  revised: { label: '近期修订', tone: 'warning', short: '近期' },
  deprecated: { label: '即将失效', tone: 'warning', short: '即将' },
  archive: { label: '历史归档', tone: 'archive', short: '归档' },
}
const VALIDITY_ORDER = ['current', 'revised', 'deprecated', 'archive']
const badgeOf = (validity?: string | null) => {
  const key = String(validity ?? '').trim().toLowerCase()
  return VALIDITY_BADGE[key] ?? { label: '有效性待核验', tone: 'pending' as ValidityTone, short: '待核验' }
}

/** 可见范围：纯展示映射；认不出来的原样显示，不编中文。 */
const VISIBILITY_LABEL: Record<string, string> = { public: '公开', campus: '校内可见', student: '学生可见', admin: '管理员可见' }
const visibilityText = (value?: string | null) =>
  value ? VISIBILITY_LABEL[value.trim().toLowerCase()] ?? value : '可见范围待返回'

/** 分类图标按名称关键词推导（与首页类别徽章同一套做法）。 */
const CATEGORY_ICONS: Array<{ match: RegExp; Icon: typeof FolderOpen }> = [
  { match: /校规|条例|准则|章程|规定/, Icon: Gavel },
  { match: /教务|教学|学籍|培养|课程|考试/, Icon: School },
  { match: /奖助|奖学|助学|荣誉|资助|奖学金/, Icon: Award },
  { match: /就业|升学|职业|毕业|就创/, Icon: Briefcase },
  { match: /宿舍|园区|后勤|生活|公寓/, Icon: Building2 },
]
const categoryIcon = (name: string) => CATEGORY_ICONS.find((entry) => entry.match.test(name))?.Icon ?? FolderOpen

const nameOf = (value: KnowledgeDocument['issuer'] | KnowledgeDocument['category']) =>
  typeof value === 'string' ? value : value?.name || ''

/** 接口时间可能是 `2026-08-20T09:00`、`2024-09-12T00:00:00+08:00` 或 `2024-09-12`，统一取日期段。 */
const formatDate = (value?: string | null) => (value ? value.slice(0, 10) : '')

/** 卡片元信息行：接口不返回 `summary`（mock 才有），用真实字段拼一行，别拿占位文案糊。 */
const docMeta = (doc: KnowledgeDocument) =>
  [nameOf(doc.category), nameOf(doc.issuer), formatDate(doc.published_at)].filter(Boolean).join(' · ')

/**
 * 来源路径：把「分类 / 文档」拼成可读的链路，写到右侧标题下方。
 * 用户 09-13 反馈「强化三栏联动」时提出 —— 中间选中的条目和右侧标题之间的关联应当更明显。
 */
const sourcePath = (doc: KnowledgeDocument) => {
  const cat = nameOf(doc.category)
  return cat ? `${cat} / ${doc.title}` : doc.title
}

interface SectionEntry extends KnowledgeSectionRef {
  chapterId: string | number
}
/** 章节索引摊平成条款清单。正文按条单独取（点一次 = 一个 GET），不按章批量补发详情请求。 */
const flattenSections = (chapters: KnowledgeChapter[]): SectionEntry[] =>
  chapters.flatMap((chapter) => (chapter.sections ?? []).map((section) => ({ ...section, chapterId: chapter.id })))

const splitParagraphs = (content?: string | null) =>
  (content ?? '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)

/** 文档级别的预置提问：根据文档类别给出 2-3 个最常被问到的小问题，让首次使用的用户少走一步。 */
const QUICK_PROMPTS: Record<string, string[]> = {
  scholarship: ['我是否符合评选范围？', '需要准备哪些申请材料？', '评选时间节点是怎样的？'],
  academic: ['这份文件适用于哪些学生？', '与上一版规定相比有哪些变化？', '办理该事项要走哪些流程？'],
  life: ['申请条件与所需材料？', '办理周期是多久？', '可以线上办理吗？'],
  default: ['这份规定的适用范围是什么？', '需要哪些办理材料？', '什么时候开始执行？'],
}
const quickPromptsFor = (doc: KnowledgeDocument) => {
  const cat = nameOf(doc.category)
  if (/奖助|奖学|助学|荣誉|资助|奖学金/.test(cat)) return QUICK_PROMPTS.scholarship
  if (/教务|教学|学籍|培养|课程|考试/.test(cat)) return QUICK_PROMPTS.academic
  if (/宿舍|园区|后勤|生活|公寓/.test(cat)) return QUICK_PROMPTS.life
  return QUICK_PROMPTS.default
}

/** 「向智能体提问」的兜底模板（用户手动输入框为空时也能直接发）。 */
const docQuestion = (doc: KnowledgeDocument) =>
  `请依据《${doc.title}》${doc.document_no ? `（${doc.document_no}）` : ''}说明办理流程、所需材料与时间节点。`

/** 栏宽（CSS 变量）：左右两侧均可拖拽调整；窄屏自动忽略。
 *  ⚠️ 默认**不写死像素** —— 没有用户自定义值时样式表走 `clamp(…)` 百分比列宽，
 *  跟视口一起伸缩（1280px 视口下若写死 240+480，中栏会被压到 ~300px，卡片标题开始换行）。
 *  只有用户真的拖过之后才落盘成固定 px。 */
const KB_LAYOUT_KEY = 'campusflow_kb_layout'
const KB_LAYOUT_BOUNDS = { left: [190, 340], right: [360, 640] } as const
const loadLayout = (): { left: number; right: number } | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(KB_LAYOUT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { left?: number; right?: number }
    if (!parsed || (typeof parsed.left !== 'number' && typeof parsed.right !== 'number')) return null
    return {
      left: typeof parsed.left === 'number' ? parsed.left : KB_LAYOUT_BOUNDS.left[0],
      right: typeof parsed.right === 'number' ? parsed.right : KB_LAYOUT_BOUNDS.right[0],
    }
  } catch {
    return null
  }
}
const saveLayout = (value: { left: number; right: number } | null) => {
  if (typeof window === 'undefined') return
  try {
    if (value) localStorage.setItem(KB_LAYOUT_KEY, JSON.stringify(value))
    else localStorage.removeItem(KB_LAYOUT_KEY)
  } catch { /* quota / private mode：忽略 */ }
}

/**
 * 渲染带关键词高亮的段落：仅当用户当前 query 非空时启用 —— 后端没返回高亮字段，
 * 这里按「命中 query 的连续片段」做本地高亮，避免无 query 时也强行渲染背景色块。
 */
const highlightParagraphs = (paragraphs: string[], query: string) => {
  const trimmed = query.trim()
  if (!trimmed) return paragraphs.map((line, index) => ({ key: `${index}`, text: line, parts: null }))
  const tokens = Array.from(new Set(trimmed.split(/\s+/).filter((token) => token.length >= 2)))
  if (!tokens.length) return paragraphs.map((line, index) => ({ key: `${index}`, text: line, parts: null }))
  const escaped = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const regex = new RegExp(`(${escaped})`, 'gi')
  return paragraphs.map((line, index) => {
    const parts: Array<{ text: string; hit: boolean }> = []
    let cursor = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(line)) !== null) {
      if (match.index > cursor) parts.push({ text: line.slice(cursor, match.index), hit: false })
      parts.push({ text: match[0], hit: true })
      cursor = match.index + match[0].length
    }
    if (cursor < line.length) parts.push({ text: line.slice(cursor), hit: false })
    return { key: `${index}`, text: line, parts: parts.length ? parts : null }
  })
}

export function KnowledgePage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [query, setQuery] = useState(params.get('query') || '')
  const [validity, setValidity] = useState('current')
  const [categoryId, setCategoryId] = useState<string | number>()
  const [categories, setCategories] = useState<KnowledgeCategory[]>([])
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  /** 各效力状态的条数：接口一次只回当前筛选的 total，四个状态各取一次（page_size=1）拿 total。 */
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<KnowledgeDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 阅读面板：章节索引 + 条款正文 + 阅读工具
  const [chapters, setChapters] = useState<KnowledgeChapter[]>([])
  const [chaptersLoading, setChaptersLoading] = useState(false)
  const [activeSectionId, setActiveSectionId] = useState<string | number | null>(null)
  const [section, setSection] = useState<KnowledgeSection | null>(null)
  const [sectionLoading, setSectionLoading] = useState(false)
  const [readerMessage, setReaderMessage] = useState('')
  const [largeText, setLargeText] = useState(false)
  /** 「专注阅读」模式：收起左栏、加大右栏宽度与正文字号。 */
  const [focusMode, setFocusMode] = useState(false)
  /** 下载菜单展开状态（点 download 之外的区域会自动收起）。 */
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false)
  const [draft, setDraft] = useState('')
  /** 切换文档时，保留右栏滚动条位置；新文档没有则默认顶部。 */
  const readerScrollRef = useRef<HTMLDivElement | null>(null)
  const lastScrollTopRef = useRef(0)

  /** 栏宽（持久化）。`null` = 用户没调过 → 样式表走百分比默认列宽。 */
  const [layoutWidths, setLayoutWidths] = useState<{ left: number; right: number } | null>(() => loadLayout())

  useEffect(() => { getKnowledgeCategories().then(({ data }) => setCategories(data.data.items)).catch(() => setCategories([])) }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getKnowledgeDocuments({ query: query.trim() || undefined, category_id: categoryId, validity: validity || undefined, sort: false, page: 1, page_size: 20 })
      .then(({ data }) => {
        if (cancelled) return
        setDocuments(data.data.items)
        setSelected((current) =>
          current && data.data.items.some((item) => String(item.id) === String(current.id)) ? current : data.data.items[0] || null,
        )
      })
      .catch((requestError) => {
        if (cancelled) return
        setDocuments([])
        setSelected(null)
        setError(apiErrorMessage(requestError, '知识库加载失败，请稍后重试'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [categoryId, query, validity])

  // 四个效力状态的条数（跟随当前关键词 / 分类）。任何一个失败只是那颗胶囊不显示数字。
  useEffect(() => {
    let cancelled = false
    const context = { query: query.trim() || undefined, category_id: categoryId, sort: false, page: 1, page_size: 1 }
    Promise.allSettled(VALIDITY_ORDER.map((key) => getKnowledgeDocuments({ ...context, validity: key }))).then((results) => {
      if (cancelled) return
      const next: Record<string, number> = {}
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') next[VALIDITY_ORDER[index]] = result.value.data.data.total
      })
      setCounts(next)
    })
    return () => { cancelled = true }
  }, [categoryId, query])

  const selectedId = selected?.id
  useEffect(() => {
    if (selectedId === undefined) return
    // 换的是**另一份文档** → 正文从头读起（用户 09-13 反馈的「明确回到当前章节」）。
    // 同一份文档内切换条款时不动这个值，由下面的 useLayoutEffect 保留滚动位置。
    lastScrollTopRef.current = 0
    getKnowledgeDocument(selectedId).then(({ data }) => setSelected(data.data)).catch(() => undefined)
  }, [selectedId])

  // 换文档 → 重取章节索引，并把选中条款落到第一条
  useEffect(() => {
    if (selectedId === undefined) { setChapters([]); setActiveSectionId(null); return }
    let cancelled = false
    setChaptersLoading(true)
    setReaderMessage('')
    getKnowledgeChapters(selectedId).then(({ data }) => {
      if (cancelled) return
      const items = data.data.items || []
      setChapters(items)
      const flat = flattenSections(items)
      setActiveSectionId((current) => (current && flat.some((item) => String(item.id) === String(current)) ? current : flat[0]?.id ?? null))
    }).catch(() => {
      if (cancelled) return
      setChapters([])
      setActiveSectionId(null)
      setReaderMessage('章节索引加载失败')
    }).finally(() => { if (!cancelled) setChaptersLoading(false) })
    return () => { cancelled = true }
  }, [selectedId])

  // 选条款 → 取正文（一次请求一条）
  useEffect(() => {
    if (selectedId === undefined || activeSectionId === null) { setSection(null); setSectionLoading(false); return }
    let cancelled = false
    setSectionLoading(true)
    getKnowledgeSection(selectedId, activeSectionId).then(({ data }) => { if (!cancelled) setSection(data.data) }).catch(() => {
      if (!cancelled) { setSection(null); setReaderMessage('条款正文加载失败') }
    }).finally(() => { if (!cancelled) setSectionLoading(false) })
    return () => { cancelled = true }
  }, [selectedId, activeSectionId])

  // 章节 / 条款切换后，把滚动条拉回切换前的位置（如果存在），否则回顶端，让用户知道「当前章节」是哪里
  useLayoutEffect(() => {
    if (!readerScrollRef.current) return
    readerScrollRef.current.scrollTop = lastScrollTopRef.current || 0
  }, [activeSectionId, selectedId])

  const sections = useMemo(() => flattenSections(chapters), [chapters])
  const activeChapter = useMemo(
    () => chapters.find((chapter) => (chapter.sections ?? []).some((entry) => String(entry.id) === String(activeSectionId))) ?? chapters[0],
    [chapters, activeSectionId],
  )
  const activeChapterIndex = useMemo(
    () => (activeChapter ? chapters.findIndex((chapter) => String(chapter.id) === String(activeChapter.id)) + 1 : 0),
    [chapters, activeChapter],
  )
  const totalDocs = useMemo(() => categories.reduce((sum, item) => sum + item.document_count, 0), [categories])
  const indexUpdated = formatDate(selected?.index?.updated_at ?? selected?.index?.updatedAt)
  const highlightedParagraphs = useMemo(() => highlightParagraphs(splitParagraphs(section?.content), query), [section?.content, query])

  // ─── 拖拽调整栏宽 ─────────────────────────────────────────────────────
  // 思路：监听 resizer 上的 pointerdown，记录起始 x 与当前栏宽；move 期间按位移重算
  //       CSS 变量；up 时把最终值写进 localStorage。
  // ⚠️ 起点优先取 DOM 实测宽度，而不是上次的值 —— 未自定义时用的是百分比列宽，
  //    直接拿常量当起点会让第一次拖拽「跳」一下。
  const dragStateRef = useRef<{ axis: 'left' | 'right'; startX: number; startLeft: number; startRight: number } | null>(null)
  const onResizerPointerDown = useCallback((axis: 'left' | 'right') => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const railWidth = document.querySelector('.kb-rail')?.getBoundingClientRect().width
    const readerWidth = document.querySelector('.reading-panel')?.getBoundingClientRect().width
    const startLeft = layoutWidths?.left ?? Math.round(railWidth ?? 240)
    const startRight = layoutWidths?.right ?? Math.round(readerWidth ?? 480)
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStateRef.current = { axis, startX: event.clientX, startLeft, startRight }
    // 立刻把百分比列宽冻结成 px，否则拖拽第一帧会因为起点是百分比而抖动
    setLayoutWidths({ left: startLeft, right: startRight })
  }, [layoutWidths])
  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const state = dragStateRef.current
      if (!state) return
      const delta = event.clientX - state.startX
      setLayoutWidths(() => {
        if (state.axis === 'left') {
          const next = Math.min(KB_LAYOUT_BOUNDS.left[1], Math.max(KB_LAYOUT_BOUNDS.left[0], state.startLeft + delta))
          return { left: next, right: state.startRight }
        }
        // 右栏拖拽时往左拖 = 加大右栏；用「起点 + 反向位移」表达更直观
        const next = Math.min(KB_LAYOUT_BOUNDS.right[1], Math.max(KB_LAYOUT_BOUNDS.right[0], state.startRight - delta))
        return { left: state.startLeft, right: next }
      })
    }
    const handleUp = () => {
      if (!dragStateRef.current) return
      dragStateRef.current = null
      // 拖完才落盘（避免每帧写入）
      setLayoutWidths((current) => { saveLayout(current); return current })
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [])

  const ask = (question: string) => {
    const text = question.trim()
    if (!text) return
    navigate('/conversations/new', { state: { question: text, agentMode: 'auto' } })
  }

  /** 「整张卡片点击 = 进入精读」：不再保留「查阅条款」按钮，底部只留「向智能体提问」。 */
  const openDocument = (doc: KnowledgeDocument) => {
    setSelected(doc)
    if (typeof window !== 'undefined' && window.innerWidth <= 1180) {
      window.requestAnimationFrame(() => document.getElementById('knowledge-reader')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }

  const quoteClause = () => {
    if (!selected) return
    const cite = `《${selected.title}》${section?.label ? ` ${section.label}` : ''}`
    setDraft((current) => (current ? `${current}\n${cite}：` : `${cite}：`))
  }

  /** 「下载」按钮下拉：原文 PDF / 当前章节导出。两路复用同一个 download-url 接口；
   *  「导出当前章节」只是把章节正文 + 元信息拼成 markdown 触发下载，避免后端没接口时硬造。 */
  /**
   * `?doc=<id>` —— 从别处（发起弹窗的「办理依据 → 查阅」）**直达某份规章**。
   *
   * ⚠️ 与列表的关系必须写清：`document_id` 来自 AI 服务的规章匹配，命中的文档**不一定在当前筛选**
   *（默认 `validity=current`、未选分类，而列表只回 20 条），所以**不能**指望它在 `documents` 里。
   * 正确做法是直接按 id 取详情（与用户点卡片走同一条 `getKnowledgeDocument`），
   * 阅读面板照常右滑出现 —— 这就是「查阅」该有的行为。
   * 条件写在 `selected === null` 上：用户在页内点了别的文档后，不再被 URL 反复拽回去。
   * 消费完把参数清掉（`replace`），否则刷新 / 返回时会重放这次跳转。
   */
  useEffect(() => {
    const docId = params.get('doc')
    if (!docId || selected) return
    let cancelled = false
    getKnowledgeDocument(docId)
      .then(({ data }) => {
        if (cancelled || !data.data) return
        setSelected(data.data)
        if (typeof window !== 'undefined' && window.innerWidth <= 1180) {
          window.requestAnimationFrame(() => document.getElementById('knowledge-reader')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
        }
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) navigate('/knowledge', { replace: true }) })
    return () => { cancelled = true }
  }, [params, selected, navigate])

  const handleDownloadPdf = async () => {
    setDownloadMenuOpen(false)
    if (selectedId === undefined) return
    setReaderMessage('正在获取原件地址…')
    try {
      const { data } = await getKnowledgeDownloadUrl(selectedId)
      const url = data.data.download_url
      if (!url) throw new Error('download url missing')
      setReaderMessage('')
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      setReaderMessage('原件下载地址获取失败')
    }
  }
  const handleDownloadSection = () => {
    setDownloadMenuOpen(false)
    if (!selected || !section) return
    const lines = [
      `# 《${selected.title}》${selected.document_no ? `（${selected.document_no}）` : ''}`,
      '',
      `## ${[section.label, section.title].filter(Boolean).join('　') || '条款正文'}`,
      '',
      ...splitParagraphs(section.content),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selected.title}-${section.label || section.id}.md`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const quickPrompts = useMemo(() => (selected ? quickPromptsFor(selected) : QUICK_PROMPTS.default), [selected])

  /** 下载菜单：点面板外或按 Esc 关闭（原生下拉的惯例行为）。 */
  useEffect(() => {
    if (!downloadMenuOpen) return
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target?.closest('.kb-download-wrap')) setDownloadMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setDownloadMenuOpen(false) }
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [downloadMenuOpen])

  /** 章节横向滚动是否溢出：只在溢出时给右缘加渐隐遮罩，否则按钮右边会被无谓地淡化。 */
  const chapterTabsRef = useRef<HTMLDivElement | null>(null)
  const [chapterOverflow, setChapterOverflow] = useState(false)
  useEffect(() => {
    const el = chapterTabsRef.current
    if (!el) return
    const check = () => setChapterOverflow(el.scrollWidth > el.clientWidth + 2)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [chapters])

  return (
    <section className="page wide-page knowledge-page">
      {/* 全站页头：紧凑化（knowledge.css 单独压一档 padding 与 margin）。 */}
      <PageTitle
        eyebrow="KNOWLEDGE LIBRARY"
        title="校园资料阅览室"
        description="集中查阅校规与办事指南，按主题筛选并对照章节、签章与时效。"
      />

      <div
        className={`knowledge-layout${focusMode ? ' reader-focused' : ''}`}
        style={
          focusMode || !layoutWidths
            ? undefined
            : { ['--kb-left-w' as string]: `${layoutWidths.left}px`, ['--kb-right-w' as string]: `${layoutWidths.right}px` }
        }
      >
        {/* 左栏：主题分类 + 时效凭证 + 多智能体协同（专注阅读模式下整体隐藏） */}
        <aside className="kb-rail" aria-hidden={focusMode}>
          <div className="kb-panel">
            <div className="kb-panel-head">
              <h3>主题分类</h3>
              <span className="kb-count">{totalDocs} 部</span>
            </div>
            {/* 全部 = 独立分段控件入口，与下面分类拉开层级（用户 09-13 反馈）。
                「全部校规与指南」不再混进 list，避免和具体分类读起来一样平。 */}
            <div className="kb-cat-all">
              <button
                type="button"
                className={categoryId === undefined ? 'active' : ''}
                onClick={() => setCategoryId(undefined)}
                title="查看全部分类下的规章"
              >
                <FolderOpen size={15} />
                <span>全部校规与指南</span>
                <em>{totalDocs}</em>
              </button>
            </div>
            <nav className="kb-cat-list" aria-label="主题分类">
              {categories.map((item) => {
                const Icon = categoryIcon(item.name)
                return (
                  <button
                    type="button"
                    className={String(categoryId) === String(item.id) ? 'active' : ''}
                    key={item.id}
                    onClick={() => setCategoryId(item.id)}
                  >
                    <Icon size={15} />
                    <span className="kb-cat-name">{item.name}</span>
                    <span className="kb-cat-count">{item.document_count}</span>
                  </button>
                )
              })}
            </nav>
          </div>

          <div className="kb-panel kb-trust">
            <div className="kb-trust-head">
              <span className="kb-trust-icon"><ShieldCheck size={18} /></span>
              <strong>时效性与溯源机制</strong>
            </div>
            <p>现行公文由校办机要室数字签名验真，版本修订后同步更新多智能体向量索引库。</p>
            {indexUpdated ? (
              <div className="kb-trust-foot">
                <i />
                <span>索引更新</span>
                <b>{indexUpdated}</b>
              </div>
            ) : null}
          </div>

          <div className="kb-agent">
            <div className="kb-agent-head">
              <span>Multi-Agent Link</span>
              <Sparkles size={15} />
            </div>
            <p>在浏览任意条款时，可就此条款直接向对应业务智能体提问，由智能体带回溯源依据。</p>
            <div className="kb-agent-foot">
              <ShieldCheck size={14} />
              <span>全库支持公文溯源链</span>
            </div>
          </div>
        </aside>

        {!focusMode ? (
          <div
            className="kb-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="拖拽调整主题分类栏宽度"
            onPointerDown={onResizerPointerDown('left')}
          >
            <GripVertical size={12} />
          </div>
        ) : null}

        {/* 中栏：条目阅览流（承托板 = 毛玻璃） */}
        <div className="document-list-panel">
          <div className="knowledge-filter-panel">
            <div className="kb-filter-row">
              {/* 胶囊 → 分段控件（用户 09-13 反馈）：选中态与普通态对比更强，
                  数字与文字固定宽度，count 变化不会让相邻按钮位移。 */}
              <div className="kb-segmented">
                {VALIDITY_ORDER.map((item) => (
                  <button
                    type="button"
                    key={item}
                    className={validity === item ? 'active' : ''}
                    onClick={() => setValidity(item)}
                    aria-pressed={validity === item}
                    title={`仅看「${badgeOf(item).label}」的规章`}
                  >
                    <span>{badgeOf(item).short}</span>
                    <em>{typeof counts[item] === 'number' ? counts[item] : '—'}</em>
                  </button>
                ))}
              </div>
              <SearchField value={query} onChange={setQuery} placeholder="搜索规章标题、文号或关键词" />
            </div>
            <div className="kb-sort-row">
              <span>排序：<b>发文日期最新</b></span>
              <span>当前结果 {documents.length} 条</span>
            </div>
          </div>

          {loading ? (
            <div className="empty-results"><p>正在读取知识库...</p></div>
          ) : error ? (
            <div className="empty-results"><FileQuestion size={34} /><h3>知识库暂时无法加载</h3><p>{error}</p></div>
          ) : documents.length ? (
            documents.map((doc) => {
              const badge = badgeOf(doc.validity)
              return (
                <article
                  key={doc.id}
                  className={`document-card${selected?.id === doc.id ? ' selected' : ''}${String(doc.validity).toLowerCase() === 'archive' ? ' kb-archived' : ''}`}
                  onClick={() => openDocument(doc)}
                >
                  <div className="kb-card-top">
                    <div className="kb-card-badges">
                      <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                    </div>
                    <span className="kb-doc-no">{doc.document_no || '文号待返回'}</span>
                  </div>
                  <h2>{doc.title}</h2>
                  <p className="kb-card-meta">{docMeta(doc) || '文档元信息待返回'}</p>
                  {/* 整张卡片已经可点进精读，底部只保留「向智能体提问」，
                      避免「查看条款」和卡片整体可点的重复动作（用户 09-13 反馈）。
                      右侧只放一个弱提示，不再重复源分类名（那已经在 .kb-card-meta 里了）。 */}
                  <div className="document-actions">
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); ask(docQuestion(doc)) }}
                    >
                      <MessageCircle size={15} />向智能体提问
                    </button>
                    <span className="kb-card-enter">进入精读 <ChevronRight size={13} /></span>
                  </div>
                </article>
              )
            })
          ) : (
            <div className="empty-results">
              <FileQuestion size={34} />
              <h3>未找到匹配的规章</h3>
              <p>请尝试缩短关键词或切换规章分类。</p>
            </div>
          )}
        </div>

        <div
          className="kb-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调整精读面板宽度"
          onPointerDown={onResizerPointerDown('right')}
        >
          <GripVertical size={12} />
        </div>

        {/* 右栏：条款精读与验真（焦点玻璃 = 毛玻璃） */}
        <aside id="knowledge-reader" className={`reading-panel knowledge-reader${largeText ? ' large-text' : ''}${focusMode ? ' focus-mode' : ''}`}>
          {selected ? (
            <>
              <div className="kb-reader-head">
                <span className="kb-reader-icon"><FileText size={16} /></span>
                <span className="kb-reader-title">
                  <strong>条款精读与验真</strong>
                  {/* 来源路径：分类 / 文档标题，强化三栏之间的视觉关联（用户 09-13 反馈）。 */}
                  <small className="kb-source-path">{sourcePath(selected)}</small>
                </span>
                <div className="kb-reader-tools">
                  <button type="button" title="切换正文字号" aria-pressed={largeText} onClick={() => setLargeText((value) => !value)}>
                    <Type size={16} />
                  </button>
                  {/* 下载改为下拉菜单：原文 PDF / 导出当前章节（用户 09-13 反馈）。 */}
                  <div className="kb-download-wrap">
                    <button
                      type="button"
                      title="下载或导出"
                      aria-haspopup="menu"
                      aria-expanded={downloadMenuOpen}
                      onClick={() => setDownloadMenuOpen((value) => !value)}
                    >
                      <Download size={16} />
                      <ChevronDown size={12} />
                    </button>
                    {downloadMenuOpen ? (
                      <div className="kb-download-menu" role="menu" onClick={(event) => event.stopPropagation()}>
                        <button type="button" role="menuitem" onClick={handleDownloadPdf}>
                          <Download size={14} />下载盖章 PDF
                        </button>
                        <button type="button" role="menuitem" onClick={handleDownloadSection}>
                          <FileText size={14} />导出当前章节
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    title={focusMode ? '退出专注阅读' : '专注阅读'}
                    aria-pressed={focusMode}
                    onClick={() => setFocusMode((value) => !value)}
                  >
                    {focusMode ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
                  </button>
                </div>
              </div>

              {/* 文档元信息：把可见范围与数字签名放回这里，不挤进正文（用户 09-13 反馈）。 */}
              <div className="kb-doc-meta">
                <span className="kb-meta-chip kb-meta-visibility">可见范围 · {visibilityText(selected.visibility)}</span>
                <span className={`kb-meta-chip kb-meta-signature${selected.signature?.verified ? ' is-verified' : ' is-unverified'}`}>
                  {selected.signature?.verified ? <BadgeCheck size={13} /> : null}
                  {selected.signature?.verified
                    ? `数字签名校验：${selected.signature.algorithm || 'SHA-256'} 通过`
                    : selected.signature
                      ? '数字签名校验未通过'
                      : '签名信息待返回'}
                </span>
              </div>

              <div className="kb-index">
                <span className="kb-index-title">
                  公文章节索引
                  {chapters.length
                    ? <em>第 {activeChapterIndex} / {chapters.length} 章 · {sections.length} 条</em>
                    : null}
                </span>
                {chaptersLoading ? (
                  <p className="muted">正在读取章节索引…</p>
                ) : chapters.length ? (
                  <>
                    {/* 章节横向滚动（用户 09-13 反馈）：避免多行堆叠打断阅读焦点；
                        当前章节固定高亮 + 顶部「第 X / N 章」计数。 */}
                    <div className={`kb-chapter-tabs${chapterOverflow ? ' is-scrollable' : ''}`} ref={chapterTabsRef}>
                      {chapters.map((chapter) => (
                        <button
                          type="button"
                          key={chapter.id}
                          className={String(activeChapter?.id) === String(chapter.id) ? 'active' : ''}
                          onClick={() => {
                            const first = (chapter.sections ?? [])[0]
                            if (first) setActiveSectionId(first.id)
                          }}
                          title={`${chapter.label || ''} ${chapter.title || ''}`}
                        >
                          {chapter.label} {chapter.title}
                          <em>{(chapter.sections ?? []).length} 条</em>
                        </button>
                      ))}
                    </div>
                    {(activeChapter?.sections ?? []).length > 1 ? (
                      <div className="kb-section-tabs">
                        {activeChapter?.sections?.map((entry) => (
                          <button
                            type="button"
                            key={entry.id}
                            className={String(activeSectionId) === String(entry.id) ? 'active' : ''}
                            onClick={() => setActiveSectionId(entry.id)}
                          >
                            {entry.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="muted">章节索引待返回。</p>
                )}
              </div>

              <div
                className="kb-read-body"
                ref={readerScrollRef}
                onScroll={(event) => { lastScrollTopRef.current = event.currentTarget.scrollTop }}
              >
                {sectionLoading ? (
                  <p className="muted">正在读取条款正文…</p>
                ) : section ? (
                  <div className="kb-clause">
                    {/* 章节标题层级：当前章节大标题 + 条号 + 条目标题分两行；正文行高与段间距加大。 */}
                    {activeChapter ? (
                      <p className="kb-clause-chapter">
                        <span>{activeChapter.label}</span>
                        <strong>{activeChapter.title}</strong>
                      </p>
                    ) : null}
                    <h3 className="kb-clause-title">
                      <span className="kb-clause-no">{section.label || '条款'}</span>
                      <span>{section.title || '条款正文'}</span>
                    </h3>
                    <div className="kb-clause-body">
                      {highlightedParagraphs.map((paragraph) => (
                        <p key={paragraph.key}>
                          {paragraph.parts
                            ? paragraph.parts.map((part, partIndex) =>
                                part.hit
                                  ? <mark key={partIndex} className="kb-mark">{part.text}</mark>
                                  : <span key={partIndex}>{part.text}</span>,
                              )
                            : paragraph.text}
                        </p>
                      ))}
                    </div>
                    {section.signature_verified ? (
                      <div className="kb-verify">
                        <span><BadgeCheck size={14} />本条款已通过数字签名校验</span>
                        <em>{section.version ? `版本 ${section.version}` : '版本待返回'}</em>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="muted">正文请通过文档章节接口加载。</p>
                )}

                <p className="kb-read-foot">
                  发布 {formatDate(selected.published_at) || '待返回'}
                  {selected.effective_from ? ` · 生效 ${formatDate(selected.effective_from)}` : ''}
                  {typeof selected.citation_count === 'number' ? ` · 引用 ${selected.citation_count} 次` : ''}
                </p>
              </div>

              {/* 提问舱：增加上下文提示「基于《XX》提问」+ 3 个快捷问题（用户 09-13 反馈）。 */}
              <div className="kb-dock">
                <div className="kb-dock-context">
                  <Lightbulb size={13} />
                  <span>基于《{selected.title}》提问 · 由对应业务智能体应答</span>
                  {focusMode ? (
                    <button type="button" className="kb-exit-focus" onClick={() => setFocusMode(false)}>
                      <X size={13} />退出专注阅读
                    </button>
                  ) : null}
                </div>
                <div className="kb-quick-prompts">
                  {quickPrompts.map((prompt) => (
                    <button type="button" key={prompt} onClick={() => setDraft((current) => (current ? `${current} ${prompt}` : prompt))}>
                      <Sparkles size={12} />{prompt}
                    </button>
                  ))}
                </div>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={`针对《${selected.title}》进一步提问，例如：这一条对我在读年级适用吗？`}
                  rows={2}
                />
                <div className="kb-dock-bar">
                  <button type="button" title="引用当前条款" onClick={quoteClause}><Quote size={15} /></button>
                  <span className="kb-dock-hint">回车直达问答</span>
                  <button type="button" className="kb-send" disabled={!draft.trim()} onClick={() => ask(draft)}>
                    向智能体提问 <Send size={14} />
                  </button>
                </div>
              </div>

              {readerMessage ? <p className="muted kb-reader-message">{readerMessage}</p> : null}
            </>
          ) : (
            <div className="empty-results"><Search size={30} /><h3>请选择一份文档</h3></div>
          )}
        </aside>
      </div>
    </section>
  )
}