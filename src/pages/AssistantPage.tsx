import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  History,
  MessageSquarePlus,
  PanelLeftOpen,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { apiErrorMessage } from '../services/http'
import { getWorkspaceSummary, type WorkspaceSummary } from '../services/workspace'
import { HistoryModal } from '../components/HistoryModal'
import { PromptComposer } from '../components/PromptComposer'
import { AskModeSwitch } from '../components/AskModeSwitch'
import { AssistantSidebar } from '../components/AssistantSidebar'
import { useSidebarOpen } from '../utils/sidebarState'

// 视图开关（侧边栏 / 顶栏两种摆法）的持久化与状态收在 utils/sidebarState.ts ——
// 09-18 起会话页也挂同一份侧栏，两页共用同一个键，切页时形态跟着走。

// 推荐问题文案收短（09-17 用户拍板）：后端下发的 title 较长，这里只按关键词映射展示短语，
// 点下去填充的 prompt 仍是后端的完整问题 —— 只改显示文案，不改数据。
const SHORT_ENTRY_LABELS: Array<[RegExp, string]> = [
  [/奖学金/, '申请奖学金'],
  [/转专业/, '了解转专业'],
  [/四六级/, '四六级报名'],
]

export function AssistantPage() {
  const navigate = useNavigate()
  // 视图开关：false = 顶栏形态（默认），true = 左侧侧边栏形态。同一批功能的两套摆法。
  const [sidebarOpen, setSidebarOpen] = useSidebarOpen()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null)
  const [error, setError] = useState('')
  // 「新建」按钮聚焦提问框，相当于就地开始一场新会话。
  const promptRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    getWorkspaceSummary()
      .then((res) => setSummary((res.data as { data?: WorkspaceSummary } | undefined)?.data ?? null))
      .catch((reason) => setError(apiErrorMessage(reason, '工作台数据加载失败，请稍后重试')))
  }, [])

  // 视图选择的持久化搬进 useSidebarOpen 了（展开写 '1'、收起删键）——
  // 会话页也要读同一个键，落盘逻辑留在页面里就会分叉。

  // 专精协同领域（09-17）：欢迎页横排已撤、弹窗改读 agent.domains（/agents 下发），不再消费 summary.domains

  return (
    <section className={`assistant-modern${sidebarOpen ? ' sidebar-open' : ''}`}>
      <header className="assistant-modern-header">
        {sidebarOpen ? (
          /* 展开时顶栏只剩会话状态 —— 视图开关搬进侧边栏第一行。
             侧边栏里不再有「新会话」那一行，两处位置正好对调。 */
          <span className="assistant-session-name is-standalone">
            <i />
            新会话
          </span>
        ) : (
          <>
            {/* 视图开关：收起态的**唯一**入口（展开后这个控件在侧边栏里，所以这里必须留着，
                否则一收起就再也打不开了）。 */}
            <button
              type="button"
              className="assistant-sidebar-toggle"
              onClick={() => setSidebarOpen(true)}
              aria-label="展开侧边栏"
              title="展开侧边栏"
            >
              {/* 侧栏开关的两个方向都用标准的「面板折叠」图标（09-18 用户拍板）：
                  原来这里是 ↔ 双向箭头，读不出「收起/展开侧栏」的含义。 */}
              <PanelLeftOpen size={16} />
            </button>

            {/* 侧边栏展开时这批按钮整组搬过去，顶栏不留重复的第二份。 */}
            <div className="assistant-session-actions">
              <AskModeSwitch />
              <button type="button" onClick={() => promptRef.current?.focus()}>
                <MessageSquarePlus size={15} />
                <span className="assistant-session-label">新建会话</span>
              </button>
              <span className="assistant-session-name">
                <i />
                新会话
              </span>
            </div>
            <div className="assistant-header-status">
              <button type="button" className="assistant-history-btn" onClick={() => setHistoryOpen(true)}>
                <History size={15} />
                <span className="assistant-session-label">历史对话</span>
              </button>
            </div>
          </>
        )}
      </header>

      {sidebarOpen && (
        <AssistantSidebar
          onNew={() => promptRef.current?.focus()}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      <main className="assistant-modern-main">
        <div className="assistant-welcome">
          {/* 欢迎图标（09-17 用户拍板）：珊瑚底 Sparkles 换成 v4 品牌图形（透明底正方形，contain 摆放） */}
          <span className="assistant-welcome-icon">
            <img src="/assets/campus-flow-logo-v4.png" alt="" />
          </span>
          <h1>校园里的事，一起理清楚</h1>
          <p>Campus Flow · 你的校园事务助手</p>
        </div>

        {error && <p className="form-error">{error}</p>}

        <PromptComposer
          value={draft}
          onChange={setDraft}
          onSubmit={() => {
            const content = draft.trim()
            if (!content) return
            // 后端通过 /conversations/messages/stream 在同一请求中创建会话并回答，
            // 这里携带首问跳转会话页，由会话页发起流式请求。
            // 工作区（09-17）是全局 store，不需要经 location.state 搬运。
            // agent_mode 恒为 auto（09-23）：前端只剩一个主智能体，没有可选项了。
            navigate('/conversations/new', {
              state: { question: content, agentMode: 'auto' },
            })
          }}
          textareaRef={promptRef}
        />

        {/* 试着问问（09-16 起，09-17 改浅描边小按钮）：只取 3 条、整排居中，
            展示文案按关键词收短（见 SHORT_ENTRY_LABELS），点击仍填充后端完整 prompt */}
        <div className="assistant-popular">
          <span>试着问问</span>
          <div>
            {summary?.quick_entries?.slice(0, 3).map((entry) => (
              <button type="button" key={entry.key} onClick={() => setDraft(entry.prompt)}>
                {SHORT_ENTRY_LABELS.find(([re]) => re.test(entry.title))?.[1] ?? entry.title}
                <ArrowUpRight size={13} />
              </button>
            ))}
          </div>
        </div>

        {/* 政策说明贴页面底部（.assistant-modern-main 是纵向 flex，margin-top:auto 把它推到底） */}
        <p className="assistant-note">Campus Flow 基于全校核准政策库生成建议，涉及重大学籍变更请以教务处官方窗口书面答复为准。</p>
      </main>

      <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />

      <Link className="assistant-back-home" to="/" aria-label="返回首页">
        <ArrowLeft size={15} />
        <span>返回首页</span>
      </Link>
    </section>
  )
}
