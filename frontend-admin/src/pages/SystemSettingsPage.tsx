import { useState } from 'react'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Database,
  Info,
  KeyRound,
  Lock,
  Network,
  RotateCcw,
  Save,
  ScrollText,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { Badge, Card, Notice, PageHead, Switch } from '../components/ui'
import { useSystemSettings } from '../hooks/queries'
import { apiErrorMessage } from '../services/http'
import { resetKnowledgeVectors, triggerFullReindex, updateRagSettings, updateSecuritySettings } from '../services/settings'
import { formatShortDateTime } from '../utils/format'

/**
 * 系统设置 —— ⚠️ 整页对应接口后端未提供。
 *
 * 文档第 15 章只有 `/health/live`、`/health/ready`、`/admin/audit-logs`，
 * 原型里的 RAG 引擎参数、安全合规开关、高危操作区都没有对应接口。
 * 路径草案见 src/services/settings.ts（搜索 RESERVED）。
 */
export function SystemSettingsPage() {
  const settings = useSystemSettings()
  const [dirty, setDirty] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // 本地草稿：改动先落这里，点「保存生效」才提交，避免每个开关都打一次接口
  const [security, setSecurity] = useState(() => ({
    admin_idle_logout_minutes: 30,
    admin_mfa_enabled: true,
    ip_allowlist_enabled: false,
    ip_allowlist: '10.128.4.0/24\n172.16.0.0/12',
    immutable_log_enabled: true,
  }))
  const [rag, setRag] = useState({
    active_model: 'CampusFlow-Qwen2-7B-32k (本地自有版本授权 V7)',
    max_context_tokens: 8192,
    top_k: 5,
    similarity_threshold: 0.75,
    escalation_enabled: true,
    escalation_min_score: 0.65,
    auto_block_hallucination: true,
  })

  const patch = <T extends object>(setter: (updater: (prev: T) => T) => void, key: keyof T, value: T[keyof T]) => {
    setter((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
    setFeedback('')
  }

  const save = async () => {
    setSaving(true)
    setFeedback('')
    setError('')
    try {
      await updateSecuritySettings(security)
      await updateRagSettings(rag)
      await settings.refetch()
      setDirty(false)
      setFeedback('配置已保存并写入审计日志。')
    } catch (requestError) {
      setError(apiErrorMessage(requestError, '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  const resetDraft = () => {
    const data = settings.data
    if (data) {
      setSecurity({
        admin_idle_logout_minutes: data.security.admin_idle_logout_minutes,
        admin_mfa_enabled: data.security.admin_mfa_enabled,
        ip_allowlist_enabled: data.security.ip_allowlist_enabled,
        ip_allowlist: data.security.ip_allowlist,
        immutable_log_enabled: data.security.immutable_log_enabled,
      })
      setRag({
        active_model: data.rag.active_model,
        max_context_tokens: data.rag.max_context_tokens,
        top_k: data.rag.top_k,
        similarity_threshold: data.rag.similarity_threshold,
        escalation_enabled: data.rag.escalation_enabled,
        escalation_min_score: data.rag.escalation_min_score,
        auto_block_hallucination: data.rag.auto_block_hallucination,
      })
    }
    setDirty(false)
  }

  return (
    <>
      <PageHead
        crumb="平台管理"
        title="系统设置"
        lede="配置 CampusFlow 的运行参数、模型与检索策略、安全合规规则与通知方式。改动会下发给全部服务节点。"
        tools={
          <>
            <Badge tone="slate" dot>
              环境变量已校验
            </Badge>
            <span className="hint mono">AUDIT: 2026-09-15 11:50</span>
          </>
        }
      />

      <div style={{ marginBottom: 16 }}>
        <Notice tone="amber" icon={<Info size={15} />}>
          <b>本页为预留接口</b> —— 接口文档未定义系统设置接口（第 15 章仅覆盖健康检查与审计查询）。
          开关与输入框均可交互，保存时会调用预留路径 <code className="mono">PATCH /admin/settings/security</code> 与{' '}
          <code className="mono">PATCH /admin/settings/rag</code>（见 <code className="mono">src/services/settings.ts</code>）。
        </Notice>
      </div>

      {(feedback || error) && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone={error ? 'coral' : 'emerald'} icon={error ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}>
            {error || feedback}
          </Notice>
        </div>
      )}

      <div className="split-settings">
        {/* 左侧：分组导航（原型为锚点列表 + 状态徽章） */}
        <aside className="settings-index">
          <a href="#security" className="index-item">
            <span className="label-sm">基础信息</span>
            <Badge tone="emerald" dot>
              {dirty ? '未保存' : '已保存'}
            </Badge>
          </a>
          <a href="#security" className="index-item">
            <ShieldCheck size={14} /> 安全与隐私策略
            <Badge tone="amber">2</Badge>
          </a>
          <a href="#security" className="index-item">
            <Database size={14} /> 数据落盘与合规
            <Badge tone="slate">只读</Badge>
          </a>
          <a href="#rag" className="index-item">
            <Network size={14} /> 安全与风控控制
            <Badge tone="emerald">已启用</Badge>
          </a>
          <a href="#danger" className="index-item danger">
            <AlertTriangle size={14} /> 高危防护区
          </a>

          <div className="index-metric">
            <span className="label-sm">环境分辨标记</span>
            <b className="mono">{settings.data?.environment ?? 'CAMPUS_ENV_META'}</b>
            <span className="hint">升级量级：1,892,312 条</span>
            <span className="hint">当前数据量（24 月内）</span>
          </div>
        </aside>

        <div className="settings-main">
          {/* SECTION 01 基础校区配置 */}
          <Card
            title={
              <>
                <ScrollText size={15} /> SECTION 01 · 基础校区配置
              </>
            }
            sub="配置系统运行对时、所属租户信息以及全局权限与参数签发设定。"
            extra={<span className="label-sm mono">CONFIG_ENV_META</span>}
          >
            <div className="kv">
              <div className="kv-row">
                <dt>组织全称</dt>
                <dd>厚德大学</dd>
              </div>
              <div className="kv-row">
                <dt>系统名称</dt>
                <dd>校园脉络 Campus Flow</dd>
              </div>
              <div className="kv-row">
                <dt>技术支持单位</dt>
                <dd>信息网与网络中心 · 多模态与智能系统实验室</dd>
              </div>
              <div className="kv-row">
                <dt>系统管理员邮箱</dt>
                <dd className="mono">admin-agent@naua.edu.cn</dd>
              </div>
              <div className="kv-row">
                <dt>服务终端电话</dt>
                <dd className="mono">010-8829-0186（告警 · 8×4）</dd>
              </div>
            </div>
            <div className="credential-card">
              <KeyRound size={16} />
              <div>
                <b>校园统一身份认证（CAS / SAML 2.0）</b>
                <span className="hint mono">Serial: CF9A5F-PROD-V2-8901 / 32 bytes SSL</span>
                <span className="hint">
                  X.509 已认证至 2026-04-15 · Last checked on 2026-04-20 02:00（约 24 天前）
                </span>
              </div>
              <button className="btn btn-ghost btn-sm">更换密钥对</button>
            </div>
          </Card>

          {/* SECTION 02 RAG 引擎配置 */}
          <Card
            title={
              <>
                <Bot size={15} /> SECTION 02 · AI 大模型与向量检索配置 (RAG Engines)
              </>
            }
            sub="设定默认推理主链、上下文窗口长度与检索精度策略。"
            extra={<Badge tone="coral">ENGINE_ACTIVE</Badge>}
          >
            <div className="form-grid">
              <label className="span-2">
                <span className="label-sm">默认推理主链（Default LLM）</span>
                <select className="field" value={rag.active_model} onChange={(event) => patch(setRag, 'active_model', event.target.value)}>
                  <option value="CampusFlow-Qwen2-7B-32k (本地自有版本授权 V7)">CampusFlow-Qwen2-7B-32k（本地自有版本授权 V7）</option>
                  <option value="DeepSeek-V3 (云端 API)">DeepSeek-V3（云端 API）</option>
                  <option value="GPT-4o-mini (云端 API)">GPT-4o-mini（云端 API）</option>
                </select>
                <small className="field-hint">所有未提交提交后的推理请求将在此主链上执行。</small>
              </label>
              <label>
                <span className="label-sm">上下文最大 Token 窗口限制</span>
                <select className="field" value={rag.max_context_tokens} onChange={(event) => patch(setRag, 'max_context_tokens', Number(event.target.value))}>
                  <option value={8192}>8,192 Tokens（标准模式，长对话与全校事务窗口）</option>
                  <option value={32768}>32,768 Tokens（长文本模式）</option>
                  <option value={4096}>4,096 Tokens（省流模式）</option>
                </select>
                <small className="field-hint">超出窗口的上下文将被截断并以历史摘要补齐。</small>
              </label>
              <label>
                <span className="label-sm">检索 Top-K 召回条数</span>
                <input
                  className="field"
                  type="number"
                  min={1}
                  max={20}
                  value={rag.top_k}
                  onChange={(event) => patch(setRag, 'top_k', Number(event.target.value))}
                />
                <small className="field-hint">控制单次注入上下文的知识条数。</small>
              </label>
              <div>
                <span className="label-sm">召回相似度推断闸值</span>
                <div className="slider-row">
                  <input
                    type="range"
                    min={0.5}
                    max={0.95}
                    step={0.01}
                    value={rag.similarity_threshold}
                    onChange={(event) => patch(setRag, 'similarity_threshold', Number(event.target.value))}
                  />
                  <b className="mono">{rag.similarity_threshold.toFixed(2)}</b>
                </div>
                {rag.similarity_threshold < 0.7 && (
                  <div className="quad-note coral">
                    <AlertTriangle size={13} />
                    低闸值（召回放宽）可能纳入低相关语义条目，建议保持 0.75 以上。
                  </div>
                )}
                <div className="scale-row">
                  <span>0.50（极宽松）</span>
                  <span>0.65（默认）</span>
                  <span>0.75（推荐）</span>
                  <span>0.90（较严格）</span>
                </div>
              </div>
            </div>

            <div className="section-divider" />

            <h3 className="sub-h3">人工复核介入触发条件（Escalation Triggers）</h3>
            <div className="checkbox-grid">
              <label className="check-row">
                <Switch on={rag.escalation_enabled} onChange={(next) => patch(setRag, 'escalation_enabled', next)} label="触发" />
                <div>
                  <b>单轮求答、有未授权内容的缺失知识</b>
                  <p>回答中若未命中任一知识源，置信度低于 60% 时强制转人工。</p>
                </div>
              </label>
              <label className="check-row">
                <Switch on={rag.auto_block_hallucination} onChange={(next) => patch(setRag, 'auto_block_hallucination', next)} label="触发" />
                <div>
                  <b>拒答源超引用与时效性问题</b>
                  <p>引用条目数≥3 且指向同一失效法源时，自动拦截并生成复核工单。</p>
                </div>
              </label>
              <label className="check-row disabled">
                <Switch on={false} onChange={() => undefined} label="未启用" />
                <div>
                  <b>多轮会话中，自动截断超长上下文</b>
                  <p>单会话轮次超过 12 轮时触发压缩，超出部分计入摘要。</p>
                </div>
              </label>
              <label className="check-row disabled">
                <Switch on={false} onChange={() => undefined} label="未启用" />
                <div>
                  <b>敏感词与政策合规触发</b>
                  <p>命中政治敏感、涉密或未授权数据时立即隔离并通知合规组。</p>
                </div>
              </label>
            </div>
          </Card>

          {/* SECTION 03 安全与合规策略 */}
          <Card
            id="security"
            title={
              <>
                <ShieldCheck size={15} /> SECTION 03 · 安全与合规策略 (Security &amp; Compliance)
              </>
            }
            sub="配置会话安全策略、网络访问白名单与日志防篡改保护。"
            extra={<span className="label-sm mono">RISK_ENFORCED</span>}
          >
            <div className="form-grid">
              <label>
                <span className="label-sm">管理员会话闲置自动登出时长</span>
                <select
                  className="field"
                  value={security.admin_idle_logout_minutes}
                  onChange={(event) => patch(setSecurity, 'admin_idle_logout_minutes', Number(event.target.value))}
                >
                  <option value={15}>15 分钟无操作自动登出（默认）</option>
                  <option value={30}>30 分钟无操作自动登出（推荐）</option>
                  <option value={60}>60 分钟无操作自动登出</option>
                </select>
                <small className="field-hint">超过时长后需重新通过 CAS 认证，本地缓存立即清除。</small>
              </label>
              <div className="toggle-card">
                <div>
                  <b>管理员双因子令牌（MFA）</b>
                  <small className="field-hint">基于 TOTP（30 秒）· 重新扫码绑定请前往个人安全中心</small>
                </div>
                <Switch on={security.admin_mfa_enabled} onChange={(next) => patch(setSecurity, 'admin_mfa_enabled', next)} label="双因子" />
              </div>
            </div>

            <div className="section-divider" />

            <label>
              <span className="label-sm">后台白名单网络策略（CIDR 格式）</span>
              <textarea
                className="field textarea"
                rows={4}
                value={security.ip_allowlist}
                onChange={(event) => patch(setSecurity, 'ip_allowlist', event.target.value)}
                placeholder="10.128.4.0/24"
              />
              <small className="field-hint">
                每行一个网段。当前系统包含 3 个活跃网段，来自 IP 范围的技术中心管控端口 2.5。
              </small>
            </label>

            <div className="toggle-card mt-16">
              <div>
                <b>日志防篡改与双写存档</b>
                <span className="hint">要求所有高危操作与合规链路不可被任何管理员删除或修改。</span>
                <div className="audit-inline">
                  <Lock size={12} />
                  <span className="mono hint">审计日志已启用「不可变」模式 · 90 天内禁止物理删除</span>
                </div>
              </div>
              <Switch on={security.immutable_log_enabled} onChange={(next) => patch(setSecurity, 'immutable_log_enabled', next)} label="不可变日志" />
            </div>
          </Card>

          {/* 高危防护区 */}
          <Card
            id="danger"
            className="danger-zone"
            title={
              <>
                <AlertTriangle size={15} style={{ color: 'var(--coral)' }} /> 高危防护区（Danger Zone）
              </>
            }
            sub="以下操作可能对系统产生不可逆影响，执行前请确认已完成管理员身份验证。"
          >
            <div className="danger-grid">
              <div>
                <span className="label-sm">清理向量索引</span>
                <p className="hint">
                  安全清除 Milvus 索引数据。该操作将先删除已完成文档重新建索引，请确保无正在运行的写作任务。
                </p>
                <DangerAction
                  label="清空向量库"
                  confirmHint="此操作不可逆。请输入「RESET-VECTORS」以确认。"
                  expected="RESET-VECTORS"
                  action={resetKnowledgeVectors}
                  onDone={() => setFeedback('向量重置任务已进入队列，可在知识治理页跟踪作业进度。')}
                  onError={(message) => setError(message)}
                />
              </div>
              <div>
                <span className="label-sm">强制全量滚动检索引擎重建</span>
                <p className="hint">
                  Force GCR 路由：GPU-V4-75-1S，触发全量索引重建，并同步载入默认场景语料库。
                </p>
                <DangerAction
                  label="强制重建索引"
                  confirmHint="此操作将占用大量算力。请输入「FULL-REINDEX」以确认。"
                  expected="FULL-REINDEX"
                  variant="outline"
                  action={triggerFullReindex}
                  onDone={() => setFeedback('全量索引任务已进入队列（job_id: 99）。')}
                  onError={(message) => setError(message)}
                />
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* 底部保存条（对应原型 footer） */}
      <div className={`save-bar${dirty ? ' is-dirty' : ''}`}>
        <span className="hint">
          上次保存于 {settings.data?.security?.updated_at ? formatShortDateTime(settings.data.security.updated_at) : '—'} · 操作人：
          {settings.data?.security?.updated_by ?? '系统超管'}
        </span>
        <div className="toolbar-spacer" />
        {dirty && <span className="mock-flag">有未保存的修改</span>}
        <button className="btn btn-ghost" disabled={!dirty || saving} onClick={resetDraft}>
          <RotateCcw size={14} /> 恢复默认设置
        </button>
        <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}>
          <Save size={14} /> {saving ? '保存中…' : '保存生效策略'}
        </button>
      </div>
    </>
  )
}

function DangerAction({
  label,
  confirmHint,
  expected,
  variant = 'solid',
  action,
  onDone,
  onError,
}: {
  label: string
  confirmHint: string
  expected: string
  variant?: 'solid' | 'outline'
  action: (code: string) => Promise<unknown>
  onDone: () => void
  onError: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      await action(code)
      setOpen(false)
      setCode('')
      onDone()
    } catch (error) {
      onError(apiErrorMessage(error, '高危操作执行失败'))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button className={variant === 'solid' ? 'btn btn-danger-solid btn-sm' : 'btn btn-danger btn-sm'} onClick={() => setOpen(true)}>
        {variant === 'solid' ? <Trash2 size={13} /> : <RotateCcw size={13} />} {label}
      </button>
    )
  }

  return (
    <div className="danger-confirm">
      <Notice tone="coral" icon={<AlertTriangle size={14} />}>
        {confirmHint}
      </Notice>
      <div className="danger-confirm-row">
        <input
          className="field"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={expected}
          aria-label="确认码"
        />
        <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setCode('') }}>
          取消
        </button>
        <button className="btn btn-danger-solid btn-sm" disabled={code !== expected || busy} onClick={run}>
          {busy ? '执行中…' : '确认执行'}
        </button>
      </div>
    </div>
  )
}
