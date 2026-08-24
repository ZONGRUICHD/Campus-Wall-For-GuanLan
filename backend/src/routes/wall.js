import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import express from 'express'
import multer from 'multer'
import { config, resolveBackend } from '../config.js'
import { authenticatedAccount, authenticatedAdmin, hasPermission, requireTrustedOrigin } from '../services/auth.js'
import { allowedFile, makeTinyFiles, safeBasename, uploadPath } from '../services/fileTools.js'
import { appendAdminLog, nowText } from '../services/jsonStore.js'
import { isLostFoundMessage, isLostFoundTag, normalizeLostFoundType } from '../services/lostFound.js'
import { messageStore } from '../services/messageStore.js'
import { contentWriteRateLimit, interactionRateLimit } from '../services/rateLimit.js'
import { userStore } from '../services/userStore.js'
import { settingsStore } from '../services/settingsStore.js'

export const wallRouter = express.Router()
const form = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxChunkSize,
    files: config.maxCommentFiles,
    fields: config.maxMessageFiles + config.maxPollOptions + 8,
    fieldSize: config.maxTextLength
  }
})

const cookieIds = (req, name) => messageStore.parseCookieIds(req.cookies?.[name] || '')
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
const normalizeText = (value = '') => String(value || '').trim()
const parseTags = (value = '') => String(value || '').split(',').map((tag) => tag.trim()).filter(Boolean)
const currentUser = (req) => authenticatedAccount(req)
const sendPolicyError = (res, result) => {
  res.status(result.statusCode || 400).json({ success: false, code: result.code, error: result.error })
}

const parsePoll = (body = {}) => {
  const question = normalizeText(body.poll_question)
  const rawOptions = Array.isArray(body.poll_options)
    ? body.poll_options
    : (body.poll_options ? [body.poll_options] : [])
  const options = rawOptions.map(normalizeText).filter(Boolean)
  const hasPollInput = Boolean(question || options.length || body.poll_closes_at)
  if (!hasPollInput) return { poll: null }
  if (!question || question.length > config.maxPollQuestionLength) {
    return { error: `投票问题不能为空，且不能超过 ${config.maxPollQuestionLength} 个字` }
  }
  if (options.length < 2 || options.length > config.maxPollOptions) {
    return { error: `投票选项数量必须为 2-${config.maxPollOptions} 个` }
  }
  if (options.some((option) => option.length > config.maxPollOptionLength)) {
    return { error: `每个投票选项不能超过 ${config.maxPollOptionLength} 个字` }
  }
  if (new Set(options).size !== options.length) return { error: '投票选项不能重复' }

  let closesAt = null
  if (body.poll_closes_at) {
    const closeTime = Date.parse(body.poll_closes_at)
    const maxCloseTime = Date.now() + config.maxPollDurationDays * 86400000
    if (Number.isNaN(closeTime) || closeTime <= Date.now() || closeTime > maxCloseTime) {
      return { error: `投票结束时间必须在未来 ${config.maxPollDurationDays} 天内` }
    }
    closesAt = new Date(closeTime).toISOString()
  }
  return {
    poll: {
      question,
      options: options.map((text) => ({ id: randomUUID(), text, votes: 0 })),
      total_votes: 0,
      closes_at: closesAt
    }
  }
}

const cookieSettings = (req, maxAge = 7 * 24 * 60 * 60 * 1000) => {
  const origin = req.headers.origin || ''
  const forwardedProto = req.headers['x-forwarded-proto'] || ''
  const secure = req.secure || forwardedProto === 'https' || origin.includes('https://')
  return { maxAge, path: '/', httpOnly: true, sameSite: secure ? 'none' : 'lax', secure }
}

const rememberPollSelection = (req, res, messageId, optionId) => {
  const selections = messageStore.parsePollSelections(req.cookies?.poll_votes || '')
  selections.set(Number(messageId), optionId)
  const value = Array.from(selections.entries()).slice(-80).map(([id, selected]) => `${id}:${selected}`).join(',')
  res.cookie('poll_votes', value, cookieSettings(req, 365 * 24 * 60 * 60 * 1000))
}

const reactionIdentity = async (req, res) => {
  const user = await currentUser(req)
  if (user) return { user, key: `user:${user.id}` }
  let visitorId = String(req.cookies?.poll_voter || '')
  if (!/^[a-f0-9-]{36}$/i.test(visitorId)) {
    visitorId = randomUUID()
    res.cookie('poll_voter', visitorId, cookieSettings(req, 365 * 24 * 60 * 60 * 1000))
  }
  return { user: null, key: `guest:${visitorId}` }
}

