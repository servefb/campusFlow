import { useState } from 'react'
import {
  ArrowRight,
  BookMarked,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  ExternalLink,
  Eye,
  FileSignature,
  GitBranch,
  Layers,
  Menu,
  Network,
  PencilRuler,
  Radio,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Waypoints,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'

/**
 * 介绍页 / 落地页
 * ============================================================================
 * 版式来源：2026-09-15 新版参考图（stitch `campus_flow/code.html`，编辑部版式 v3.4）。
 * 语言要点（照参考图，但统一到全站变量，不引入 Tailwind / 思源宋体 / Cinzel）：
 *  ① 页头：sticky + 毛玻璃，品牌左侧（衬线方章「脉」+ Cinzel 风格字距英文名），
 *     导航带 01–04 等宽序号，右侧「运行演示」次级按钮 + 「进入工作台」深色主按钮。
 *  ② 首屏：**不是居中大标题**，而是 7:5 双栏 —— 左白卡（眉标药丸 + 44px 衬线标题 +
 *     珊瑚高亮垫色 + 珊瑚主按钮 + 底部等宽微指标行），右满高建筑实景图 + 顶部 HUD 条 +
 *     底部渐变说明块。这是整页与旧版差异最大的一处。
 *  ③ 四个编号章节（01 脉络流转 / 02 智能体拓扑 / 03 场景实录 / 04 设计哲学）：
 *     统一「左 eyebrow 行 + 衬线大标题 / 右一句话说明」的章节头，下方 1px 分隔线。
 *  ④ 01 节点流水线：5 列节点卡 + 绝对定位 SVG 贯穿虚线 + 底部深色事件总线条。
 *  ⑤ 02 四维智能体矩阵：4 列卡，每卡「编号+类型标签 / 方块图标 / 衬线标题 / 描述 /
 *     两行等宽指标」，四色分别是珊瑚、蓝、紫、绿。
 *  ⑥ 03 三栏联调台：左对话流 / 中审批 DAG / 右法条引索抽屉，1224 栅格各占 4 列。
 *  ⑦ 04 范式对比：左白卡论纲，右「传统 / 脉络」双卡对照（玫红 vs 翠绿）。
 *  ⑧ 收尾深色巨幅 CTA + 编辑部页脚。
 *
 * 纪律：
 *  · 只在 `landing.css` 内加类，全部带 `.landing-` 前缀，不改动其它页样式。
 *  · 不引入外部字体与 Tailwind，衬线走系统内置（Songti SC / SimSun / Georgia）。
 *  · 数字与文案属于**产品叙事**（参考图既有），不是后端字段，不受「拿不到就不写」约束。
 */

/** 页头导航：编号 + 锚点，与参考图的 01–04 序号一致。 */
const navItems = [
  { no: '01', label: '设计哲学', href: '#philosophy' },
  { no: '02', label: '脉络流转', href: '#pipeline' },
  { no: '03', label: '智能体拓扑', href: '#topology' },
  { no: '04', label: '场景实录', href: '#simulation' },
] as const

/** 01 脉络流转：五段节点。tone 决定编号色与右下状态点色（分 coral/blue/purple/green 四色谱系）。 */
const flowNodes = [
  {
    no: '01',
    code: 'INTENT TRIGGER',
    title: '学生口语意图发起',
    body: '“我要申报竞赛加分并冲抵第二课堂学分”',
    footTone: 'green',
    foot: '语音 / 自然文本输入',
    icon: Radio,
  },
  {
    no: '02',
    code: 'AGENT 01 · ROUTING',
    title: '智能意图向量分流',
    body: '精准解构归属：教务处教研科 ➔ 学工研工部，拒绝部门推诿。',
    footTone: 'coral',
    foot: '分流延迟 180ms',
    icon: Waypoints,
  },
  {
    no: '03',
    code: 'AGENT 02 · RETRIEVAL',
    title: '红头文件条款溯源',
    body: '关联《校发〔2023〕142号》，逐字提取第三章第十二条硬性标准。',
    footTone: 'blue',
    foot: '政策效力锁定',
    icon: BookMarked,
  },
  {
    no: '04',
    code: 'AGENT 03+04 · SYNTHESIS',
    title: '材料装配与审批画布',
    body: '自动填充学籍、绩点与竞赛奖项，构建导师 ➔ 院长电子签批 DAG。',
    footTone: 'purple',
    foot: '材料自拟合率 92%',
    icon: GitBranch,
  },
  {
    no: '05',
    code: 'TERMINAL · RECEIPT',
    title: '电子回执与存证入库',
    body: '即审即走，生成防伪 PDF 带章凭证，推送到师生个人档案中心。',
    footTone: 'green',
    foot: '12 分钟闭环流转',
    icon: CheckCircle2,
  },
] as const

/** 02 智能体拓扑：四维矩阵，两行指标。 */
const swarmAgents = [
  {
    no: '01',
    type: 'ROUTER',
    tone: 'coral',
    title: '意图路由智能体',
    body: '针对高校事务特有的多义性口语（如“换寝”“销假”“免听”），进行 48 维语义特征投影，精准拆解并指派对应责任处室。',
    metrics: [['分流准确率', '99.4%', 'strong'], ['处理吞吐', '820 req/min', 'plain']],
    icon: Waypoints,
  },
  {
    no: '02',
    type: 'RETRIEVAL',
    tone: 'blue',
    title: '校规向量检索体',
    body: '对跨越 10 年期全校 1,480 余件现行红头文件实施分级向量嵌入。带时间轴与废改立状态机，确保引证条款效力绝对有效。',
    metrics: [['条款溯源召回', '0.998 MAP', 'strong'], ['幻觉拦截率', 'Zero-Hallucination', 'green']],
    icon: ScanSearch,
  },
  {
    no: '03',
    type: 'SYNTHESIS',
    tone: 'purple',
    title: '审批拟合智能体',
    body: '依据师生所属院系及诉求等级，动态拟合由班导师、辅导员、教学院长构成的有向无环图（DAG），并自适应分派前置材料。',
    metrics: [['状态机节点', '动态自愈', 'strong'], ['跨院系协同', '秒级同步', 'plain']],
    icon: Network,
  },
  {
    no: '04',
    type: 'DRAFTING',
    tone: 'green',
    title: '文书智拟智能体',
    body: '自动按国家行政公文 GB/T 9704-2012 排版标准拟定申明书、学籍异动报告与免研综测申报表，免去师生繁琐格式调校。',
    metrics: [['表单预填率', '94.6%', 'green'], ['标准格式支持', 'A4 PDF / OFD', 'plain']],
    icon: PencilRuler,
  },
] as const

/** 03 场景实录：中栏审批 DAG 三步。state 决定边框与圆点样式。 */
const pipelineSteps = [
  {
    state: 'done',
    title: '获奖证书智能验真',
    tag: '已比对',
    body: '系统直连教务部竞赛白名单库，匹配全国大学生集成电路设计竞赛奖项哈希。',
  },
  {
    state: 'active',
    title: '生成《冲抵与推免加分申报表》',
    tag: '文书智拟中',
    body: '自动调取绩点排名 (3.86/4.0)、导师工号及项目立项编号并预填完毕。',
  },
  {
    state: 'pending',
    title: '教学院长 & 研工组电子签批',
    tag: '待提交',
    body: '学生确认后将自动推送至审批人企业微信 / 工作台待办任务。',
  },
] as const

/** 03 场景实录：右栏法条引索抽屉。excerptTone 决定引文左边线颜色。 */
const citations = [
  {
    code: '校发〔2023〕142 号',
    badge: '现行有效',
    badgeTone: 'green',
    title: '《本科生创新创业实践与学分认定管理条例》',
    quote: '第三章第十二条：在教育部认可之全国性学科竞赛中斩获大区一等奖及以上者，可置换同专业限选或专业实践学分，上限 2.0 学分。',
    excerptTone: 'coral',
  },
  {
    code: '学工发〔2024〕19 号',
    badge: '秋季最新',
    badgeTone: 'blue',
    title: '《推荐优秀应届毕业生免试攻读研究生综合测评细则》',
    quote: '附件二·科研加分细则：集成电路设计竞赛认定为国家二类学科赛事，排名第一作者计入附加分 0.4 分。',
    excerptTone: 'blue',
  },
] as const

/** 04 设计哲学：两栏对照各自的痛点 / 收益清单。 */
const legacyPoints = [
  '处室条块分割，办一项业务需辗转 3 个系统重复登录。',
  '政策文件散落各处，学生难以甄别是否废止或更新。',
  '材料驳回理由晦涩简短，缺少具体的补正引导。',
] as const

const flowPoints = [
  '一句话意图智能拆解，自动归纳对应审批部门与前置表单。',
  '校规向量图谱秒级检索，高亮展示具体法理条款与发文字号。',
  '自动预填学籍与竞赛数据，材料自拟合率突破 92%。',
] as const

export function LandingPage() {
  const user = useAuthStore((state) => state.user)
  const [menuOpen, setMenuOpen] = useState(false)
  const entryPath = user ? '/workspace' : '/login'
  const closeMenu = () => setMenuOpen(false)

  return (
    <div className="landing-page">
      {/* ===================== 页头：sticky 毛玻璃，01–04 编号导航 ===================== */}
      <header className="landing-header">
        <div className="landing-header-inner">
          <Link className="landing-brand" to="/welcome" onClick={closeMenu}>
            <span className="landing-seal" aria-hidden="true">脉</span>
            <span className="landing-brand-name">
              <strong>CAMPUS FLOW</strong>
              <i>校园脉络</i>
            </span>
            <code className="landing-version">v3.4 Editorial</code>
          </Link>

          <nav className={menuOpen ? 'open' : ''} aria-label="介绍页导航">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} onClick={closeMenu}>
                <b>{item.no}</b>
                {item.label}
              </a>
            ))}
          </nav>

          <div className="landing-header-actions">
            <a className="landing-ghost-action" href="#simulation">
              <Eye size={15} />
              运行演示
            </a>
            <Link className="landing-primary-action" to={entryPath}>
              进入工作台
              <ArrowRight size={15} />
            </Link>
            <button
              type="button"
              className="landing-menu-button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={menuOpen ? '关闭导航菜单' : '打开导航菜单'}
            >
              {menuOpen ? <X size={19} /> : <Menu size={19} />}
            </button>
          </div>
        </div>
      </header>

      <main className="landing-main">
        {/* ===================== 首屏：7:5 编辑部封面（左陈述白卡 + 右建筑实景） ===================== */}
        <section className="landing-hero" id="overview">
          <div className="landing-hero-card">
            <span className="landing-hero-stamp" aria-hidden="true">FLOW</span>

            <div className="landing-hero-lead">
              <span className="landing-hero-pill">
                <i />
                <em>Academic Governance Reimagined</em>
              </span>
              <h1>
                重塑校园行政的
                <br />
                <mark>人文厚度</mark> 与 <i>呼吸感。</i>
              </h1>
              <p>
                摒弃冰冷卡片的割裂堆砌与晦涩填报。「校园脉络」以多智能体编排网络为骨架，
                让每一条校规红头条文清晰可溯、每道审批流水如光影般透明通达，为师生构筑有温度的事务交互场。
              </p>
            </div>

            <div className="landing-hero-actions">
              <a className="landing-cta-coral" href="#pipeline">
                <Waypoints size={17} />
                体验交互脉络
                <ArrowRight size={15} />
              </a>
              <a className="landing-cta-quiet" href="#topology">
                <Network size={17} />
                四维智能体矩阵
              </a>
            </div>

            <div className="landing-hero-metrics">
              <span>NODE // ASSET-FLOW-2024</span>
              <i aria-hidden="true" />
              <span>POLICIES INDEXED: 1,480+</span>
              <i aria-hidden="true" />
              <strong>LATENCY &lt; 1.2s</strong>
            </div>
          </div>

          <aside className="landing-hero-visual">
            <img src="/assets/campus-library.png" alt="通透层叠的现代大学图书馆中庭" />
            <span className="landing-hero-hud">
              <i>SPATIAL CONTEXT: CENTRAL ATRIUM</i>
              <i>AXIS // 31.299°N</i>
            </span>
            <div className="landing-hero-caption">
              <span>
                <i aria-hidden="true" />
                建筑动线与规章走廊的隐喻
              </span>
              <h2>流动空间 · 无摩擦的学术生活</h2>
              <p>
                正如通透的层叠曲廊引导师生自由漫步，Campus Flow 将复杂的处室条块壁垒消解于无形，
                建立有秩序、透明自如的数据走廊。
              </p>
            </div>
          </aside>
        </section>

        {/* ===================== 01 脉络流转：五节点流水线 ===================== */}
        <section className="landing-section" id="pipeline">
          <header className="landing-section-head">
            <div>
              <span className="landing-eyebrow">
                01 // DYNAMIC LIFECYCLE
                <i aria-hidden="true">•</i>
                全域办事脉络图谱
              </span>
              <h2>从一句话输入，到法定公文闭环的「脉络流动线」</h2>
            </div>
            <p>以实时智能事件流（Event Flow）串联学生意图、红头校规检校、审批链拟合与回执分发，全程可视化追踪。</p>
          </header>

          <div className="landing-pipeline">
            <svg className="landing-pipeline-axis" aria-hidden="true" preserveAspectRatio="none">
              <line x1="10%" x2="90%" y1="38%" y2="38%" />
              <line className="is-animated" x1="10%" x2="68%" y1="38%" y2="38%" />
            </svg>

            <ol className="landing-pipeline-track">
              {flowNodes.map(({ no, code, title, body, footTone, foot, icon: Icon }) => (
                <li key={no}>
                  <div className="landing-node-top">
                    <b>{no}</b>
                    <i>
                      <Icon size={15} />
                    </i>
                  </div>
                  <span className="landing-node-code">{code}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                  <span className={`landing-node-foot tone-${footTone}`}>
                    <i aria-hidden="true" />
                    {foot}
                  </span>
                </li>
              ))}
            </ol>

            <div className="landing-eventbus">
              <span className="landing-eventbus-live">
                <i className="landing-ping" aria-hidden="true" />
                <b>CAMPUS FLOW EVENT BUS:</b>
                <em>REQ#90812-INNOVATION-CREDIT STREAMING ACTIVE</em>
              </span>
              <span className="landing-eventbus-meta">
                <b>NODE LATENCY: 24ms</b>
                <b>TOPOLOGY: 4 AGENTS CO-VERIFYING</b>
              </span>
            </div>
          </div>
        </section>

        {/* ===================== 02 智能体拓扑：四维矩阵 ===================== */}
        <section className="landing-section" id="topology">
          <header className="landing-section-head">
            <div>
              <span className="landing-eyebrow">
                02 // COLLABORATIVE SWARM
                <i aria-hidden="true">•</i>
                核心技术架构
              </span>
              <h2>四维智能体协同拓扑 (Agent Swarm Architecture)</h2>
            </div>
            <p>不依赖单一通用大模型，而是通过四套职责清晰、互为校验的专业 Agent 阵列，杜绝行政公文幻觉。</p>
          </header>

          <div className="landing-swarm">
            {swarmAgents.map(({ no, type, tone, title, body, metrics, icon: Icon }) => (
              <article key={no} className={`landing-swarm-card tone-${tone}`}>
                <div className="landing-swarm-top">
                  <span>AGENT // {no}</span>
                  <code>{type}</code>
                </div>
                <i className="landing-swarm-icon">
                  <Icon size={21} />
                </i>
                <h3>{title}</h3>
                <p>{body}</p>
                <dl className="landing-swarm-metrics">
                  {metrics.map(([label, value, kind]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd className={`is-${kind}`}>{value}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        </section>

        {/* ===================== 03 场景实录：三栏联调台 ===================== */}
        <section className="landing-section" id="simulation">
          <header className="landing-section-head">
            <div>
              <span className="landing-eyebrow">
                03 // LIVE SIMULATION
                <i aria-hidden="true">•</i>
                真实业务推演
              </span>
              <h2>真实场景推演 · 竞赛学分与推免加分协同申报</h2>
            </div>
            <div className="landing-scenario-chips">
              <span>SCENARIO: COMP-CREDIT-77</span>
              <span className="is-ok">
                <i aria-hidden="true" />
                联调校验通过
              </span>
            </div>
          </header>

          <div className="landing-studio">
            {/* 左：对话流 */}
            <div className="landing-studio-pane">
              <header className="landing-pane-head">
                <span>DIALOGUE STREAM</span>
                <code>14:28:02 CST</code>
              </header>

              <div className="landing-bubble">
                <span className="landing-bubble-who">
                  <i>李</i>
                  计算机学院 · 2022 级本科生
                </span>
                <p>
                  “老师好，我在『全国大学生集成电路设计竞赛』拿了华东一等奖，听说既可以免修下学期一门实验课，
                  又可以在大四保研综测加分，请问具体怎么办理？要交哪些材料？”
                </p>
              </div>

              <div className="landing-intent">
                <span>
                  <Sparkles size={13} />
                  意图路由 Agent 已锁定复合诉求：
                </span>
                <p>
                  ① 教务处 · 学科竞赛创新学分冲抵 (上限 2.0)
                  <br />② 学工部 · 免试研究生综合测评科研加分 (0.4 分)
                </p>
              </div>

              <footer className="landing-pane-foot">
                <span>输入通道：网页终端 (Campus Portal)</span>
                <strong>
                  <i aria-hidden="true" />
                  在线会话
                </strong>
              </footer>
            </div>

            {/* 中：审批 DAG */}
            <div className="landing-studio-pane">
              <header className="landing-pane-head">
                <span>ACTIVE PIPELINE DAG</span>
                <code className="is-coral">3 步流转拟合</code>
              </header>

              <ol className="landing-dag">
                {pipelineSteps.map((step, index) => (
                  <li key={step.title} className={`state-${step.state}`}>
                    <i aria-hidden="true">{step.state === 'done' ? <Check size={12} /> : index + 1}</i>
                    <div>
                      <div className="landing-dag-title">
                        <b>{step.title}</b>
                        <em>{step.tag}</em>
                      </div>
                      <p>{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <footer className="landing-pane-foot is-actions">
                <Link className="landing-pane-submit" to={entryPath}>
                  <FileSignature size={15} />
                  一键确认并提交申报
                </Link>
                <button type="button" className="landing-pane-iconbtn" aria-label="预览预填表单">
                  <Eye size={15} />
                </button>
              </footer>
            </div>

            {/* 右：法条引索抽屉 */}
            <div className="landing-studio-pane">
              <header className="landing-pane-head">
                <span className="is-with-icon">
                  <ShieldCheck size={15} />
                  CITATION DRAWER
                </span>
                <code className="is-green">2 份法定效力切片</code>
              </header>

              <div className="landing-citations">
                {citations.map((item) => (
                  <article key={item.code}>
                    <div className="landing-citation-meta">
                      <b>{item.code}</b>
                      <code className={`tone-${item.badgeTone}`}>{item.badge}</code>
                    </div>
                    <h4>{item.title}</h4>
                    <blockquote className={`tone-${item.excerptTone}`}>“{item.quote}”</blockquote>
                  </article>
                ))}
              </div>

              <footer className="landing-pane-foot">
                <span>发文源：教务处 · 学工部</span>
                <a href="#simulation">
                  查验红头公文原件
                  <ExternalLink size={12} />
                </a>
              </footer>
            </div>
          </div>
        </section>

        {/* ===================== 04 设计哲学：范式对照 ===================== */}
        <section className="landing-section" id="philosophy">
          <header className="landing-section-head">
            <div>
              <span className="landing-eyebrow">
                04 // PHILOSOPHICAL ESSAY
                <i aria-hidden="true">•</i>
                范式变革
              </span>
              <h2>从僵化卡片堆叠，到自由呼吸的「流动脉络」</h2>
            </div>
            <p>以现代图书情报学与分布式软件工程理念，消解官僚界面卡片化带来的信息熵增。</p>
          </header>

          <div className="landing-philosophy">
            <article className="landing-thesis">
              <div>
                <span>EDITORIAL THESIS</span>
                <h3>高校数字化行政，不该是冰冷的表单迷宫</h3>
                <p>
                  过往的数字校园系统常将各个处室的信息化孤岛直接映射为杂乱无章的磁贴或弹窗。
                  学生找政策如同大海捞针，稍有材料不齐便面临冷冰冰的“驳回”，却不知如何纠偏。
                </p>
                <p>
                  「校园脉络」通过知识图谱与协同智能体网络，使规章具备自解释性、审批流程如同水流顺势前行。
                  师生每一次诉求，都是一次优雅舒展的学术生活体验。
                </p>
              </div>
              <footer>
                <i>
                  <Layers size={19} />
                </i>
                <div>
                  <strong>结构化极简主义 (Structured Editorial)</strong>
                  <small>遵循学术社区从容审美的界面规范</small>
                </div>
              </footer>
            </article>

            <div className="landing-contrast">
              <article className="landing-contrast-card is-legacy">
                <header>
                  <span>TRADITIONAL · 传统行政黑盒</span>
                  <CircleSlash size={17} />
                </header>
                <ul>
                  {legacyPoints.map((point) => (
                    <li key={point}>
                      <X size={13} />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
                <footer>
                  <span>平均流转时长</span>
                  <b>5.4 工作日 / 滞后</b>
                </footer>
              </article>

              <article className="landing-contrast-card is-flow">
                <header>
                  <span>CAMPUS FLOW · 脉络共生</span>
                  <CheckCircle2 size={17} />
                </header>
                <ul>
                  {flowPoints.map((point) => (
                    <li key={point}>
                      <Check size={13} />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
                <footer>
                  <span>平均闭环时长</span>
                  <b>12 分钟 / 即审即走</b>
                </footer>
              </article>
            </div>
          </div>
        </section>

        {/* ===================== 收尾：深色巨幅 CTA ===================== */}
        <section className="landing-moment">
          <span className="landing-moment-glow is-coral" aria-hidden="true" />
          <span className="landing-moment-glow is-blue" aria-hidden="true" />
          <div className="landing-moment-body">
            <span className="landing-moment-eyebrow">
              <i aria-hidden="true" />
              READY FOR DEPLOYMENT · 2026-2027 ACADEMIC YEAR
            </span>
            <h2>
              让每一个校园诉求，
              <br />
              在清澈的脉络中自然生长。
            </h2>
            <p>
              无论是教务排课冲突协调、国家奖学金申报推演，还是跨部门资产调拨申请，
              「校园脉络」始终以理性沉静的人文关怀陪伴师生治学日常。
            </p>
            <div className="landing-moment-actions">
              <Link className="landing-cta-coral" to={entryPath}>
                {user ? '进入我的工作台' : '进入工作台体验'}
                <ArrowRight size={17} />
              </Link>
              <a className="landing-cta-glass" href="#pipeline">
                重新查阅脉络流转
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* ===================== 编辑部页脚 ===================== */}
      <footer className="landing-foot">
        <div className="landing-foot-inner">
          <span className="landing-foot-brand">
            <b>CAMPUS FLOW 校园脉络</b>
            <i aria-hidden="true">|</i>
            <span>高校信息化与治理现代化联合实验室</span>
            <i aria-hidden="true">|</i>
            <span>SYS-NODE: SHA-09</span>
          </span>
          <span className="landing-foot-links">
            <b>
              <ShieldCheck size={14} />
              教育部教育数字化可信合规参考
            </b>
            <span>规章溯源可信白皮书</span>
            <span>系统状态</span>
            <em>© 2026 Academic Affairs &amp; IT Center</em>
          </span>
        </div>
      </footer>

      {/* 深色 CTA 里的次按钮用的是 <a>，这里补一个安静入口给键盘用户跳到正文锚点 */}
      <a className="sr-only" href="#topology">
        跳至智能体拓扑
        <ChevronRight size={12} />
      </a>
    </div>
  )
}
