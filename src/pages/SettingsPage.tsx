import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { BellRing, Camera, Check, CheckCircle2, Database, Loader2, LogOut, MonitorSmartphone, RefreshCw, Save, School, ShieldCheck, Trash2, Waypoints } from 'lucide-react'
import { AvatarCropper } from '../components/AvatarCropper'
import { PageTitle } from '../components/ui'
import { apiErrorMessage } from '../services/http'
import { getCurrentUser, getUserPreferences, logoutAll, updateMyAvatar, updateUserPreferences, type UserPreferences } from '../services/auth'
import { uploadFile } from '../services/files'
import { useAuthStore } from '../stores/auth'

/** 接口文档 A.1.6 示例给出的默认偏好，用作「恢复系统默认」的取值。 */
/** 接口文档 A.1.6 示例默认值（同时也是「恢复默认」的基准）。类型挂 UserPreferences 以免枚举被放宽成 string。 */
const DEFAULT_PREFERENCES: UserPreferences = {
  default_agent_mode: 'auto',
  answer_length: 'balanced',
  show_citations: true,
  task_notifications: true,
  knowledge_notifications: true,
  history_retention_days: 365,
}

const RETENTION_OPTIONS = [
  { value: '30', label: '30 天 · 短期事项备查' },
  { value: '90', label: '90 天 · 覆盖单学期周期' },
  { value: '365', label: '1 学年 · 学年评优备查' },
  { value: 'forever', label: '永久保留' },
]

/** 取值必须落在数据库 CHECK 约束内（brief | balanced | detailed），故显式标注联合类型而非放任 string 放宽。 */
const ANSWER_LENGTH_OPTIONS: (OptionItem & { value: UserPreferences['answer_length'] })[] = [
  { value: 'brief', title: '精炼步骤优先', description: '剥离繁复用语，直接输出行动清单与办理窗口，节约时间。' },
  { value: 'balanced', title: '标准均衡', badge: '默认', description: '解释与行动清单并重，适配大多数日常咨询场景。' },
  { value: 'detailed', title: '全量出处详答', description: '包含文件字号、生效年份与具体条款原文，适于办事答辩与存证。' },
]

/** 头像可选格式与体积上限（与后端 `files.content_type` / `size_bytes` 校验口径一致，后端接口就绪后无需再改）。 */
const AVATAR_ACCEPT = 'image/png,image/jpeg,image/webp'
const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const AVATAR_MAX_BYTES = 2 * 1024 * 1024

const SETTINGS_SECTIONS = [
  { id: 'settings-identity', label: '学籍与身份档案', icon: School, keywords: '学籍 身份 档案 学院 部门 资料 头像 profile' },
  { id: 'settings-security', label: '账号与安全', icon: ShieldCheck, keywords: '安全 登录 设备 会话 退出 密码 session logout' },
  { id: 'settings-agent', label: '回答与引用偏好', icon: Waypoints, keywords: '回答 详尽 引用 溯源 citation 摘要 结构化' },
  { id: 'settings-notifications', label: '办事与提醒通知', icon: BellRing, keywords: '通知 提醒 任务 状态 知识库 新规 修订 notification' },
  { id: 'settings-privacy', label: '数据与隐私留存', icon: Database, keywords: '隐私 数据 留存 保留 周期 历史 记录 retention privacy' },
]

const formatClock = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

