import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssistantSidebar } from './AssistantSidebar'

// 组件只从 react-router 拿一个 useNavigate；真挂 MemoryRouter 会在 SSR 下刷一片
// useLayoutEffect 警告，mock 掉更干净。
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))

/**
 * 侧边栏（09-19 二十改版后）：主操作、顶行 Chat/Agent 模式切换、收起按钮的形状、Codex 风格两段列表。
 * 09-23：顶行那个「智能体管理」迷你入口随多智能体选择一起撤掉（全站只剩一个主智能体）。
 *
 * ⚠️ renderToStaticMarkup 不跑 effect、也点不动，所以这里覆盖的是「默认长什么样」——
 * 会话列表要等接口回来才渲染，静态渲染里永远是 loading 态：「项目 / 最近」两段、
 * 文件夹夹头、展开显示**不会**出现在这里，靠工装验
 * （.workbuddy/preview/_clicktest/_verify-sidebar-v20.mjs）。
 * 分组纯函数在 utils/conversationGroups.test.ts 里单独测。
 */
const html = () =>
  renderToStaticMarkup(
    <AssistantSidebar
      onNew={() => {}}
      onClose={() => {}}
    />,
  )

describe('AssistantSidebar 结构', () => {
  it('主操作是整行「新建会话」主按钮（不再是玻璃气泡卡之外的第三种说法）', () => {
    const out = html()
    expect(out).toContain('assistant-sidebar-new')
    expect(out).toContain('>新建会话</span>')
  })

  it('顶行不再有「智能体管理」入口（09-23）：迷你入口与旧的入口行/入口卡全部退役', () => {
    const out = html()
    expect(out).not.toContain('assistant-sidebar-agents-mini')
    expect(out).not.toContain('智能体管理')
    expect(out).not.toContain('assistant-sidebar-action')
    expect(out).not.toContain('矩阵中心')
  })

  it('顶行顺序（09-23 两槽位）：模式切换 → 滑块（同在背景组）→ 收起键在组外', () => {
    const out = html()
    const group = out.indexOf('assistant-sidebar-head-group')
    const seg = out.indexOf('ask-mode-switch')
    const thumb = out.indexOf('assistant-sidebar-head-thumb')
    const fold = out.indexOf('assistant-sidebar-fold')
    expect(group).toBeGreaterThan(-1)
    expect(seg).toBeGreaterThan(group)
    expect(thumb).toBeGreaterThan(seg)
    expect(fold).toBeGreaterThan(thumb)
  })

  it('Chat / Agent 分段控件还在顶行（轻量化走 CSS 前缀变体，不换结构）', () => {
    expect(html()).toContain('ask-mode-switch')
  })

  it('文件树彻底退役：没有文件夹头、展开显示、会话缩进类', () => {
    const out = html()
    expect(out).not.toContain('assistant-sidebar-ws-head')
    expect(out).not.toContain('assistant-sidebar-ws-more')
    expect(out).not.toContain('assistant-sidebar-ws ')
  })

  it('收起按钮是标准的侧栏折叠图标（PanelLeftClose），不再是双向箭头', () => {
    const out = html()
    expect(out).toContain('assistant-sidebar-fold')
    expect(out).toContain('收起侧边栏')
    // MoveHorizontal（↔）的两条箭头路径
    expect(out).not.toContain('<polyline points="18 8 22 12 18 16"/><polyline points="6 8 2 12 6 16"/>')
  })

  it('会话行不再挂时钟图标（时刻改由分组标签 + 悬停承担）', () => {
    const out = html()
    // lucide Clock 的圆 + 指针路径
    expect(out).not.toContain('<circle cx="12" cy="12" r="10"/>')
  })

  /**
   * 占位行（09-19 二十四改）：真后端只在整轮回答跑完才 INSERT conversations 行，
   * 所以 accepted 那次重拉看不到刚发的这条 —— 会话页把已知信息传进来顶一行。
   * 静态渲染跑不到 effect，列表永远是 loading 态，正好用来验「loading 期间占位行也得渲染」
   * （所以分组条件里那个 `!loading` 被摘掉了）。去重（真行到了占位让位）要接口回来才看得出，靠工装验。
   */
  const htmlPending = (pending: Parameters<typeof AssistantSidebar>[0]['pending']) =>
    renderToStaticMarkup(
      <AssistantSidebar
        activeId="4242"
        pending={pending}
        onNew={() => {}}
        onClose={() => {}}
      />,
    )

  it('占位行：列表还在拉的时候，刚发出去的那条已经在侧栏里（loading 不再挡住它）', () => {
    const out = htmlPending({
      id: '4242',
      title: '把这个文件夹移动到桌面上',
      updated_at: new Date().toISOString(),
      work_space: 'd:agent_workspace',
    })
    expect(out).toContain('把这个文件夹移动到桌面上')
    expect(out).toContain('agent_workspace')
  })

  it('占位行：挂 is-pending + 选中态，且不挂 ⋯ 菜单（没落库，增删改都会 404）', () => {
    const out = htmlPending({
      id: '4242',
      title: '把这个文件夹移动到桌面上',
      updated_at: new Date().toISOString(),
      work_space: 'd:agent_workspace',
    })
    const row = out.slice(out.indexOf('assistant-sidebar-convo'))
    expect(row.startsWith('assistant-sidebar-convo')).toBe(true)
    expect(row.slice(0, 80)).toContain('is-active')
    expect(row.slice(0, 80)).toContain('is-pending')
    expect(out).not.toContain('assistant-sidebar-convo-more')
  })

  it('没有占位行时一个 is-pending 也不该出现（默认行为不变）', () => {
    expect(html()).not.toContain('is-pending')
  })

  it('占位行：没选工作区时落到「最近会话」段（不是被丢掉）', () => {
    const out = htmlPending({ id: '4242', title: '缓考怎么申请', updated_at: new Date().toISOString() })
    expect(out).toContain('最近会话')
    expect(out).toContain('缓考怎么申请')
    expect(out).toContain('is-pending')
  })
})
