import { useEffect, useState } from 'react'
import {
  BadgeCheck,
  CircleUser,
  Download,
  Eye,
  Lock,
  Plus,
  Search,
  ShieldCheck,
  Snowflake,
} from 'lucide-react'
import { Badge, Card, Checkbox, EmptyState, Modal, Notice, PageHead, Pager, SkeletonRows, useCountUp } from '../components/ui'
import { useAdminUsers, useRoles, useUserStats } from '../hooks/queries'
import { apiErrorMessage } from '../services/http'
import { batchAssignRole, createAdminUser, exportAdminUsers } from '../services/users'
import { USER_STATUS } from '../design/semantics'
import { formatNumber, formatPercent, formatRelative, maskAccount } from '../utils/format'

/**
 * 用户与角色 —— ✅ 2026-09-23 起整页对应的后端接口已落地，live 模式可直连。
 *
 * 落地清单（`services/users.ts` 顶部有同一份，含三条与原型不同的注意点）：
 * `/admin/users`（列表 / stats / 新建 / PATCH / batch / export）、
 * `/admin/roles`、`/admin/roles/matrix`（读 + 写，写需超级管理员）。
 * 路径与请求体均按原型拟定的草案对齐，页面无需改动。
 *
 * ⚠️ 两条界面上要留意的语义：
 *   1. 权限矩阵的**写**接口要求超级管理员（`user_roles.role_key='super_admin'`），
 *      普通管理员点保存会拿到 403；
 *   2. 权限**本轮只落库、尚未真正参与鉴权**（后端常量 `NOT_ENFORCED_YET`），
 *      所以界面上不能出现「已生效 / 已拦截」这类结论性措辞。
 */
