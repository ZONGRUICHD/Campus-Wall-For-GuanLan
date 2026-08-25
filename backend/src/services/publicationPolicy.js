import { isPrivilegedRole } from './roles.js'

export const publicationStateFor = ({ user = null, admin = null, lostFound = null } = {}) => {
  let reason = ''
  if (admin || isPrivilegedRole(user?.role)) reason = 'privileged_author'
  else if (lostFound && typeof lostFound === 'object') reason = 'lost_found'
  // Ordinary posts, including confessions, intentionally fall through to review.

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
