/**
 * CampusFlow Console —— 设计令牌（TS 镜像）
 * CSS 变量是运行时真源（`styles/base.css` 的 `:root`），这里只给需要在 TS 里取值的场景。
 * 改任一处分值时必须两边一起改。
 *
 * 视觉语言：**清爽的校园工作空间**（Quiet Campus Workspace）
 *   页面底色 #F7F8F5 · 内容表面 #FFFFFF · 主文字 #202722 · 次要文字 #727C75
 *   主色（低饱和松绿）#356B56 · 浅色强调底 #EAF1EC · 分隔线 #E3E8E2
 *   橙 / 红只给「需要关注 / 异常」。
 *
 * 三条硬规则（改样式前先读）：
 *  1. 层级靠**留白 + 1px 细线 + 一点点明度差**表达；阴影只用来表示"浮起"。
 *  2. 松绿是唯一主色，只用于主要按钮、选中状态、关键操作；红只用于风险与异常。
 *  3. 所有数字 / 时间戳 / 编号必须 tabular-nums；台账、规则、接口标签用 JetBrains Mono。
 */

/** 装帧层（侧栏 / 顶栏）—— 浅色，与画布同族、更亮，靠一条 hairline 分栏。 */
export const sidebar = {
  base: '#ffffff',
  deep: '#fafbf9',
  line: '#e3e8e2',
  ink: '#202722',
  text: '#5b655d',
  textDim: '#727c75',
  hover: 'rgba(53, 107, 86, 0.06)',
  active: '#eaf1ec',
} as const

export const colors = {
  /* 页面底色：暖白 */
  canvas: '#f7f8f5',
  canvasDeep: '#eef1ec',
  surface: '#ffffff',
  surfaceSubtle: '#fafbf9',
  surfaceMuted: '#f1f4ef',
  surfaceSunken: '#e7ece5',
  border: '#e3e8e2',
  borderStrong: '#ccd6cd',
  borderHair: '#eef1ec',

  ink: '#202722',
  inkHover: '#2b332c',
  inkActive: '#141a15',
  inkSecondary: '#333c35',
  text: '#5b655d',
  textMuted: '#727c75',

  /* 主色：低饱和松绿 —— 主要按钮 / 选中状态 / 关键操作 */
  brand: '#356b56',
  brandHover: '#2c5a48',
  brandDeep: '#24493b',
  brandSoft: '#eaf1ec',
  brandBorder: '#cfe0d5',
  brandTint: '#f3f8f4',

  /* 注意（橙） */
  amber: '#c07a12',
  amberSoft: '#fdf6e8',
  amberBorder: '#ecdcb6',
  amberText: '#8a5a08',

  /* 异常 / 风险（红）—— 出现即代表需要注意 */
  danger: '#c0453a',
  dangerHover: '#a73a30',
  dangerSoft: '#fdf2f0',
  dangerBorder: '#f0cfc9',
  dangerText: '#8d2f26',

  /* 健康 / 通过：与主色同族，避免出现"第二套绿" */
  emerald: '#356b56',
  emeraldSoft: '#eaf1ec',
  emeraldBorder: '#cfe0d5',
  emeraldText: '#24493b',
} as const

/** 状态徽章的语义色：对应「健康 / 注意 / 风险 / 归档 / 中性强调」五态。 */
export type BadgeTone = 'coral' | 'emerald' | 'amber' | 'slate' | 'ink'

export const radii = {
  sm: '6px',
  DEFAULT: '8px',
  md: '8px',
  lg: '12px',
  xl: '12px',
} as const

export const elevation = {
  level1: '0 1px 2px rgba(32, 39, 34, 0.04)',
  level2: '0 2px 6px -2px rgba(32, 39, 34, 0.08), 0 10px 22px -14px rgba(32, 39, 34, 0.12)',
  level3: '0 24px 52px -26px rgba(32, 39, 34, 0.24), 0 8px 18px -14px rgba(32, 39, 34, 0.1)',
  veil: 'rgba(32, 39, 34, 0.32)',
} as const

/** 间距体系：8px 为基准。 */
export const spacing = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '24px',
  6: '32px',
  7: '40px',
} as const

/** 时间范围口径 —— 指标类接口统一用这个字面量，别自己拼字符串。 */
export const RANGE_OPTIONS = [
  { value: 'today', label: '今日实时' },
  { value: '7d', label: '最近 7 天' },
  { value: '30d', label: '最近 30 天' },
] as const

export type RangeValue = (typeof RANGE_OPTIONS)[number]['value']
