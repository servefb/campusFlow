import { useState } from 'react'
import { ArrowRight, Eye, EyeOff, FileCheck2, GitBranch, ShieldCheck, Workflow } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { login } from '../services/auth'
import { useAuthStore } from '../stores/auth'
import { apiErrorMessage } from '../services/http'

export function LoginPage() {
  const navigate = useNavigate()
  const setSession = useAuthStore((state) => state.setSession)
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setLoading(true)
    try {
      const session = (await login({ account, password, remember })).data.data
      setSession(session.user, session.access_token, session.refresh_token); navigate('/workspace', { replace: true })
    } catch (requestError) {
      setPassword(''); setError(apiErrorMessage(requestError, '账号或密码错误，请重试'))
    } finally { setLoading(false) }
  }

  return <div className="login-page"><div className="login-card">
    <section className="login-visual">
      <div className="visual-top"><div className="visual-badge"><span className="status-dot" /> 校园统一身份认证</div><div className="visual-time">安全连接 · 权限由后端实时校验</div></div>
      <div className="agent-glass"><div className="agent-glass-title"><strong>校园事务协同中枢</strong><span><i /> 后端服务已接入</span></div><div><Workflow size={15} />事项精准路由 → 业务 Agent</div><div><GitBranch size={15} />规章实时溯源 → 授权知识库</div><div><FileCheck2 size={15} />材料规范预审 → 任务流转接口</div></div>
      <div className="visual-content"><p className="eyebrow">CAMPUS FLOW 理念体系</p><h1>连接校园事务与权威规章</h1><p>智能检索 · 权威溯源 · 协同办理 · 消除繁琐壁垒</p></div>
    </section>
    <section className="login-panel"><div className="login-panel-inner">
      <div className="login-kicker"><ShieldCheck size={16} /> 校园统一身份认证对接中</div><h2>登录校园脉络工作台</h2><p className="muted">面向全校师生的校园事务智能协作中枢，支持学号/教工号一键登录</p>
      <form onSubmit={handleSubmit} className="login-form"><label>学号 / 工号<input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="请输入学号或工号" autoComplete="username" required /></label><label>统一身份认证密码<div className="password-field"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="请输入密码" autoComplete="current-password" required /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label="显示密码">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label><div className="form-meta"><label className="checkbox"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> 在此受信任设备保持登录 14 天</label><a href="#reset">忘记密码？</a></div>{error && <div className="form-error" role="alert">{error}</div>}<button className="primary-button login-button" disabled={loading}>{loading ? '正在登录…' : <>登录校园脉络 <ArrowRight size={18} /></>}</button></form>
      <div className="login-divider">或使用高校认证通道快速登录</div><div className="alt-login"><button type="button">CAS SSO 单点登录</button><button type="button">电子校园卡扫码</button></div>
      <footer className="login-footer"><span>中国教育科研网 CERNET 认证信道</span><span>信息网络中心技术支持 · 隐私保护规范 · 版本 v2.4.0</span></footer>
    </div></section>
  </div></div>
}

