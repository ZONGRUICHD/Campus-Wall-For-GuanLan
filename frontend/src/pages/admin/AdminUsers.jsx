import { useEffect, useMemo, useState } from 'react'
import AdminShell from '../../components/AdminShell.jsx'
import Modal from '../../components/Modal.jsx'
import { useAlert } from '../../contexts/AlertContext.jsx'
import api from '../../services/api'

const roleOptions = [
  { value: 'user', label: '普通用户', description: '使用前台账号功能，不进入管理后台。' },
  { value: 'reviewer', label: '审核员', description: '可审核全部帖子并管理主页公告，不能添加审核员或修改任何人的权限。' },
  { value: 'admin', label: '管理员', description: '可管理内容与平台日常事务，不能修改用户角色。' },
  { value: 'super_admin', label: '超级管理员', description: '拥有全部权限，包括任命管理员、超级管理员与审核员。' }
]

const roleMeta = (role) => roleOptions.find((option) => option.value === role) || roleOptions[0]

const defaultMuteUntil = () => {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

const formatTime = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

function StatusBadge({ user }) {
  if (user.status === 'disabled') return <span className="badge status-danger">已停用</span>
  if (user.is_muted) return <span className="badge status-warning">禁言中</span>
  return <span className="badge status-success">正常</span>
}

function RoleBadge({ role }) {
  const meta = roleMeta(role)
  const statusClass = role === 'super_admin' ? 'status-danger' : role === 'admin' ? 'status-success' : role === 'reviewer' ? 'status-warning' : ''
  return <span className={`badge ${statusClass}`}><i className={`bi ${role === 'super_admin' ? 'bi-stars' : role === 'admin' ? 'bi-shield-check' : role === 'reviewer' ? 'bi-clipboard-check' : 'bi-person'}`} />{meta.label}</span>
}

export default function AdminUsers() {
  const [users, setUsers] = useState([])
  const [stats, setStats] = useState({ total: 0, active: 0, disabled: 0, muted: 0 })
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [status, setStatus] = useState('')
  const [role, setRole] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null)
  const [roleTarget, setRoleTarget] = useState(null)
  const [nextRole, setNextRole] = useState('user')
  const [muteTarget, setMuteTarget] = useState(null)
  const [resetTarget, setResetTarget] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [muteUntil, setMuteUntil] = useState(defaultMuteUntil())
  const [muteReason, setMuteReason] = useState('')
  const [canManageRoles, setCanManageRoles] = useState(false)
  const alert = useAlert()

  const params = useMemo(() => ({
    page,
    page_size: 20,
    q: appliedQuery,
    status,
    role
  }), [appliedQuery, page, role, status])

  const load = async () => {
    setLoading(true)
    try {
      const [list, stat, roles] = await Promise.all([api.adminGetUsers(params), api.adminGetUserStats(), api.adminGetRoles()])
      setUsers(list.data?.users || [])
      setTotalPages(Math.max(1, Number(list.data?.total_pages) || 1))
      setStats(stat.data?.stats || { total: 0, active: 0, disabled: 0, muted: 0 })
      setCanManageRoles(roles.data?.can_manage_roles === true)
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '用户加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [params])

  const run = async (action, successMessage) => {
    setBusy(true)
    try {
      await action()
      alert.showTopRightAlert(successMessage, 'success', '操作完成')
      await load()
      return true
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '操作失败')
      return false
    } finally {
      setBusy(false)
    }
  }

  const search = () => {
    setPage(1)
    setAppliedQuery(query.trim())
  }

  const saveEdit = async () => {
    if (!editing) return
    if (await run(() => api.adminUpdateUser(editing.id, editing), '用户资料已更新')) setEditing(null)
  }

  const openRole = (user) => {
    setRoleTarget(user)
    setNextRole(user.role || 'user')
  }

  const saveRole = async () => {
    if (!roleTarget) return
    if (nextRole === 'super_admin' && roleTarget.role !== 'super_admin') {
      const confirmed = window.confirm(`确定将“${roleTarget.username}”设为超级管理员吗？该用户将获得全部权限，包括继续任命其他超级管理员。`)
      if (!confirmed) return
    }
    const targetLabel = roleMeta(nextRole).label
    if (await run(() => api.adminSetUserRole(roleTarget.id, nextRole), `${roleTarget.username} 已设为${targetLabel}`)) setRoleTarget(null)
  }

  const disableUser = async (user) => {
    if (!window.confirm(`确定停用账号“${user.username}”吗？历史内容会保留。`)) return
    await run(() => api.adminDisableUser(user.id), `${user.username} 已停用`)
  }

  const openMute = (user) => {
    setMuteTarget(user)
    setMuteUntil(defaultMuteUntil())
    setMuteReason('')
  }

  const saveMute = async () => {
    if (!muteTarget) return
    if (await run(() => api.adminMuteUser(muteTarget.id, { muted_until: muteUntil, reason: muteReason }), `${muteTarget.username} 已禁言`)) setMuteTarget(null)
  }

  const unmute = async (user) => run(() => api.adminUnmuteUser(user.id), `${user.username} 已解除禁言`)

  const resetPassword = async () => {
    if (!resetTarget || newPassword.length < 8) return
    if (await run(() => api.adminResetUserPassword(resetTarget.id, newPassword), `${resetTarget.username} 的密码已重置`)) {
      setResetTarget(null)
      setNewPassword('')
    }
  }

  return (
    <AdminShell title="用户与权限">
      <div className="info-callout mb-5 p-4 text-sm">
        <i className="bi bi-shield-lock-fill" />
        <div><b>{canManageRoles ? '你可以修改账号角色。' : '角色只能由超级管理员修改。'}</b><p className="mt-1 text-muted">审核员负责帖子审核与主页公告；管理员可管理普通用户与日常运营；超级管理员拥有全部权限。</p></div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card-flat admin-stat-card"><b>{stats.total || 0}</b><p className="text-muted">注册用户</p></div>
        <div className="card-flat admin-stat-card"><b>{stats.active || 0}</b><p className="text-muted">正常账号</p></div>
        <div className="card-flat admin-stat-card"><b>{stats.muted || 0}</b><p className="text-muted">禁言中</p></div>
        <div className="card-flat admin-stat-card"><b>{stats.disabled || 0}</b><p className="text-muted">已停用</p></div>
      </div>

      <div className="admin-toolbar mb-4">
        <input className="field admin-toolbar-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && search()} placeholder="搜索用户名或昵称" />
        <select className="field w-auto" value={role} onChange={(event) => { setRole(event.target.value); setPage(1) }} aria-label="按角色筛选">
          <option value="">全部角色</option>
          {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select className="field w-auto" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }} aria-label="按账号状态筛选">
          <option value="">全部状态</option>
          <option value="active">正常</option>
          <option value="disabled">已停用</option>
        </select>
        <button className="btn btn-primary" type="button" onClick={search}><i className="bi bi-search" />搜索</button>
        <button className="btn btn-outline" type="button" onClick={load}><i className="bi bi-arrow-clockwise" />刷新</button>
      </div>

      {loading ? <div className="page-center"><div className="spinner" /></div> : null}
      <div className="data-table-wrap">
        <table className="data-table min-w-[960px] text-left">
          <thead><tr><th>用户名</th><th>显示名称</th><th>角色</th><th>账号状态</th><th>禁言到期</th><th>最后登录</th><th className="text-right">操作</th></tr></thead>
          <tbody>
            {users.map((user) => {
              const canManageTarget = canManageRoles || user.role === 'user'
              return <tr key={user.id}>
                <td><div className="font-semibold">{user.username}</div><div className="text-xs text-muted">ID {user.id}</div></td>
                <td>{user.nickname || user.real_name || '-'}</td>
                <td><RoleBadge role={user.role || 'user'} /></td>
                <td><StatusBadge user={user} /></td>
                <td>{formatTime(user.muted_until)}{user.mute_reason ? <div className="text-xs text-muted">{user.mute_reason}</div> : null}</td>
                <td>{formatTime(user.last_login_at)}</td>
                <td>
                  <div className="data-table-actions">
                    {canManageRoles ? <button className="btn btn-sm btn-primary" type="button" disabled={busy} onClick={() => openRole(user)}><i className="bi bi-person-gear" />设置角色</button> : null}
                    {canManageTarget ? <>
                      <button className="btn btn-sm btn-outline" type="button" disabled={busy} onClick={() => setEditing({ ...user })}>资料</button>
                      {user.is_muted ? <button className="btn btn-sm btn-outline" type="button" disabled={busy} onClick={() => unmute(user)}>解禁</button> : <button className="btn btn-sm btn-outline" type="button" disabled={busy} onClick={() => openMute(user)}>禁言</button>}
                      <button className="btn btn-sm btn-outline" type="button" disabled={busy} onClick={() => setResetTarget(user)}>重置密码</button>
                      <button className="btn btn-sm btn-danger" type="button" disabled={busy || user.status === 'disabled'} onClick={() => disableUser(user)}>停用</button>
                    </> : <span className="text-xs text-muted">仅超级管理员可操作</span>}
                  </div>
                </td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
      {!loading && !users.length ? <p className="py-8 text-center text-muted">没有匹配的注册用户</p> : null}
      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button className="btn btn-sm btn-outline" type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
          <span className="text-sm text-muted">第 {page} / {totalPages} 页</span>
          <button className="btn btn-sm btn-outline" type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>下一页</button>
        </div>
      ) : null}

      <Modal visible={Boolean(roleTarget)} title={`设置 ${roleTarget?.username || ''} 的角色`} onClose={() => !busy && setRoleTarget(null)} footer={<><button className="btn btn-outline" type="button" disabled={busy} onClick={() => setRoleTarget(null)}>取消</button><button className="btn btn-primary" type="button" disabled={busy || nextRole === (roleTarget?.role || 'user')} onClick={saveRole}>确认设置</button></>}>
        <fieldset className="space-y-3" disabled={busy}>
          <legend className="sr-only">选择账号角色</legend>
          {roleOptions.map((option) => (
            <label className={`card-flat flex cursor-pointer items-start gap-3 p-4 ${nextRole === option.value ? 'border-[var(--primary-color)]' : ''}`} key={option.value}>
              <input className="mt-1" type="radio" name="user-role" value={option.value} checked={nextRole === option.value} onChange={() => setNextRole(option.value)} />
              <span><b>{option.label}</b><small className="mt-1 block text-muted">{option.description}</small></span>
            </label>
          ))}
        </fieldset>
        {nextRole === 'super_admin' ? <div className="info-callout status-warning mt-4 p-3 text-sm"><i className="bi bi-exclamation-triangle-fill" /><span>超级管理员可以修改所有用户权限。只授予你完全信任的人。</span></div> : null}
      </Modal>

      <Modal visible={Boolean(editing)} title="编辑用户资料" onClose={() => !busy && setEditing(null)} footer={<><button className="btn btn-outline" type="button" disabled={busy} onClick={() => setEditing(null)}>取消</button><button className="btn btn-primary" type="button" disabled={busy} onClick={saveEdit}>保存</button></>}>
        {editing ? (
          <div className="space-y-4">
            <div className="info-callout p-3 text-sm text-muted">用户名“{editing.username}”不能在这里修改。</div>
            <label className="block"><span className="mb-2 block text-sm font-bold">昵称</span><input className="field" maxLength={30} value={editing.nickname || ''} onChange={(event) => setEditing((item) => ({ ...item, nickname: event.target.value }))} /></label>
            <label className="block"><span className="mb-2 block text-sm font-bold">个人简介</span><textarea className="field min-h-24" maxLength={200} value={editing.bio || ''} onChange={(event) => setEditing((item) => ({ ...item, bio: event.target.value }))} /></label>
            <label className="block"><span className="mb-2 block text-sm font-bold">状态</span><select className="field" value={editing.status || 'active'} onChange={(event) => setEditing((item) => ({ ...item, status: event.target.value }))}><option value="active">正常</option><option value="disabled">停用</option></select></label>
          </div>
        ) : null}
      </Modal>

      <Modal visible={Boolean(muteTarget)} title={`禁言 ${muteTarget?.username || ''}`} onClose={() => !busy && setMuteTarget(null)} footer={<><button className="btn btn-outline" type="button" disabled={busy} onClick={() => setMuteTarget(null)}>取消</button><button className="btn btn-primary" type="button" disabled={busy || !muteUntil} onClick={saveMute}>确认禁言</button></>}>
        <div className="space-y-4">
          <label className="block"><span className="mb-2 block text-sm font-bold">禁言到期时间</span><input className="field" type="datetime-local" value={muteUntil} onChange={(event) => setMuteUntil(event.target.value)} /></label>
          <label className="block"><span className="mb-2 block text-sm font-bold">原因</span><textarea className="field min-h-24" maxLength={200} value={muteReason} onChange={(event) => setMuteReason(event.target.value)} placeholder="给用户看的原因（可选）" /></label>
        </div>
      </Modal>

      <Modal visible={Boolean(resetTarget)} title={`重置 ${resetTarget?.username || ''} 的密码`} onClose={() => !busy && setResetTarget(null)} footer={<><button className="btn btn-outline" type="button" disabled={busy} onClick={() => setResetTarget(null)}>取消</button><button className="btn btn-primary" type="button" disabled={busy || newPassword.length < 8} onClick={resetPassword}>确认重置</button></>}>
        <label className="block"><span className="mb-2 block text-sm font-bold">新密码</span><input className="field" type="password" autoComplete="new-password" maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="至少 8 个字符" /></label>
      </Modal>
    </AdminShell>
  )
}
