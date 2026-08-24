import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import multer from 'multer'
import { config, resolveBackend } from '../config.js'
import { requireTrustedOrigin } from '../services/auth.js'
import { safeBasename } from '../services/fileTools.js'
import { messageStore } from '../services/messageStore.js'
import { verifyCaptcha } from '../services/captcha.js'
import { contentWriteRateLimit, loginRateLimit } from '../services/rateLimit.js'
import { userCookieOptions, userSessionCookieName, userStore } from '../services/userStore.js'
import { settingsStore } from '../services/settingsStore.js'
import { reportStore } from '../services/reportStore.js'

export const usersRouter = express.Router()

const form = multer({ limits: { fields: 8, fieldSize: 4096 } }).none()
const messageEditForm = multer({ limits: { fields: 4, fieldSize: config.maxTextLength } }).none()
const avatarForm = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxAvatarSize, files: 1 }
})
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
const avatarExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

const requireUser = asyncRoute(async (req, res, next) => {
  const user = await userStore.getSessionUser(req)
  if (!user) {
    res.status(401).json({ success: false, error: '未登录' })
    return
  }
  req.user = user
  next()
})

const publicMessage = (message, viewerUserId = 0) => {
  const copy = JSON.parse(JSON.stringify(message))
  delete copy.username
  if (copy.anonymous !== false) {
    delete copy.user_id
    copy.display_name_snapshot = '匿名用户'
  }
  if (Array.isArray(copy.comments)) {
    const hiddenCommentIds = new Set(copy.comments
      .filter((comment) => !messageStore.isPublicComment(comment))
      .map((comment) => String(comment.id)))
    copy.comments = copy.comments.filter((comment) => messageStore.isPublicComment(comment)).map((comment) => {
      const next = { ...comment }
      if (next.refer_id && hiddenCommentIds.has(String(next.refer_id))) {
        next.refer = '该评论已被管理员隐藏'
        next.refer_hidden = true
      }
      if (viewerUserId && Number(next.user_id) === Number(viewerUserId)) next.owned = true
      else delete next.owned
      delete next.username
      delete next.user_id
      return next
    })
  }
  return copy
}

const visitorViewerKey = (req) => {
  const visitorId = String(req.cookies?.poll_voter || '')
  return /^[a-f0-9-]{36}$/i.test(visitorId) ? `guest:${visitorId}` : ''
}

const decorateMessages = (req, messages, user = null) => messageStore.withViewerState(messages, {
  reactorKey: user ? `user:${user.id}` : visitorViewerKey(req),
  likeList: messageStore.parseCookieIds(req.cookies?.likes || ''),
  dislikeList: messageStore.parseCookieIds(req.cookies?.dislikes || ''),
  pollSelections: messageStore.parsePollSelections(req.cookies?.poll_votes || '')
})
usersRouter.get('/captcha/config', asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ success: true, captcha: await settingsStore.captchaPublic() })
}))

usersRouter.post('/login', requireTrustedOrigin, loginRateLimit, form, asyncRoute(async (req, res) => {
  const captcha = await verifyCaptcha(req.body?.captcha_token || '', req)
  if (!captcha.success) {
    res.status(400).json({ success: false, error: captcha.error || '人机验证失败' })
    return
  }

  const loginResult = await userStore.login(req.body?.username || '', req.body?.password || '')
  if (!loginResult) {
    res.status(401).json({ success: false, error: '学号或密码错误，或账号已停用' })
    return
  }

  res.cookie(
    userSessionCookieName,
    userStore.createSession(loginResult.user, loginResult.sessionVersion),
    userCookieOptions()
  )
  res.json({ success: true, user: loginResult.user })
}))

usersRouter.post('/logout', requireTrustedOrigin, (req, res) => {
  res.clearCookie(userSessionCookieName, { path: '/' })
  res.json({ success: true })
})

usersRouter.get('/me', asyncRoute(async (req, res) => {
  const user = await userStore.getSessionUser(req)
  if (!user) {
    res.status(401).json({ success: false, error: '未登录' })
    return
  }
  res.json({ success: true, user })
}))

