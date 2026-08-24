import { useEffect, useMemo, useState } from 'react'
import AdminShell from '../../components/AdminShell.jsx'
import Modal from '../../components/Modal.jsx'
import api from '../../services/api'
import { genderText } from '../../utils/user'

const defaultMuteUntil = () => {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

const formatTime = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function StatusBadge({ user }) {
  if (user.status === 'disabled') return <span className="badge status-danger">已停用</span>
  if (user.is_muted) return <span className="badge status-warning">禁言中</span>
  return <span className="badge status-success">正常</span>
}

export default function AdminUsers() {
  const [users, setUsers] = useState([])
  const [stats, setStats] = useState({ total: 0, active: 0, disabled: 0, muted: 0 })
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [muted, setMuted] = useState('')
  const [loading, setLoading] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [editing, setEditing] = useState(null)
  const [muteTarget, setMuteTarget] = useState(null)
  const [resetTarget, setResetTarget] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [muteUntil, setMuteUntil] = useState(defaultMuteUntil())
  const [muteReason, setMuteReason] = useState('')

  const params = useMemo(() => ({
    page,
    page_size: 20,
    q: query,
    status,
    muted
  }), [page, query, status, muted])

  const load = async () => {
    setLoading(true)
    try {
      const [list, stat] = await Promise.all([api.adminGetUsers(params), api.adminGetUserStats()])
      setUsers(list.data?.users || [])
      setTotalPages(list.data?.total_pages || 1)
      setStats(stat.data?.stats || { total: 0, active: 0, disabled: 0, muted: 0 })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [params])

  const search = () => {
    setPage(1)
    load()
  }

  const importUsers = async () => {
    if (!importFile) return
    const response = await api.adminImportUsers(importFile)
    setImportResult(response.data)
    await load()
  }

  const saveEdit = async () => {
    if (!editing) return
    await api.adminUpdateUser(editing.id, editing)
    setEditing(null)
    await load()
  }

  const disableUser = async (user) => {
    if (!window.confirm(`确定停用账号 ${user.username} 吗？历史内容会保留。`)) return
    await api.adminDisableUser(user.id)
    await load()
  }

  const openMute = (user) => {
    setMuteTarget(user)
    setMuteUntil(defaultMuteUntil())
    setMuteReason('')
  }

  const saveMute = async () => {
    if (!muteTarget) return
    await api.adminMuteUser(muteTarget.id, { muted_until: muteUntil, reason: muteReason })
    setMuteTarget(null)
    await load()
  }

  const unmute = async (user) => {
    await api.adminUnmuteUser(user.id)
    await load()
  }

  const resetPassword = async () => {
    if (!resetTarget || !newPassword.trim()) return
    await api.adminResetUserPassword(resetTarget.id, newPassword.trim())
    setResetTarget(null)
    setNewPassword('')
    await load()
  }

  return (
    <AdminShell title="用户管理">
      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <div className="card-flat admin-stat-card"><b>{stats.total}</b><p className="text-muted">总账号</p></div>
        <div className="card-flat admin-stat-card"><b>{stats.active}</b><p className="text-muted">正常账号</p></div>
        <div className="card-flat admin-stat-card"><b>{stats.disabled}</b><p className="text-muted">已停用</p></div>
        <div className="card-flat admin-stat-card"><b>{stats.muted}</b><p className="text-muted">禁言中</p></div>
      </div>

      <div className="admin-toolbar mb-4">
        <input className="field admin-toolbar-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && search()} placeholder="搜索学号、姓名或昵称" />
        <select className="field w-auto" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
          <option value="">全部状态</option>
          <option value="active">正常</option>
          <option value="disabled">已停用</option>
        </select>
        <select className="field w-auto" value={muted} onChange={(event) => { setMuted(event.target.value); setPage(1) }}>
          <option value="">全部禁言</option>
          <option value="true">禁言中</option>
          <option value="false">未禁言</option>
        </select>
        <button className="btn btn-primary" type="button" onClick={search}><i className="bi bi-search" />搜索</button>
        <button className="btn btn-outline" type="button" onClick={() => setImportOpen(true)}><i className="bi bi-cloud-upload" />导入 Excel</button>
      </div>

      {loading ? <div className="page-center"><div className="spinner" /></div> : null}
      <div className="data-table-wrap">
        <table className="data-table min-w-[980px] text-left">
          <thead>
            <tr>
              <th>学号</th>
              <th>姓名</th>
              <th>昵称</th>
              <th>性别</th>
              <th>状态</th>
              <th>禁言到期</th>
              <th>最后登录</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td className="font-mono">{user.username}</td>
                <td>{user.real_name || '-'}</td>
                <td>{user.nickname || '-'}</td>
                <td>{genderText(user.gender)}</td>
                <td><StatusBadge user={user} /></td>
                <td>{formatTime(user.muted_until)}{user.mute_reason ? <div className="text-xs text-muted">{user.mute_reason}</div> : null}</td>
                <td>{formatTime(user.last_login_at)}</td>
                <td>
                  <div className="data-table-actions">
                    <button className="btn btn-sm btn-outline" type="button" onClick={() => setEditing({ ...user })}>编辑</button>
                    {user.is_muted ? <button className="btn btn-sm btn-outline" type="button" onClick={() => unmute(user)}>解禁</button> : <button className="btn btn-sm btn-outline" type="button" onClick={() => openMute(user)}>禁言</button>}
                    <button className="btn btn-sm btn-outline" type="button" onClick={() => setResetTarget(user)}>重置密码</button>
                    <button className="btn btn-sm btn-danger" type="button" disabled={user.status === 'disabled'} onClick={() => disableUser(user)}>停用</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && !users.length ? <p className="py-8 text-center text-muted">没有匹配的用户</p> : null}
      {totalPages > 1 ? (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((num) => <button key={num} className={`btn btn-sm ${num === page ? 'btn-primary' : 'btn-outline'}`} type="button" onClick={() => setPage(num)}>{num}</button>)}
        </div>
      ) : null}

      <Modal visible={importOpen} title="导入用户账号" onClose={() => setImportOpen(false)} footer={<><button className="btn btn-outline" type="button" onClick={() => setImportOpen(false)}>关闭</button><button className="btn btn-primary" type="button" disabled={!importFile} onClick={importUsers}>开始导入</button></>}>
        <div className="space-y-4">
          <div className="info-callout p-4 text-sm">
            Excel 首行字段至少包含 <b>学号</b>、<b>密码</b>、<b>姓名</b>，也兼容 <code>username</code>、<code>password</code>、<code>real_name</code>。重复导入时会更新姓名；密码列非空才会重置密码。
          </div>
          <label className="upload-dropzone flex min-h-32 cursor-pointer flex-col items-center justify-center p-4 text-center">
            <i className="bi bi-cloud-upload upload-dropzone-icon text-4xl" />
            <p className="mt-2">{importFile ? importFile.name : '选择 .xlsx 文件'}</p>
            <input hidden type="file" accept=".xlsx" onChange={(event) => setImportFile(event.target.files?.[0] || null)} />
          </label>
          {importResult ? (
            <div className="info-callout p-4">
              <p><b>新增：</b>{importResult.created}　<b>更新：</b>{importResult.updated}　<b>跳过：</b>{importResult.skipped}</p>
              {importResult.errors?.length ? <pre className="code-panel mt-3">{JSON.stringify(importResult.errors, null, 2)}</pre> : null}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal visible={Boolean(editing)} title="编辑用户" onClose={() => setEditing(null)} footer={<><button className="btn btn-outline" type="button" onClick={() => setEditing(null)}>取消</button><button className="btn btn-primary" type="button" onClick={saveEdit}>保存</button></>}>
        {editing ? (
          <div className="space-y-4">
            <div className="info-callout p-3 text-sm text-muted">学号 {editing.username} 不能修改。</div>
            <label className="block"><span className="mb-2 block text-sm font-bold">姓名</span><input className="field" value={editing.real_name || ''} onChange={(event) => setEditing((item) => ({ ...item, real_name: event.target.value }))} /></label>
            <label className="block"><span className="mb-2 block text-sm font-bold">昵称</span><input className="field" value={editing.nickname || ''} onChange={(event) => setEditing((item) => ({ ...item, nickname: event.target.value }))} /></label>
            <label className="block"><span className="mb-2 block text-sm font-bold">个人简介</span><textarea className="field min-h-24" maxLength={200} value={editing.bio || ''} onChange={(event) => setEditing((item) => ({ ...item, bio: event.target.value }))} /></label>
            <label className="block"><span className="mb-2 block text-sm font-bold">性别</span><select className="field" value={editing.gender || 0} onChange={(event) => setEditing((item) => ({ ...item, gender: Number(event.target.value) }))}><option value={0}>未设置</option><option value={1}>男</option><option value={2}>女</option></select></label>
            <label className="block"><span className="mb-2 block text-sm font-bold">状态</span><select className="field" value={editing.status || 'active'} onChange={(event) => setEditing((item) => ({ ...item, status: event.target.value }))}><option value="active">正常</option><option value="disabled">停用</option></select></label>
          </div>
        ) : null}
      </Modal>

      <Modal visible={Boolean(muteTarget)} title={`禁言 ${muteTarget?.username || ''}`} onClose={() => setMuteTarget(null)} footer={<><button className="btn btn-outline" type="button" onClick={() => setMuteTarget(null)}>取消</button><button className="btn btn-primary" type="button" onClick={saveMute}>确认禁言</button></>}>
        <div className="space-y-4">
          <label className="block"><span className="mb-2 block text-sm font-bold">禁言到期时间</span><input className="field" type="datetime-local" value={muteUntil} onChange={(event) => setMuteUntil(event.target.value)} /></label>
          <label className="block"><span className="mb-2 block text-sm font-bold">原因</span><textarea className="field min-h-24" value={muteReason} onChange={(event) => setMuteReason(event.target.value)} placeholder="可选" /></label>
        </div>
      </Modal>

      <Modal visible={Boolean(resetTarget)} title={`重置密码 ${resetTarget?.username || ''}`} onClose={() => setResetTarget(null)} footer={<><button className="btn btn-outline" type="button" onClick={() => setResetTarget(null)}>取消</button><button className="btn btn-primary" type="button" disabled={!newPassword.trim()} onClick={resetPassword}>确认重置</button></>}>
        <label className="block"><span className="mb-2 block text-sm font-bold">新密码</span><input className="field" type="text" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="输入新的初始密码" /></label>
      </Modal>
    </AdminShell>
  )
}
