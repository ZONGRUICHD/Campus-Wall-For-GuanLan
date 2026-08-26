export const accountRoles = Object.freeze(['user', 'reviewer', 'admin', 'super_admin'])

// Legacy permission objects remain part of the public session contract. New
// authorization checks use the finer capability catalog below; a legacy
// permission is exposed only when all capabilities in its bundle are effective.
export const adminPermissionDefinitions = Object.freeze([
  Object.freeze({ name: 'review_posts', description: '审核全部实际待审内容（帖子与表白墙）', url: '/admin' }),
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

export const permissionCatalogVersion = 3

const defineCapability = (key, group, label, description, options = {}) => Object.freeze({
  key,
  name: key,
  group,
  label,
  description,
  risk: options.risk || 'low',
  assignable: options.assignable !== false,
  requires: Object.freeze([...(options.requires || [])])
})

export const capabilityDefinitions = Object.freeze([
  defineCapability('dashboard.read', 'dashboard', '查看后台概览', '进入后台并查看自己有权访问的统计摘要'),
  defineCapability('content.publish.official', 'publishing', '以官方身份发布', '使用官方身份发布校园动态', { risk: 'high', requires: ['content.publish.bypass_review'] }),
  defineCapability('content.publish.bypass_review', 'publishing', '发布免审', '发布内容时直接公开，不进入审核队列', { risk: 'high', requires: ['dashboard.read'] }),
  defineCapability('content.queue.read', 'review', '查看审核队列', '查看帖子与表白墙审核队列'),
  defineCapability('content.review', 'review', '审核全部内容', '通过或退回帖子与表白墙中的待审内容', { risk: 'medium', requires: ['content.queue.read'] }),
  defineCapability('content.author_identity.read', 'review', '查看作者身份', '在后台查看内容作者和提交账号身份', { risk: 'high', requires: ['content.queue.read'] }),
  defineCapability('content.attachment.private.read', 'review', '查看非公开附件', '读取待审、下架或被举报内容的附件', { risk: 'medium', requires: ['content.queue.read'] }),
  defineCapability('content.trash.read', 'content', '查看内容回收站', '查看已删除的帖子和评论', { risk: 'medium' }),
  defineCapability('content.message.pin', 'content', '置顶帖子', '设置或取消帖子置顶', { risk: 'medium', requires: ['content.queue.read'] }),
  defineCapability('content.message.feature', 'content', '设置精华', '设置或取消帖子精华', { risk: 'medium', requires: ['content.queue.read'] }),
  defineCapability('content.message.hide', 'content', '上下架帖子', '下架或恢复帖子展示', { risk: 'high', requires: ['content.queue.read'] }),
  defineCapability('content.message.delete', 'content', '删除帖子', '把帖子移入回收站', { risk: 'high', requires: ['content.queue.read'] }),
  defineCapability('content.message.restore', 'content', '恢复已删帖子', '从回收站恢复帖子', { risk: 'high', requires: ['content.trash.read'] }),
  defineCapability('content.message.purge', 'content', '永久删除帖子', '从回收站永久删除帖子', { risk: 'critical', requires: ['content.trash.read'] }),
  defineCapability('content.media.repair', 'content', '修复媒体', '重新生成帖子媒体缩略文件', { risk: 'medium', requires: ['content.queue.read'] }),
  defineCapability('content.comment.read', 'comments', '查看评论管理', '查看公开与已下架评论'),
  defineCapability('content.comment.hide', 'comments', '上下架评论', '下架或恢复评论展示', { risk: 'high', requires: ['content.comment.read'] }),
  defineCapability('content.comment.delete', 'comments', '删除评论', '把评论移入回收站', { risk: 'high', requires: ['content.comment.read'] }),
  defineCapability('content.comment.restore', 'comments', '恢复已删评论', '从回收站恢复评论', { risk: 'high', requires: ['content.trash.read'] }),
  defineCapability('content.comment.purge', 'comments', '永久删除评论', '从回收站永久删除评论', { risk: 'critical', requires: ['content.trash.read'] }),
  defineCapability('notice.read', 'notice', '查看公告管理', '查看公告及历史记录'),
  defineCapability('notice.create', 'notice', '发布公告', '创建新的主页公告', { risk: 'medium', requires: ['notice.read'] }),
  defineCapability('notice.update', 'notice', '编辑公告', '修改已有公告', { risk: 'medium', requires: ['notice.read'] }),
  defineCapability('notice.delete', 'notice', '撤回公告', '撤回已有公告', { risk: 'high', requires: ['notice.read'] }),
  defineCapability('feedback.read', 'feedback', '查看反馈工单', '查看用户反馈工单'),
  defineCapability('feedback.update', 'feedback', '处理反馈工单', '更新反馈状态、回复和内部备注', { risk: 'medium', requires: ['feedback.read'] }),
  defineCapability('report.read', 'reports', '查看举报', '查看待处理举报'),
  defineCapability('report.history.read', 'reports', '查看举报历史', '查看已处理举报记录', { requires: ['report.read'] }),
  defineCapability('report.resolve', 'reports', '处理举报', '驳回举报或结合内容权限完成处置', { risk: 'high', requires: ['report.read'] }),
  defineCapability('users.read', 'users', '查看用户', '查看、筛选和搜索注册用户'),
  defineCapability('users.profile.update', 'users', '编辑用户资料', '编辑普通用户的昵称、简介等资料', { risk: 'medium', requires: ['users.read'] }),
  defineCapability('users.mute', 'users', '管理禁言', '禁言或解除普通用户禁言', { risk: 'high', requires: ['users.read'] }),
  defineCapability('users.status.disable', 'users', '停用账号', '停用普通用户账号并使会话失效', { risk: 'critical', requires: ['users.read'] }),
  defineCapability('users.status.enable', 'users', '启用账号', '重新启用普通用户账号', { risk: 'high', requires: ['users.read'] }),
  defineCapability('users.password.reset', 'users', '重置用户密码', '重置普通用户密码并使旧会话失效', { risk: 'critical', requires: ['users.read'] }),
  defineCapability('users.role.assign', 'security', '分配角色', '任命或调整用户角色，仅超级管理员可用', { risk: 'critical', assignable: false, requires: ['users.read'] }),
  defineCapability('users.permissions.assign', 'security', '分配个人权限', '设置用户个人允许或拒绝权限，仅超级管理员可用', { risk: 'critical', assignable: false, requires: ['users.read'] }),
  defineCapability('settings.read', 'settings', '查看平台设置', '查看平台和人机验证设置'),
  defineCapability('settings.captcha.update', 'settings', '修改人机验证', '修改人机验证开关与服务配置', { risk: 'high', requires: ['settings.read'] }),
  defineCapability('settings.community.update', 'settings', '修改社区设置', '修改发帖、评论和敏感词等设置', { risk: 'high', requires: ['settings.read'] }),
  defineCapability('settings.notifications.read', 'settings', '查看消息提醒', '查看审核消息提醒渠道的脱敏配置状态', { requires: ['settings.read'] }),
  defineCapability('settings.notifications.update', 'settings', '修改消息提醒', '启停消息提醒并替换机器人 Webhook 或签名密钥', { risk: 'critical', requires: ['settings.notifications.read'] }),
  defineCapability('settings.notifications.test', 'settings', '测试消息提醒', '向已保存的群机器人发送固定的安全测试消息', { risk: 'high', requires: ['settings.notifications.read'] }),
  defineCapability('logs.error.read', 'logs', '查看错误日志', '查看服务器错误日志', { risk: 'high' }),
  defineCapability('logs.legacy_admin.read', 'logs', '查看管理员日志', '查看兼容的管理员文本日志', { risk: 'high' }),
  defineCapability('audit.read', 'logs', '查看操作审计', '查看结构化后台操作审计', { risk: 'high' })
])

const capabilityMap = new Map(capabilityDefinitions.map((capability) => [capability.key, capability]))
export const capabilityKeys = Object.freeze(capabilityDefinitions.map((capability) => capability.key))

export const legacyPermissionBundles = Object.freeze({
  review_posts: Object.freeze([
    'dashboard.read',
    'content.publish.official',
    'content.publish.bypass_review',
    'content.queue.read',
    'content.review',
    'content.attachment.private.read'
  ]),
  manage_wall_message: Object.freeze([
    'dashboard.read',
    'content.publish.official',
    'content.publish.bypass_review',
    'content.queue.read',
    'content.review',
    'content.author_identity.read',
    'content.attachment.private.read',
    'content.trash.read',
    'content.message.pin',
    'content.message.feature',
    'content.message.hide',
    'content.message.delete',
    'content.message.restore',
    'content.message.purge',
    'content.media.repair',
    'content.comment.read',
    'content.comment.hide',
    'content.comment.delete',
    'content.comment.restore',
    'content.comment.purge'
  ]),
  notice: Object.freeze(['notice.read', 'notice.create', 'notice.update', 'notice.delete']),
  view_user_log: Object.freeze(['feedback.read', 'feedback.update']),
  view_report: Object.freeze(['report.read', 'report.history.read', 'report.resolve']),
  view_log: Object.freeze(['logs.error.read']),
  view_admin_log: Object.freeze(['logs.legacy_admin.read', 'audit.read']),
  manage_settings: Object.freeze(['settings.read', 'settings.captcha.update', 'settings.community.update', 'settings.notifications.read']),
  manage_users: Object.freeze([
    'users.read',
    'users.profile.update',
    'users.mute',
    'users.status.disable',
    'users.status.enable',
    'users.password.reset'
  ]),
  manage_roles: Object.freeze(['users.read', 'users.role.assign', 'users.permissions.assign']),
  manage_admins: Object.freeze(['users.read', 'users.role.assign', 'users.permissions.assign'])
})

const roleLegacyPermissionNames = Object.freeze({
  user: Object.freeze([]),
  reviewer: Object.freeze(['review_posts', 'notice']),
  admin: Object.freeze([
    'manage_wall_message',
    'notice',
    'view_user_log',
    'view_report',
    'view_log',
    'view_admin_log',
    'manage_settings',
    'manage_users'
  ]),
  super_admin: Object.freeze(adminPermissionDefinitions.map((permission) => permission.name))
})

const expandLegacyPermissions = (names = []) => [...new Set(names.flatMap((name) => legacyPermissionBundles[name] || []))]

const roleCapabilityKeys = Object.freeze({
  user: Object.freeze([]),
  reviewer: Object.freeze(expandLegacyPermissions(roleLegacyPermissionNames.reviewer)),
  admin: Object.freeze(expandLegacyPermissions(roleLegacyPermissionNames.admin)),
  super_admin: capabilityKeys
})

const legacyPermissionMap = new Map(adminPermissionDefinitions.map((permission) => [permission.name, permission]))

export const normalizeRole = (value = '') => accountRoles.includes(String(value || '').trim())
  ? String(value).trim()
  : 'user'

export const isPrivilegedRole = (role) => ['reviewer', 'admin', 'super_admin'].includes(normalizeRole(role))

export const canPasswordLogin = (user) => Boolean(
  user
  && user.status === 'active'
  && isPrivilegedRole(user.role)
  && user.password_hash
  && user.password_salt
)

export const overridesLockedForRole = (role) => ['reviewer', 'super_admin'].includes(normalizeRole(role))

export const capabilitiesForRole = (role) => [...(roleCapabilityKeys[normalizeRole(role)] || [])]

const normalizedOverrideEntries = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => [String(item?.permission_key || item?.key || ''), String(item?.effect || '')])
  }
  if (value && typeof value === 'object') return Object.entries(value)
  return []
}

