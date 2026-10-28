import {
  Download,
  FilePen,
  FolderOpen,
  Globe,
  Network,
  Search,
  Terminal,
  Trash2,
} from 'lucide-react'
import type { PermissionAction } from '../services/conversations'

/**
 * 权限确认卡片（09-17 新增；09-18 改为「轻量操作确认卡」）。
 *
 * 后端拦下需要人工批准的动作后推 `event: question`（type='permission'），本卡片接住。
 * 被拦的**不一定**是文件操作：节点 `interrupt_on` 登记的工具（search / extract / crawl /
 * map_site / run_on_host）调用前同样会中断，所以文案按动作名走，不写死"修改文件"。
 *
 * 结构按三层递减，别把同一件事说三遍：
 *   1. 标题 = 动作本身（"允许联网搜索？"，带该工具的图标）；
 *   2. 目的 = 一句话说明为什么要做（工具的 purpose 参数；写文件等没有就省略）；
 *   3. 辅助 = 搜索词 / 路径 / **完整命令**，浅灰底小块，纯参考信息。
 *
 * 两条与「知情」直接相关的硬规则（09-18 评审）：
 *   · **宿主机命令不截断**：后端下发全文，这里也全文渲染（过长时给滚动区并明确提示），
 *     绝不静默砍尾 —— 命令尾部恰恰能藏 `&& …` 或第二处重定向；
 *   · **访问范围必须写出来**：`warning` 恒有值（三态见 PermissionAction 注释），
 *     因为静态分析证明不了「只碰工作文件夹内」，不能只报检出结果就完事。
 *
 * 顶部页头与 AskUserCard **完全共用**（09-18 十四改）：`需要你确认` + 珊瑚点 + 服务方署名。
 * ⚠️ 沿革（别把这里改回去）：09-18 初版曾把「需要你确认」红字与红点从这张卡**删掉**，
 * 理由是「这是一次常规授权，不是告警」。用户随后指出：卡片从消息流里冒出来时，
 * 一眼看不出「它在等我操作」，署名那行灰字读起来只是个小注。
 * 结论：**「要不要告警」和「要不要表明它在等你」是两件事** ——
 * 前者继续不做（不换盾牌 / 不加警示色 / 标题仍用工具自己的图标），后者要补回来，
 * 且与问询卡同一套语言。两张卡都表示「Agent 停下等你」，页头就该长得一样。
 *
 * 交互沿用 ask_user 同款选项行（radio 圈 + 行号）。09-23 五改：**点选项即作答** ——
 * 点「允许」= onDecide(true)，点「拒绝」= onDecide(false)，不再有单独的提交键
 * （09-23 三改曾放右下角 .assistant-send 圆形箭头，五改随 ask_user 单题口径一起撤掉）；
 * 作答走 ask_user 的 resume 契约（answers[0] = '允许' | '拒绝'），后端翻译成
 * HITL 的 decisions 再续跑同一线程。批准是**一次性**的：同一条命令再执行会重新弹卡。
 */
interface Props {
  actions: PermissionAction[]
  agentName?: string
  disabled?: boolean
  onDecide: (allow: boolean) => void
}

/** 工具 → 图标（未知工具用通用图标） */
const ICONS: Record<string, typeof FilePen> = {
  write_file: FilePen,
  edit_file: FilePen,
  delete: Trash2,
  read_file: FolderOpen,
  ls: FolderOpen,
  glob: FolderOpen,
  grep: FolderOpen,
  execute: Terminal,
  // interrupt_on 拦下的联网工具（Tavily）
  search: Search,
  extract: Download,
  crawl: Globe,
  map_site: Network,
  // interrupt_on 拦下的宿主机命令执行（沙箱外，比联网更需要看清命令原文）
  run_on_host: Terminal,
}

/** 辅助块用等宽字体的工具：命令这类要逐字符看清的内容（虚拟路径已另有 mono 判断） */
const MONO_TOOLS = new Set(['run_on_host'])

/** 超过这个长度的内容给滚动区（仍然全文渲染，只是别把卡片撑爆） */
const SCROLL_THRESHOLD = 300

/** 辅助块（路径）显示用：虚拟前缀换成用户能看懂的位置 */
const toDisplayPath = (path: string) =>
  path.startsWith('/user/') ? `工作文件夹/${path.slice('/user/'.length)}` : path

