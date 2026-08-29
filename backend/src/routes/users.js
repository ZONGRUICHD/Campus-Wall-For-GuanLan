import express from 'express'
import multer from 'multer'
import { config } from '../config.js'
import { authenticatedAccount, sessionCookieName, requireTrustedOrigin } from '../services/auth.js'
import { feishuAuth, feishuOauthCookieName, feishuOauthCookieOptions } from '../services/feishuAuth.js'
import { messageStore } from '../services/messageStore.js'
import { verifyCaptcha } from '../services/captcha.js'
import { consumeUploadBytes, contentWriteRateLimit, emailChangeRateLimit, loginRateLimit, passwordChangeRateLimit, registerRateLimit, uploadConcurrencyLimit, uploadRateLimit } from '../services/rateLimit.js'
import { userCookieOptions, userSessionCookieName, userStore } from '../services/userStore.js'
import { visitorKeyFromRequest } from '../services/visitorIdentity.js'
import { settingsStore } from '../services/settingsStore.js'
import { reportStore } from '../services/reportStore.js'
import { isLostFoundMessage, isLostFoundTag, lostFoundTag, lostFoundTags, normalizeLostFoundType } from '../services/lostFound.js'
import { AvatarImageError, processAvatarImage } from '../services/avatarProcessor.js'
import { acquireAvatarProcessingSlot } from '../services/avatarProcessingGate.js'
import { storeAvatarReplacement } from '../services/avatarStorage.js'
import { redactPublicMessage } from '../services/publicMessageView.js'

export const usersRouter = express.Router()

const form = multer({ limits: { fields: 8, fieldSize: 4096 } }).none()
const messageEditForm = multer({ limits: { fields: 4, fieldSize: config.maxTextLength } }).none()
const avatarForm = multer({
  storage: multer.memoryStorage(),
  // Do not set `parts: 1` here. Busboy emits `partsLimit` as soon as the
  // configured number is reached, so a perfectly valid form containing the
  // single avatar file would be rejected with LIMIT_PART_COUNT.
  limits: { fileSize: config.maxAvatarSize, files: 1, fields: 0 }
})
export const avatarUpload = (req, res, next) => {
  avatarForm.single('avatar')(req, res, (error) => {
    if (!error) {
      next()
      return
    }
    if (!(error instanceof multer.MulterError)) {
      next(error)
      return
    }

    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        success: false,
        error: `头像文件不能超过 ${Math.floor(config.maxAvatarSize / (1024 * 1024))}MB`,
        code: 'AVATAR_TOO_LARGE'
      })
      return
    }

    res.status(400).json({
      success: false,
      error: '头像上传表单无效，请重新选择一张图片',
      code: 'INVALID_AVATAR_UPLOAD'
    })
  })
}
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

const redirectFeishuResult = (res, path, error = '') => {
  const target = feishuAuth.frontendUrl(path, error)
  if (!target) {
    res.status(503).json({ success: false, error: '飞书登录暂未配置' })
    return
  }
  res.redirect(302, target)
}

const requireUser = asyncRoute(async (req, res, next) => {
  const user = await authenticatedAccount(req)
  if (!user) {
    res.status(401).json({ success: false, error: '未登录' })
    return
  }
  req.user = user
  next()
})

const publicMessage = redactPublicMessage

const decorateMessages = (req, messages, user = null) => messageStore.withViewerState(messages, {
  reactorKey: user ? `user:${user.id}` : visitorKeyFromRequest(req),
  likeList: messageStore.parseCookieIds(req.cookies?.likes || ''),
  dislikeList: messageStore.parseCookieIds(req.cookies?.dislikes || ''),
  pollSelections: messageStore.parsePollSelections(req.cookies?.poll_votes || '')
})
const lostFoundField = (value = '', max = 200) => String(value || '')
  .replace(/[<>\x00-\x1F\x7F]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max)
const lostFoundText = ({ kind, item, location, time, details, contact, resolved }) => [
  `【类型】${kind === 'lost' ? '寻物启事' : '招领启事'}`,
  `物品：${item}`,
  location ? `地点：${location}` : '',
  time ? `时间：${time}` : '',
  details ? `说明：${details}` : '',
  contact ? `联系：${contact}` : '',
  `状态：${resolved ? '已找回' : (kind === 'lost' ? '待找回' : '待认领')}`
].filter(Boolean).join('\n')
usersRouter.get('/captcha/config', asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ success: true, captcha: await settingsStore.captchaPublic() })
}))

