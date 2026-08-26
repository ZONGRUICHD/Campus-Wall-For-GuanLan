export const adminCapabilityDestinations = Object.freeze([
  ['dashboard.read', '/admin'],
  ['content.queue.read', '/admin/wall'],
  ['content.comment.read', '/admin/comments'],
  ['content.trash.read', '/admin/trash'],
  ['users.read', '/admin/users'],
  ['notice.read', '/admin/notice'],
  ['settings.notifications.read', '/admin/notifications'],
  ['feedback.read', '/admin/feedback'],
  ['report.read', '/admin/report'],
  ['audit.read', '/admin/audit'],
  ['logs.legacy_admin.read', '/admin/log'],
  ['logs.error.read', '/admin/error_log'],
  ['settings.read', '/admin/settings']
])

export const capabilitySet = (account) => new Set(
  Array.isArray(account?.capabilities)
    ? account.capabilities.map((item) => String(typeof item === 'string' ? item : item?.key || item?.name || '')).filter(Boolean)
    : []
)

export const hasCapability = (account, capability) => capabilitySet(account).has(String(capability || ''))

export const hasAnyCapability = (account, capabilities = []) => {
  const allowed = capabilitySet(account)
  return capabilities.some((capability) => allowed.has(capability))
}

export const firstAdminDestination = (account) => {
  const allowed = capabilitySet(account)
  return adminCapabilityDestinations.find(([capability]) => allowed.has(capability))?.[1] || ''
}
