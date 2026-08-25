const tagName = (value = '') => String(
  typeof value === 'string' ? value : (value?.tag || value?.name || '')
)
  .trim()

export const moderationScopes = Object.freeze(['all', 'posts', 'confessions'])

export const normalizeModerationScope = (value = 'all') => {
  const scope = String(value || '').trim().toLowerCase()
  return moderationScopes.includes(scope) ? scope : 'all'
}

export const isConfessionMessage = (message = {}) => {
  if (message?.lost_found && typeof message.lost_found === 'object') return false
  const tags = Array.isArray(message?.tags) ? message.tags : String(message?.tags || '').split(',')
  return tags.some((tag) => tagName(tag) === '表白')
}

export const moderationScopeForMessage = (message = {}) => (
  isConfessionMessage(message) ? 'confessions' : 'posts'
)

export const matchesModerationScope = (message, scope = 'all') => {
  const normalized = normalizeModerationScope(scope)
  return normalized === 'all' || moderationScopeForMessage(message) === normalized
}

export const filterModerationScope = (messages = [], scope = 'all') => (
  messages.filter((message) => matchesModerationScope(message, scope))
)
