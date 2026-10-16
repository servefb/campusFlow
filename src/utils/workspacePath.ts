/**
 * 工作区路径的展示口径（09-18 从 conversationGroups 提出来的）。
 *
 * 两处 UI 都要「只显示最后一级文件夹名」：
 * ① 侧边栏按 `work_space` 分组时的组标题（`splitByWorkspace`）；
 * ② 输入框工具条上那个工作区回显 chip。
 * 口径必须一致 —— 否则同一块工作区在左栏叫 `campusflow`、在输入框叫 `d:campusflow`，
 * 用户会以为是两个地方。所以抽成一处，两边都从这里取。
 *
 * 纯函数、不依赖 React，放 utils 便于单测。
 */

/**
 * 从工作区路径里取**最后一段文件夹名**（用户：「按照返回路径的最后一个文件夹」）。
 * 同时兼容三种写法，因为前后端两端都可能给出其中任一种：
 *   · `d:worker-space/WebstormProjects/campusflow`（前端选择器提交的 `<盘符>:<相对路径>`）
 *   · `D:\worker-space\WebstormProjects\campusflow`（Windows 绝对路径）
 *   · `/home/me/proj`（类 Unix）
 * 先剥掉盘符前缀与前后的分隔符，再按 `/` 和 `\` 两路切 —— 不要只 split('/')，
 * Windows 形态会整段返回。
 * 盘根（`d:` / `d:\`）取不出文件夹名，返回空串（由调用方退回原值），
 * 不在这里编一个「D盘」之类的名字。
 */
export const workspaceName = (value: string) => {
  const tail = value
    .trim()
    .replace(/^[a-zA-Z]:/, '') // 盘符前缀 d: / d:\
    .replace(/^[\\/]+/, '')
    .replace(/[\\/]+$/, '')
  const segments = tail.split(/[\\/]/).filter(Boolean)
  return segments.length ? segments[segments.length - 1] : ''
}