export const normalizeStoredPermissionOverrides = (value) => {
  const allow = []
  const deny = []
  for (const [rawKey, rawEffect] of normalizedOverrideEntries(value)) {
    const key = String(rawKey || '').trim()
    const effect = String(rawEffect || '').trim().toLowerCase()
    if (!capabilityMap.has(key)) continue
    if (effect === 'allow') allow.push(key)
    if (effect === 'deny') deny.push(key)
  }
  return {
    allow: [...new Set(allow)].sort(),
    deny: [...new Set(deny)].sort()
  }
}

export const validatePermissionOverrideLists = ({ allow = [], deny = [] } = {}) => {
  if (!Array.isArray(allow) || !Array.isArray(deny)) {
    return { success: false, error: '权限允许与拒绝列表必须是数组', code: 'INVALID_PERMISSION_OVERRIDES' }
  }
  const normalizedAllow = [...new Set(allow.map((key) => String(key || '').trim()).filter(Boolean))]
  const normalizedDeny = [...new Set(deny.map((key) => String(key || '').trim()).filter(Boolean))]
  const submitted = [...normalizedAllow, ...normalizedDeny]
  const unknown = submitted.filter((key) => !capabilityMap.has(key))
  if (unknown.length) {
    return { success: false, error: `未知权限：${unknown.join('、')}`, code: 'UNKNOWN_PERMISSION', unknown }
  }
  const protectedKeys = submitted.filter((key) => capabilityMap.get(key)?.assignable === false)
  if (protectedKeys.length) {
    return { success: false, error: `系统级权限不能单独分配：${protectedKeys.join('、')}`, code: 'PROTECTED_PERMISSION', protected: protectedKeys }
  }
  const denySet = new Set(normalizedDeny)
  const overlap = normalizedAllow.filter((key) => denySet.has(key))
  if (overlap.length) {
    return { success: false, error: `权限不能同时允许和拒绝：${overlap.join('、')}`, code: 'PERMISSION_OVERRIDE_CONFLICT', overlap }
  }
  return { success: true, allow: normalizedAllow.sort(), deny: normalizedDeny.sort() }
}