const allowLostFoundInteraction = async (req, res, messageId) => {
  const message = messageStore.getMessage(messageId)
  if (!messageStore.isPublicMessage(message) || !isLostFoundMessage(message)) return true
  if (await currentUser(req)) return true
  res.status(401).json({ success: false, error: '登录后才能使用失物招领' })
  return false
}

const updateReactionCookies = (req, res, messageId, reaction) => {
  const update = (name, active) => {
    const ids = cookieIds(req, name).filter((id) => id !== messageId)
    if (active) ids.push(messageId)
    res.cookie(name, ids.slice(-200).join(','), cookieSettings(req, 365 * 24 * 60 * 60 * 1000))
  }
  update('likes', reaction === 1)
  update('dislikes', reaction === -1)
}

wallRouter.use(requireTrustedOrigin)

wallRouter.post('/comment/:messageId', contentWriteRateLimit, form.none(), asyncRoute(async (req, res) => {
  const user = await currentUser(req)
  if (user?.is_muted) {
    res.status(403).json({ success: false, error: '账号已被禁言，暂时不能评论' })
    return
  }
  const messageId = Number(req.params.messageId)
  const text = normalizeText(req.body?.text)
  const referId = normalizeText(req.body?.refer_id)
  if (!text) {
    res.json({ success: false, error: 'Input cannot be empty' })
    return
  }
  if (text.length > config.maxTextLength) {
    res.json({ success: false, error: 'Text is too long' })
    return
  }
  if (referId && !/^[a-zA-Z0-9_-]{1,80}$/.test(referId)) {
    res.status(400).json({ success: false, error: '回复目标参数无效' })
    return
  }
  const policy = await settingsStore.checkCommunityWrite('comment', { user, values: [text] })
  if (!policy.success) {
    sendPolicyError(res, policy)
    return
  }
  const targetMessage = messageStore.getMessage(messageId)
  if (!targetMessage || !messageStore.isPublicMessage(targetMessage)) {
    res.status(404).json({ success: false, error: '留言不存在或已下架' })
    return
  }
  if (isLostFoundMessage(targetMessage) && !user) {
    res.status(401).json({ success: false, error: '登录后才能使用失物招领' })
    return
  }

  const result = await messageStore.commentMessage({ id: messageId, text, files: [], referId, user })
  if (!result.success) {
    res.status(result.code === 'REPLY_NOT_FOUND' ? 404 : 400).json(result)
    return
  }
  const recipients = new Map()
  if (targetMessage.user_id) {
    recipients.set(Number(targetMessage.user_id), {
      type: 'comment',
      content: text
    })
  }
  if (result.reply_to_user_id) {
    recipients.set(Number(result.reply_to_user_id), {
      type: 'reply',
      content: `回复了你的评论：${text}`
    })
  }
  await Promise.all(Array.from(recipients.entries()).map(([userId, notification]) => userStore.createNotification({
    userId,
    type: notification.type,
    messageId,
    actorUserId: user?.id || null,
    content: notification.content
  })))
  if (result.comment) {
    result.comment = { ...result.comment, owned: Boolean(user) }
    delete result.comment.user_id
    delete result.comment.username
  }
  delete result.reply_to_user_id
  res.json(result)
}))

wallRouter.post('/like/:messageId', interactionRateLimit, asyncRoute(async (req, res) => {
  const messageId = Number(req.params.messageId)
  if (!await allowLostFoundInteraction(req, res, messageId)) return
  const identity = await reactionIdentity(req, res)
  const legacyReaction = cookieIds(req, 'likes').includes(messageId) ? 1 : (cookieIds(req, 'dislikes').includes(messageId) ? -1 : 0)
  const result = await messageStore.likeMessage(messageId, identity.key, legacyReaction)
  if (result.success) updateReactionCookies(req, res, messageId, result.reaction)
  res.json(result)
}))

wallRouter.post('/dislike/:messageId', interactionRateLimit, asyncRoute(async (req, res) => {
  const messageId = Number(req.params.messageId)
  if (!await allowLostFoundInteraction(req, res, messageId)) return
  const identity = await reactionIdentity(req, res)
  const legacyReaction = cookieIds(req, 'likes').includes(messageId) ? 1 : (cookieIds(req, 'dislikes').includes(messageId) ? -1 : 0)
  const result = await messageStore.dislikeMessage(messageId, identity.key, legacyReaction)
  if (result.success) updateReactionCookies(req, res, messageId, result.reaction)
  res.json(result)
}))