usersRouter.post('/register', requireTrustedOrigin, registerRateLimit, form, asyncRoute(async (req, res) => {
  const captcha = await verifyCaptcha(req.body?.captcha_token || '', req, { action: 'register' })
  if (!captcha.success) {
    res.status(400).json({ success: false, error: captcha.error || '人机验证失败' })
    return
  }
  const result = await userStore.register(req.body?.username || '', req.body?.password || '', {
    email: req.body?.email || '',
    emailNotify: !['0', 'false', 'off'].includes(String(req.body?.email_notify ?? 'true').toLowerCase())
  })
  if (!result.success) {
    res.status(400).json({ success: false, error: result.error || '注册失败，请检查用户名与密码' })
    return
  }
  res.status(201).json({
    success: true,
    pending: true,
    email_queued: Boolean(result.email_queued),
    message: result.email_queued
      ? '注册已提交。请查收验证邮件；审核通过后才能登录。'
      : '注册已提交，审核通过后才能登录'
  })
}))

usersRouter.get('/feishu/start', loginRateLimit, asyncRoute(async (req, res) => {
  const intent = String(req.query.intent || '') === 'bind' ? 'bind' : 'login'
  const failPath = intent === 'bind' ? '/me' : '/login'
  if (!feishuAuth.isConfigured()) {
    redirectFeishuResult(res, failPath, 'not_configured')
    return
  }
  if (intent === 'bind') {
    const user = await authenticatedAccount(req)
    if (!user) {
      redirectFeishuResult(res, '/login', 'oauth_failed')
      return
    }
    const { nonce, state } = feishuAuth.createState({ next: '/me', intent: 'bind', userId: user.id })
    res.cookie(feishuOauthCookieName, nonce, feishuOauthCookieOptions())
    res.redirect(302, feishuAuth.buildAuthorizeUrl(state))
    return
  }
  const { nonce, state } = feishuAuth.createState(req.query.next)
  res.cookie(feishuOauthCookieName, nonce, feishuOauthCookieOptions())
  res.redirect(302, feishuAuth.buildAuthorizeUrl(state))
}))

usersRouter.get('/feishu/callback', loginRateLimit, asyncRoute(async (req, res) => {
  let failPath = '/login'
  const fail = (reason) => {
    res.clearCookie(feishuOauthCookieName, { path: '/' })
    redirectFeishuResult(res, failPath, reason)
  }
  const parsed = feishuAuth.parseState(req.query.state, req.cookies?.[feishuOauthCookieName])
  if (parsed.ok && parsed.intent === 'bind') failPath = '/me'
  const denied = String(req.query.error || '')
  if (denied) {
    fail(denied === 'access_denied' ? 'cancelled' : 'oauth_failed')
    return
  }
  if (!parsed.ok) {
    fail('invalid_state')
    return
  }
  if (!String(req.query.code || '').trim()) {
    fail('oauth_failed')
    return
  }
  if (parsed.intent === 'bind') {
    const account = await authenticatedAccount(req)
    if (!account || Number(account.id) !== Number(parsed.userId)) {
      fail('invalid_state')
      return
    }
    let oauth
    try {
      oauth = await feishuAuth.completeOAuthUser(req.query.code)
    } catch {
      redirectFeishuResult(res, '/me', 'oauth_failed')
      return
    }
    const bound = await userStore.bindFeishuOpenId(account.id, oauth.user)
    if (!bound.success) {
      redirectFeishuResult(res, '/me', bound.code || 'oauth_failed')
      return
    }
    const invited = await feishuAuth.inviteToLoginChat(oauth.user.openId)
    res.clearCookie(feishuOauthCookieName, { path: '/' })
    const target = new URL(feishuAuth.frontendUrl('/me'))
    target.searchParams.set('feishu', invited.ok ? 'bound' : 'join_failed')
    res.redirect(302, target.toString())
    return
  }
  let completed
  try {
    completed = await feishuAuth.completeLogin(req.query.code)
  } catch {
    fail('oauth_failed')
    return
  }
  if (!completed?.ok) {
    fail(completed?.reason || 'oauth_failed')
    return
  }
  const result = await userStore.upsertFeishuUser(completed.user)
  if (!result.success) {
    fail(result.code === 'disabled' ? 'disabled' : 'oauth_failed')
    return
  }
  res.clearCookie(feishuOauthCookieName, { path: '/' })
  res.cookie(
    userSessionCookieName,
    userStore.createSession(result.user, result.sessionVersion),
    userCookieOptions()
  )
  res.clearCookie(sessionCookieName, { path: '/' })
  redirectFeishuResult(res, parsed.next)
}))

