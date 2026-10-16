import { useSyncExternalStore } from 'react'

/**
 * 提问模式（09-16 新增）：chat = 纯对话，agent = 交给主智能体（`Campus Flow`）处理。
 * 只影响前端展示与请求字段：chat 档下输入框页脚的「工作区选择 / 权限控制」不可用，
 * 请求体带 mode 告诉后端。（原页头那行「当前调度：…」09-23 已整体撤掉，不再是它的用途。）
 * 用模块级小 store + localStorage：两页（问助手 / 对话页）共享同一个值，切换即时同步。
 */
export type AskMode = 'chat' | 'agent'

const STORAGE_KEY = 'campusflow_ask_mode'

const read = (): AskMode => {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'chat' ? 'chat' : 'agent'
  } catch {
    return 'agent'
  }
}

let current: AskMode = read()
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const setAskMode = (mode: AskMode) => {
  current = mode
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* 隐私模式下写不了，内存里生效即可 */
  }
  listeners.forEach((listener) => listener())
}

export const getAskMode = () => current

export const useAskMode = () => useSyncExternalStore(subscribe, getAskMode, getAskMode)
