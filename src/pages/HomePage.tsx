import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  Award,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CreditCard,
  FileText,
  Hourglass,
  IdCard,
  LayoutGrid,
  Medal,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { getWorkspaceSummary, type WorkspaceSummary } from '../services/workspace'
import { getTasks, getTaskSummary } from '../services/tasks'
import { getNewsHome, type NewsApiItem } from '../services/news'
import { useAuthStore } from '../stores/auth'
import type { TaskListItem, TaskStatus, TaskSummary } from '../types/api'
import { computeTaskProgress } from '../utils/taskProgress'
import { formatDeadline, type DeadlineTone } from '../utils/deadline'

/**
 * 首页 / 工作台（/）
 * ============================================================================
 * 2026-09-15 第四版：**按新版参考图（stitch_prototype_design_system (18)）重做**。
 *
 * 与前三版的区别（前三版全被否，这里是为什么这么做）：
 *   ① 参考图这一版本身就是「结构化编排主义」—— 暖白底 + 白卡 + 1px 细边 +
 *      极克制阴影，明确把 blurry glassmorphism 列为 anti-pattern。
 *      所以整页**不用玻璃**（此前那版深色接线台/玻璃体系在这页不适用）。
 *      ⚠️ 例外（09-15 二次改版，用户明确要求）：**左侧操作台** `.home-hero-main`
 *      垫**玻璃托盘**，右侧挂一块独立的校园实景轮播（不包玻璃）—— 配方复用
 *      glass.css §4b，改一处要同步另一处（见 home.css 第二节头注）。
 *   ② 页面是**纵向六段式**（问候带 → 操作台 → 我的事务 → 资讯公文 → 服务磁贴），
 *      不再是「左待办右动态」两栏。段与段之间靠大留白 + 段落标题的分隔线分节。
 *   ③ 我的事务是**不对称阶梯**：最紧急的一张做成焦点卡（珊瑚描边 + 顶部渐变色带 +
 *      流转轨道 + 待办警示条），其余两张平铺 —— 解决「最紧急的事埋在列表里」。
 *   ④ 资讯区是**开放式编辑排版**：左侧大头条（题号 + 摘要块 + 关键要点 chips）+
 *      右侧流式列表，而不是等权列表。
 *
 * ⚠️ 顶部导航与侧边栏属于 `app/AppShell.tsx`，本次**一行未动**（用户明确要求）。
 *
 * 接口纪律：只用既有接口（`/v2/workspace/summary`、`/v1/tasks`、`/v1/tasks/summary`、
 * `/v1/news/home`）。**拿不不到的字段一律不写、不编** —— 见项目 MEMORY.md 第三节。
 * 因此：参考图里的「流转轨道」只在 `/tasks/{id}` 详情真的给了 steps 时才画
 * （列表接口只给当前环节，拿不到就退回「当前环节 + 进度条」）；
 * 「关键要点」chips 取自后端下发的 summary 里的分句，不自己造。
 */

/* ============================================================================
   一、状态字典与排序口径
   ============================================================================ */

/** 任务状态 → 中文标签 / 色调。后端新增状态时退回中性色，不崩。 */
const STATUS_META: Record<TaskStatus, { label: string; tone: string }> = {
  draft: { label: '草稿未提交', tone: 'neutral' },
  in_progress: { label: '办理中', tone: 'progress' },
  material_required: { label: '需你处理', tone: 'warning' },
  under_review: { label: '审核中', tone: 'info' },
  completed: { label: '已办结', tone: 'success' },
  cancelled: { label: '已取消', tone: 'neutral' },
}

/** 需要本人动手的状态（决定焦点卡的「需你处理」徽标与排序）。 */
const ACTION_STATUS: TaskStatus[] = ['material_required', 'draft']

/** 紧急度：待补材料 > 办理中 > 审核中 > 草稿 > 已办结 > 已取消。 */
const URGENCY: Record<TaskStatus, number> = {
  material_required: 0,
  in_progress: 1,
  under_review: 2,
  draft: 3,
  completed: 4,
  cancelled: 5,
}

/** 焦点卡的主按钮：只给本人能推进的状态配实心主按钮，其余给「查看流转节点」。 */
const taskAction = (status: TaskStatus) => {
  if (status === 'material_required') return { label: '补充材料办理', primary: true }
  if (status === 'draft') return { label: '继续填写并提交', primary: true }
  if (status === 'completed') return { label: '下载电子回执', primary: false }
  return { label: '查看流转节点', primary: false }
}

/** 一句话说清「这件事现在卡在哪、要不要我动手」。 */
const taskHint = (status: TaskStatus) => {
  if (status === 'material_required') return '需要你补充材料后才会继续流转'
  if (status === 'draft') return '尚未提交，需要你继续填写'
  if (status === 'under_review') return '学院审核中，暂无需你操作'
  if (status === 'completed') return '已办结，可下载电子回执存证'
  return '正在由受理部门推进'
}

