import express from 'express'
import multer from 'multer'
import { config } from '../config.js'
import { authenticatedAccount, requireTrustedOrigin } from '../services/auth.js'
import { readJson } from '../services/jsonStore.js'
import { messageStore } from '../services/messageStore.js'
import { feedbackStore } from '../services/feedbackStore.js'
import { feedbackRateLimit } from '../services/rateLimit.js'
import { settingsStore } from '../services/settingsStore.js'
import { reportStore } from '../services/reportStore.js'
import { isLostFoundMessage, isLostFoundTag } from '../services/lostFound.js'

export const publicRouter = express.Router()
const form = multer({ limits: { fields: 8, fieldSize: config.maxTextLength } }).none()
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
const reportCategories = {
  spam: '垃圾信息',
  abuse: '恶意行为',
  porn: '低俗或违法信息',
  rumor: '虚假或不实信息',
  other: '其他'
}

const cookieIds = (req, name) => messageStore.parseCookieIds(req.cookies?.[name] || '')
const queryIndex = (value, fallback) => {
  const next = Math.floor(Number(value))
  return Number.isFinite(next) ? Math.max(next, 0) : fallback
}
const moderationActorFields = ['admin_username', 'submitted_by_user_id', 'reviewed_by', 'restored_by', 'hidden_by', 'deleted_by']
const redactModerationActors = (value) => {
  for (const field of moderationActorFields) delete value[field]
  return value
}
const redactPublicMessage = (message, viewerUserId = 0) => {
  if (!message) return message
  const copy = redactModerationActors(JSON.parse(JSON.stringify(message)))
  delete copy.username
  if (copy.user_id && copy.anonymous !== false) {
    copy.display_name_snapshot = '匿名用户'
  }
  delete copy.user_id
  if (Array.isArray(copy.comments)) {
    const hiddenCommentIds = new Set(copy.comments
      .filter((comment) => !messageStore.isPublicComment(comment))
      .map((comment) => String(comment.id)))
    copy.comments = copy.comments.filter((comment) => messageStore.isPublicComment(comment)).map((comment) => {
      const next = redactModerationActors({ ...comment })
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
const viewerIdentity = async (req) => {
  const user = await authenticatedAccount(req)
  if (user) return { user, key: `user:${user.id}` }
  const visitorId = String(req.cookies?.poll_voter || '')
  return { user: null, key: /^[a-f0-9-]{36}$/i.test(visitorId) ? `guest:${visitorId}` : '' }
}
const publicMessages = async (req, messages) => {
  const isArray = Array.isArray(messages)
  const identity = await viewerIdentity(req)
  const decorated = await messageStore.withViewerState(messages, {
    reactorKey: identity.key,
    likeList: cookieIds(req, 'likes'),
    dislikeList: cookieIds(req, 'dislikes'),
    pollSelections: messageStore.parsePollSelections(req.cookies?.poll_votes || '')
  })
  return isArray
    ? decorated.map((message) => redactPublicMessage(message, identity.user?.id))
    : redactPublicMessage(decorated, identity.user?.id)
}

const reportFields = (req, res) => {
  const text = String(req.body?.text || '').trim()
  const email = String(req.body?.email || '').trim()
  if (!text) {
    res.status(400).json({ success: false, error: '请填写举报理由' })
    return null
  }
  if (text.length > 1000 || email.length > config.maxEmailLength) {
    res.status(400).json({ success: false, error: '举报内容或邮箱过长' })
    return null
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ success: false, error: '请输入有效的联系邮箱' })
    return null
  }
  return {
    text,
    email,
    category: reportCategories[req.body?.category] || reportCategories.other
  }
}

publicRouter.get('/community/config', asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ success: true, community: await settingsStore.communityPublic() })
}))

publicRouter.get('/get_messages', asyncRoute(async (req, res) => {
  const account = await authenticatedAccount(req)
  if (!account && isLostFoundTag(req.query.tag)) {
    res.status(401).json({ success: false, error: '登录后才能查看失物招领' })
    return
  }
  const start = queryIndex(req.query.start, 0)
  const requestedEnd = queryIndex(req.query.end, start + config.messagePageSize)
  const end = Math.max(start + 1, Math.min(requestedEnd, start + config.maxPublicQuerySize))
  let messages = messageStore.getMessages({
    likeList: cookieIds(req, 'likes'),
    dislikeList: cookieIds(req, 'dislikes'),
    sort: req.query.s || 'newest',
    word: req.query.w || '',
    tag: req.query.tag || '',
    filterType: req.query.f || 'all'
  })
  if (!account) messages = messages.filter((message) => !isLostFoundMessage(message))
  res.json({ data: await publicMessages(req, messages.slice(start, end)), total: messages.length })
}))

publicRouter.post('/notice', (req, res) => {
  const notices = readJson('static/notice.json', [])
  const content = (Array.isArray(notices) ? notices : []).map((notice) => {
    const copy = { ...notice }
    delete copy.user
    delete copy.updated_by
    return copy
  })
  res.json({ success: true, content })
})

