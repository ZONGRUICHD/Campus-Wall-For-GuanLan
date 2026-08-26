import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AdminShell from '../../components/AdminShell.jsx'
import Modal from '../../components/Modal.jsx'
import { useAlert } from '../../contexts/AlertContext.jsx'
import { useUser } from '../../contexts/UserContext.jsx'
import api from '../../services/api'

const roleOptions = [
  { value: 'user', label: '普通用户', description: '使用前台账号功能，不进入管理后台。' },
  { value: 'reviewer', label: '审核员', description: '可审核全部帖子和表白便签并管理主页公告，不能添加审核员或修改任何人的权限。' },
  { value: 'admin', label: '管理员', description: '可管理内容与平台日常事务，不能修改用户角色。' },
  { value: 'super_admin', label: '超级管理员', description: '拥有全部权限，包括任命管理员、超级管理员与审核员。' }
]

const staffRoleOptions = roleOptions.filter((option) => option.value !== 'user')
const emptyStaffDraft = { username: '', nickname: '', password: '', passwordConfirm: '', role: 'reviewer' }

const permissionGroupLabels = {
  dashboard: '后台入口',
  publishing: '内容发布',
  review: '审核队列',
  content: '帖子管理',
  comments: '评论管理',
  notice: '公告管理',
  feedback: '反馈工单',
  reports: '举报管理',
  users: '用户管理',
  security: '角色与安全',
  settings: '平台设置',
  logs: '日志与审计'
}

const permissionRiskLabels = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '严格控制'
}

const permissionDraftFromState = (catalog, state) => {
  const allow = new Set(state?.overrides?.allow || [])
  const deny = new Set(state?.overrides?.deny || [])
  return Object.fromEntries(catalog.map((permission) => [
    permission.key,
    allow.has(permission.key) ? 'allow' : (deny.has(permission.key) ? 'deny' : 'inherit')
  ]))
}

const permissionOverridesFromDraft = (draft) => ({
  allow: Object.entries(draft).filter(([, value]) => value === 'allow').map(([key]) => key).sort(),
  deny: Object.entries(draft).filter(([, value]) => value === 'deny').map(([key]) => key).sort()
})

const emptyStats = {
  total: 0,
  active: 0,
  disabled: 0,
  muted: 0,
  by_role: { user: 0, reviewer: 0, admin: 0, super_admin: 0 }
}

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

const formatNumber = (value) => (Number(value) || 0).toLocaleString('zh-CN')

const paginationItems = (page, totalPages) => {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)
  const pages = new Set([1, totalPages, page - 1, page, page + 1])
  if (page <= 3) [2, 3, 4].forEach((item) => pages.add(item))
  if (page >= totalPages - 2) [totalPages - 3, totalPages - 2, totalPages - 1].forEach((item) => pages.add(item))
  const sorted = [...pages].filter((item) => item > 0 && item <= totalPages).sort((a, b) => a - b)
  const result = []
  sorted.forEach((item, index) => {
    if (index > 0 && item - sorted[index - 1] > 1) result.push(`gap-${item}`)
    result.push(item)
  })
  return result
}

function StatusBadge({ user }) {
  if (user.status === 'disabled') return <span className="badge status-danger">已停用</span>
  if (user.is_muted) return <span className="badge status-warning">禁言中</span>
  return <span className="badge status-success">正常</span>
}

function RoleBadge({ role }) {
  const meta = roleMeta(role)
  const statusClass = role === 'super_admin' ? 'status-danger' : role === 'admin' ? 'status-success' : role === 'reviewer' ? 'status-warning' : ''
  return <span className={`badge ${statusClass}`}><i className={`bi ${role === 'super_admin' ? 'bi-stars' : role === 'admin' ? 'bi-shield-check' : role === 'reviewer' ? 'bi-person-check' : 'bi-person'}`} />{meta.label}</span>
}

