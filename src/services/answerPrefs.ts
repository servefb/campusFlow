import { useSyncExternalStore } from 'react'

/**
 * 自定义参数（09-19 新增）：输入框页脚「自定义参数」按钮的弹层状态，两页共享、localStorage 持久化。
 * 随提问作为接口真字段发送（09-19 起契约有 answer_style / thinking_level，见接口文档 §8.2）：
 * 非默认值时由 buildAnswerPrefsPayload() 带上字段 —— 气泡回显、标题截断始终用用户原文。
 */
export type AnswerStyle = 'concise' | 'balanced' | 'detailed'
export type ThinkingLevel = 'off' | 'low' | 'high' | 'max'

export const ANSWER_STYLE_DEFAULT: AnswerStyle = 'balanced'
export const THINKING_LEVEL_DEFAULT: ThinkingLevel = 'off'

const STYLE_STORAGE_KEY = 'campusflow_answer_style'
const THINKING_STORAGE_KEY = 'campusflow_thinking_level'

const STYLE_VALUES: AnswerStyle[] = ['concise', 'balanced', 'detailed']
const THINKING_VALUES: ThinkingLevel[] = ['off', 'low', 'high', 'max']

const readStored = <T extends string>(key: string, allowed: T[], fallback: T): T => {
  try {
    const value = localStorage.getItem(key)
    return allowed.includes(value as T) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

/* —— 回答偏好（风格） —— */

let currentStyle: AnswerStyle = readStored(STYLE_STORAGE_KEY, STYLE_VALUES, ANSWER_STYLE_DEFAULT)
const styleListeners = new Set<() => void>()

const subscribeStyle = (listener: () => void) => {
  styleListeners.add(listener)
  return () => styleListeners.delete(listener)
}

export const setAnswerStyle = (style: AnswerStyle) => {
  currentStyle = style
  try {
    localStorage.setItem(STYLE_STORAGE_KEY, style)
  } catch {
    /* 隐私模式下写不了，内存里生效即可 */
  }
  styleListeners.forEach((listener) => listener())
}

export const getAnswerStyle = () => currentStyle
export const useAnswerStyle = () => useSyncExternalStore(subscribeStyle, getAnswerStyle, getAnswerStyle)

/* —— 深度思考等级 —— */

let currentThinking: ThinkingLevel = readStored(THINKING_STORAGE_KEY, THINKING_VALUES, THINKING_LEVEL_DEFAULT)
const thinkingListeners = new Set<() => void>()

const subscribeThinking = (listener: () => void) => {
  thinkingListeners.add(listener)
  return () => thinkingListeners.delete(listener)
}

export const setThinkingLevel = (level: ThinkingLevel) => {
  currentThinking = level
  try {
    localStorage.setItem(THINKING_STORAGE_KEY, level)
  } catch {
    /* 隐私模式下写不了，内存里生效即可 */
  }
  thinkingListeners.forEach((listener) => listener())
}

export const getThinkingLevel = () => currentThinking
export const useThinkingLevel = () =>
  useSyncExternalStore(subscribeThinking, getThinkingLevel, getThinkingLevel)

/* —— 发送侧：当前取值（09-19 起走接口真字段，不再拼 content） —— */

/**
 * 组装请求体里的自定义参数字段（发送前调用）。
 * 全默认时返回空对象（缺省语义由后端兜底：balanced / off）；
 * 只在非默认时带字段，减小后端兼容面。气泡回显与标题截断用原文，与本函数无关。
 */
export const buildAnswerPrefsPayload = (): { answer_style?: AnswerStyle; thinking_level?: ThinkingLevel } => {
  const payload: { answer_style?: AnswerStyle; thinking_level?: ThinkingLevel } = {}
  if (currentStyle !== ANSWER_STYLE_DEFAULT) payload.answer_style = currentStyle
  if (currentThinking !== THINKING_LEVEL_DEFAULT) payload.thinking_level = currentThinking
  return payload
}
