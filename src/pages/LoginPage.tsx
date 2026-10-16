import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { useDataModeStore } from '../stores/dataMode'
import { getRememberedAccount, useSessionStore } from '../stores/session'
import type { AuthErrorField } from '../services/auth'

/** 只接受站内路径，挡掉 `?redirect=//evil.com` 这类开放重定向。 */
const safeRedirect = (raw: string | null) => {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/observatory'
  return raw
}

/**
 * 管理端登录。
 *
 * 后端没有管理端专用入口，复用 `POST /auth/login`（文档 6.1），
 * 放行条件在前端：`user.role === 'admin'`（文档第 19 章验收清单第 7 条）。
 * 「不是管理员」与「密码错误」是两种语义，界面要分开说 —— 否则用户会一直怀疑自己密码打错了。
 */
export function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const target = safeRedirect(searchParams.get('redirect'))

  const user = useSessionStore((state) => state.user)
  const pending = useSessionStore((state) => state.pending)
  const login = useSessionStore((state) => state.login)
  const mode = useDataModeStore((state) => state.mode)

  // 「记住我」勾选过的账号回填；密码永远不落盘
  const remembered = getRememberedAccount()
  const [account, setAccount] = useState(remembered)
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(!!remembered)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState<AuthErrorField | undefined>(undefined)

  useEffect(() => {
    if (user) navigate(target, { replace: true })
  }, [user, navigate, target])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    setError('')
    setErrorField(undefined)

    // 空值在前端拦掉，省一次必然失败的往返；其余交给后端判定
    if (!account.trim()) {
      setError('请输入管理员账号')
      setErrorField('account')
      return
    }
    if (!password) {
      setError('请输入密码')
      setErrorField('password')
      return
    }

    const result = await login(account, password, remember)
    if (!result.ok) {
      setError(result.message)
      setErrorField(result.field)
      return
    }
    // 成功后的跳转由上面的 useEffect 统一负责（user 一变就跳），这里不重复导航
  }

  return (
    <div className="login-page">
      <div className="login-visual">
        <div className="visual-top">
          <div className="visual-brand">
            <img src="/campus-flow-logo-v3.png" alt="" />
            <b>CampusFlow</b>
          </div>
          <div className="visual-badge">
            <ShieldCheck size={14} /> 厚德大学 · 信息化办公室
          </div>
        </div>
        <div className="visual-content">
          {/*
            这里原先是 `style={{ color: 'rgba(255,255,255,.6)' }}` —— 深色封面时代留下的。
            封面改成浅色之后，白字落在近白底上，整行字**直接消失**（截图里只能看到一个空档）。
            内联色值正是这种「换主题时漏掉一处」的温床，改回由 login.css 的令牌统一控制。
          */}
          <p className="visual-eyebrow">CAMPUSFLOW CONSOLE</p>
          <h1>
            校园事务
            <br />
            智能问答管理台
          </h1>
          <p>
            CampusFlow 统一承接全校政策咨询、办事流程与学工事务问答。本控制台管理它的知识来源、
            答复质量与操作轨迹，所有高危操作全程留痕，符合高校内控与信息安全审计标准。
          </p>
          <div className="visual-metrics">
            <span>
              <b>19</b>
              <small>已注册接口路由</small>
            </span>
            <span>
              <b>7</b>
              <small>管理模块</small>
            </span>
            <span>
              <b>90d</b>
              <small>审计留存周期</small>
            </span>
          </div>
        </div>
        <p className="visual-foot">© 2026 信息与网络中心 · RBAC-POLICY-V4</p>
      </div>

      <div className="login-panel">
        <div className="login-panel-inner">
          <span className="login-kicker">
            <KeyRound size={13} /> 管理员身份认证
          </span>
          <h2>登录管理后台</h2>
          <p className="hint">使用管理员工号与密码登录。普通用户账号无法访问管理后台。</p>

          <form className="login-form" onSubmit={submit} noValidate>
            <div className="login-field">
              <label className="login-field-label" htmlFor="login-account">
                管理员账号
              </label>
              <div className={`login-input-wrap${errorField === 'account' ? ' is-error' : ''}`}>
                <UserRound size={15} />
                <input
                  id="login-account"
                  className="login-input"
                  value={account}
                  onChange={(event) => setAccount(event.target.value)}
                  placeholder="工号 / 邮箱"
                  autoComplete="username"
                  autoFocus
                  disabled={pending}
                  aria-invalid={errorField === 'account'}
                />
              </div>
            </div>

            <div className="login-field">
              <label className="login-field-label" htmlFor="login-password">
                密码
              </label>
              <div className={`login-input-wrap${errorField === 'password' ? ' is-error' : ''}`}>
                <Lock size={15} />
                <input
                  id="login-password"
                  className="login-input"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="请输入登录密码"
                  autoComplete="current-password"
                  disabled={pending}
                  aria-invalid={errorField === 'password'}
                />
                <button
                  type="button"
                  className="login-input-affix"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <label className="login-check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                disabled={pending}
              />
              <span>记住账号（仅记录账号，不保存密码）</span>
            </label>

            {error && (
              <p className="login-alert" role="alert">
                <AlertCircle size={15} />
                <span>{error}</span>
              </p>
            )}

            <button className="btn btn-primary login-button" type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 size={16} className="spin" /> 正在验证身份…
                </>
              ) : (
                <>
                  登录管理后台 <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {mode === 'mock' ? (
            <div className="login-demo">
              <p className="login-demo-title">Mock 模式演示账号（任意密码）</p>
              <ul>
                <li>
                  <code className="mono">10008892</code> 林宪成 · 超级管理员 —— 正常登录
                </li>
                <li>
                  <code className="mono">2022010834</code> 林晨 · 学生 —— 演示非管理员被拦截
                </li>
              </ul>
              <p className="login-demo-note">姓名与部门取自内置数据，与真实后端返回无关。</p>
            </div>
          ) : (
            <p className="login-note">
              数据源：真实接口 <code className="mono">/api/v1</code>，请确认后端已启动
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