export default function AdminUsers() {
  const [users, setUsers] = useState([])
  const [stats, setStats] = useState(emptyStats)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [accountState, setAccountState] = useState('')
  const [role, setRole] = useState('')
  const [sortValue, setSortValue] = useState('created_at:desc')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null)
  const [roleTarget, setRoleTarget] = useState(null)
  const [nextRole, setNextRole] = useState('user')
  const [muteTarget, setMuteTarget] = useState(null)
  const [resetTarget, setResetTarget] = useState(null)
  const [creatingStaff, setCreatingStaff] = useState(false)
  const [staffDraft, setStaffDraft] = useState(emptyStaffDraft)
  const [newPassword, setNewPassword] = useState('')
  const [muteUntil, setMuteUntil] = useState(defaultMuteUntil())
  const [muteReason, setMuteReason] = useState('')
  const [canManageRoles, setCanManageRoles] = useState(false)
  const [canManagePermissions, setCanManagePermissions] = useState(false)
  const [permissionCatalog, setPermissionCatalog] = useState([])
  const [currentUserId, setCurrentUserId] = useState(0)
  const [permissionTarget, setPermissionTarget] = useState(null)
  const [permissionState, setPermissionState] = useState(null)
  const [permissionDraft, setPermissionDraft] = useState({})
  const [permissionReason, setPermissionReason] = useState('')
  const [permissionLoading, setPermissionLoading] = useState(false)
  const requestId = useRef(0)
  const alert = useAlert()
  const { user: currentUser, hasCapability } = useUser()

  const [sortBy, sortOrder] = sortValue.split(':')
  const params = useMemo(() => ({
    page,
    page_size: pageSize,
    q: appliedQuery,
    status: ['active', 'disabled'].includes(accountState) ? accountState : '',
    muted: accountState === 'muted' ? 'true' : '',
    role,
    sort_by: sortBy,
    sort_order: sortOrder
  }), [accountState, appliedQuery, page, pageSize, role, sortBy, sortOrder])

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current
    setLoading(true)
    try {
      const response = await api.adminGetUsers(params)
      if (currentRequest !== requestId.current) return
      const data = response.data || {}
      const returnedPage = Math.max(1, Number(data.page) || 1)
      setUsers(Array.isArray(data.users) ? data.users : [])
      setTotal(Number(data.total) || 0)
      setTotalPages(Math.max(0, Number(data.total_pages) || 0))
      setStats(data.stats || emptyStats)
      if (returnedPage !== page) setPage(returnedPage)
    } catch (error) {
      if (currentRequest === requestId.current) alert.showTopRightAlert(error.message, 'warning', '用户加载失败')
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }, [alert, page, params])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    let active = true
    Promise.all([api.adminGetRoles(), api.adminGetPermissionCatalog()])
      .then(([rolesResponse, catalogResponse]) => {
        if (!active) return
        setCanManageRoles(rolesResponse.data?.can_manage_roles === true)
        setCanManagePermissions(catalogResponse.data?.can_manage_permissions === true)
        setPermissionCatalog(Array.isArray(catalogResponse.data?.permissions) ? catalogResponse.data.permissions : [])
        setCurrentUserId(Number(catalogResponse.data?.current_user_id) || 0)
      })
      .catch((error) => { if (active) alert.showTopRightAlert(error.message, 'warning', '权限加载失败') })
    return () => { active = false }
  }, [alert])

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
    const nextQuery = query.trim().slice(0, 64)
    setPage(1)
    if (nextQuery === appliedQuery && page === 1) load()
    else setAppliedQuery(nextQuery)
  }

  const clearFilters = () => {
    setQuery('')
    setAppliedQuery('')
    setAccountState('')
    setRole('')
    setSortValue('created_at:desc')
    setPage(1)
  }

  const saveEdit = async () => {
    if (!editing) return
    const statusChanged = editing.status !== editing._original_status
    if (!hasCapability('users.profile.update') && !statusChanged) return
    if (statusChanged && !hasCapability(editing.status === 'disabled' ? 'users.status.disable' : 'users.status.enable')) return
    if (await run(() => api.adminUpdateUser(editing.id, editing), '用户资料已更新')) setEditing(null)
  }

  const openRole = (user) => {
    if (!canManageRoles) return
    setRoleTarget(user)
    setNextRole(user.role || 'user')
  }

  const saveRole = async () => {
    if (!canManageRoles || !roleTarget) return
    if (nextRole !== roleTarget.role && roleTarget.permission_customized) {
      const confirmed = window.confirm(`“${roleTarget.username}”存在个人权限覆盖。修改角色会同时清空所有覆盖并撤销旧会话，是否继续？`)
      if (!confirmed) return
    }
    if (nextRole === 'super_admin' && roleTarget.role !== 'super_admin') {
      const confirmed = window.confirm(`确定将“${roleTarget.username}”设为超级管理员吗？该用户将获得全部权限，包括继续任命其他超级管理员。`)
      if (!confirmed) return
    }
    const targetLabel = roleMeta(nextRole).label
    if (await run(() => api.adminSetUserRole(roleTarget.id, nextRole), `${roleTarget.username} 已设为${targetLabel}`)) setRoleTarget(null)
  }

  const disableUser = async (user) => {
    if (!hasCapability('users.status.disable')) return
    if (!window.confirm(`确定停用账号“${user.username}”吗？历史内容会保留。`)) return
    await run(() => api.adminDisableUser(user.id), `${user.username} 已停用`)
  }

  const openMute = (user) => {
    if (!hasCapability('users.mute')) return
    setMuteTarget(user)
    setMuteUntil(defaultMuteUntil())
    setMuteReason('')
  }

  const saveMute = async () => {
    if (!hasCapability('users.mute') || !muteTarget) return
    if (await run(() => api.adminMuteUser(muteTarget.id, { muted_until: muteUntil, reason: muteReason }), `${muteTarget.username} 已禁言`)) setMuteTarget(null)
  }

  const unmute = async (user) => hasCapability('users.mute')
    ? run(() => api.adminUnmuteUser(user.id), `${user.username} 已解除禁言`)
    : false

  const resetPassword = async () => {
    if (!hasCapability('users.password.reset') || !resetTarget || newPassword.length < 8) return
    if (await run(() => api.adminResetUserPassword(resetTarget.id, newPassword), `${resetTarget.username} 的密码已重置`)) {
      setResetTarget(null)
      setNewPassword('')
    }
  }

  const createStaff = async () => {
    if (!canManageRoles) return
    const username = staffDraft.username.trim()
    if (username.length < 2) {
      alert.showTopRightAlert('用户名至少需要 2 个字符', 'warning', '信息不完整')
      return
    }
    if (staffDraft.password.length < 8) {
      alert.showTopRightAlert('密码至少需要 8 个字符', 'warning', '密码太短')
      return
    }
    if (staffDraft.password !== staffDraft.passwordConfirm) {
      alert.showTopRightAlert('两次输入的密码不一致', 'warning', '请重新确认密码')
      return
    }
    if (staffDraft.role === 'super_admin' && !window.confirm('确定创建一个超级管理员账号吗？该账号将获得全部权限，包括继续任命其他超级管理员。')) {
      return
    }
    if (await run(
      () => api.adminCreateStaffUser(staffDraft),
      `已创建${roleMeta(staffDraft.role).label} ${username}`
    )) {
      setCreatingStaff(false)
      setStaffDraft(emptyStaffDraft)
    }
  }

  const currentCapabilitySet = useMemo(() => new Set(currentUser?.capabilities || []), [currentUser?.capabilities])
  const permissionGroups = useMemo(() => {
    const groups = new Map()
    permissionCatalog.forEach((permission) => {
      const group = permission.group || 'other'
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group).push(permission)
    })
    return [...groups.entries()]
  }, [permissionCatalog])
  const permissionOverrides = useMemo(() => permissionOverridesFromDraft(permissionDraft), [permissionDraft])
  const permissionDefaults = useMemo(() => new Set(permissionState?.defaults || []), [permissionState])
  const originalPermissionDraft = useMemo(
    () => permissionDraftFromState(permissionCatalog, permissionState),
    [permissionCatalog, permissionState]
  )
  const permissionsDirty = JSON.stringify(permissionDraft) !== JSON.stringify(originalPermissionDraft)
  const permissionReadOnly = Boolean(
    !canManagePermissions
    || permissionState?.overrides_locked
    || Number(permissionTarget?.id) === currentUserId
  )

  const openPermissions = async (user) => {
    if (!canManagePermissions) return
    setPermissionTarget(user)
    setPermissionState(null)
    setPermissionDraft({})
    setPermissionReason('')
    setPermissionLoading(true)
    try {
      const response = await api.adminGetUserPermissions(user.id)
      const state = response.data || null
      setPermissionState(state)
      setPermissionDraft(permissionDraftFromState(permissionCatalog, state))
    } catch (error) {
      alert.showTopRightAlert(error.message, 'warning', '权限加载失败')
      setPermissionTarget(null)
    } finally {
      setPermissionLoading(false)
    }
  }

  const setPermissionChoice = (permissionKey, choice) => {
    setPermissionDraft((current) => {
      const next = { ...current, [permissionKey]: choice }
      const definitions = new Map(permissionCatalog.map((permission) => [permission.key, permission]))
      const defaults = new Set(permissionState?.defaults || [])
      const isEffective = (key) => next[key] === 'allow' || (next[key] !== 'deny' && defaults.has(key))
      const allowWithDependencies = (key, visited = new Set()) => {
        if (visited.has(key)) return
        visited.add(key)
        for (const dependency of definitions.get(key)?.requires || []) {
          if (!isEffective(dependency)) next[dependency] = defaults.has(dependency) ? 'inherit' : 'allow'
          allowWithDependencies(dependency, visited)
        }
      }
      const denyDependents = (key, visited = new Set()) => {
        if (visited.has(key)) return
        visited.add(key)
        permissionCatalog.forEach((permission) => {
          if (!(permission.requires || []).includes(key) || !isEffective(permission.key)) return
          next[permission.key] = 'deny'
          denyDependents(permission.key, visited)
        })
      }
      if (choice === 'allow') allowWithDependencies(permissionKey)
      else if (!isEffective(permissionKey)) denyDependents(permissionKey)
      return next
    })
  }

  const savePermissions = async () => {
    if (!permissionTarget || !permissionState || permissionReadOnly) return
    const reason = permissionReason.trim()
    if (!reason) {
      alert.showTopRightAlert('请填写权限调整原因', 'warning', '需要调整原因')
      return
    }
    if (!window.confirm(`确认替换“${permissionTarget.username}”的全部个人权限覆盖吗？保存后该用户现有会话将立即失效。`)) return
    setBusy(true)
    try {
      await api.adminUpdateUserPermissions(permissionTarget.id, {
        ...permissionOverrides,
        permission_version: permissionState.permission_version,
        reason,
        confirm: 'REPLACE_PERMISSION_OVERRIDES'
      })
      alert.showTopRightAlert('个人权限已更新，旧会话已撤销', 'success', '权限已保存')
      setPermissionTarget(null)
      await load()
    } catch (error) {
      if (error.code === 'PERMISSION_VERSION_CONFLICT') {
        alert.showTopRightAlert('权限已被其他管理员修改，正在重新加载', 'warning', '版本冲突')
        await openPermissions(permissionTarget)
      } else {
        alert.showTopRightAlert(error.message, 'warning', '权限保存失败')
      }
    } finally {
      setBusy(false)
    }
  }

  const resetPermissions = async () => {
    if (!permissionTarget || !permissionState || permissionReadOnly) return
    const reason = permissionReason.trim()
    if (!reason) {
      alert.showTopRightAlert('请填写恢复默认的原因', 'warning', '需要调整原因')
      return
    }
    if (!window.confirm(`确认清除“${permissionTarget.username}”的全部个人权限覆盖，完全恢复${roleMeta(permissionTarget.role).label}默认权限吗？`)) return
    setBusy(true)
    try {
      await api.adminResetUserPermissions(permissionTarget.id, {
        permission_version: permissionState.permission_version,
        reason,
        confirm: 'RESET_PERMISSION_OVERRIDES'
      })
      alert.showTopRightAlert('已恢复角色默认权限，旧会话已撤销', 'success', '权限已重置')
      setPermissionTarget(null)
      await load()
    } catch (error) {
      if (error.code === 'PERMISSION_VERSION_CONFLICT') await openPermissions(permissionTarget)
      alert.showTopRightAlert(error.message, 'warning', '权限重置失败')
    } finally {
      setBusy(false)
    }
  }

  const menuAction = (event, action) => {
    event.currentTarget.closest('details')?.removeAttribute('open')
    action()
  }

  const firstVisible = total === 0 ? 0 : ((page - 1) * pageSize) + 1
  const lastVisible = Math.min(page * pageSize, total)
  const pages = paginationItems(page, totalPages)
  const canChangeEditingStatus = editing?._original_status === 'disabled'
    ? currentCapabilitySet.has('users.status.enable')
    : currentCapabilitySet.has('users.status.disable')

  return (
    <AdminShell title="用户与权限">
      <style>{`
        .admin-users-toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) repeat(3, minmax(132px, 1fr)); gap: 10px; align-items: center; }
        .admin-users-toolbar .admin-users-search-actions { grid-column: 1; }
        .admin-users-toolbar > .btn:last-child { justify-self: start; }
        .admin-users-summary { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin: 16px 0 10px; }
        .admin-users-list { display: grid; gap: 10px; }
        .admin-user-card { position: relative; display: grid; grid-template-columns: minmax(190px, 1.4fr) minmax(220px, .9fr) minmax(190px, 1fr) auto; gap: 18px; align-items: center; min-width: 0; padding: 16px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--card-solid-bg); }
        .admin-user-card:hover { background: var(--admin-table-row-hover); }
        .admin-user-identity, .admin-user-meta { min-width: 0; }
        .admin-user-name { overflow-wrap: anywhere; font-weight: 750; }
        .admin-user-nickname { overflow: hidden; margin-top: 3px; color: var(--text-secondary); font-size: .86rem; text-overflow: ellipsis; white-space: nowrap; }
        .admin-user-id { margin-top: 3px; color: var(--text-muted); font-size: .74rem; }
        .admin-user-badges { display: flex; flex-wrap: nowrap; gap: 7px; min-width: max-content; }
        .admin-user-badges .badge { flex-shrink: 0; white-space: nowrap; }
        .admin-user-activity { display: grid; gap: 5px; color: var(--text-secondary); font-size: .8rem; }
        .admin-user-activity b { color: var(--text-primary); font-weight: 650; white-space: nowrap; }
        .admin-user-actions { position: relative; justify-self: end; white-space: nowrap; }
        .admin-user-actions summary { list-style: none; cursor: pointer; }
        .admin-user-actions summary::-webkit-details-marker { display: none; }
        .admin-user-action-menu { position: absolute; z-index: 30; top: calc(100% + 7px); right: 0; display: grid; min-width: 178px; padding: 6px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--card-solid-bg); box-shadow: 0 12px 32px rgba(0, 0, 0, .14); }
        .admin-user-action-menu button { justify-content: flex-start; width: 100%; border: 0; background: transparent; color: var(--text-primary); white-space: nowrap; }
        .admin-user-action-menu button:hover { background: var(--hover-bg); }
        .admin-user-action-menu .danger { color: #ef4444; }
        .admin-users-pagination { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; }
        .admin-users-pages { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
        .admin-users-page-button { min-width: 36px; justify-content: center; padding-inline: 9px; }
        .admin-users-page-button[aria-current='page'] { border-color: var(--primary-color); background: var(--primary-light); color: var(--primary-color); }
        .permission-editor { display: grid; gap: 16px; max-height: min(66vh, 720px); overflow: auto; padding-right: 4px; }
        .permission-group { border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden; background: var(--card-solid-bg); }
        .permission-group h3 { padding: 11px 14px; border-bottom: 1px solid var(--border-color); background: var(--hover-bg); font-size: .9rem; }
        .permission-row { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(155px, auto); gap: 14px; align-items: center; padding: 12px 14px; }
        .permission-row + .permission-row { border-top: 1px solid var(--border-color); }
        .permission-copy { min-width: 0; }
        .permission-copy code { display: block; overflow-wrap: anywhere; margin-top: 3px; color: var(--text-muted); font-size: .7rem; }
        .permission-copy small { display: block; margin-top: 4px; color: var(--text-secondary); }
        .permission-choice { min-width: 155px; }
        .permission-effective { display: inline-flex; align-items: center; gap: 4px; margin-top: 5px; font-size: .72rem; }
        .permission-reason { min-height: 76px; }
        @media (max-width: 1120px) {
          .admin-users-toolbar { grid-template-columns: minmax(220px, 1fr) repeat(2, minmax(132px, 1fr)); }
          .admin-users-toolbar .admin-users-search-actions { grid-column: 1 / -1; }
          .admin-user-card { grid-template-columns: minmax(180px, 1fr) max-content auto; gap: 12px 18px; }
          .admin-user-identity { grid-column: 1; grid-row: 1; }
          .admin-user-badges { grid-column: 2; grid-row: 1; }
          .admin-user-activity { grid-column: 1 / -1; grid-row: 2; grid-template-columns: repeat(2, minmax(0, 1fr)); padding-top: 10px; border-top: 1px solid var(--border-color); }
          .admin-user-actions { grid-column: 3; grid-row: 1; }
        }
        @media (max-width: 760px) {
          .admin-users-toolbar { grid-template-columns: 1fr 1fr; }
          .admin-users-toolbar .admin-users-query { grid-column: 1 / -1; }
          .admin-users-toolbar .admin-users-sort { grid-column: 1 / -1; }
          .admin-users-toolbar .admin-users-search-actions { display: grid; grid-template-columns: 1fr 1fr; }
          .admin-user-card { grid-template-columns: 1fr auto; gap: 12px; }
          .admin-user-identity { grid-column: 1; grid-row: 1; }
          .admin-user-badges { grid-column: 1; grid-row: 2; }
          .admin-user-activity { grid-column: 1 / -1; grid-row: 3; grid-template-columns: 1fr; padding-top: 10px; border-top: 1px solid var(--border-color); }
          .admin-user-actions { grid-column: 2; grid-row: 1 / span 2; align-self: start; }
          .admin-users-pagination { align-items: stretch; flex-direction: column; }
          .admin-users-pages { justify-content: center; }
          .permission-row { grid-template-columns: 1fr; }
          .permission-choice { width: 100%; }
        }
        @media (max-width: 440px) {
          .admin-users-toolbar { grid-template-columns: 1fr; }
          .admin-users-toolbar .admin-users-query, .admin-users-toolbar .admin-users-sort, .admin-users-toolbar .admin-users-search-actions { grid-column: 1; }
          .admin-user-card { padding: 14px; }
        }
        @media (max-width: 360px) {
          .admin-user-identity, .admin-user-badges, .admin-user-actions { grid-column: 1 / -1; }
          .admin-user-actions { grid-row: 3; justify-self: start; }
          .admin-user-activity { grid-row: 4; }
        }
      `}</style>

      <div className="info-callout mb-5 p-4 text-sm">
        <i className="bi bi-shield-lock-fill" />
        <div><b>{canManagePermissions ? '你可以逐项设置用户权限。' : (canManageRoles ? '你可以修改账号角色。' : '你只能执行已授予的用户管理操作。')}</b><p className="mt-1 text-muted">个人“拒绝”高于角色默认与个人“允许”；审核员保持全员同权，超级管理员始终拥有全权。前台学生只能飞书登录；后台人员账号只能由超级管理员在此创建。</p></div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card-flat admin-stat-card"><b>{formatNumber(stats.total)}</b><p className="text-muted">注册用户</p><small className="text-muted">普通用户 {formatNumber(stats.by_role?.user)}</small></div>
        <div className="card-flat admin-stat-card"><b>{formatNumber(stats.active)}</b><p className="text-muted">正常账号</p><small className="text-muted">管理员 {formatNumber(stats.by_role?.admin)}</small></div>
        <div className="card-flat admin-stat-card"><b>{formatNumber(stats.muted)}</b><p className="text-muted">禁言中</p><small className="text-muted">审核员 {formatNumber(stats.by_role?.reviewer)}</small></div>
        <div className="card-flat admin-stat-card"><b>{formatNumber(stats.disabled)}</b><p className="text-muted">已停用</p><small className="text-muted">超级管理员 {formatNumber(stats.by_role?.super_admin)}</small></div>
      </div>

      <div className="admin-users-toolbar">
        <input className="field admin-users-query" maxLength={64} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && search()} placeholder="用户名、昵称、姓名前缀或完整 ID" aria-label="搜索用户" />
        <select className="field" value={role} onChange={(event) => { setRole(event.target.value); setPage(1) }} aria-label="按角色筛选">
          <option value="">全部角色</option>
          {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select className="field" value={accountState} onChange={(event) => { setAccountState(event.target.value); setPage(1) }} aria-label="按账号状态筛选">
          <option value="">全部状态</option>
          <option value="active">正常</option>
          <option value="muted">禁言中</option>
          <option value="disabled">已停用</option>
        </select>
        <select className="field admin-users-sort" value={sortValue} onChange={(event) => { setSortValue(event.target.value); setPage(1) }} aria-label="用户排序方式">
          <option value="created_at:desc">最新注册</option>
          <option value="created_at:asc">最早注册</option>
          <option value="last_login_at:desc">最近登录</option>
          <option value="username:asc">用户名 A-Z</option>
          <option value="role:asc">按角色排序</option>
          <option value="status:asc">按状态排序</option>
        </select>
        <div className="admin-users-search-actions flex gap-2">
          <button className="btn btn-primary" type="button" onClick={search}><i className="bi bi-search" />搜索</button>
          <button className="btn btn-outline" type="button" onClick={clearFilters}>清除</button>
        </div>
        <button className="btn btn-outline" type="button" disabled={loading} onClick={load}><i className="bi bi-arrow-clockwise" />刷新</button>
        {canManageRoles ? <button className="btn btn-primary" type="button" onClick={() => { setStaffDraft(emptyStaffDraft); setCreatingStaff(true) }}><i className="bi bi-person-plus" />创建管理员</button> : null}
      </div>

      <div className="admin-users-summary">
        <p className="text-sm text-muted">{loading ? '正在加载…' : <>显示 {formatNumber(firstVisible)}–{formatNumber(lastVisible)}，共 {formatNumber(total)} 位匹配用户</>}</p>
        <label className="flex items-center gap-2 text-sm text-muted">每页
          <select className="field w-auto" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} aria-label="每页用户数量">
            <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
          </select>
        </label>
      </div>

      <section className="admin-users-list" aria-busy={loading} aria-label="用户列表">
        {users.map((user) => {
          const isSelf = Number(user.id) === currentUserId
          const protectedTarget = !canManageRoles && (user.role !== 'user' || (user.capabilities || []).length > 0)
          const canEditTargetProfile = currentCapabilitySet.has('users.profile.update')
          const canToggleTargetStatus = user.status === 'disabled'
            ? currentCapabilitySet.has('users.status.enable')
            : currentCapabilitySet.has('users.status.disable')
          const canEditTarget = (canEditTargetProfile || canToggleTargetStatus) && !protectedTarget && !isSelf
          const canMuteTarget = currentCapabilitySet.has('users.mute') && !protectedTarget && !isSelf
          const canResetTarget = currentCapabilitySet.has('users.password.reset') && !protectedTarget && !isSelf
          const canDisableTarget = currentCapabilitySet.has('users.status.disable') && !protectedTarget && !isSelf && user.role !== 'super_admin'
          const canSetRole = canManageRoles && !isSelf
          const canOpenPermissions = canManagePermissions
          const canManageTarget = canEditTarget || canMuteTarget || canResetTarget || canDisableTarget || canSetRole || canOpenPermissions
          return <article className="admin-user-card" key={user.id}>
            <div className="admin-user-identity">
              <div className="admin-user-name">{user.username}</div>
              <div className="admin-user-nickname">{user.nickname || user.real_name || '未设置显示名称'}</div>
              <div className="admin-user-id">用户 ID · {user.id}</div>
            </div>
            <div className="admin-user-badges">
              <RoleBadge role={user.role || 'user'} /><StatusBadge user={user} />
              {user.permission_customized ? <span className="badge status-warning" title={`允许 ${user.permission_allow_count || 0} 项，拒绝 ${user.permission_deny_count || 0} 项`}><i className="bi bi-sliders" />个人权限</span> : null}
            </div>
            <div className="admin-user-activity">
              <span>最后登录 <b>{formatTime(user.last_login_at)}</b></span>
              <span>{user.is_muted ? <>禁言到 <b>{formatTime(user.muted_until)}</b></> : <>注册于 <b>{formatTime(user.created_at)}</b></>}</span>
              {user.mute_reason ? <span title={user.mute_reason}>原因：{user.mute_reason}</span> : null}
            </div>
            <div className="admin-user-actions">
              {canManageTarget ? <details>
                <summary className="btn btn-sm btn-outline" aria-label={`管理用户 ${user.username}`} onClick={(event) => { if (busy) event.preventDefault() }}><i className="bi bi-three-dots" />管理</summary>
                <div className="admin-user-action-menu" role="menu">
                  {canSetRole ? <button className="btn btn-sm" type="button" disabled={busy} onClick={(event) => menuAction(event, () => openRole(user))}><i className="bi bi-shield-check" />设置角色</button> : null}
                  {canOpenPermissions ? <button className="btn btn-sm" type="button" disabled={busy} onClick={(event) => menuAction(event, () => openPermissions(user))}><i className="bi bi-sliders" />细分权限</button> : null}
                  {canEditTarget ? <button className="btn btn-sm" type="button" disabled={busy} onClick={(event) => menuAction(event, () => setEditing({ ...user, _original_status: user.status || 'active' }))}><i className="bi bi-pencil" />编辑资料</button> : null}
                  {canMuteTarget && user.is_muted
                    ? <button className="btn btn-sm" type="button" disabled={busy} onClick={(event) => menuAction(event, () => unmute(user))}><i className="bi bi-check-circle" />解除禁言</button>
                    : (canMuteTarget ? <button className="btn btn-sm" type="button" disabled={busy} onClick={(event) => menuAction(event, () => openMute(user))}><i className="bi bi-shield-exclamation" />设置禁言</button> : null)}
                  {canResetTarget ? <button className="btn btn-sm" type="button" disabled={busy} onClick={(event) => menuAction(event, () => setResetTarget(user))}><i className="bi bi-key" />重置密码</button> : null}
                  {canDisableTarget ? <button className="btn btn-sm danger" type="button" disabled={busy || user.status === 'disabled'} onClick={(event) => menuAction(event, () => disableUser(user))}><i className="bi bi-person" />停用账号</button> : null}
                </div>
              </details> : <span className="text-xs text-muted">无可用操作</span>}
            </div>
          </article>
        })}
      </section>

      {!loading && !users.length ? <div className="card-flat py-10 text-center text-muted"><i className="bi bi-people block text-2xl" /><p className="mt-2">没有匹配的注册用户</p></div> : null}

      {totalPages > 0 ? (
        <nav className="admin-users-pagination" aria-label="用户列表分页">
          <span className="text-sm text-muted">第 {formatNumber(page)} / {formatNumber(totalPages)} 页</span>
          <div className="admin-users-pages">
            <button className="btn btn-sm btn-outline" type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
            {pages.map((item) => typeof item === 'string'
              ? <span className="px-1 text-muted" key={item}>…</span>
              : <button className="btn btn-sm btn-outline admin-users-page-button" type="button" key={item} aria-current={item === page ? 'page' : undefined} disabled={loading} onClick={() => setPage(item)}>{item}</button>)}
            <button className="btn btn-sm btn-outline" type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button>
          </div>
        </nav>
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
        {roleTarget?.permission_customized && nextRole !== roleTarget.role ? <div className="info-callout status-warning mt-4 p-3 text-sm"><i className="bi bi-exclamation-triangle-fill" /><span>修改角色会清空该用户现有的全部个人权限覆盖，并使旧会话立即失效。</span></div> : null}
        {nextRole === 'super_admin' ? <div className="info-callout status-warning mt-4 p-3 text-sm"><i className="bi bi-exclamation-triangle-fill" /><span>超级管理员可以修改所有用户权限。只授予你完全信任的人。</span></div> : null}
      </Modal>

      <Modal
        visible={Boolean(permissionTarget)}
        title={`细分权限 · ${permissionTarget?.username || ''}`}
        width="1040px"
        onClose={() => !busy && !permissionLoading && setPermissionTarget(null)}
        footer={permissionState ? <>
          {!permissionReadOnly && permissionState.customized ? <button className="btn btn-outline" type="button" disabled={busy || !permissionReason.trim()} onClick={resetPermissions}><i className="bi bi-arrow-counterclockwise" />恢复角色默认</button> : null}
          <button className="btn btn-outline" type="button" disabled={busy} onClick={() => setPermissionTarget(null)}>{permissionReadOnly ? '关闭' : '取消'}</button>
          {!permissionReadOnly ? <button className="btn btn-primary" type="button" disabled={busy || !permissionsDirty || !permissionReason.trim()} onClick={savePermissions}><i className="bi bi-shield-check" />确认并保存</button> : null}
        </> : null}
      >
        {permissionLoading ? <div className="page-center py-10"><div className="spinner" /><p className="text-muted">正在加载权限…</p></div> : null}
        {!permissionLoading && permissionState ? <div className="space-y-4">
          <div className="info-callout p-3 text-sm">
            <i className={`bi ${permissionReadOnly ? 'bi-lock-fill' : 'bi-diagram-3-fill'}`} />
            <div>
              <b>{roleMeta(permissionState.role).label}默认 + 个人允许/拒绝</b>
              <p className="mt-1 text-muted">解析顺序：个人拒绝 → 个人允许 → 角色默认。拒绝始终优先，权限依赖会自动联动。</p>
              {permissionState.overrides_locked ? <p className="mt-1 status-warning">该角色的个人覆盖已系统锁定：{permissionState.role === 'reviewer' ? '所有审核员必须完全同权' : '超级管理员始终拥有全部权限'}。</p> : null}
              {Number(permissionTarget?.id) === currentUserId ? <p className="mt-1 status-warning">为避免自我授权或锁定，不能修改当前账号的个人权限。</p> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="badge">角色默认 {permissionState.defaults.length}</span>
            <span className="badge status-success">个人允许 {permissionOverrides.allow.length}</span>
            <span className="badge status-danger">个人拒绝 {permissionOverrides.deny.length}</span>
            <span className="badge status-warning">最终可用 {permissionCatalog.filter((permission) => {
              const choice = permissionDraft[permission.key] || 'inherit'
              return choice === 'allow' || (choice === 'inherit' && permissionDefaults.has(permission.key))
            }).length}</span>
          </div>
          <div className="permission-editor">
            {permissionGroups.map(([group, permissions]) => <section className="permission-group" key={group}>
              <h3>{permissionGroupLabels[group] || group}<span className="ml-2 text-xs font-normal text-muted">{permissions.length} 项</span></h3>
              {permissions.map((permission) => {
                const choice = permissionDraft[permission.key] || 'inherit'
                const inherited = permissionDefaults.has(permission.key)
                const effective = choice === 'allow' || (choice === 'inherit' && inherited)
                return <div className="permission-row" key={permission.key}>
                  <div className="permission-copy">
                    <div className="flex flex-wrap items-center gap-2"><b>{permission.label}</b><span className={`badge ${permission.risk === 'critical' || permission.risk === 'high' ? 'status-danger' : (permission.risk === 'medium' ? 'status-warning' : '')}`}>{permissionRiskLabels[permission.risk] || permission.risk}</span></div>
                    <small>{permission.description}</small>
                    <code>{permission.key}</code>
                    {(permission.requires || []).length ? <small>依赖：{permission.requires.join('、')}</small> : null}
                  </div>
                  <div>
                    <select className="field permission-choice" value={choice} disabled={busy || permissionReadOnly || permission.assignable === false} onChange={(event) => setPermissionChoice(permission.key, event.target.value)} aria-label={`${permission.label}权限策略`}>
                      <option value="inherit">继承角色（{inherited ? '允许' : '不授予'}）</option>
                      <option value="allow">个人允许</option>
                      <option value="deny">个人拒绝</option>
                    </select>
                    <span className={`permission-effective ${effective ? 'status-success' : 'text-muted'}`}><i className={`bi ${effective ? 'bi-check-circle-fill' : 'bi-dash-circle'}`} />最终{effective ? '可用' : '不可用'}{permission.assignable === false ? ' · 系统控制' : ''}</span>
                  </div>
                </div>
              })}
            </section>)}
          </div>
          {!permissionReadOnly ? <label className="block"><span className="mb-2 block text-sm font-bold">调整原因 <span className="status-danger">*</span></span><textarea className="field permission-reason" maxLength={300} value={permissionReason} onChange={(event) => setPermissionReason(event.target.value)} placeholder="必填，将与变更前后权限一起写入操作审计" /><small className="mt-1 block text-muted">保存前会再次确认；保存后目标用户的旧会话立即失效。</small></label> : null}
        </div> : null}
      </Modal>

      <Modal visible={Boolean(editing)} title="编辑用户资料" onClose={() => !busy && setEditing(null)} footer={<><button className="btn btn-outline" type="button" disabled={busy} onClick={() => setEditing(null)}>取消</button><button className="btn btn-primary" type="button" disabled={busy} onClick={saveEdit}>保存</button></>}>
        {editing ? (
          <div className="space-y-4">
            <div className="info-callout p-3 text-sm text-muted">用户名“{editing.username}”不能在这里修改。</div>
            <label className="block"><span className="mb-2 block text-sm font-bold">昵称</span><input className="field" maxLength={30} value={editing.nickname || ''} disabled={!currentCapabilitySet.has('users.profile.update')} onChange={(event) => setEditing((item) => ({ ...item, nickname: event.target.value }))} /></label>
            <label className="block"><span className="mb-2 block text-sm font-bold">个人简介</span><textarea className="field min-h-24" maxLength={200} value={editing.bio || ''} disabled={!currentCapabilitySet.has('users.profile.update')} onChange={(event) => setEditing((item) => ({ ...item, bio: event.target.value }))} /></label>
            <label className="block"><span className="mb-2 block text-sm font-bold">状态</span><select className="field" value={editing.status || 'active'} disabled={!canChangeEditingStatus} onChange={(event) => setEditing((item) => ({ ...item, status: event.target.value }))}><option value="active">正常</option><option value="disabled">停用</option></select>{!canChangeEditingStatus ? <small className="mt-1 block text-muted">当前账号没有切换此状态的权限。</small> : null}</label>
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

      <Modal visible={creatingStaff} title="创建管理员账号" onClose={() => !busy && setCreatingStaff(false)} footer={<><button className="btn btn-outline" type="button" disabled={busy} onClick={() => setCreatingStaff(false)}>取消</button><button className="btn btn-primary" type="button" disabled={busy || staffDraft.username.trim().length < 2 || staffDraft.password.length < 8} onClick={createStaff}>确认创建</button></>}>
        <div className="space-y-4">
          <p className="text-sm text-muted">只能创建审核员、管理员或超级管理员。学生请使用飞书登录，不能在此创建普通用户。</p>
          <label className="block"><span className="mb-2 block text-sm font-bold">用户名</span><input className="field" autoComplete="off" maxLength={24} value={staffDraft.username} onChange={(event) => setStaffDraft((current) => ({ ...current, username: event.target.value }))} placeholder="2–24 个字符" /></label>
          <label className="block"><span className="mb-2 block text-sm font-bold">显示名（可选）</span><input className="field" maxLength={40} value={staffDraft.nickname} onChange={(event) => setStaffDraft((current) => ({ ...current, nickname: event.target.value }))} placeholder="默认与用户名相同" /></label>
          <label className="block"><span className="mb-2 block text-sm font-bold">角色</span><select className="field" value={staffDraft.role} onChange={(event) => setStaffDraft((current) => ({ ...current, role: event.target.value }))}>{staffRoleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="block"><span className="mb-2 block text-sm font-bold">密码</span><input className="field" type="password" autoComplete="new-password" maxLength={128} value={staffDraft.password} onChange={(event) => setStaffDraft((current) => ({ ...current, password: event.target.value }))} placeholder="至少 8 个字符" /></label>
          <label className="block"><span className="mb-2 block text-sm font-bold">确认密码</span><input className="field" type="password" autoComplete="new-password" maxLength={128} value={staffDraft.passwordConfirm} onChange={(event) => setStaffDraft((current) => ({ ...current, passwordConfirm: event.target.value }))} placeholder="再次输入密码" /></label>
        </div>
      </Modal>
    </AdminShell>
  )
}
