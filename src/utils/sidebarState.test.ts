import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SIDEBAR_OPEN_KEY, readSidebarOpen, writeSidebarOpen } from './sidebarState'

/**
 * 侧边栏开关的持久化契约。它现在被**两个页面**共用（问助手页 / 会话页），
 * 所以只有 '1' 算展开 —— 其它任何值（'0'、空串、没这个键）都等价于收起。
 */
const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    },
  })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('sidebarState', () => {
  it('默认收起：键不存在时读到 false', () => {
    expect(store.has(SIDEBAR_OPEN_KEY)).toBe(false)
    expect(readSidebarOpen()).toBe(false)
  })

  it('展开写 1、收起直接删键，不留 "0" 当噪声', () => {
    writeSidebarOpen(true)
    expect(store.get(SIDEBAR_OPEN_KEY)).toBe('1')
    expect(readSidebarOpen()).toBe(true)

    writeSidebarOpen(false)
    expect(store.has(SIDEBAR_OPEN_KEY)).toBe(false)
    expect(readSidebarOpen()).toBe(false)
  })

  it('只有 "1" 算展开：历史遗留的 "0" / 空串都当收起', () => {
    store.set(SIDEBAR_OPEN_KEY, '0')
    expect(readSidebarOpen()).toBe(false)
    store.set(SIDEBAR_OPEN_KEY, '')
    expect(readSidebarOpen()).toBe(false)
  })

  it('存储不可用时静默降级：读成 false、写不抛异常', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        get localStorage(): never {
          throw new Error('blocked')
        },
      },
    })
    expect(readSidebarOpen()).toBe(false)
    expect(() => writeSidebarOpen(true)).not.toThrow()
  })
})
