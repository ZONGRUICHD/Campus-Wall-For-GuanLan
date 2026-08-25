import { isPrivilegedRole } from './roles.js'

const normalizeCategoryTag = (value = '') => String(value || '')
  .trim()
  .replace(/^#+/, '')
  .trim()

const confessionTags = new Set(['表白', '表白墙'])

export const isConfessionPost = (tags = []) => (
  (Array.isArray(tags) ? tags : [])
    .some((tag) => confessionTags.has(normalizeCategoryTag(tag)))
)

export const publicationStateFor = ({ tags = [], user = null, admin = null, lostFound = null } = {}) => {
  let reason = ''
  if (admin || isPrivilegedRole(user?.role)) reason = 'privileged_author'
  else if (lostFound && typeof lostFound === 'object') reason = 'lost_found'
  else if (isConfessionPost(tags)) reason = 'confession'

  return reason
    ? { moderation_status: 'visible', review_status: 'approved', review_bypass_reason: reason }
    : { moderation_status: 'pending', review_status: 'pending', review_bypass_reason: '' }
}

export const editedPublicationStateFor = ({ message = null, ...context } = {}) => {
  if (message?.review_hold === true) {
    return { moderation_status: 'pending', review_status: 'pending', review_bypass_reason: '' }
  }
  return publicationStateFor(context)
}