usersRouter.get('/session', asyncRoute(async (req, res) => {
  const user = await userStore.getSessionUser(req)
  res.json(user ? { success: true, user } : { success: false, error: '未登录' })
}))

usersRouter.get('/me/favorites/ids', requireUser, asyncRoute(async (req, res) => {
  res.json({ success: true, ids: await userStore.favoriteIds(req.user.id) })
}))

usersRouter.get('/me/favorites', requireUser, asyncRoute(async (req, res) => {
  const result = await userStore.listFavorites(req.user.id, {
    page: req.query.page,
    pageSize: req.query.page_size
  })
  const messages = await decorateMessages(req, result.messages, req.user)
  res.json({
    success: true,
    ...result,
    messages: messages.map(publicMessage)
  })
}))

usersRouter.post('/me/favorites/:messageId', requireTrustedOrigin, requireUser, asyncRoute(async (req, res) => {
  const messageId = Number(req.params.messageId)
  const message = Number.isSafeInteger(messageId) ? messageStore.getMessage(messageId) : null
  if (!messageStore.isPublicMessage(message)) {
    res.status(404).json({ success: false, error: '留言不存在或已被删除' })
    return
  }
  await userStore.favoriteMessage(req.user.id, messageId)
  res.json({ success: true, favorited: true })
}))

usersRouter.delete('/me/favorites/:messageId', requireTrustedOrigin, requireUser, asyncRoute(async (req, res) => {
  await userStore.unfavoriteMessage(req.user.id, req.params.messageId)
  res.json({ success: true, favorited: false })
}))

usersRouter.put('/me/profile', requireTrustedOrigin, form, requireUser, asyncRoute(async (req, res) => {
  if (String(req.body?.bio || '').length > 200) {
    res.status(400).json({ success: false, error: '个人简介不能超过 200 个字符' })
    return
  }
  const user = await userStore.updateProfile(req.user.id, {
    nickname: req.body?.nickname,
    gender: req.body?.gender,
    bio: req.body?.bio
  })
  if (!user) {
    res.status(404).json({ success: false, error: '用户不存在' })
    return
  }
  res.json({ success: true, user })
}))

usersRouter.post('/me/password', requireTrustedOrigin, form, requireUser, asyncRoute(async (req, res) => {
  const currentPassword = String(req.body?.current_password || '')
  const newPassword = String(req.body?.new_password || '')
  if (newPassword.length < 8 || newPassword.length > 128) {
    res.status(400).json({ success: false, error: '新密码长度需要在 8 到 128 个字符之间' })
    return
  }
  if (currentPassword === newPassword) {
    res.status(400).json({ success: false, error: '新密码不能与当前密码相同' })
    return
  }
  const result = await userStore.changePassword(req.user.id, currentPassword, newPassword)
  if (!result.success) {
    res.status(400).json(result)
    return
  }
  res.cookie(
    userSessionCookieName,
    userStore.createSession(result.user, result.sessionVersion),
    userCookieOptions()
  )
  res.json({ success: true, user: result.user })
}))

usersRouter.get('/me/messages', requireUser, asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.max(1, Math.min(Number(req.query.page_size) || 10, 50))
  const allMessages = await decorateMessages(req, messageStore.getMessagesByUser(req.user.id), req.user)
  const start = (page - 1) * pageSize
  const messages = allMessages.slice(start, start + pageSize).map((message) => ({
    ...publicMessage(message, req.user.id),
    owned: true
  }))
  res.json({
    success: true,
    messages,
    page,
    page_size: pageSize,
    total: allMessages.length,
    total_pages: Math.ceil(allMessages.length / pageSize)
  })
}))

usersRouter.get('/me/comments', requireUser, asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.max(1, Math.min(Number(req.query.page_size) || 20, 50))
  const allComments = messageStore.getCommentsByUser(req.user.id)
  const start = (page - 1) * pageSize
  res.json({
    success: true,
    comments: allComments.slice(start, start + pageSize),
    page,
    page_size: pageSize,
    total: allComments.length,
    total_pages: Math.ceil(allComments.length / pageSize)
  })
}))