export const resolvePermissionState = ({ role = 'user', overrides = {} } = {}) => {
  const normalizedRole = normalizeRole(role)
  const defaults = capabilitiesForRole(normalizedRole)
  if (overridesLockedForRole(normalizedRole)) {
    return {
      role: normalizedRole,
      defaults,
      allow: [],
      deny: [],
      effective: [...defaults],
      overrides_locked: true,
      customized: false
    }
  }
  const normalized = normalizeStoredPermissionOverrides(overrides)
  const denied = new Set(normalized.deny)
  const effective = [...new Set([...defaults, ...normalized.allow])]
    .filter((key) => !denied.has(key) && capabilityMap.has(key))
    .sort()
  return {
    role: normalizedRole,
    defaults,
    allow: normalized.allow,
    deny: normalized.deny,
    effective,
    overrides_locked: false,
    customized: normalized.allow.length > 0 || normalized.deny.length > 0
  }
}

export const missingCapabilityDependencies = (capabilities = []) => {
  const effective = new Set(capabilities)
  const missing = []
  for (const key of effective) {
    for (const dependency of capabilityMap.get(key)?.requires || []) {
      if (!effective.has(dependency)) missing.push({ key, dependency })
    }
  }
  return missing
}

export const legacyPermissionsForCapabilities = (capabilities = []) => {
  const effective = new Set(capabilities)
  return adminPermissionDefinitions
    .filter((permission) => (legacyPermissionBundles[permission.name] || []).every((key) => effective.has(key)))
    .map((permission) => ({ ...permission }))
}