/** 辅助信息块：路径 / 搜索词 / 完整命令 */
function MetaBlock({ action }: { action: PermissionAction }) {
  if (action.path) {
    return (
      <span className={`convo-perm-meta${MONO_TOOLS.has(action.tool ?? '') ? ' mono' : ''}`}>
        {toDisplayPath(action.path)}
      </span>
    )
  }
  const text = action.detail ?? ''
  if (!text) return null
  const mono = MONO_TOOLS.has(action.tool ?? '')
  const long = text.length > SCROLL_THRESHOLD
  return (
    <>
      <span className={`convo-perm-meta${mono ? ' mono' : ''}${long ? ' scroll' : ''}`}>{text}</span>
      {long ? (
        <span className="convo-perm-note">内容较长（{text.length} 字符），已全文给出，可在块内滚动查看。</span>
      ) : null}
    </>
  )
}

function PermissionCard({ actions, agentName, disabled, onDecide }: Props) {
  // 标题就是动作：单条用它的中文名（"允许联网搜索？"），多条落到通用说法。
  // 图标取首个动作的工具图标 —— 联网是地球/放大镜，不再是警告盾牌。
  const primary = actions[0]
  const HeadIcon = ICONS[primary?.tool ?? ''] ?? FilePen
  const onlyAction = actions.length === 1 ? primary?.label || primary?.tool || '该操作' : null
  const headline = onlyAction ? `允许${onlyAction}？` : '允许执行以下操作？'
  // 含被安全规则拒绝的命令：工具侧必拒，所以「允许」不该可点（点了也不会执行）
  const blockReason = actions.find((action) => action.blocked)?.blocked ?? ''
  const allowLabel = blockReason
    ? '允许（不可选：这条命令会被安全规则拒绝）'
    : onlyAction
      ? `允许：允许${onlyAction}`
      : '允许：允许以上操作'

  return (
    <div className={`convo-ask convo-perm${disabled ? ' busy' : ''}`}>
      <div className="convo-ask-head">
        {/* 页头与 AskUserCard 完全一致（09-18 十四改，用户要求）：「需要你确认」+ 珊瑚点 + 署名。
            两张卡都表示「Agent 停下来等你」，用户扫一眼就该认出是同一类东西，
            区别只在里面的问题本身，不该再靠页头去分辨。
            注意：**只是把「需要确认」这件事说清楚**，不是把这张卡变回告警 ——
            标题区仍然用工具自己的图标（不再有盾牌 / 警示三角），选项里也不加红色。 */}
        <p className="convo-ask-eyebrow">需要你确认</p>
        {agentName ? (
          <span className="convo-ask-agent">
            <i />
            {agentName}
          </span>
        ) : null}
      </div>

      <p className="convo-perm-title">
        <HeadIcon size={14} />
        <span>{headline}</span>
      </p>

      <ul className="convo-perm-list">
        {actions.map((action, index) => (
          <li className="convo-perm-item" key={`${action.tool}-${action.path}-${action.detail}-${index}`}>
            {/* 多条动作时标题概括不了，逐条点名 */}
            {actions.length > 1 ? (
              <span className="convo-perm-tool">{action.label || action.tool || '工具调用'}</span>
            ) : null}
            {action.purpose ? <p className="convo-perm-purpose">{action.purpose}</p> : null}
            <MetaBlock action={action} />
            {/* 访问范围：warn=检出越界位置；info=范围声明（路径都在框内 / 无法静态确认）。
                两者都不静默 —— "没被标出来"不等于"看不了文件夹外"。 */}
            {action.warning ? (
              <span className={action.warning_level === 'warn' ? 'convo-perm-warn' : 'convo-perm-note'}>
                {action.warning}
              </span>
            ) : null}
            {action.blocked ? (
              <span className="convo-perm-blocked">
                安全规则判定为可能{action.blocked}的操作，点「允许」也不会执行。
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {/* 允许 / 拒绝 = ask_user 同款选项行（radio 圈 + 行号）。
          09-23 五改（用户拍板）：**点选项即作答**，不再有单独的提交箭头 ——
          允许 = onDecide(true)，拒绝 = onDecide(false)；被 block 的「允许」行不可点。 */}
      <ul className="convo-ask-options convo-perm-choices">
        <li>
          <button
            type="button"
            className="convo-ask-option"
            disabled={disabled || Boolean(blockReason)}
            title={blockReason ? '这条命令会被安全规则拒绝，无法执行' : '允许并继续'}
            onClick={() => onDecide(true)}
          >
            <span className="convo-ask-mark">
              <i />
            </span>
            <span className="convo-ask-option-label">{allowLabel}</span>
            <span className="convo-ask-key">1</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className="convo-ask-option"
            disabled={disabled}
            title="跳过这一步，继续后面的工作"
            onClick={() => onDecide(false)}
          >
            <span className="convo-ask-mark">
              <i />
            </span>
            <span className="convo-ask-option-label">拒绝：跳过这一步，继续后面的工作</span>
            <span className="convo-ask-key">2</span>
          </button>
        </li>
      </ul>
    </div>
  )
}

export { PermissionCard }
