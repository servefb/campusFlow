import { create } from 'zustand'

/**
 * 数据源开关：mock（默认） / live（真实接口）。
 *
 * 为什么要有这一层：接口文档 18.1 明确记录了几个关键接口还没实现
 * （`PATCH /tasks/{id}/draft`、`/admin/metrics/trends` 的扩展字段等），
 * AI 服务没起来时 `/api/v2/*` 直接 502。没有开关的话，联调环境一半页面是空的，
 * 没法评审 UI。所以页面永远按「契约形状」渲染，数据从这一层取。
 *
 * 切到 live 后：mock 数据一律不参与，请求失败按空态 + 错误提示处理
 * （`@tanstack/react-query` 的 data 为 undefined），绝不回落到假数据 ——
 * 免得把「后端没返回」误判成「后端返回了 0」。
 */

export type DataMode = 'mock' | 'live'

const STORAGE_KEY = 'campusflow_admin_data_mode'

interface DataModeState {
  mode: DataMode
  setMode: (mode: DataMode) => void
  toggle: () => void
}

const readInitial = (): DataMode => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'live' || raw === 'mock') return raw
  } catch { /* 隐私模式下 localStorage 不可用，用默认值 */ }
  return 'mock'
}

export const useDataModeStore = create<DataModeState>((set, get) => ({
  mode: readInitial(),
  setMode: (mode) => {
    try { localStorage.setItem(STORAGE_KEY, mode) } catch { /* ignore */ }
    set({ mode })
  },
  toggle: () => get().setMode(get().mode === 'mock' ? 'live' : 'mock'),
}))

/** 供 service 层做分支：`if (isMock()) return mockXxx()`。 */
export const isMock = () => useDataModeStore.getState().mode === 'mock'

/** 模拟网络延迟，让加载态/骨架屏在评审时也看得见。 */
export const mockDelay = (ms = 260) => new Promise<void>((resolve) => setTimeout(resolve, ms))