usersRouter.post('/login', requireTrustedOrigin, loginRateLimit, form, asyncRoute(async (req, res) => {
  const captcha = await verifyCaptcha(req.body?.captcha_token || '', req, { action: 'login' })
  if (!captcha.success) {
    res.status(400).json({ success: false, error: captcha.error || '人机验证失败' })
    return
  }

  const loginResult = await userStore.login(req.body?.username || '', req.body?.password || '')
  if (loginResult?.pending) {
    res.status(403).json({ success: false, code: 'pending', error: loginResult.error })
    return
  }
  if (!loginResult) {
    res.status(401).json({ success: false, error: '用户名或密码错误，或账号已停用' })
    return
  }

  res.cookie(
    userSessionCookieName,
    userStore.createSession(loginResult.user, loginResult.sessionVersion),
    userCookieOptions()
  )
  res.clearCookie(sessionCookieName, { path: '/' })
  res.json({ success: true, user: loginResult.user })
}))

usersRouter.post('/logout', requireTrustedOrigin, (req, res) => {
  res.clearCookie(userSessionCookieName, { path: '/' })
  res.clearCookie(sessionCookieName, { path: '/' })
  res.json({ success: true })
})

usersRouter.get('/me', asyncRoute(async (req, res) => {
  const user = await authenticatedAccount(req)
  if (!user) {
    res.status(401).json({ success: false, error: '未登录' })
    return
  }
  res.json({ success: true, user })
}))

usersRouter.get('/session', asyncRoute(async (req, res) => {
  const user = await authenticatedAccount(req)
  res.json(user ? { success: true, user } : { success: false, error: '未登录' })
}))

usersRouter.get('/email/verify', asyncRoute(async (req, res) => {
  const result = await userStore.confirmEmailToken(req.query.token)
  const account = await authenticatedAccount(req)
  const base = String(config.publicSiteUrl || '').trim().replace(/\/+$/, '') || 'https://wall.zongtech.xyz'
  const target = new URL(account ? '/me' : '/login', `${base}/`)
  if (result.success) target.searchParams.set('email', 'verified')
  else target.searchParams.set('email_error', 'invalid')
  res.redirect(302, target.toString())
}))

usersRouter.post('/me/email', requireTrustedOrigin, form, requireUser, emailChangeRateLimit, asyncRoute(async (req, res) => {
  try {
    const result = await userStore.requestEmailChange(req.user.id, req.body?.email || '')
    if (!result.success) {
      const status = result.code === 'email_not_configured' ? 503 : 400
      res.status(status).json({ success: false, code: result.code, error: result.error })
      return
    }
    res.json({ success: true, pending_email: result.pending_email, message: '验证邮件已发送，请查收后完成绑定' })
  } catch (error) {
    if (error?.message === 'email_not_configured') {
      res.status(503).json({ success: false, error: '邮件服务暂未配置，请稍后再试' })
      return
    }
    throw error
  }
}))

usersRouter.post('/me/email/notify', requireTrustedOrigin, form, requireUser, asyncRoute(async (req, res) => {
  const enabled = !['0', 'false', 'off'].includes(String(req.body?.email_notify ?? 'true').toLowerCase())
  const user = await userStore.setEmailNotify(req.user.id, enabled)
  res.json({ success: true, user })
}))

usersRouter.get('/lost-found', asyncRoute(async (req, res) => {
  const viewer = await authenticatedAccount(req)
  const filter = String(req.query.filter || 'all').trim().toLowerCase()
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.max(1, Math.min(Number(req.query.page_size) || 20, 50))
  let messages = messageStore.getMessages({ tag: lostFoundTag, sort: 'newest' })
  if (['lost', 'found'].includes(filter)) {
    messages = messages.filter((message) => normalizeLostFoundType(message.lost_found?.kind) === filter)
  } else if (filter === 'resolved') {
    messages = messages.filter((message) => message.lost_found?.resolved === true)
  } else if (filter === 'unresolved') {
    messages = messages.filter((message) => message.lost_found?.resolved !== true)
  }
  const total = messages.length
  const pageMessages = messages.slice((page - 1) * pageSize, page * pageSize)
  const decorated = await decorateMessages(req, pageMessages, viewer)
  res.set('Cache-Control', 'private, no-store')
  res.json({
    success: true,
    messages: decorated.map((message) => publicMessage(message, viewer?.id)),
    page,
    page_size: pageSize,
    total,
    total_pages: Math.ceil(total / pageSize),
    filter
  })
}))