export const permissionsForRole = (role) => (roleLegacyPermissionNames[normalizeRole(role)] || [])
  .map((name) => ({ ...legacyPermissionMap.get(name) }))

export const hasRolePermission = (role, permissionName) => (roleLegacyPermissionNames[normalizeRole(role)] || [])
  .includes(String(permissionName || ''))

export const hasCapability = (accountOrCapabilities, capabilityKey) => {
  const key = String(capabilityKey || '')
  if (!capabilityMap.has(key)) return false
  if (Array.isArray(accountOrCapabilities)) {
    return accountOrCapabilities.some((item) => String(typeof item === 'string' ? item : item?.key || item?.name || '') === key)
  }
  if (!accountOrCapabilities || typeof accountOrCapabilities !== 'object') return false
  if (Array.isArray(accountOrCapabilities.capabilities)) return accountOrCapabilities.capabilities.includes(key)
  return resolvePermissionState({
    role: accountOrCapabilities.role,
    overrides: accountOrCapabilities.permission_overrides || accountOrCapabilities.overrides
  }).effective.includes(key)
}

export const canAccessAdmin = (account = null) => Boolean(account?.status !== 'disabled'
  && Array.isArray(account?.capabilities)
  && account.capabilities.length > 0)

export const canReadMessageDetail = ({ capabilities = [], message = null, hasPendingReport = false } = {}) => {
  if (!message) return false
  const allowed = new Set(Array.isArray(capabilities) ? capabilities.map(String) : [])
  if (message.moderation_status === 'deleted') return allowed.has('content.trash.read')
  if (hasPendingReport && allowed.has('report.read')) return true
  if (message.moderation_status === 'hidden') return allowed.has('content.message.hide')
  return allowed.has('content.queue.read')
}