wallRouter.post('/poll/:messageId/vote', interactionRateLimit, asyncRoute(async (req, res) => {
  const messageId = Number(req.params.messageId)
  const optionId = String(req.body?.option_id || '').trim()
  if (!Number.isSafeInteger(messageId) || messageId <= 0 || !/^[a-zA-Z0-9-]{1,80}$/.test(optionId)) {
    res.status(400).json({ success: false, error: '投票参数无效' })
    return
  }
  if (!await allowLostFoundInteraction(req, res, messageId)) return
  const identity = await reactionIdentity(req, res)
  const result = await messageStore.votePoll(messageId, optionId, identity.key)
  if (result.selected_option_id) rememberPollSelection(req, res, messageId, result.selected_option_id)
  res.json(result)
}))

wallRouter.post('/submit', contentWriteRateLimit, form.none(), asyncRoute(async (req, res) => {
  const user = await currentUser(req)
  const adminSession = await authenticatedAdmin(req)
  const requestedAdminPost = String(req.body?.post_as_admin || '').toLowerCase() === 'true'
  const canPostAsAdmin = Boolean(adminSession && (
    hasPermission(adminSession.permissions, 'review_posts')
    || hasPermission(adminSession.permissions, 'manage_wall_message')
  ))
  if (requestedAdminPost && !canPostAsAdmin) {
    res.status(403).json({ success: false, error: '当前管理员账号无权以官方身份发帖' })
    return
  }
  const postAsAdmin = canPostAsAdmin && (!user || requestedAdminPost)
  if (user?.is_muted && !postAsAdmin) {
    res.status(403).json({ success: false, error: '账号已被禁言，暂时不能发帖' })
    return
  }
  const filenames = Array.isArray(req.body.filenames) ? req.body.filenames : (req.body.filenames ? [req.body.filenames] : [])
  const text = normalizeText(req.body?.text)
  const pollResult = parsePoll(req.body)
  if (pollResult.error) {
    res.status(400).json({ success: false, error: pollResult.error })
    return
  }
  if (!text && filenames.length === 0 && !pollResult.poll) {
    res.json({ success: false, error: 'Input cannot be empty' })
    return
  }
  if (text.length > config.maxTextLength) {
    res.json({ success: false, error: 'Text is too long' })
    return
  }
  const rawLostFoundType = normalizeText(req.body?.lost_found_type)
  const lostFoundType = normalizeLostFoundType(rawLostFoundType)
  if (rawLostFoundType && !lostFoundType) {
    res.status(400).json({ success: false, error: '失物招领类型无效' })
    return
  }
  const submittedTags = parseTags(req.body.tags)
  if (lostFoundType || submittedTags.some(isLostFoundTag)) {
    res.status(400).json({ success: false, error: '请登录后通过失物招领专用表单发布' })
    return
  }
  const tags = [...new Set(submittedTags)]
  const policy = await settingsStore.checkCommunityWrite('post', {
    user,
    values: [
      text,
      ...tags,
      pollResult.poll?.question,
      ...(pollResult.poll?.options || []).map((option) => option.text)
    ]
  })
  if (!policy.success) {
    sendPolicyError(res, policy)
    return
  }
  if (filenames.length > config.maxMessageFiles) {
    res.json({ success: false, error: 'Too many files' })
    return
  }

  const validFiles = filenames.filter((filename) => allowedFile(filename) && fs.existsSync(uploadPath(filename)))
  if (tags.length > config.maxTags || tags.some((tag) => tag.length > config.maxTagLength)) {
    res.json({ success: false, error: 'Invalid tags' })
    return
  }

  const anonymous = postAsAdmin ? false : (user ? String(req.body.anonymous ?? 'true') !== 'false' : true)
  const id = await messageStore.postMessage({
    text,
    files: validFiles.map(safeBasename),
    tags,
    user: postAsAdmin ? null : user,
    admin: postAsAdmin ? {
      username: adminSession.username,
      userId: adminSession.user.id,
      displayName: `${config.siteName}管理员`
    } : null,
    anonymous,
    poll: pollResult.poll
  })
  for (const filename of validFiles) {
    const tiny = resolveBackend(config.tinyFolder, safeBasename(filename))
    if (!fs.existsSync(tiny)) makeTinyFiles([filename]).catch(() => {})
  }
  if (postAsAdmin) appendAdminLog(`${nowText()}    ${adminSession.username} 以官方身份提交待审核留言 ${id}`)
  res.json({
    success: true,
    id,
    moderation_status: 'pending',
    review_status: 'pending',
    author_type: postAsAdmin ? 'admin' : (user ? 'student' : 'guest'),
    official: postAsAdmin
  })
}))
