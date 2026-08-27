const moderationActorFields = [
  'admin_username',
  'submitted_by_user_id',
  'reviewed_by',
  'review_hold_by',
  'restored_by',
  'hidden_by',
  'deleted_by'
]

const isPublicComment = (comment) => Boolean(comment) && comment.moderation_status === 'visible'

const stripModerationActors = (value) => {
  for (const field of moderationActorFields) delete value[field]
  return value
}

export const redactPublicMessage = (message, viewerUserId = 0) => {
  if (!message) return message
  const copy = stripModerationActors(JSON.parse(JSON.stringify(message)))
  delete copy.username
  const named = copy.anonymous === false
  if (!named) {
    copy.display_name_snapshot = '匿名用户'
    delete copy.user_id
  }
  if (Array.isArray(copy.comments)) {
    const hiddenCommentIds = new Set(copy.comments
      .filter((comment) => !isPublicComment(comment))
      .map((comment) => String(comment.id)))
    copy.comments = copy.comments.filter((comment) => isPublicComment(comment)).map((comment) => {
      const next = stripModerationActors({ ...comment })
      if (next.refer_id && hiddenCommentIds.has(String(next.refer_id))) {
        next.refer = '该评论已被管理员隐藏'
        next.refer_hidden = true
      }
      if (viewerUserId && Number(next.user_id) === Number(viewerUserId)) next.owned = true
      else delete next.owned
      delete next.user_id
      delete next.username
      return next
    })
  }
  return copy
}