usersRouter.put('/me/messages/:messageId', requireTrustedOrigin, contentWriteRateLimit, requireUser, messageEditForm, asyncRoute(async (req, res) => {
  const messageId = Number(req.params.messageId)
  const message = messageStore.getMessage(messageId)
  if (!message || Number(message.user_id) !== Number(req.user.id)) {
    res.status(404).json({ success: false, error: '留言不存在或不属于当前账号' })
    return
  }
  if (req.user.is_muted) {
    res.status(403).json({ success: false, error: '账号已被禁言，暂时不能编辑留言' })
    return
  }
  const text = String(req.body?.text || '').trim()
  const tags = [...new Set(String(req.body?.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean))]
  if (!text && !(message.files || []).length && !message.poll) {
    res.status(400).json({ success: false, error: '留言内容不能为空' })
    return
  }
  if (text.length > config.maxTextLength) {
    res.status(400).json({ success: false, error: '留言内容过长' })
    return
  }
  if (tags.length > config.maxTags || tags.some((tag) => tag.length > config.maxTagLength)) {
    res.status(400).json({ success: false, error: '标签数量或长度不符合要求' })
    return
  }
  const policy = await settingsStore.checkCommunityWrite('post', { user: req.user, values: [text, ...tags] })
  if (!policy.success) {
    res.status(policy.statusCode || 400).json({ success: false, code: policy.code, error: policy.error })
    return
  }
  const result = await messageStore.updateOwnedMessage({
    id: messageId,
    userId: req.user.id,
    text,
    tags,
    anonymous: String(req.body?.anonymous ?? 'true') !== 'false',
    displayName: req.user.nickname,
    requireApproval: policy.policy?.require_post_approval === true
  })
  if (!result.success) {
    res.status(result.code === 'FORBIDDEN' ? 403 : (result.code === 'MESSAGE_DELETED' ? 409 : 404)).json(result)
    return
  }
  res.json({ success: true, message: { ...publicMessage(result.message, req.user.id), owned: true } })
}))

usersRouter.delete('/me/messages/:messageId', requireTrustedOrigin, requireUser, asyncRoute(async (req, res) => {
  const pendingReports = reportStore.pending()[String(req.params.messageId)] || []
  const result = await messageStore.deleteOwnedMessage(req.params.messageId, req.user.id)
  if (!result.success) {
    res.status(result.code === 'FORBIDDEN' ? 403 : 404).json(result)
    return
  }
  if (pendingReports.length) {
    reportStore.archive(req.params.messageId, pendingReports, {
      resolution: 'delete_message',
      processedBy: 'content-owner',
      publicReply: '相关留言已由发布者删除'
    })
  }
  delete result.deleted_message
  res.json(result)
}))

usersRouter.delete('/me/comments/:messageId/:commentId', requireTrustedOrigin, requireUser, asyncRoute(async (req, res) => {
  const commentId = String(req.params.commentId || '')
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(commentId)) {
    res.status(400).json({ success: false, error: '评论参数无效' })
    return
  }
  const pendingReports = reportStore.pending()[String(req.params.messageId)] || []
  const result = await messageStore.deleteOwnedComment(req.params.messageId, commentId, req.user.id)
  if (!result.success) {
    res.status(result.code === 'FORBIDDEN' ? 403 : 404).json(result)
    return
  }
  const matchingReports = pendingReports.filter((item) => item.target_type === 'comment' && String(item.comment_id) === commentId)
  if (matchingReports.length) {
    reportStore.archive(req.params.messageId, matchingReports, {
      resolution: 'delete_comment',
      processedBy: 'content-owner',
      publicReply: '相关评论已由发布者删除'
    })
  }
  res.json({ success: true, comment_id: commentId })
}))

usersRouter.get('/me/notifications/unread-count', requireUser, asyncRoute(async (req, res) => {
  res.json({ success: true, unread: await userStore.unreadNotificationCount(req.user.id) })
}))