publicRouter.get('/get_page_size', (req, res) => {
  res.json({ page_size: config.messagePageSize })
})

publicRouter.post('/get_message_details/:messageId', asyncRoute(async (req, res) => {
  const message = messageStore.getMessage(req.params.messageId, cookieIds(req, 'likes'), cookieIds(req, 'dislikes'))
  if (messageStore.isPublicMessage(message) && isLostFoundMessage(message) && !await authenticatedAccount(req)) {
    res.status(401).json({ success: false, error: '登录后才能查看失物招领' })
    return
  }
  if (messageStore.isPublicMessage(message)) res.json({ success: true, message: await publicMessages(req, message) })
  else res.status(404).json({ success: false, error: 'Message not found' })
}))

publicRouter.post('/get_message_partitions/:messageId', asyncRoute(async (req, res) => {
  const message = messageStore.getMessage(req.params.messageId, cookieIds(req, 'likes'), cookieIds(req, 'dislikes'))
  if (messageStore.isPublicMessage(message) && isLostFoundMessage(message) && !await authenticatedAccount(req)) {
    res.status(401).json({ success: false, error: '登录后才能查看失物招领' })
    return
  }
  if (messageStore.isPublicMessage(message)) res.json({ success: true, partition: message.tags || [] })
  else res.status(404).json({ success: false, error: 'Message not found' })
}))

publicRouter.post('/get_tags', asyncRoute(async (req, res) => {
  const tags = messageStore.getTags()
  res.json(await authenticatedAccount(req) ? tags : tags.filter((tag) => !isLostFoundTag(tag)))
}))

publicRouter.post('/get_partition_messages', asyncRoute(async (req, res) => {
  const account = await authenticatedAccount(req)
  const partition = req.body?.partition || ''
  if (!account && isLostFoundTag(partition)) {
    res.status(401).json({ success: false, error: '登录后才能查看失物招领' })
    return
  }
  let ids = messageStore.getTagMessageIds(partition)
  if (!account) ids = ids.filter((id) => !isLostFoundMessage(messageStore.getMessage(id)))
  res.json({ success: true, data: ids })
}))

publicRouter.post('/get_hot_messages', asyncRoute(async (req, res) => {
  const account = await authenticatedAccount(req)
  const messages = messageStore.getHotMessages(cookieIds(req, 'likes'), cookieIds(req, 'dislikes'), {
    includeLostFound: Boolean(account)
  })
  res.json({ success: true, messages: await publicMessages(req, messages) })
}))

publicRouter.post('/help/form', requireTrustedOrigin, feedbackRateLimit, form, (req, res) => {
  try {
    const ticket = feedbackStore.create(req.body || {})
    res.json({ success: true, ticket_id: ticket.id })
  } catch (error) {
    res.status(error?.statusCode || 400).json({ success: false, error: error.message || '反馈提交失败' })
  }
})

publicRouter.post('/help/report/:messageId', requireTrustedOrigin, feedbackRateLimit, form, asyncRoute(async (req, res) => {
  const messageId = Number(req.params.messageId)
  const message = Number.isInteger(messageId) ? messageStore.getMessage(messageId) : null
  if (!messageStore.isPublicMessage(message)) {
    res.status(404).json({ success: false, error: '留言不存在或已下架' })
    return
  }
  if (isLostFoundMessage(message) && !await authenticatedAccount(req)) {
    res.status(401).json({ success: false, error: '登录后才能使用失物招领' })
    return
  }
  const report = reportFields(req, res)
  if (!report) return
  const created = reportStore.create(messageId, {
    ...report,
    target_type: 'message',
    target_excerpt: String(message.text || ((message.files || []).length ? '附件留言' : '')).slice(0, 200)
  })
  res.json({ success: true, report_id: created.id })
}))

publicRouter.post('/help/report/:messageId/comment/:commentId', requireTrustedOrigin, feedbackRateLimit, form, asyncRoute(async (req, res) => {
  const messageId = Number(req.params.messageId)
  const commentId = String(req.params.commentId || '')
  const message = Number.isInteger(messageId) ? messageStore.getMessage(messageId) : null
  if (!messageStore.isPublicMessage(message) || !/^[a-zA-Z0-9_-]{1,80}$/.test(commentId)) {
    res.status(404).json({ success: false, error: '留言或评论不存在' })
    return
  }
  if (isLostFoundMessage(message) && !await authenticatedAccount(req)) {
    res.status(401).json({ success: false, error: '登录后才能使用失物招领' })
    return
  }
  const comment = (message.comments || []).find((item) => String(item.id) === commentId)
  if (!messageStore.isPublicComment(comment)) {
    res.status(404).json({ success: false, error: '留言或评论不存在' })
    return
  }
  const report = reportFields(req, res)
  if (!report) return
  const created = reportStore.create(messageId, {
    ...report,
    target_type: 'comment',
    comment_id: commentId,
    target_excerpt: String(comment.text || ((comment.files || []).length ? '附件评论' : '')).slice(0, 200)
  })
  res.json({ success: true, report_id: created.id })
}))
