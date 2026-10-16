import { useSyncExternalStore } from 'react'

/**
 * 工作区选择（09-17）：全局会话级状态——主页选定后，新建对话、来回切页都保留，
 * 只有手动点 × 或重选才变更。localStorage 持久化，与 askMode / permissionMode 同一模式。
 * 存的是文件夹名（浏览器拿不到绝对路径），随提问以 workspace_path 字段发给后端。
 */
const STORAGE_KEY = 'campusflow_workspace'

const read = (): string => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

let current: string = read()
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const setWorkspace = (path: string) => {
  current = path
  try {
    localStorage.setItem(STORAGE_KEY, path)
  } catch {
    /* 隐私模式下写不了，内存里生效即可 */
  }
  listeners.forEach((listener) => listener())
}

export const getWorkspace = () => current

export const useWorkspace = () => useSyncExternalStore(subscribe, getWorkspace, getWorkspace)
