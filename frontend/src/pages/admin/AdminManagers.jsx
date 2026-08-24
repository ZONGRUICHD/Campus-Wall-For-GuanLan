import { useCallback, useEffect, useMemo, useState } from 'react'
import AdminShell from '../../components/AdminShell.jsx'
import Modal from '../../components/Modal.jsx'
import api from '../../services/api'
import { useAlert } from '../../contexts/AlertContext.jsx'

const emptyStats = { total: 0, active: 0, disabled: 0, super_admins: 0 }
const emptyCreate = { username: '', password: '', permissions: [] }

const permissionNames = (manager) => (manager?.permissions || []).map((permission) => permission.name)

function PermissionPicker({ definitions, selected, onChange, disabled = false }) {
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const toggle = (name) => {
    onChange(selectedSet.has(name) ? selected.filter((item) => item !== name) : [...selected, name])
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold">功能权限</span>
        <div className="flex gap-2">
          <button className="btn btn-sm btn-ghost" type="button" disabled={disabled} onClick={() => onChange(definitions.map((item) => item.name))}>全选</button>
          <button className="btn btn-sm btn-ghost" type="button" disabled={disabled} onClick={() => onChange([])}>清空</button>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {definitions.map((permission) => (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--card-secondary-bg)] p-3" key={permission.name}>
            <input
              className="mt-1 h-4 w-4 accent-[var(--primary-color)]"
              type="checkbox"
              checked={selectedSet.has(permission.name)}
              disabled={disabled}
              onChange={() => toggle(permission.name)}
            />
            <span className="min-w-0">
              <b className="block text-sm">{permission.description}</b>
              <code className="text-xs text-muted">{permission.name}</code>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

export default function AdminManagers() {
  const [managers, setManagers] = useState([])
  const [permissions, setPermissions] = useState([])
  const [stats, setStats] = useState(emptyStats)
  const [currentUsername, setCurrentUsername] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [createVisible, setCreateVisible] = useState(false)
  const [createForm, setCreateForm] = useState(emptyCreate)
  const [editTarget, setEditTarget] = useState(null)
  const [editForm, setEditForm] = useState({ status: 'active', permissions: [] })
  const [resetTarget, setResetTarget] = useState(null)
  const [resetPassword, setResetPassword] = useState('')
  const [ownPassword, setOwnPassword] = useState({ current_password: '', new_password: '', confirm_password: '' })
  const alert = useAlert()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.adminGetManagers()
      setManagers(response.data?.managers || [])
      setPermissions(response.data?.permissions || [])
      setStats({ ...emptyStats, ...(response.data?.stats || {}) })
      setCurrentUsername(response.data?.current_username || '')
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '加载管理员账号失败')
    } finally {
      setLoading(false)
    }
  }, [alert])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setCreateForm(emptyCreate)
    setCreateVisible(true)
  }

  const createManager = async () => {
    if (saving) return
    if (!createForm.username.trim() || createForm.password.length < 8) {
      alert.showTopRightAlert('请填写有效用户名和至少 8 位密码', 'warning', '无法创建')
      return
    }
    setSaving(true)
    try {
      await api.adminCreateManager({ ...createForm, username: createForm.username.trim() })
      setCreateVisible(false)
      alert.showTopRightAlert('管理员账号已创建', 'success', '创建成功')
      await load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '创建失败')
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (manager) => {
    setEditTarget(manager)
    setEditForm({ status: manager.status, permissions: permissionNames(manager) })
  }

  const saveEdit = async () => {
    if (!editTarget || saving) return
    setSaving(true)
    try {
      await api.adminUpdateManager(editTarget.username, editForm)
      if (editTarget.username === currentUsername) window.dispatchEvent(new Event('admin-session-updated'))
      setEditTarget(null)
      alert.showTopRightAlert('账号状态和权限已更新', 'success', '保存成功')
      await load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const openReset = (manager) => {
    setResetTarget(manager)
    setResetPassword('')
  }

  const submitReset = async () => {
    if (!resetTarget || saving) return
    if (resetPassword.length < 8) {
      alert.showTopRightAlert('新密码至少需要 8 个字符', 'warning', '密码过短')
      return
    }
    setSaving(true)
    try {
      await api.adminResetManagerPassword(resetTarget.username, resetPassword)
      setResetTarget(null)
      setResetPassword('')
      alert.showTopRightAlert('密码已重置，该账号其它会话已失效', 'success', '重置成功')
      await load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '重置失败')
    } finally {
      setSaving(false)
    }
  }

  const changeOwnPassword = async (event) => {
    event.preventDefault()
    if (saving) return
    if (ownPassword.new_password.length < 8) {
      alert.showTopRightAlert('新密码至少需要 8 个字符', 'warning', '密码过短')
      return
    }
    if (ownPassword.new_password !== ownPassword.confirm_password) {
      alert.showTopRightAlert('两次输入的新密码不一致', 'warning', '请重新确认')
      return
    }
    setSaving(true)
    try {
      await api.adminChangeOwnPassword({
        current_password: ownPassword.current_password,
        new_password: ownPassword.new_password
      })
      setOwnPassword({ current_password: '', new_password: '', confirm_password: '' })
      alert.showTopRightAlert('密码已修改，其它设备上的管理员会话已失效', 'success', '修改成功')
      await load()
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '修改密码失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminShell title="管理员账号">
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="admin-stat-card"><b>{stats.total}</b><p className="text-muted">全部管理员</p></div>
        <div className="admin-stat-card"><b>{stats.active}</b><p className="text-muted">启用账号</p></div>
        <div className="admin-stat-card"><b>{stats.disabled}</b><p className="text-muted">停用账号</p></div>
        <div className="admin-stat-card"><b>{stats.super_admins}</b><p className="text-muted">账号管理者</p></div>
      </div>

      <div className="admin-toolbar mb-4">
        <div className="mr-auto min-w-0">
          <h2 className="text-lg font-bold"><i className="bi bi-shield-lock mr-2" />账号与权限</h2>
          <p className="text-sm text-muted">按职责分配最小权限；停用或重置密码会立即注销该账号的旧会话。</p>
        </div>
        <button className="btn btn-outline" type="button" disabled={loading} onClick={load}><i className={`bi bi-arrow-repeat ${loading ? 'admin-spin' : ''}`} />刷新</button>
        <button className="btn btn-primary" type="button" onClick={openCreate}><i className="bi bi-plus-circle" />新增管理员</button>
      </div>

      {loading ? <div className="page-center"><div className="spinner" /></div> : (
        <div className="data-table-wrap">
          <table className="data-table min-w-[880px] text-left">
            <thead><tr><th>管理员</th><th>状态</th><th>权限</th><th>最后登录</th><th>更新时间</th><th>操作</th></tr></thead>
            <tbody>
              {managers.map((manager) => {
                const own = manager.username === currentUsername
                const names = permissionNames(manager)
                return (
                  <tr key={manager.username}>
                    <td><div className="font-bold">{manager.username}</div>{own ? <span className="badge mt-1">当前账号</span> : null}</td>
                    <td><span className={`badge ${manager.status === 'active' ? 'status-success' : 'status-danger'}`}>{manager.status === 'active' ? '启用' : '停用'}</span></td>
                    <td>
                      <div className="flex max-w-md flex-wrap gap-1.5">
                        {names.length ? names.map((name) => <code className="badge text-xs" key={name}>{name}</code>) : <span className="text-sm text-muted">无功能权限</span>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-sm text-muted">{manager.last_login_at || '尚未登录'}</td>
                    <td className="whitespace-nowrap text-sm text-muted">{manager.updated_at || manager.created_at || '-'}</td>
                    <td>
                      <div className="flex gap-2 whitespace-nowrap">
                        <button className="btn btn-sm btn-outline" type="button" onClick={() => openEdit(manager)}><i className="bi bi-pencil" />编辑</button>
                        {!own ? <button className="btn btn-sm btn-outline" type="button" onClick={() => openReset(manager)}><i className="bi bi-key" />重置密码</button> : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <section className="mt-6 border-t border-[var(--border-color)] pt-6">
        <div className="mb-4">
          <h2 className="text-lg font-bold"><i className="bi bi-key mr-2" />修改我的密码</h2>
          <p className="text-sm text-muted">修改成功后保留当前会话，同时注销其它设备上的旧会话。</p>
        </div>
        <form className="grid max-w-3xl gap-3 md:grid-cols-3" onSubmit={changeOwnPassword}>
          <input className="field" type="password" value={ownPassword.current_password} onChange={(event) => setOwnPassword((current) => ({ ...current, current_password: event.target.value }))} placeholder="当前密码" autoComplete="current-password" required />
          <input className="field" type="password" value={ownPassword.new_password} onChange={(event) => setOwnPassword((current) => ({ ...current, new_password: event.target.value }))} placeholder="新密码（至少 8 位）" autoComplete="new-password" required />
          <input className="field" type="password" value={ownPassword.confirm_password} onChange={(event) => setOwnPassword((current) => ({ ...current, confirm_password: event.target.value }))} placeholder="再次输入新密码" autoComplete="new-password" required />
          <button className="btn btn-primary md:col-start-3" type="submit" disabled={saving}><i className="bi bi-shield-check" />{saving ? '正在保存...' : '修改密码'}</button>
        </form>
      </section>

      <Modal
        visible={createVisible}
        title="新增管理员"
        width="760px"
        onClose={() => saving ? null : setCreateVisible(false)}
        footer={<><button className="btn btn-outline" type="button" disabled={saving} onClick={() => setCreateVisible(false)}>取消</button><button className="btn btn-primary" type="button" disabled={saving} onClick={createManager}>创建账号</button></>}
      >
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2"><span className="block text-sm font-bold">管理员用户名</span><input className="field w-full" value={createForm.username} onChange={(event) => setCreateForm((current) => ({ ...current, username: event.target.value }))} maxLength={40} autoComplete="off" placeholder="3-40 位字母或数字" /></label>
            <label className="space-y-2"><span className="block text-sm font-bold">初始密码</span><input className="field w-full" type="password" value={createForm.password} onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))} maxLength={128} autoComplete="new-password" placeholder="至少 8 位" /></label>
          </div>
          <PermissionPicker definitions={permissions} selected={createForm.permissions} onChange={(next) => setCreateForm((current) => ({ ...current, permissions: next }))} disabled={saving} />
        </div>
      </Modal>

      <Modal
        visible={Boolean(editTarget)}
        title={`编辑管理员 · ${editTarget?.username || ''}`}
        width="760px"
        onClose={() => saving ? null : setEditTarget(null)}
        footer={<><button className="btn btn-outline" type="button" disabled={saving} onClick={() => setEditTarget(null)}>取消</button><button className="btn btn-primary" type="button" disabled={saving} onClick={saveEdit}>保存修改</button></>}
      >
        <div className="space-y-5">
          <label className="block max-w-xs space-y-2"><span className="block text-sm font-bold">账号状态</span><select className="field w-full" value={editForm.status} disabled={saving || editTarget?.username === currentUsername} onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value }))}><option value="active">启用</option><option value="disabled">停用</option></select></label>
          <PermissionPicker definitions={permissions} selected={editForm.permissions} onChange={(next) => setEditForm((current) => ({ ...current, permissions: next }))} disabled={saving} />
        </div>
      </Modal>

      <Modal
        visible={Boolean(resetTarget)}
        title={`重置密码 · ${resetTarget?.username || ''}`}
        width="520px"
        onClose={() => saving ? null : setResetTarget(null)}
        footer={<><button className="btn btn-outline" type="button" disabled={saving} onClick={() => setResetTarget(null)}>取消</button><button className="btn btn-primary" type="button" disabled={saving} onClick={submitReset}>确认重置</button></>}
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">重置后，该管理员在其它设备上的会话会立即失效。</p>
          <input className="field w-full" type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} maxLength={128} autoComplete="new-password" placeholder="输入至少 8 位的新密码" />
        </div>
      </Modal>
    </AdminShell>
  )
}