export function SettingsPage() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)
  const clearSession = useAuthStore((state) => state.clearSession)
  const avatarUrl = user?.avatar_url ?? null

  const [preferences, setPreferences] = useState<UserPreferences | null>(null)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState('')

  const [answerLength, setAnswerLength] = useState(DEFAULT_PREFERENCES.answer_length)
  const [showCitations, setShowCitations] = useState(DEFAULT_PREFERENCES.show_citations)
  const [taskNotifications, setTaskNotifications] = useState(DEFAULT_PREFERENCES.task_notifications)
  const [knowledgeNotifications, setKnowledgeNotifications] = useState(DEFAULT_PREFERENCES.knowledge_notifications)
  const [retention, setRetention] = useState('365')

  const [refreshingProfile, setRefreshingProfile] = useState(false)
  const [profileRefreshedAt, setProfileRefreshedAt] = useState('')
  const [signingOutAll, setSigningOutAll] = useState(false)

  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarNotice, setAvatarNotice] = useState<AvatarNotice | null>(null)
  /** 待裁剪的原图（dataURL），非空即打开裁剪弹层。 */
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  /** 上传期间的即时预览（仅内存，不落 localStorage）——成功即被服务端 `avatar_url` 取代，失败即撤回。 */
  const [pendingAvatar, setPendingAvatar] = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const [activeSection, setActiveSection] = useState(SETTINGS_SECTIONS[0].id)

  /** 保存成功的短暂 toast。 */
  const [toast, setToast] = useState('')
  /** 危险操作的二次确认：第一次点击只是「上膛」，几秒内再点才真正执行。 */
  const [confirmAction, setConfirmAction] = useState<'remove-avatar' | 'logout-all' | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 2400)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!confirmAction) return
    const timer = setTimeout(() => setConfirmAction(null), 3200)
    return () => clearTimeout(timer)
  }, [confirmAction])

  useEffect(() => {
    getUserPreferences()
      .then(({ data }) => {
        const prefs = data.data
        setPreferences(prefs)
        setAnswerLength(prefs.answer_length || 'balanced')
        setShowCitations(prefs.show_citations)
        setTaskNotifications(prefs.task_notifications)
        setKnowledgeNotifications(prefs.knowledge_notifications)
        setRetention(prefs.history_retention_days == null ? 'forever' : String(prefs.history_retention_days))
      })
      .catch((requestError) => setLoadError(apiErrorMessage(requestError, '偏好设置加载失败')))
  }, [])

  /** 服务端返回了固定选项之外的留存天数时，动态补一个选项，避免 select 落空。 */
  const retentionOptions = useMemo(() => (
    RETENTION_OPTIONS.some((option) => option.value === retention)
      ? RETENTION_OPTIONS
      : [{ value: retention, label: `${retention} 天（服务端当前值）` }, ...RETENTION_OPTIONS]
  ), [retention])

  useEffect(() => {
    const elements = SETTINGS_SECTIONS
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => !!element)
    if (!elements.length) return
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) setActiveSection(entry.target.id) })
    }, { rootMargin: '-96px 0px -55% 0px' })
    elements.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [])

  const scrollToSection = (id: string) => {
    setActiveSection(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const dirty = !!preferences && (
    answerLength !== preferences.answer_length ||
    showCitations !== preferences.show_citations ||
    taskNotifications !== preferences.task_notifications ||
    knowledgeNotifications !== preferences.knowledge_notifications ||
    (retention === 'forever' ? null : Number(retention)) !== preferences.history_retention_days
  )

  /** 分卡片的「已修改」标记：哪张卡改了就在哪张卡右上角点亮，保存后一起熄灭。 */
  const cardDirty = {
    agent: !!preferences && (
      answerLength !== preferences.answer_length ||
      showCitations !== preferences.show_citations
    ),
    notifications: !!preferences && (
      taskNotifications !== preferences.task_notifications ||
      knowledgeNotifications !== preferences.knowledge_notifications
    ),
    privacy: !!preferences && (retention === 'forever' ? null : Number(retention)) !== preferences.history_retention_days,
  }

  const savePreferences = async () => {
    setSaving(true)
    setActionError('')
    try {
      const { data } = await updateUserPreferences({
        // 09-23：「默认调度智能体」不再是用户可选项（全站只有一个主智能体），但这个契约
        // 字段保留 —— 恒发 auto，语义等于「交给主智能体自己决定怎么答」。
        default_agent_mode: DEFAULT_PREFERENCES.default_agent_mode,
        answer_length: answerLength,
        show_citations: showCitations,
        task_notifications: taskNotifications,
        knowledge_notifications: knowledgeNotifications,
        history_retention_days: retention === 'forever' ? null : Number(retention),
      })
      setPreferences(data.data)
      setSavedAt(formatClock())
      setToast('偏好设置已保存')
    } catch (requestError) {
      setActionError(apiErrorMessage(requestError, '偏好设置保存失败'))
    } finally {
      setSaving(false)
    }
  }

  /** 仅回填表单（接口文档示例默认值），需再次保存才会写回服务端。 */
  const resetToDefaults = () => {
    setAnswerLength(DEFAULT_PREFERENCES.answer_length)
    setShowCitations(DEFAULT_PREFERENCES.show_citations)
    setTaskNotifications(DEFAULT_PREFERENCES.task_notifications)
    setKnowledgeNotifications(DEFAULT_PREFERENCES.knowledge_notifications)
    setRetention(DEFAULT_PREFERENCES.history_retention_days == null ? 'forever' : String(DEFAULT_PREFERENCES.history_retention_days))
    setSavedAt('')
  }

  const refreshProfile = async () => {
    setRefreshingProfile(true)
    setActionError('')
    try {
      const { data } = await getCurrentUser()
      setUser(data.data)
      setProfileRefreshedAt(formatClock())
    } catch (requestError) {
      setActionError(apiErrorMessage(requestError, '用户资料刷新失败'))
    } finally {
      setRefreshingProfile(false)
    }
  }

  /**
   * 更换头像第 1 步：校验后把原图读成 dataURL，交给 `AvatarCropper` 让用户自己框选区域。
   * 真正的上传在裁剪弹层确认后进行（见 `handleCropConfirm`）。
   */
  const pickAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0]
    // 清空 value，否则连续两次选同一个文件不会触发 change
    event.target.value = ''
    if (!picked) return
    setAvatarNotice(null)
    if (!AVATAR_TYPES.includes(picked.type)) {
      setAvatarNotice({ tone: 'error', text: '仅支持 JPG / PNG / WebP 格式的图片' })
      return
    }
    if (picked.size > AVATAR_MAX_BYTES) {
      setAvatarNotice({ tone: 'error', text: `图片需小于 2MB，当前 ${(picked.size / 1024 / 1024).toFixed(1)}MB` })
      return
    }
    try {
      setCropSrc(await readFileAsDataUrl(picked))
    } catch {
      setAvatarNotice({ tone: 'error', text: '图片读取失败，请换一张重试' })
    }
  }

  /**
   * 更换头像第 2 步：用户框选完区域，按选区裁剪并上传，再 `PATCH /users/me` 回写。
   * 上传期间用裁剪结果做即时预览（仅内存），成功交给服务端 `avatar_url`，失败撤回并如实报错。
   */
  const handleCropConfirm = async ({ preview, upload }: { preview: string; upload: File }) => {
    setAvatarNotice(null)
    setAvatarBusy(true)
    setPendingAvatar(preview)
    let uploadedFileId: number | string | null = null
    try {
      uploadedFileId = await uploadFile(upload, 'avatar')
      const { data } = await updateMyAvatar({ avatar_file_id: uploadedFileId })
      setUser(data.data)
      setPendingAvatar(null)
      setCropSrc(null)
      setAvatarNotice({ tone: 'ok', text: `头像已更新 · ${formatClock()}` })
    } catch (requestError) {
      setPendingAvatar(null)
      setCropSrc(null)
      const reason = apiErrorMessage(requestError, uploadedFileId ? '服务端头像接口暂不可用' : '头像上传失败')
      setAvatarNotice({
        tone: 'error',
        text: uploadedFileId
          ? `${reason}（图片已上传为文件 #${uploadedFileId}，尚未绑定到账号）`
          : reason,
      })
    } finally {
      setAvatarBusy(false)
    }
  }

  const removeAvatar = async () => {
    setAvatarNotice(null)
    setAvatarBusy(true)
    try {
      const { data } = await updateMyAvatar({ avatar_file_id: null })
      setUser(data.data)
      setAvatarNotice({ tone: 'ok', text: `头像已清除 · ${formatClock()}` })
    } catch (requestError) {
      setAvatarNotice({ tone: 'error', text: apiErrorMessage(requestError, '清除头像失败') })
    } finally {
      setAvatarBusy(false)
    }
  }

  const signOutAllDevices = async () => {
    setSigningOutAll(true)
    setActionError('')
    try {
      await logoutAll()
      clearSession()
      navigate('/login', { replace: true })
    } catch (requestError) {
      setActionError(apiErrorMessage(requestError, '退出全部设备失败'))
      setSigningOutAll(false)
    }
  }

  /** 危险操作的二次确认：第一次点击上膛，第二次才执行。 */
  const handleRemoveAvatarClick = () => {
    if (confirmAction === 'remove-avatar') {
      setConfirmAction(null)
      void removeAvatar()
    } else {
      setConfirmAction('remove-avatar')
    }
  }

  const handleLogoutAllClick = () => {
    if (confirmAction === 'logout-all') {
      setConfirmAction(null)
      void signOutAllDevices()
    } else {
      setConfirmAction('logout-all')
    }
  }

  const signOutCurrentDevice = () => {
    clearSession()
    navigate('/login', { replace: true })
  }

  const roleLabel = user?.role === 'admin' ? '管理员' : user?.role === 'teacher' ? '教师' : user?.role === 'student' ? '学生' : '—'
  /** 头像渲染取值：上传中的即时预览优先，其次服务端 `avatar_url`，都没有则渲染姓名首字。 */
  const shownAvatar = pendingAvatar ?? avatarUrl

  return <section className="page wide-page settings-page">
    <PageTitle
      eyebrow="PREFERENCES & SYSTEM"
      title="偏好与系统设置"
      description="个性化定制个人学籍身份、回答渲染与引用偏好、通知提醒与数据留存周期。"
    />
    {(loadError || actionError) && <div className="form-error">{loadError || actionError}</div>}
    <div className="settings-layout">
      <aside className="settings-rail">
        <p className="rail-label">配置导航目录</p>
        <nav className="rail-nav">
          {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={`rail-item${activeSection === id ? ' active' : ''}`} onClick={() => scrollToSection(id)}>
              <Icon size={16} strokeWidth={1.9} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        {/* 09-23：原先这里挂着「智能体健康度」集群状态块（逐行列出 /agents 下发的
            在线/忙碌/降级）。全站只剩一个主智能体，没有集群可看，整块删掉。 */}
      </aside>
      <div className="settings-sections">
        {<section id="settings-identity" className="settings-card">
          <header className="card-head">
            <div className="card-head-main">
              <School size={19} />
              <div>
                <p className="card-crumb">偏好与系统设置<i>/</i>学籍与身份档案</p>
                <h2>学籍与身份档案</h2><p>个人资料由统一身份认证实时同步，关键变更需经教务处或辅导员核准。</p>
              </div>
            </div>
            <span className="card-badge ok"><span className="badge-dot" />{profileRefreshedAt ? `资料已更新 · ${profileRefreshedAt}` : '资料已同步'}</span>
          </header>
          <div className="identity-card">
            <button
              type="button"
              className="identity-avatar"
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarBusy}
              title="点击更换头像"
              aria-label={avatarUrl ? '更换头像' : '上传头像'}
            >
              {shownAvatar ? <img src={shownAvatar} alt={user?.name || '用户头像'} /> : user?.name?.slice(0, 1) || '—'}
              <span className="avatar-hover" aria-hidden="true">
                {avatarBusy ? <Loader2 size={16} className="spin" /> : <Camera size={16} />}
                <em>{avatarBusy ? '处理中' : '更换'}</em>
              </span>
              <span className="verified-badge"><Check size={11} strokeWidth={3} /></span>
            </button>
            <input ref={avatarInputRef} className="avatar-input" type="file" accept={AVATAR_ACCEPT} onChange={pickAvatar} aria-label="选择头像图片" />
            <div className="identity-main">
              <div className="identity-name-row">
                <strong>{user?.name || '未加载'}</strong>
                {user?.account && <code>{user.account}</code>}
                <span className="role-pill">{roleLabel}</span>
              </div>
              <div className="identity-meta">
                <span>学院：{user?.department || '—'}</span>
              </div>
              {avatarNotice
                ? <p className={`avatar-note ${avatarNotice.tone}`}>{avatarNotice.text}</p>
                : <p className="avatar-note">支持 JPG / PNG / WebP，不超过 2MB，将自动裁为正方形。</p>}
            </div>
            <div className="identity-actions">
              {avatarUrl && (
                <button
                  type="button"
                  className={`danger-button${confirmAction === 'remove-avatar' ? ' armed' : ''}`}
                  onClick={handleRemoveAvatarClick}
                  disabled={avatarBusy}
                >
                  <Trash2 size={15} />{confirmAction === 'remove-avatar' ? '确认移除？' : '移除头像'}
                </button>
              )}
              <button type="button" className="soft-button" onClick={refreshProfile} disabled={refreshingProfile}>
                <RefreshCw size={15} className={refreshingProfile ? 'spin' : undefined} />从教务系统重新同步
              </button>
            </div>
          </div>
        </section>}
        {<section id="settings-security" className="settings-card">
          <header className="card-head">
            <div className="card-head-main">
              <ShieldCheck size={19} />
              <div>
                <p className="card-crumb">偏好与系统设置<i>/</i>账号与安全</p>
                <h2>账号与安全</h2><p>管理多端登录会话；退出全部设备后，所有浏览器与移动端都需要重新登录。</p>
              </div>
            </div>
            <span className="card-badge ok"><span className="badge-dot" />登录会话有效</span>
          </header>
          <div className="settings-action-row">
            <div><strong>退出全部设备</strong><small>撤销服务端所有已登录会话，操作完成后需重新登录。</small></div>
            <button
              type="button"
              className={`danger-button${confirmAction === 'logout-all' ? ' armed' : ''}`}
              onClick={handleLogoutAllClick}
              disabled={signingOutAll}
            >
              <LogOut size={15} />{signingOutAll ? '正在退出…' : confirmAction === 'logout-all' ? '确认退出全部设备？' : '退出全部设备'}
            </button>
          </div>
          <div className="settings-action-row">
            <div><strong>退出当前设备</strong><small>仅清除当前浏览器的登录状态。</small></div>
            <button type="button" className="soft-button" onClick={signOutCurrentDevice}><MonitorSmartphone size={15} />退出登录</button>
          </div>
        </section>}
        {<section id="settings-agent" className="settings-card">
          <header className="card-head">
            <div className="card-head-main">
              <Waypoints size={19} />
              <div>
                <p className="card-crumb">偏好与系统设置<i>/</i>回答与引用偏好</p>
                <h2>回答渲染与引用偏好</h2><p>定义回答的详尽程度，以及是否默认展开权威出处与有效期。</p>
              </div>
            </div>
            {cardDirty.agent && <span className="card-badge modified">已修改</span>}
          </header>
          {/* 09-23：「默认协同调度机制」那组单选（全自主动态路由 / 各领域 Agent）已删 ——
              全站只剩一个主智能体，用户没有可选的调度对象了。 */}
          <div className="settings-group">
            <p className="group-label">回答详尽与溯源粒度</p>
            <div className="option-grid three">
              {ANSWER_LENGTH_OPTIONS.map((option) => (
                <OptionRadio key={option.value} name="answer_length" value={option.value} checked={answerLength === option.value} onChange={setAnswerLength} title={option.title} badge={option.badge} description={option.description} />
              ))}
            </div>
          </div>
          <ToggleRow checked={showCitations} onChange={setShowCitations} label="默认展示引用来源" description="回答完成后自动展开权威出处与有效期，便于核对原文。" />
        </section>}
        {<section id="settings-notifications" className="settings-card">
          <header className="card-head">
            <div className="card-head-main">
              <BellRing size={19} />
              <div>
                <p className="card-crumb">偏好与系统设置<i>/</i>办事与提醒通知</p>
                <h2>办事与提醒通知流</h2><p>材料退回、审核推进与规章修订等重要节点，第一时间同步给你。</p>
              </div>
            </div>
            {cardDirty.notifications && <span className="card-badge modified">已修改</span>}
          </header>
          <ToggleRow checked={taskNotifications} onChange={setTaskNotifications} label="任务状态通知" description="材料退回、审核通过或事项办结时通知我。" />
          <ToggleRow checked={knowledgeNotifications} onChange={setKnowledgeNotifications} label="新规修订与知识库时效提醒" description="回答引用过的规章修订或下线时提醒我。" />
        </section>}
        {<section id="settings-privacy" className="settings-card">
          <header className="card-head">
            <div className="card-head-main">
              <Database size={19} />
              <div>
                <p className="card-crumb">偏好与系统设置<i>/</i>数据与隐私留存</p>
                <h2>数据隐私与知识留存</h2><p>历史记录、附件和下载链接均经过身份鉴权，不会生成永久公开地址。</p>
              </div>
            </div>
            {cardDirty.privacy && <span className="card-badge modified">已修改</span>}
          </header>
          <div className="settings-group">
            <p className="group-label">问答与办事记录留存周期</p>
            <select className="settings-select" value={retention} onChange={(event) => setRetention(event.target.value)} aria-label="问答与办事记录留存周期">
              {retentionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <p className="group-note">所选周期由平台统一执行；选择永久保留时记录一直可用，其余周期到期后对应记录将不可恢复。</p>
          </div>
        </section>}
      </div>
    </div>
    {cropSrc && (
      <AvatarCropper
        src={cropSrc}
        busy={avatarBusy}
        onCancel={() => { setCropSrc(null); setAvatarNotice(null) }}
        onConfirm={handleCropConfirm}
      />
    )}
    <div className="settings-savebar">
      <div className="savebar-inner">
        <div className={`savebar-status${saving ? '' : dirty ? ' dirty' : savedAt ? ' ok' : ''}`}>
          {saving ? <Loader2 size={15} className="spin" /> : dirty ? <span className="status-dot" /> : <CheckCircle2 size={15} />}
          <span>{saving ? '正在保存偏好…' : dirty ? '有未保存的更改' : savedAt ? `偏好已保存 · ${savedAt}` : loadError ? '偏好加载失败，无法保存' : '偏好已与服务器同步'}</span>
        </div>
        <div className="savebar-actions">
          <button type="button" className="soft-button" onClick={resetToDefaults} disabled={saving || !dirty}>恢复系统默认</button>
          <button
            type="button"
            className={`primary-button${dirty ? ' ready' : ''}`}
            onClick={savePreferences}
            disabled={saving || !preferences || !dirty}
          >
            {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />}保存设置
          </button>
        </div>
      </div>
    </div>
    {toast && createPortal(
      <div className="settings-toast" role="status"><CheckCircle2 size={15} />{toast}</div>,
      document.body,
    )}
  </section>
}