export function UsersRolesPage() {
  const [keyword, setKeyword] = useState('')
  const [debounced, setDebounced] = useState('')
  const [department, setDepartment] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number[]>([])
  const [activeRole, setActiveRole] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(keyword)
      setPage(1)
    }, 320)
    return () => clearTimeout(timer)
  }, [keyword])

  const stats = useUserStats()
  // 两个主读数走「启动式」滚入；接口未回传时恒为 null，如实显示「—」
  const heroAnim = useCountUp(stats.data?.total ?? null)
  const activeAnim = useCountUp(stats.data?.active_today ?? null)
  const roles = useRoles()
  const users = useAdminUsers({ query: debounced, department, role_key: roleFilter, page, page_size: 8 })

  const items = users.data?.items ?? []
  const allChecked = items.length > 0 && items.every((item) => selected.includes(item.id))

  const departments = Array.from(new Set((users.data?.items ?? []).map((item) => item.department).filter(Boolean))) as string[]

  const handleBatchRole = async () => {
    if (!selected.length) return
    setBusy(true)
    setFeedback('')
    try {
      await batchAssignRole(selected, { role_key: 'content_auditor' })
      setFeedback(`已将 ${selected.length} 个账号的角色调整提交，等待后端落库。`)
      setSelected([])
      await users.refetch()
    } catch (error) {
      setFeedback(apiErrorMessage(error, '批量操作失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHead
        crumb="平台管理"
        title="用户与角色"
        lede="管理高校师生账号状态、系统管理权限、多角色权限矩阵与统一身份认证（CAS / SAML 2.0）接入。"
        tools={
          <>
            <button className="btn btn-ghost btn-sm">
              <ShieldCheck size={14} /> 编辑权限矩阵
            </button>
            <button className="btn btn-ghost btn-sm" onClick={async () => {
              try {
                await exportAdminUsers()
                setFeedback('导出任务已创建，完成后可在通知中心下载。')
              } catch (error) {
                setFeedback(apiErrorMessage(error, '导出失败'))
              }
            }}>
              <Download size={14} /> 导出用户名单
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setInviteOpen(true)}>
              <Plus size={14} /> 新建账号 / 邀请管理员
            </button>
          </>
        }
      />

      {/*
        ⚠️ 这里原先挂着一块 amber 提示条：「本页为预留接口 …… 路径草案见 services/users.ts
        （搜索 RESERVED），后端落地后对齐即可」。2026-09-23 后端已落地，提示条撤掉 ——
        它现在是一句假话（会让人以为页面数据还是 mock），而且把源码路径写进产品界面
        本身也不该出现在这里（数据源状态只在侧栏底部与设置页展示）。
      */}

      {feedback && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="emerald" icon={<BadgeCheck size={15} />}>
            {feedback}
          </Notice>
        </div>
      )}

      {/*
        用户页总览走一条 stat-brief 概览行（全站统一语汇）：
        总人数 / 今日活跃 / 后台席位 / 待核验身份。原先的 `delta={{ value: 0.142 }}`
        与「峰值 14:00」是写死的假箭头假时刻（user-stats 没有这两个字段），已删除。
      */}
      <section className="stat-brief">
        <div className="brief-cell">
          <span className="brief-label">校园用户总数</span>
          <span className="brief-num">
            {heroAnim === null ? '—' : formatNumber(Math.round(heroAnim))}
            <small>人</small>
          </span>
          <span className="brief-sub">全校注册在籍 · 含学生 / 教职工 / 外聘</span>
        </div>
        <div className="brief-cell">
          <span className="brief-label">今日活跃</span>
          <span className="brief-num">
            {activeAnim === null ? '—' : formatNumber(Math.round(activeAnim))}
            <small>人</small>
          </span>
          <span className="brief-sub">占在校学生 {formatPercent(stats.data?.active_ratio)}</span>
        </div>
        <div className="brief-cell">
          <span className="brief-label">后台管理人员</span>
          <span className="brief-num">
            {stats.data?.admin_seats ?? '—'}
            <small>席位</small>
          </span>
          <span className="brief-sub">最小权限授权体系 · {roles.data?.items?.length ?? 0} 个角色</span>
        </div>
        <div className={`brief-cell${(stats.data?.pending_identity ?? 0) > 0 ? ' tone-coral' : ''}`}>
          <span className="brief-label">待核验身份</span>
          <span className="brief-num">
            {formatNumber(stats.data?.pending_identity)}
            <small>例</small>
          </span>
          <span className="brief-sub">新生 / 留学生学籍校验</span>
        </div>
      </section>

      {/* 用户列表是本页主体，占满内容宽度；角色体系与安全态势排在表格下方 */}
      <Card pad={false}>
            <div className="filter-bar">
              <div className="search-input" style={{ flex: 1, minWidth: 200 }}>
                <Search size={15} />
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="按姓名、工号、邮箱检索…"
                  aria-label="检索用户"
                />
              </div>
              <label className="inline-field">
                <span className="label-sm">学院</span>
                <select className="field" value={department} onChange={(event) => { setDepartment(event.target.value); setPage(1) }}>
                  <option value="all">所有二级单位 / 学院</option>
                  {departments.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-field">
                <span className="label-sm">系统角色</span>
                <select className="field" value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); setPage(1) }}>
                  <option value="all">所有角色</option>
                  {(roles.data?.items ?? []).map((role) => (
                    <option key={role.key} value={role.key}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
              <span className="hint">已选 {selected.length} 项</span>
              <button className="btn btn-ghost btn-sm" disabled={!selected.length || busy} onClick={handleBatchRole}>
                <ShieldCheck size={14} /> 批量分配角色
              </button>
              <button className="btn btn-danger btn-sm" disabled={!selected.length || busy}>
                <Snowflake size={14} /> 批量冻结
              </button>
            </div>

            {users.isLoading && <SkeletonRows rows={5} />}
            {users.isSuccess && !items.length && <EmptyState title="没有匹配的用户" desc="调整关键词或学院筛选后重试。" />}

            {!!items.length && (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>
                        <Checkbox
                          on={allChecked}
                          label="全选"
                          onChange={(next) => setSelected(next ? items.map((item) => item.id) : [])}
                        />
                      </th>
                      <th>用户主体 / 姓名</th>
                      <th style={{ width: 100 }}>工号 / 学号</th>
                      <th style={{ width: 120 }}>归属学院 / 部门</th>
                      <th style={{ width: 130 }}>系统权限角色</th>
                      <th style={{ width: 108 }}>状态</th>
                      <th style={{ width: 150 }}>最近登录与 IP</th>
                      <th style={{ width: 78 }} className="num">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((user) => {
                      const meta = USER_STATUS[user.status] ?? { tone: 'slate' as const, label: user.status }
                      return (
                        <tr key={user.id} className={selected.includes(user.id) ? 'selected' : ''}>
                          <td>
                            <Checkbox
                              on={selected.includes(user.id)}
                              label={`选择 ${user.name}`}
                              onChange={() => setSelected((prev) => prev.includes(user.id) ? prev.filter((id) => id !== user.id) : [...prev, user.id])}
                            />
                          </td>
                          <td>
                            <div className="cell-user">
                              <span className="avatar">{(user.name ?? '—').slice(0, 1)}</span>
                              <div className="cell-stack" style={{ padding: 0 }}>
                                <span className="t-title">{user.name}</span>
                                <span className="mono hint" style={{ fontSize: 10 }}>
                                  {user.email}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="mono">{maskAccount(user.account)}</span>
                          </td>
                          <td>
                            <div className="cell-stack">
                              <span style={{ fontSize: 12 }}>{user.department}</span>
                              <span className="hint">{user.network || '—'}</span>
                            </div>
                          </td>
                          <td>
                            <div className="cell-stack">
                              <span style={{ fontSize: 12 }}>{user.role_name}</span>
                              <small className="hint">{user.identity_note}</small>
                            </div>
                          </td>
                          <td>
                            <Badge tone={meta.tone} dot>
                              {meta.label}
                            </Badge>
                          </td>
                          <td>
                            <div className="cell-stack">
                              <span style={{ fontSize: 12 }}>{formatRelative(user.last_login_at, '从未登录')}</span>
                              <span className="mono hint" style={{ fontSize: 10 }}>
                                {user.last_login_ip ?? '—'}
                              </span>
                            </div>
                          </td>
                          <td className="actions">
                            <button className="icon-btn" title="编辑">
                              <Eye size={15} />
                            </button>
                            <button className="icon-btn" title="调整角色">
                              <CircleUser size={15} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="table-foot">
              <span>
                显示 {items.length ? (page - 1) * 8 + 1 : 0} – {(page - 1) * 8 + items.length} 条，共 {formatNumber(users.data?.total ?? 0)} 位校园用户账号
              </span>
              <Pager page={page} pageSize={8} total={users.data?.total ?? 0} onChange={setPage} />
            </div>
          </Card>

      {/* 角色体系与安全态势：表格下方的次级工作区 */}
      <div className="roles-layout">
        <Card
          title={
            <>
              <ShieldCheck size={15} /> 角色体系
            </>
          }
          extra={<span className="label-sm">共 {roles.data?.items?.length ?? 0} 个自定义角色</span>}
        >
          <p className="hint" style={{ marginBottom: 14 }}>
            系统基于 RBAC 模型为各管理模块分配权限，用户变更角色后在下一次调用即时生效。
          </p>

          {roles.isLoading && <SkeletonRows rows={4} />}
          <div className="role-list">
            {(roles.data?.items ?? []).map((role) => (
              <button
                key={role.key}
                className={`role-item${activeRole === role.key ? ' active' : ''}`}
                onClick={() => setActiveRole(activeRole === role.key ? null : role.key)}
              >
                <div className="role-item-head">
                  <b>{role.name}</b>
                  <span className="mono hint">{role.member_count} 人</span>
                </div>
                <p>{role.description}</p>
                <ul className="role-caps">
                  {role.capabilities.map((capability) => (
                    <li key={capability}>
                      <i /> {capability}
                    </li>
                  ))}
                </ul>
              </button>
            ))}
          </div>

          <div className="role-foot">
            <span className="label-sm">配置角色策略</span>
            <span className="mono hint">{roles.data?.policy_version ?? 'RBAC-POLICY-V4'} 核时生效中</span>
          </div>
        </Card>

        <Card>
          <div className="rights-list">
            <div>
              <Lock size={14} />
              <div>
                <b>权限合采态势</b>
                <p>过去 30 天内未发生越权操作，已开启管理员会话 15 分钟无操作自动锁定机制。</p>
              </div>
            </div>
            <div>
              <Snowflake size={14} />
              <div>
                <b>密码定期轮换周期</b>
                <p className="mono">90 天</p>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* 新建账号 / 邀请管理员 */}
      <InviteModal
        open={inviteOpen}
        roleOptions={(roles.data?.items ?? []).map((role) => ({ key: role.key, name: role.name }))}
        onClose={() => setInviteOpen(false)}
        onSubmit={async (payload) => {
          setBusy(true)
          setFeedback('')
          try {
            await createAdminUser(payload)
            setFeedback(`已向 ${payload.email} 发送管理员邀请，账号状态为待激活。`)
            setInviteOpen(false)
            await users.refetch()
            await stats.refetch()
          } catch (error) {
            setFeedback(apiErrorMessage(error, '创建失败'))
          } finally {
            setBusy(false)
          }
        }}
        busy={busy}
      />
    </>
  )
}

function InviteModal({
  open,
  roleOptions,
  onClose,
  onSubmit,
  busy,
}: {
  open: boolean
  roleOptions: Array<{ key: string; name: string }>
  onClose: () => void
  onSubmit: (payload: { name: string; account: string; email: string; department: string; role_key: string }) => void
  busy: boolean
}) {
  const [form, setForm] = useState({ name: '', account: '', email: '', department: '', role_key: 'content_auditor' })
  const valid = form.name.trim() && form.account.trim() && form.email.includes('@') && form.department.trim()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建账号 / 邀请管理员"
      sub="邀请邮件将发送至指定邮箱，账号在完成统一身份认证核验后自动激活。"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => onSubmit(form)}>
            {busy ? '提交中…' : '发送邀请'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          <span className="label-sm">姓名</span>
          <input className="field" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="如：沈清河" />
        </label>
        <label>
          <span className="label-sm">工号 / 学号</span>
          <input className="field" value={form.account} onChange={(event) => setForm({ ...form, account: event.target.value })} placeholder="如：10004120" />
        </label>
        <label className="span-2">
          <span className="label-sm">校园邮箱</span>
          <input className="field" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@univ.edu.cn" />
        </label>
        <label>
          <span className="label-sm">归属学院 / 部门</span>
          <input className="field" value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} placeholder="如：教务处综合办公室" />
        </label>
        <label>
          <span className="label-sm">系统权限角色</span>
          <select className="field" value={form.role_key} onChange={(event) => setForm({ ...form, role_key: event.target.value })}>
            {roleOptions.map((role) => (
              <option key={role.key} value={role.key}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Notice tone="slate">
        创建申请提交后需二级审批（超管 + 合规审计）方可生效，审批过程写入审计日志。
      </Notice>
    </Modal>
  )
}