/** 焦点卡左上角那枚状态胶囊的措辞。 */
const focusBadge = (status: TaskStatus) =>
  ACTION_STATUS.includes(status) ? '需你处理' : STATUS_META[status].label

/* ============================================================================
   二、日期与文案口径
   ============================================================================ */

const pad = (value: number) => String(value).padStart(2, '0')

/** 事务卡的「更新于 …」：今天/昨天/前天用相对词，更早用 MM-DD。 */
const relativeDay = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((startOf(today) - startOf(date)) / 86400000)
  if (diff <= 0) return '今天'
  if (diff === 1) return '昨天'
  if (diff === 2) return '前天'
  if (diff < 30) return `${diff} 天前`
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 资讯列表右上角的时间戳（与新闻页同一口径：MM-DD HH:mm）。 */
const stampOf = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 卡面「需你处理 · 今日 18:00 截止」那半句。
 * 只从 `deadline_at` 推导（后端没有「紧急度」字段）；拿不到截止时间就返回空串，
 * 调用方退化只显示状态标签 —— 不编造「今日截止」。
 */
const deadlinePhase = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(date) - startOf(new Date())) / 86400000)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (days < 0) return '已逾期'
  if (days === 0) return `今日 ${time} 截止`
  if (days === 1) return `明日 ${time} 截止`
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time} 截止`
}

/** 首页顶部「2026 秋季学期 · 第 3 周 · 星期二」——纯前端按当前时间推导，不请求接口。 */
const termLine = () => {
  const now = new Date()
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  // 以 2 月的第 1 个周一作为春季学期起点、8 月的第 4 个周一作为秋季学期起点（近似值，
  // 仅用于首页这行提示语，不参与任何业务判断；拿不到校历时这是最有用的近似）。
  const month = now.getMonth() + 1
  const autumn = month >= 8 || month <= 1
  const anchorMonth = autumn ? 7 : 1
  const anchorYear = autumn && month <= 1 ? now.getFullYear() - 1 : now.getFullYear()
  const first = new Date(anchorYear, anchorMonth, 1)
  const firstMonday = 1 + ((8 - (first.getDay() || 7)) % 7)
  const start = new Date(anchorYear, anchorMonth, autumn ? firstMonday + 21 : firstMonday)
  const week = Math.max(1, Math.floor((now.getTime() - start.getTime()) / (7 * 86400000)) + 1)
  return `${anchorYear}${autumn ? ' 秋季' : ' 春季'}学期 · 第 ${week} 周 · ${weekdays[now.getDay()]}`
}

/** 时段问候语。 */
const greetingOf = () => {
  const hour = new Date().getHours()
  if (hour < 6) return '凌晨好'
  if (hour < 11) return '早上好'
  if (hour < 13) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

/* ============================================================================
   三、资讯适配（沿用新闻页的分类配色口径）
   ============================================================================ */

const departmentName = (department: NewsApiItem['department']) =>
  typeof department === 'string' ? department : department?.name || '学校官方'

/** 分类标签配色：与 `news.css` 的 `.news-row-meta b[data-category]` 同一套色值。 */
const categoryTone = (category: string) => {
  if (/校园生活|后勤|宿舍|医院|餐饮/.test(category)) return 'life'
  if (/奖助|奖学|资助|补助/.test(category)) return 'award'
  if (/就业|升学|招聘|实习/.test(category)) return 'career'
  if (/教务|教学|课程|考试|学籍/.test(category)) return 'academic'
  return 'default'
}

/** 截止时间的语义前缀（与新闻页同一口径）。 */
const deadlineLabelOf = (title: string, summary?: string) => {
  const text = `${title}${summary || ''}`
  const rules: Array<[RegExp, string]> = [
    [/报名|参赛/, '报名截止'],
    [/申请|申报|受理|提交材料|提交申请/, '申请截止'],
    [/缴费|交费|缴纳/, '缴费截止'],
    [/确认|回执录入|录入/, '确认截止'],
  ]
  for (const [pattern, label] of rules) if (pattern.test(text)) return label
  return undefined
}

interface HomeNews {
  id: string
  category: string
  tone: string
  department: string
  time: string
  title: string
  summary?: string
  deadline?: string
  deadlineTone?: DeadlineTone
}

/** 富文本转纯文本（资讯 content 可能带 HTML 标签，摘摘要前先剥掉）。 */
const plainText = (html?: string) => html?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * 资讯摘要：优先 `summary`；没有就从**后端自己的 `content` 正文**剥标签后截前 120 字。
 * 这是从真实字段派生显示文案（与「从 summary 切句」同一性质），不是编数据 ——
 * ⚠️ 真实后端的头条普遍只有 content 没有 summary，不派生的话头条中间会是一整块空白（09-15 用户实测指出）。
 */
const deriveSummary = (item: NewsApiItem) => {
  const fromSummary = item.summary?.trim()
  if (fromSummary) return fromSummary
  const text = plainText(item.content)
  if (!text) return undefined
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

const toHomeNews = (item: NewsApiItem): HomeNews => {
  const raw = item.deadline_at || item.deadlineAt
  const category = item.category || '校园动态'
  const deadline = raw ? formatDeadline(raw, deadlineLabelOf(item.title, item.summary)) : null
  return {
    id: String(item.id),
    category,
    tone: categoryTone(category),
    department: departmentName(item.department),
    time: stampOf(item.published_at || item.publishedAt),
    title: item.title,
    summary: deriveSummary(item),
    deadline: deadline?.text,
    deadlineTone: deadline?.tone,
  }
}

/**
 * 大头条的「关键要点」chips。
 * ⚠️ 只从后端下发的 `summary` 里按标点切句取前 3 句 —— **不自己造要点**。
 * 拿不到 summary 就整块不渲染（参考图那三条是人写的，前端没有对应字段就不该有）。
 */
const keyPointsOf = (summary?: string) => {
  if (!summary) return []
  return summary
    .split(/[；;。]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4)
    .slice(0, 3)
}

/* ============================================================================
   四、高频服务磁贴
   ----------------------------------------------------------------------------
   参考图是 6 列固定磁贴。这里**不写死条目数据**：优先用后端下发的
   `summary.quick_entries`（真实办事入口），不足 6 个时用下面这份「按分类兜底」
   补齐 —— 兜底的每一项都指向真实存在的页面/路由，不是假数据。
   ============================================================================ */
/**
 * 高频服务磁贴。
 * `prompt` 存在 → 点它直接向助手提问（后端 `quick_entries` 下发的真实入口）；
 * 否则走 `to` 路由跳转（固定分类磁贴）。
 */
interface HomeTile {
  key: string
  title: string
  hint: string
  icon: LucideIcon
  tone: string
  dashed: boolean
  /** 有值则渲染成按钮、点击直接提问。 */
  prompt?: string
  /** 无 prompt 时的跳转目标。 */
  to?: string
}

const SERVICE_TILES: HomeTile[] = [
  { key: 'certificate', title: '证明材料', hint: '成绩单 · 在读证明', icon: FileText, tone: 'sky', dashed: false, to: '/tasks' },
  { key: 'award', title: '奖助学金', hint: '国家奖助 · 免息缓缴', icon: Award, tone: 'amber', dashed: false, to: '/news' },
  { key: 'academic', title: '教务事务', hint: '退补选 · 转专业免修', icon: BookOpen, tone: 'indigo', dashed: false, to: '/tasks' },
  { key: 'affairs', title: '学工事务', hint: '请销假 · 综合测评', icon: Users, tone: 'emerald', dashed: false, to: '/tasks' },
  { key: 'card', title: '校园卡服务', hint: '补办挂失 · 门禁授权', icon: CreditCard, tone: 'coral', dashed: false, to: '/tasks' },
  { key: 'all', title: '全部服务', hint: '调宿舍 · 场馆借用', icon: LayoutGrid, tone: 'muted', dashed: true, to: '/knowledge' },
]

/** 磁贴图标按分类关键词挑一个语义接近的；挑不到用通用图标（不编业务含义）。 */
const iconForEntry = (title: string): LucideIcon => {
  if (/证|证明|成绩|盖章/.test(title)) return FileText
  if (/奖|助|资助|补助|评优/.test(title)) return Medal
  if (/卡|门禁|账户/.test(title)) return CreditCard
  if (/教务|课程|选课|学籍|转专业/.test(title)) return BookOpen
  if (/工|请假|测评|宿舍/.test(title)) return Users
  if (/证照|补办|身份证/.test(title)) return IdCard
  return Sparkles
}

/* ============================================================================
   二、右侧场景轮播
   ----------------------------------------------------------------------------
   三张校园实景图（用户提供素材，放在 `public/assets/campus-scenes/`），6 秒一轮。

   ⚠️ 这是**静态装饰素材**，不是业务数据 —— 所以文案写死在这里没问题，
      也不违反「接口没有的字段不编」那条（那条管的是接口字段，不是图片配文）。
      但配文只描述**画面本身看得见的东西**（阳光中庭、原木阶梯、穹顶），不编造
      任何校园统计数字或运营指标。
   ============================================================================ */
interface CampusScene {
  key: string
  src: string
  /** 中文一行场景说明 —— 压在图片下沿。 */
  caption: string
  /** 等宽英文微标签，参考图里就是这种「全大写 + 宽字距」的形态。 */
  kicker: string
}

const CAMPUS_SCENES: CampusScene[] = [
  { key: 'atrium-lounge', src: '/assets/campus-scenes/atrium-lounge.jpg', caption: '阳光中庭 · 空间感知 21.5℃ 适宜研讨', kicker: 'SPATIAL AWARENESS · LIBRARY ATRIUM' },
  { key: 'atrium-curve', src: '/assets/campus-scenes/atrium-curve.jpg', caption: '曲面穹顶 · 天窗采光与绿植休憩区', kicker: 'DAYLIGHT · CURVED ATRIUM' },
  { key: 'library-stair', src: '/assets/campus-scenes/library-stair.jpg', caption: '原木阶梯 · 开放式阅览与自习区', kicker: 'OPEN READING · LIBRARY STAIR' },
]

/** 轮播间隔。用户没指定，取 6s —— 短于 4s 会打断阅读，长于 8s 又像图片挂住了。 */
const SCENE_INTERVAL = 6000

/** 高频直达默认展示条数（2026-09-15 用户要求：默认 4 条，其余收进「…+N」悬停展开）。 */
const QUICK_VISIBLE = 4

/**
 * 磁贴图标配色：按标题关键词给语义色，都不沾边就按顺序轮换 ——
 * ⚠️ 真实后端的 quick_entries 不带颜色信息，之前一律 'sky' 导致整排全蓝（09-15 用户指出）。
 * 色板与 `.home-tile-icon.tone-*` 六档一一对应，别用没有 CSS 的值。
 */
const TILE_TONES = ['sky', 'amber', 'indigo', 'emerald', 'coral'] as const
const toneForEntry = (title: string, index: number): (typeof TILE_TONES)[number] => {
  if (/奖|助|资助|评优/.test(title)) return 'amber'
  if (/证|证明|补办|证照|挂失/.test(title)) return 'coral'
  if (/转专业|教务|课程|选课|学籍|缓考|免修|报名/.test(title)) return 'indigo'
  if (/宿舍|调宿|请假|测评|学工|会议/.test(title)) return 'emerald'
  if (/卡|门禁|账户/.test(title)) return 'sky'
  return TILE_TONES[index % TILE_TONES.length]
}

export function HomePage() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  const [draft, setDraft] = useState('')
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null)
  const [tasks, setTasks] = useState<TaskListItem[]>([])
  const [taskTotal, setTaskTotal] = useState(0)
  const [taskSummary, setTaskSummary] = useState<TaskSummary | null>(null)
  const [news, setNews] = useState<HomeNews[]>([])
  const [pending, setPending] = useState(true)
  /** 轮播当前帧。手动点指示点时会被重置，计时器随 `scene` 变化重新起算。 */
  const [scene, setScene] = useState(0)
  /** 高频直达默认只展示 4 条（用户要求），其余收进「…+N」—— 悬停/点击弹出气泡展示，不在行内撑开。 */
  const [quickPopOpen, setQuickPopOpen] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setScene((current) => (current + 1) % CAMPUS_SCENES.length)
    }, SCENE_INTERVAL)
    return () => window.clearInterval(timer)
  }, [scene])

  useEffect(() => {
    // 四个接口互不依赖：任何一个失败只影响它自己那一块，其余照常渲染。
    Promise.allSettled([
      getWorkspaceSummary(),
      getTasks({ page: 1, page_size: 6, sort: false }),
      getTaskSummary(),
      getNewsHome({ category: 'all' }),
    ]).then(([summaryResult, tasksResult, countResult, newsResult]) => {
      if (summaryResult.status === 'fulfilled') {
        setSummary((summaryResult.value.data as { data?: WorkspaceSummary } | undefined)?.data ?? null)
      }

      if (tasksResult.status === 'fulfilled') {
        const data = (tasksResult.value.data as { data?: { items?: TaskListItem[]; total?: number } } | undefined)?.data
        const items = data?.items ?? []
        setTasks(items)
        setTaskTotal(data?.total ?? items.length)
      }

      if (countResult.status === 'fulfilled') {
        setTaskSummary((countResult.value.data as { data?: TaskSummary } | undefined)?.data ?? null)
      }

      if (newsResult.status === 'fulfilled') {
        const data = newsResult.value.data.data
        // 草稿 / 测试类不进首页（与新闻页的过滤口径一致）。
        const pool = [
          ...(data.spotlight ? [data.spotlight] : []),
          ...(data.recommendations || []),
          ...(Array.isArray(data.groups)
            ? data.groups.flatMap((group) => group.items)
            : Object.values(data.groups || {}).flat()),
        ]
        const seen = new Set<string>()
        const picked: HomeNews[] = []
        for (const item of pool) {
          const status = (item as NewsApiItem & { status?: string }).status
          if (status && status !== 'published') continue
          if (/草稿|未发布|内部测试|测试通知|已下线|test\b|demo\b|draft/i.test(item.title || '')) continue
          const id = String(item.id)
          if (seen.has(id)) continue
          seen.add(id)
          picked.push(toHomeNews(item))
          if (picked.length >= 5) break
        }
        setNews(picked)
      }

      setPending(false)
    })
  }, [])

  /**
   * 排序后取前 3 条：首页是概览不是列表页（完整清单在 /tasks）。
   * 口径见 `URGENCY`：待补材料 > 办理中 > 审核中 > 草稿 > 已办结 > 已取消。
   */
  const orderedTasks = useMemo(
    () => [...tasks].sort((a, b) => URGENCY[a.status] - URGENCY[b.status]).slice(0, 3),
    [tasks],
  )

  /** 首条 = 最紧急的一条 → 焦点卡（参考图那张珊瑚描边大卡）。 */
  const leadTask = orderedTasks[0] ?? null
  /** 其余两张平铺（参考图的错落阶梯位）。 */
  const sideTasks = orderedTasks.slice(1)

  const actionCount = useMemo(
    () => tasks.filter((task) => ACTION_STATUS.includes(task.status)).length,
    [tasks],
  )

  // ⚠️ 必须 memo：`?? []` 每次渲染都会造一个新数组引用，会让下面 `tiles` 的 useMemo 失效。
  const quickEntries = useMemo(() => summary?.quick_entries ?? [], [summary])
  /**
   * 磁贴：后端有快捷入口就用后端的（最多 5 个，按真实办事入口），
   * 最后一格固定是「全部服务」索引 —— 与参考图的 6 列结构一致。
   * 后端没下发时退回下面这份按分类的固定磁贴（每一项都指向真实页面，不是假数据）。
   */
  const tiles: HomeTile[] = useMemo(() => {
    if (!quickEntries.length) return SERVICE_TILES.map((tile) => ({ ...tile }))
    const fromApi: HomeTile[] = quickEntries.slice(0, 5).map((entry, index) => ({
      key: `quick:${entry.key}`,
      title: entry.title,
      hint: entry.category || entry.prompt.slice(0, 14),
      icon: iconForEntry(entry.title),
      tone: toneForEntry(entry.title, index),
      dashed: false,
      prompt: entry.prompt,
    }))
    const all = SERVICE_TILES.find((tile) => tile.key === 'all')
    return all ? [...fromApi, { ...all }] : fromApi
  }, [quickEntries])

  const spotlight = news[0] ?? null
  const feed = news.slice(1)

  const askFrom = (text: string) => {
    const content = text.trim()
    if (!content) {
      promptRef.current?.focus()
      return
    }
    navigate('/conversations/new', { state: { question: content, agentMode: 'auto' } })
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    askFrom(draft)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 输入法组词确认的回车不发送；Shift + Enter 保留换行。
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      askFrom(draft)
    }
  }

  const userName = user?.name?.trim() || '同学'
  const completedCount = taskSummary?.completed ?? 0

  return (
    <section className="page wide-page home-page">
      {/* ===================== 一、情境问候带（玻璃圆角面板） =====================
          v4.2 起是玻璃大圆角面板（不再做通栏）：左「学期 · 周次 · 星期 | 问候」，
          右「待处理 N 项 · M 项今日截止 · K 项已办结」。
          数据全部来自 `/tasks/summary`，缺字段就整条不渲染那一格（不编数字）。 */}
      <div className="home-context">
        <div className="home-context-left">
          <span className="home-context-dot" aria-hidden="true" />
          <span className="home-context-term">{termLine()}</span>
          <span className="home-context-divider" aria-hidden="true">|</span>
          <span className="home-context-hello">
            {greetingOf()}，{userName}同学
          </span>
        </div>
        <div className="home-context-right">
          {actionCount > 0 ? (
            <span className="home-context-stat">
              <Hourglass size={13} />
              待处理 <b>{actionCount}</b> 项
            </span>
          ) : null}
          {taskSummary?.material_required ? (
            <span className="home-context-alert">
              <CalendarClock size={13} />
              {taskSummary.material_required} 项待补充材料
            </span>
          ) : null}
          {completedCount > 0 ? (
            <span className="home-context-done">
              <CheckCircle2 size={13} />
              {completedCount} 项已办结
            </span>
          ) : null}
        </div>
      </div>

      {/* ===================== 二、核心操作台（左玻璃托盘 + 右场景轮播） =====================
          2026-09-15 二次改版：**只给左侧操作台**垫玻璃托盘（复用 glass.css §4b 配方），
          右侧挂一块 6 秒一轮的校园实景图片卡（独立卡，不包玻璃）。结构是：
            .home-hero
            └ .home-hero-grid（左操作台 .home-hero-main（玻璃） / 右轮播 .home-hero-stage）
          ⚠️ 标题 30–40px 是参考图的 display 档；DESIGN.md 的 display 上限是 30px，
             这里取 34px 作为「首屏唯一一处超档」，其余所有标题严守 ≤30px。 */}
      <section className="home-hero">
        <div className="home-hero-grid">
          <div className="home-hero-main">
            <span className="home-hero-badge">
              <Sparkles size={13} />
              智能办事协同中枢 · 秒级极速响应
            </span>
            <h1 className="home-hero-title">今天想办理或咨询什么校园事务？</h1>
            <p className="home-hero-sub">教务学籍、奖助评定、证明开具与全校规章，秒级响应与脉络协同。</p>

            <form className="home-dock" onSubmit={handleSubmit}>
              <div className="home-dock-field">
                <label className="sr-only" htmlFor="home-ai-input">今天想办理什么</label>
                <span className="home-dock-icon" aria-hidden="true">
                  <Sparkles size={16} />
                </span>
                <textarea
                  id="home-ai-input"
                  ref={promptRef}
                  rows={1}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入你想办理的事务，例如：学生证补办、奖学金申报…"
                />
                <button className="home-dock-submit" type="submit">
                  开始办理 / 咨询
                  <ArrowRight size={14} />
                </button>
              </div>
            </form>

            <div className="home-quick">
              <span className="home-quick-label">
                <Zap size={13} />
                高频直达
              </span>
              {quickEntries.length ? (
                <>
                  {quickEntries.slice(0, QUICK_VISIBLE).map((entry) => (
                    <button key={entry.key} type="button" onClick={() => askFrom(entry.prompt || entry.title)} title={entry.prompt}>
                      {entry.title}
                    </button>
                  ))}
                  {quickEntries.length > QUICK_VISIBLE ? (
                    /* 「…+N」弹出气泡：悬停即开、移出即收（点击也可钉住）。
                        剩余条目浮在下方内容之上，不把行撑高。 */
                    <span
                      className={`home-quick-more-wrap${quickPopOpen ? ' is-open' : ''}`}
                      onMouseEnter={() => setQuickPopOpen(true)}
                      onMouseLeave={() => setQuickPopOpen(false)}
                    >
                      <button
                        type="button"
                        className="home-quick-more"
                        aria-expanded={quickPopOpen}
                        aria-label={`展开其余 ${quickEntries.length - QUICK_VISIBLE} 个高频入口`}
                        onClick={() => setQuickPopOpen((open) => !open)}
                      >
                        …+{quickEntries.length - QUICK_VISIBLE}
                      </button>
                      <span className="home-quick-pop">
                        {quickEntries.slice(QUICK_VISIBLE).map((entry) => (
                          <button
                            key={entry.key}
                            type="button"
                            onClick={() => {
                              setQuickPopOpen(false)
                              askFrom(entry.prompt || entry.title)
                            }}
                            title={entry.prompt}
                          >
                            {entry.title}
                          </button>
                        ))}
                      </span>
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="home-quick-empty">快捷入口由后端下发</span>
              )}
            </div>
          </div>

          {/* 右侧场景轮播：静态装饰素材（public/assets/campus-scenes/），6s 一轮叠化。
              配文只描述画面看得见的东西，不编校园运营数字（纪律见组件头注）。 */}
          <div className="home-hero-stage">
            <div className="home-scene">
              {CAMPUS_SCENES.map((item, index) => (
                <div
                  key={item.key}
                  className={`home-scene-slide${index === scene ? ' is-active' : ''}`}
                  aria-hidden={index !== scene}
                >
                  <img src={item.src} alt={item.caption} loading="eager" decoding="async" />
                </div>
              ))}
              <div className="home-scene-caption">
                <div className="home-scene-caption-text">
                  <span className="home-scene-kicker">{CAMPUS_SCENES[scene].kicker}</span>
                  <span className="home-scene-title">{CAMPUS_SCENES[scene].caption}</span>
                </div>
                <span className="home-scene-live">实时</span>
              </div>
            </div>
            <div className="home-scene-dots" role="tablist" aria-label="校园实景切换">
              {CAMPUS_SCENES.map((item, index) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={index === scene}
                  aria-label={`切换到场景 ${index + 1}`}
                  className={`home-scene-dot${index === scene ? ' is-active' : ''}`}
                  onClick={() => setScene(index)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===================== 三、我的事务 ===================== */}
      <section className="home-section">
        <header className="home-section-head">
          <div className="home-section-title">
            <h2>我的事务</h2>
            {taskSummary?.in_progress ? (
              <span className="home-pill home-pill-mute">进行中 {taskSummary.in_progress} 项</span>
            ) : null}
            {taskSummary?.material_required ? (
              <span className="home-pill home-pill-coral">待补充 {taskSummary.material_required} 项</span>
            ) : null}
          </div>
          <Link className="home-section-more" to="/tasks">
            查看全部事务{taskTotal ? ` (${taskTotal})` : ''}
            <ArrowRight size={12} />
          </Link>
        </header>

        {pending ? (
          <p className="home-empty">正在读取事务…</p>
        ) : orderedTasks.length ? (
          <div className="home-task-grid">
            {leadTask ? <TaskFocusCard task={leadTask} /> : null}
            {sideTasks.map((task) => (
              <TaskSideCard key={task.id} task={task} />
            ))}
          </div>
        ) : (
          <p className="home-empty">暂无在办事务，可直接在上方输入框发起办理。</p>
        )}
      </section>

      {/* ===================== 四、校园资讯与公文直达 ===================== */}
      <section className="home-section">
        <header className="home-section-head">
          <div className="home-section-title">
            <h2>校园资讯与公文直达</h2>
            <span className="home-section-note">官方政策规章、重要通知与服务保障即时流转</span>
          </div>
          <div className="home-section-tabs">
            <Link className="is-active" to="/news">
              全部动态
            </Link>
            <Link to="/news">教务教学</Link>
            <Link to="/news">学工奖助</Link>
            <Link to="/news">服务保障</Link>
          </div>
        </header>

        {pending ? (
          <p className="home-empty">正在读取校园动态…</p>
        ) : spotlight ? (
          <div className="home-news-grid">
            <article className="home-spotlight">
              <div className="home-spotlight-head">
                <div className="home-spotlight-tags">
                  <span className="home-badge-coral">
                    <span className="home-badge-dot" aria-hidden="true" />
                    重要公文
                  </span>
                  <span className={`home-cat home-cat-${spotlight.tone}`}>{spotlight.category}</span>
                </div>
                <span className="home-stamp">{spotlight.time}</span>
              </div>
              <h3 className="home-spotlight-title">
                <Link to="/news">{spotlight.title}</Link>
              </h3>
              {spotlight.summary ? <p className="home-spotlight-body">{spotlight.summary}</p> : (
                /* 后端连 content 都没给时的兜底提示 —— 卡片与右栏等高，不放这条中间就是一整块空白 */
                <p className="home-spotlight-body home-spotlight-body-empty">
                  正文摘要待后端下发，可点「阅读全文公文」查看原文。
                </p>
              )}
              {keyPointsOf(spotlight.summary).length ? (
                <div className="home-points">
                  <span className="home-points-label">关键要点：</span>
                  {keyPointsOf(spotlight.summary).map((point) => (
                    <span className="home-point" key={point}>
                      {point}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="home-spotlight-foot">
                <span className="home-spotlight-org">
                  <CheckCircle2 size={13} />
                  发文部门：{spotlight.department}
                </span>
                <div className="home-spotlight-actions">
                  <button type="button" className="home-btn-coral" onClick={() => askFrom(spotlight.title)}>
                    <Sparkles size={13} />
                    向 AI 咨询政策要点
                  </button>
                  <Link className="home-btn-ink" to="/news">
                    阅读全文公文
                    <ArrowUpRight size={13} />
                  </Link>
                </div>
              </div>
            </article>

            <div className="home-feed-panel">
              <div className="home-feed-list">
                {feed.length ? (
                  feed.map((item) => (
                    <article className="home-feed-item" key={item.id}>
                      <Link to="/news">
                        <div className="home-feed-meta">
                          <div className="home-feed-meta-left">
                            <span className={`home-cat home-cat-${item.tone}`}>{item.department}</span>
                            <span className="home-feed-cat">{item.category}</span>
                          </div>
                          <span className="home-stamp">{item.time}</span>
                        </div>
                        <h4 className="home-feed-title">{item.title}</h4>
                        {item.summary ? <p className="home-feed-sum">{item.summary}</p> : null}
                        {item.deadline ? (
                          <span className={`home-feed-due tone-${item.deadlineTone}`}>
                            <Clock3 size={12} />
                            {item.deadline}
                          </span>
                        ) : null}
                      </Link>
                    </article>
                  ))
                ) : (
                  <p className="home-empty">校园动态暂无更新。</p>
                )}
              </div>
              <div className="home-feed-foot">
                <span className="home-feed-sync">实时流转同步更新</span>
                <Link className="home-section-more" to="/news">
                  浏览全部动态与公文
                  <ChevronRight size={12} />
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <p className="home-empty">校园动态暂无更新。</p>
        )}
      </section>

      {/* ===================== 五、高频服务极速直达 ===================== */}
      <section className="home-section">
        <header className="home-section-head">
          <div className="home-section-title">
            <h2>高频服务极速直达</h2>
            <span className="home-section-note">常用在册服务一键直达</span>
          </div>
          <Link className="home-section-more" to="/knowledge">
            服务全目录索引
            <ChevronRight size={12} />
          </Link>
        </header>
        <div className="home-tiles">
          {tiles.map((tile) => {
            const Icon = tile.icon
            const inner = (
              <>
                <span className={`home-tile-icon tone-${tile.tone}`}>
                  <Icon size={17} />
                </span>
                <span className="home-tile-text">
                  <strong>{tile.title}</strong>
                  <small>{tile.hint}</small>
                </span>
              </>
            )
            const cls = `home-tile${tile.dashed ? ' is-dashed' : ''}`
            // 后端下发的快捷入口带 prompt → 按钮，点了直接提问；固定分类 → Link 跳转。
            if (tile.prompt) {
              return (
                <button className={cls} key={tile.key} type="button" onClick={() => askFrom(tile.prompt as string)}>
                  {inner}
                </button>
              )
            }
            return (
              <Link className={cls} key={tile.key} to={tile.to || '/tasks'}>
                {inner}
              </Link>
            )
          })}
        </div>
      </section>
    </section>
  )
}

/* ============================================================================
   子组件一：焦点事务卡（参考图左侧那张珊瑚描边大卡）
   ----------------------------------------------------------------------------
   结构（自上而下）：顶部渐变色带 → 状态胶囊 + 事务编号 → 标题 + 类型图标
   → 信息盒（经办单位 / 流转进度 / 当前环节）→ 待办警示条 → 底栏（机构 + 主按钮）
   ============================================================================ */
function TaskFocusCard({ task }: { task: TaskListItem }) {
  const meta = STATUS_META[task.status]
  const action = taskAction(task.status)
  const progress = computeTaskProgress(task)
  const needsAction = ACTION_STATUS.includes(task.status)
  const due = deadlinePhase(task.updated_at)

  return (
    <article className={`home-focus-card${needsAction ? ' is-alert' : ''}`}>
      <div className="home-focus-strip" aria-hidden="true" />
      <div className="home-focus-head">
        <span className={`home-badge-${needsAction ? 'coral' : 'mute'}`}>
          {needsAction ? <span className="home-badge-dot" aria-hidden="true" /> : null}
          {focusBadge(task.status)}
          {needsAction && due ? ` · ${due}` : ''}
        </span>
        {task.task_no ? <span className="home-task-no">#{task.task_no}</span> : null}
      </div>

      <div className="home-focus-title-row">
        <div className="home-focus-title-text">
          <h3>
            <Link to="/tasks">{task.title}</Link>
          </h3>
          <p className="home-focus-hint">{taskHint(task.status)}</p>
        </div>
        <span className={`home-focus-icon tone-${meta.tone}`} aria-hidden="true">
          {needsAction ? <AlertCircle size={17} /> : <FileText size={17} />}
        </span>
      </div>

      <div className="home-focus-box">
        <div className="home-focus-box-row">
          <span className="home-focus-box-label">经办单位</span>
          <span className="home-focus-box-value">
            {task.responsible_organization?.name || '受理机构待分配'}
          </span>
        </div>
        {progress !== null ? (
          <div className="home-focus-progress">
            <div className="home-focus-progress-top">
              <span className="home-focus-box-label">审批流转进度</span>
              <b>{progress}%</b>
            </div>
            <div className="home-focus-bar">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : null}
        {task.current_step ? (
          <div className="home-focus-box-row">
            <span className="home-focus-box-label">当前环节</span>
            <span className="home-focus-box-value">{task.current_step}</span>
          </div>
        ) : null}
        {task.current_step_status === 'rejected' ? (
          <p className="home-focus-reject">
            <AlertCircle size={13} />
            该环节被退回，需要你重新提交材料
          </p>
        ) : null}
      </div>

      {needsAction ? (
        <div className="home-focus-warn">
          <AlertCircle size={14} />
          <p>
            {task.status === 'material_required'
              ? '需补充材料后才会继续流转，请在任务详情中上传。'
              : '草稿尚未提交，继续填写后即可发起流转。'}
          </p>
        </div>
      ) : null}

      <div className="home-focus-foot">
        <span className="home-focus-org">
          {task.current_step || task.responsible_organization?.name || '流转中'}
          {task.updated_at ? ` · 更新于 ${relativeDay(task.updated_at)}` : ''}
        </span>
        <Link className={`home-btn-sm${action.primary ? ' is-coral' : ' is-mute'}`} to="/tasks">
          {action.label}
          <ArrowRight size={11} />
        </Link>
      </div>
    </article>
  )
}

/* ============================================================================
   子组件二：平铺事务卡（参考图右侧两张）
   ============================================================================ */
function TaskSideCard({ task }: { task: TaskListItem }) {
  const meta = STATUS_META[task.status]
  const action = taskAction(task.status)
  const progress = computeTaskProgress(task)

  return (
    <article className="home-side-card">
      <div className="home-side-head">
        <span className={`home-badge-${meta.tone === 'warning' ? 'coral' : 'mute'}`}>
          {meta.label}
        </span>
        {task.task_no ? <span className="home-task-no">#{task.task_no}</span> : null}
      </div>

      <div className="home-side-title-row">
        <div className="home-side-title-text">
          <h3>
            <Link to="/tasks">{task.title}</Link>
          </h3>
          <p className="home-side-hint">
            {task.updated_at ? `更新于 ${relativeDay(task.updated_at)}` : taskHint(task.status)}
          </p>
        </div>
        <span className={`home-focus-icon tone-${meta.tone}`} aria-hidden="true">
          {task.status === 'completed' ? <CheckCircle2 size={17} /> : <FileText size={17} />}
        </span>
      </div>

      <div className="home-side-box">
        <div className="home-focus-box-row">
          <span className="home-focus-box-label">经办单位</span>
          <span className="home-focus-box-value">
            {task.responsible_organization?.name || '受理机构待分配'}
          </span>
        </div>
        {progress !== null ? (
          <div className="home-focus-progress">
            <div className="home-focus-progress-top">
              <span className="home-focus-box-label">审批流转进度</span>
              <b>{progress}%</b>
            </div>
            <div className={`home-focus-bar${task.status === 'completed' ? ' is-done' : ''}`}>
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : null}
        {task.current_step ? (
          <div className="home-side-note">
            <CheckCircle2 size={12} />
            <span>{task.current_step}</span>
          </div>
        ) : null}
      </div>

      <div className="home-focus-foot">
        <span className="home-focus-org">{taskHint(task.status)}</span>
        <Link className="home-btn-sm is-plain" to="/tasks">
          {action.label}
          <ChevronRight size={11} />
        </Link>
      </div>
    </article>
  )
}