usersRouter.post('/lost-found', requireTrustedOrigin, contentWriteRateLimit, requireUser, asyncRoute(async (req, res) => {
  const kind = normalizeLostFoundType(req.body?.kind)
  const item = lostFoundField(req.body?.item, 100)
  const location = lostFoundField(req.body?.location, 120)
  const time = lostFoundField(req.body?.time, 80)
  const details = lostFoundField(req.body?.details, 2000)
  const contact = lostFoundField(req.body?.contact, 160)
  const resolved = req.body?.resolved === true || String(req.body?.resolved || '').toLowerCase() === 'true'
  if (!kind || !item) {
    res.status(400).json({ success: false, error: '请选择寻物或招领类型，并填写物品名称' })
    return
  }
  if (req.user.is_muted) {
    res.status(403).json({ success: false, error: '账号已被禁言，暂时不能发布' })
    return
  }
  const text = lostFoundText({ kind, item, location, time, details, contact, resolved })
  const policy = await settingsStore.checkCommunityWrite('post', {
    user: req.user,
    values: [text, item, location, details, contact]
  })
  if (!policy.success) {
    res.status(policy.statusCode || 400).json({ success: false, code: policy.code, error: policy.error })
    return
  }
  const lostFound = { kind, item, location, time, details, contact, resolved }
  const id = await messageStore.postMessage({
    text,
    tags: [...lostFoundTags(kind), resolved ? '已找回' : (kind === 'lost' ? '待找回' : '待认领')],
    user: req.user,
    anonymous: false,
    lostFound
  })
  const message = messageStore.getMessage(id)
  res.status(201).json({
    success: true,
    id,
    moderation_status: message.moderation_status,
    review_status: message.review_status,
    message: { ...publicMessage(message, req.user.id), owned: true }
  })
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
    messages: messages.map((message) => publicMessage(message, req.user.id))
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

usersRouter.post('/me/password', requireTrustedOrigin, form, requireUser, passwordChangeRateLimit, asyncRoute(async (req, res) => {
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
  res.clearCookie(sessionCookieName, { path: '/' })
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
  let tags = [...new Set(String(req.body?.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean))]
  if (isLostFoundMessage(message)) {
    const kind = normalizeLostFoundType(message.lost_found?.kind) || 'lost'
    const statusTag = message.lost_found?.resolved === true ? '已找回' : (kind === 'found' ? '待认领' : '待找回')
    const lostFoundStatusTags = new Set(['待找回', '待认领', '已找回'])
    const customTags = tags.filter((tag) => !isLostFoundTag(tag) && !lostFoundStatusTags.has(tag))
    tags = [...new Set([...lostFoundTags(kind), statusTag, ...customTags])]
  }
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
    user: req.user,
    text,
    tags,
    anonymous: String(req.body?.anonymous ?? 'true') !== 'false',
    displayName: req.user.nickname
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

usersRouter.post('/me/avatar', requireTrustedOrigin, requireUser, uploadRateLimit, uploadConcurrencyLimit, avatarUpload, asyncRoute(async (req, res) => {
  if (!req.file?.buffer) {
    res.status(400).json({ success: false, error: '请选择头像文件' })
    return
  }
  if (!consumeUploadBytes(req, res, req.file.size)) return

  const releaseProcessingSlot = acquireAvatarProcessingSlot()
  if (!releaseProcessingSlot) {
    res.set('Retry-After', '2')
    res.status(429).json({ success: false, error: '头像处理任务较多，请稍后再试', retry_after: 2 })
    return
  }

  try {
    let processed
    try {
      processed = await processAvatarImage(req.file.buffer)
    } catch (error) {
      if (error instanceof AvatarImageError) {
        res.status(400).json({ success: false, error: error.message, code: error.code })
        return
      }
      throw error
    }

    const replacement = await storeAvatarReplacement({
      userId: req.user.id,
      buffer: processed.buffer,
      swapAvatar: (filename) => userStore.updateAvatar(req.user.id, filename),
      isAvatarReferenced: (filename) => userStore.isAvatarReferenced(filename)
    })
    res.json({ success: true, user: replacement.user, avatar: processed.info })
  } finally {
    releaseProcessingSlot()
  }
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
    res.set('Cache-Control', 'public, max-age=0, must-revalidate')
    res.sendFile(filePath)
    return
  }

  const initial = String(req.params.userId || '?').replace(/[^a-zA-Z0-9]/g, '').slice(0, 1).toUpperCase() || '?'
  res.type('image/svg+xml')
  res.set('Cache-Control', 'public, max-age=0, must-revalidate')
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="#2A5CAA"/><circle cx="64" cy="52" r="24" fill="#fff" opacity=".9"/><path d="M24 118c7-26 24-40 40-40s33 14 40 40" fill="#fff" opacity=".9"/><text x="64" y="72" text-anchor="middle" font-family="Arial, sans-serif" font-size="40" font-weight="700" fill="#2A5CAA">${initial}</text></svg>`)
}))

usersRouter.get('/:userId/messages', asyncRoute(async (req, res) => {
  const userId = Number(req.params.userId)
  const viewer = await authenticatedAccount(req)
  let messages = messageStore.getMessages()
    .filter((message) => Number(message.user_id ?? -1) === userId && message.anonymous === false)
  const decorated = await decorateMessages(req, messages, viewer)
  res.json({ messages: decorated.map((message) => publicMessage(message, viewer?.id)), total: decorated.length })
}))