type OptionItem = { title: string; badge?: string; description: string }

/** 头像操作结果提示：ok 已更新 / error 校验或上传失败（不再有「本机暂存」一态）。 */
type AvatarNotice = { tone: 'ok' | 'error'; text: string }

/** 把用户选中的原图读成 dataURL，交给 `AvatarCropper` 展示与框选。 */
const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(new Error('file read failed'))
  reader.readAsDataURL(file)
})

function OptionRadio<T extends string>({ name, value, checked, onChange, title, badge, description, className, style }: { name: string; value: T; checked: boolean; onChange: (value: T) => void; className?: string; style?: CSSProperties } & OptionItem) {
  return <label className={`option-card${checked ? ' selected' : ''}${className ? ` ${className}` : ''}`} style={style}>
    <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} />
    <span className="option-body">
      <span className="option-title">{title}{badge && <em>{badge}</em>}</span>
      <span className="option-desc">{description}</span>
    </span>
  </label>
}

function ToggleRow({ checked, onChange, label, description }: { checked: boolean; onChange: (checked: boolean) => void; label: string; description: string }) {
  return <label className="settings-toggle">
    <span className="toggle-copy"><strong>{label}</strong><small>{description}</small></span>
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span className="toggle-track" aria-hidden="true" />
  </label>
}