usersRouter.get('/me/notifications', requireUser, asyncRoute(async (req, res) => {
  const result = await userStore.listNotifications(req.user.id, {
    page: req.query.page,
    pageSize: req.query.page_size
  })
  res.json({ success: true, ...result })
}))

usersRouter.post('/me/notifications/:notificationId/read', requireTrustedOrigin, requireUser, asyncRoute(async (req, res) => {
  const updated = await userStore.markNotificationRead(req.user.id, req.params.notificationId)
  res.json({ success: true, updated })
}))

usersRouter.post('/me/notifications/read-all', requireTrustedOrigin, requireUser, asyncRoute(async (req, res) => {
  const updated = await userStore.markAllNotificationsRead(req.user.id)
  res.json({ success: true, updated })
}))

usersRouter.delete('/me/notifications/:notificationId', requireTrustedOrigin, requireUser, asyncRoute(async (req, res) => {
  const deleted = await userStore.deleteNotification(req.user.id, req.params.notificationId)
  if (!deleted) {
    res.status(404).json({ success: false, error: '通知不存在' })
    return
  }
  res.json({ success: true })
}))

usersRouter.delete('/me/notifications', requireTrustedOrigin, requireUser, asyncRoute(async (req, res) => {
  const deleted = await userStore.clearNotifications(req.user.id)
  res.json({ success: true, deleted })
}))

usersRouter.post('/me/avatar', requireTrustedOrigin, requireUser, avatarForm.single('avatar'), asyncRoute(async (req, res) => {
  if (!req.file?.buffer) {
    res.status(400).json({ success: false, error: '请选择头像文件' })
    return
  }
  const ext = path.extname(req.file.originalname || '').slice(1).toLowerCase()
  if (!avatarExtensions.has(ext)) {
    res.status(400).json({ success: false, error: '头像仅支持 png、jpg、gif、webp' })
    return
  }

  fs.mkdirSync(resolveBackend(config.avatarFolder), { recursive: true })
  const filename = safeBasename(`user_${req.user.id}_${Date.now()}.${ext}`)
  fs.writeFileSync(resolveBackend(config.avatarFolder, filename), req.file.buffer)
  const user = await userStore.updateAvatar(req.user.id, filename)
  res.json({ success: true, user })
}))

usersRouter.get('/:userId/profile', asyncRoute(async (req, res) => {
  const profile = await userStore.getPublicProfile(req.params.userId)
  if (!profile) {
    res.status(404).json({ success: false, error: '用户不存在' })
    return
  }
  res.json({ success: true, user: profile })
}))

usersRouter.get('/:userId/avatar', asyncRoute(async (req, res) => {
  const filePath = await userStore.avatarFile(req.params.userId)
  if (filePath) {
    res.set('Cache-Control', 'public, max-age=3600')
    res.sendFile(filePath)
    return
  }

  const initial = String(req.params.userId || '?').replace(/[^a-zA-Z0-9]/g, '').slice(0, 1).toUpperCase() || '?'
  res.type('image/svg+xml')
  res.set('Cache-Control', 'public, max-age=3600')
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="#2A5CAA"/><circle cx="64" cy="52" r="24" fill="#fff" opacity=".9"/><path d="M24 118c7-26 24-40 40-40s33 14 40 40" fill="#fff" opacity=".9"/><text x="64" y="72" text-anchor="middle" font-family="Arial, sans-serif" font-size="40" font-weight="700" fill="#2A5CAA">${initial}</text></svg>`)
}))

usersRouter.get('/:userId/messages', asyncRoute(async (req, res) => {
  const userId = Number(req.params.userId)
  const viewer = await userStore.getSessionUser(req)
  const messages = messageStore.getMessages()
    .filter((message) => Number(message.user_id ?? -1) === userId && message.anonymous === false)
  const decorated = await decorateMessages(req, messages, viewer)
  res.json({ messages: decorated.map((message) => publicMessage(message, viewer?.id)), total: decorated.length })
}))