export const canReadFileReference = ({ capabilities = [], references = [], reportedTargets = [] } = {}) => {
  const allowed = new Set(Array.isArray(capabilities) ? capabilities.map(String) : [])
  if (!allowed.has('content.attachment.private.read')) return false
  const reported = (Array.isArray(reportedTargets) ? reportedTargets : []).map((target) => ({
    messageId: String(target?.messageId || target?.message_id || ''),
    targetType: target?.targetType === 'comment' || target?.target_type === 'comment' ? 'comment' : 'message',
    commentId: String(target?.commentId || target?.comment_id || '')
  }))
  return (Array.isArray(references) ? references : []).some((reference) => {
    const messageId = String(reference?.messageId || '')
    const messageStatus = String(reference?.messageStatus || 'visible')
    const commentStatus = reference?.kind === 'comment'
      ? String(reference?.commentStatus || 'visible')
      : ''
    if (messageStatus === 'deleted') return allowed.has('content.trash.read')
    if (commentStatus === 'deleted') return allowed.has('content.trash.read')
    if (allowed.has('report.read')) {
      const reportMatch = reported.some((target) => target.messageId === messageId && (
        reference?.kind === 'message'
        || (target.targetType === 'comment' && target.commentId === String(reference?.commentId || ''))
      ))
      if (reportMatch) return true
    }

    if (messageStatus === 'hidden') {
      return allowed.has('content.message.hide')
        && (reference?.kind !== 'comment' || allowed.has('content.comment.read'))
    }

    if (reference?.kind === 'comment') {
      return allowed.has('content.queue.read') && allowed.has('content.comment.read')
    }
    return allowed.has('content.queue.read')
  })
}

export const capabilityDefinition = (key) => capabilityMap.get(String(key || '')) || null

export const roleDefinitions = Object.freeze(accountRoles.map((role) => Object.freeze({
  role,
  label: {
    user: '普通用户',
    reviewer: '审核员',
    admin: '管理员',
    super_admin: '超级管理员'
  }[role],
  permissions: Object.freeze((roleLegacyPermissionNames[role] || []).map((name) => name)),
  capabilities: Object.freeze([...(roleCapabilityKeys[role] || [])]),
  overrides_locked: overridesLockedForRole(role)
})))
