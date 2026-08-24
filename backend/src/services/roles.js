export const accountRoles = Object.freeze(['user', 'reviewer', 'admin', 'super_admin'])

export const adminPermissionDefinitions = Object.freeze([
  Object.freeze({ name: 'review_posts', description: '审核校园墙留言', url: '/admin/wall' }),
  Object.freeze({ name: 'manage_wall_message', description: '管理校园墙留言', url: '/admin/wall', max_delete_message: 10000 }),
  Object.freeze({ name: 'notice', description: '管理公告', url: '/admin/notice' }),
  Object.freeze({ name: 'view_user_log', description: '处理反馈工单', url: '/admin/feedback' }),
  Object.freeze({ name: 'view_report', description: '处理内容举报', url: '/admin/report' }),
  Object.freeze({ name: 'view_log', description: '查看错误日志', url: '/admin/error_log' }),
  Object.freeze({ name: 'view_admin_log', description: '查看管理员日志', url: '/admin/log' }),
  Object.freeze({ name: 'manage_settings', description: '管理平台设置', url: '/admin/settings' }),
  Object.freeze({ name: 'manage_users', description: '管理注册用户', url: '/admin/users' }),
  Object.freeze({ name: 'manage_roles', description: '分配用户角色', url: '/admin/users' }),
  Object.freeze({ name: 'manage_admins', description: '兼容旧版管理员入口', url: '/admin/managers' })
])

const permissionMap = new Map(adminPermissionDefinitions.map((permission) => [permission.name, permission]))
const adminPermissionNames = adminPermissionDefinitions
  .map((permission) => permission.name)
  .filter((name) => !['review_posts', 'manage_roles', 'manage_admins'].includes(name))

const rolePermissionNames = Object.freeze({
  user: Object.freeze([]),
  reviewer: Object.freeze(['review_posts']),
  admin: Object.freeze(adminPermissionNames),
  super_admin: Object.freeze(adminPermissionDefinitions.map((permission) => permission.name))
})

export const normalizeRole = (value = '') => accountRoles.includes(String(value || '').trim())
  ? String(value).trim()
  : 'user'

export const isPrivilegedRole = (role) => ['reviewer', 'admin', 'super_admin'].includes(normalizeRole(role))

export const permissionsForRole = (role) => (rolePermissionNames[normalizeRole(role)] || [])
  .map((name) => ({ ...permissionMap.get(name) }))

export const hasRolePermission = (role, permissionName) => (rolePermissionNames[normalizeRole(role)] || [])
  .includes(String(permissionName || ''))

export const roleDefinitions = Object.freeze(accountRoles.map((role) => Object.freeze({
  role,
  label: {
    user: '普通用户',
    reviewer: '审核员',
    admin: '管理员',
    super_admin: '超级管理员'
  }[role],
  permissions: Object.freeze((rolePermissionNames[role] || []).map((name) => name))
})))
