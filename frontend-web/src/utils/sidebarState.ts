import { useEffect, useState } from 'react'

/**
 * 「问助手侧边栏」展开状态的持久化键。
 *
 * 09-18 从 AssistantPage 挪到这里：侧边栏现在挂在**两个页面**
 * （问助手 /workspace 与 会话页 /conversations/:id），键必须只有一处定义 ——
 * 两边各抄一份，迟早会有一边改了名、另一边读不到，表现就是「切页时侧栏忽开忽关」。
 */
export const SIDEBAR_OPEN_KEY = 'campusflow:workspace-sidebar'

/** 读：只有 '1' 算展开，其余（缺键 / '0' / 空串）一律收起。存储被禁时也降级成收起。 */
export const readSidebarOpen = () => {
  try {
    return window.localStorage.getItem(SIDEBAR_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

/** 写：收起时**删键**而不是写 '0' —— 少一个需要跟读端对齐的取值。 */
export const writeSidebarOpen = (open: boolean) => {
  try {
    if (open) window.localStorage.setItem(SIDEBAR_OPEN_KEY, '1')
    else window.localStorage.removeItem(SIDEBAR_OPEN_KEY)
  } catch {
    /* 隐私模式：只是记不住下次的形态，不影响本页功能 */
  }
}

/**
 * 两个页面共用的展开开关（状态 + 落盘绑在一起）。
 * 这样「在会话页收起侧栏，回到问助手页」也是收起的 —— 用户拍板的「同步」就是这条：
 * 侧栏是两个页面**同一份视图**，不是各页一份长得像的东西。
 */
export function useSidebarOpen() {
  const [open, setOpen] = useState(readSidebarOpen)
  useEffect(() => {
    writeSidebarOpen(open)
  }, [open])
  return [open, setOpen] as const
}
