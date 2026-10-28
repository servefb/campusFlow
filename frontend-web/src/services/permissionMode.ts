import { useSyncExternalStore } from 'react'

/**
 * 权限控制（09-17 新增）：参照 ChatGPT 的批准方式选择器，三档：
 * - ask  = 请求批准（默认）：敏感操作每次都询问
 * - auto = 帮我批准：仅对检测到的风险操作请求批准
 * - full = 完全访问权限：不受限制（高风险档，入口与选中项都用警示红）
 * localStorage 持久化，两页共享；随每次提问以 `permission_mode` 传给后端，
 * 后端按档位生成 deepagents 的文件读写权限规则（见后端 src/agent/permissions.py）。
 */
export type PermissionMode = 'ask' | 'auto' | 'full'

const STORAGE_KEY = 'campusflow_permission_mode'

const read = (): PermissionMode => {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'auto' || value === 'full' ? value : 'ask'
  } catch {
    return 'ask'
  }
}

let current: PermissionMode = read()
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const setPermissionMode = (mode: PermissionMode) => {
  current = mode
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* 隐私模式下写不了，内存里生效即可 */
  }
  listeners.forEach((listener) => listener())
}

export const getPermissionMode = () => current

export const usePermissionMode = () => useSyncExternalStore(subscribe, getPermissionMode, getPermissionMode)
