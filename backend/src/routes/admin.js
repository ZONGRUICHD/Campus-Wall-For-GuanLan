import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import multer from 'multer'
import { config, resolveBackend } from '../config.js'
import { sessionCookieName, createSession, authenticatedAdmin, hasPermission, requireAdmin, requireTrustedOrigin, adminCookieOptions } from '../services/auth.js'
import { appendAdminLog, nowText, readJson, writeJson } from '../services/jsonStore.js'
import { makeTinyFiles, removeUploadedFiles } from '../services/fileTools.js'
import { messageStore } from '../services/messageStore.js'
import { userSessionCookieName, userStore } from '../services/userStore.js'
import { loginRateLimit } from '../services/rateLimit.js'
import { settingsStore } from '../services/settingsStore.js'
import { feedbackCategories, feedbackStatuses, feedbackStore } from '../services/feedbackStore.js'
import { reportStore } from '../services/reportStore.js'
import { adminPermissionDefinitions, permissionsForRole, roleDefinitions } from '../services/roles.js'
import { auditStore } from '../services/auditStore.js'
import { createNoticeId, readNotices, writeNotices } from '../services/noticeStore.js'

export const adminRouter = express.Router()
const form = multer({ limits: { fields: 8, fieldSize: 4096 } }).none()
const noticeForm = multer({ limits: { fields: 2, fieldSize: config.maxTextLength * 4 } }).none()
const userForm = multer({ limits: { fields: 10, fieldSize: 4096 } }).none()
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

const auditTarget = (req) => {
  const pathName = String(req.route?.path || req.path || '')
  const targetType = pathName.includes('comment') ? 'comment'
    : (pathName.includes('message') || pathName.includes('approve') || pathName.includes('repair') ? 'message'
        : (pathName.includes('user') ? 'user'
            : (pathName.includes('app') ? 'app'
                : (pathName.includes('notice') ? 'notice'
                    : (pathName.includes('report') ? 'report'
                        : (pathName.includes('manager') ? 'manager'
                            : (pathName.includes('setting') ? 'setting' : 'admin')))))))
  const targetId = req.auditTargetId || req.params?.commentId || req.params?.messageId || req.params?.userId
    || req.params?.appId || req.params?.noticeId || req.params?.reportId || req.params?.username || ''
  return { pathName, targetType, targetId: String(targetId || '') }
}

const auditSummary = (req, target) => {
  const pathName = target.pathName
  const id = target.targetId ? ` ${target.targetId}` : ''
  if (pathName === '/feedback/:ticketId') return `更新反馈工单${id}`
  if (pathName.includes('/reports/') && pathName.endsWith('/resolve')) return `处理举报${id}`
  if (pathName === '/managers') return '创建管理员账号'
  if (pathName === '/managers/me/password') return '修改当前管理员密码'
  if (pathName.includes('/managers/') && pathName.endsWith('/reset_password')) return `重置管理员密码${id}`
  if (pathName.includes('/managers/')) return `更新管理员账号${id}`
  if (pathName === '/settings/captcha') return '更新人机验证设置'
  if (pathName === '/settings/community') return '更新社区运营设置'
  if (pathName === '/users/import') return '导入学生账号'
  if (pathName.includes('/users/') && pathName.endsWith('/role')) return `更新用户角色${id}`
  if (pathName.includes('/users/') && pathName.endsWith('/mute')) return `禁言用户${id}`
  if (pathName.includes('/users/') && pathName.endsWith('/unmute')) return `解除用户禁言${id}`
  if (pathName.includes('/users/') && pathName.endsWith('/disable')) return `停用用户${id}`
  if (pathName.includes('/users/') && pathName.endsWith('/reset_password')) return `重置用户密码${id}`
  if (pathName.includes('/users/')) return `编辑用户${id}`
  if (pathName === '/trash/bulk') return '批量处理内容回收站'
  if (pathName.includes('/trash/') && pathName.endsWith('/restore')) return `恢复回收站${target.targetType === 'comment' ? '评论' : '留言'}${id}`
  if (pathName.includes('/trash/')) return `彻底删除回收站${target.targetType === 'comment' ? '评论' : '留言'}${id}`
  if (pathName === '/delete_message/:messageId') return `留言移入回收站${id}`
  if (pathName.includes('/delete_comment/')) return `评论移入回收站${id}`
  if (pathName === '/messages/bulk-moderation') return '批量管理留言'
  if (pathName.includes('/messages/') && pathName.endsWith('/review')) return `审核留言${id}`
  if (pathName.includes('/messages/') && pathName.endsWith('/moderation')) return `更新留言状态${id}`
  if (pathName === '/comments/bulk-moderation') return '批量管理评论'
  if (pathName.includes('/comments/') && pathName.endsWith('/moderation')) return `更新评论状态${id}`
  if (pathName.includes('/notice')) return `${req.method === 'POST' ? '发布' : (req.method === 'DELETE' ? '撤回' : '编辑')}公告${id}`
  if (pathName.includes('/approve_message/') || pathName.includes('/repair_message/')) return `处理留言${id}`
  return `${req.method} ${pathName}`
}

adminRouter.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    next()
    return
  }
  res.once('finish', () => {
    if (!req.adminUser || res.statusCode < 200 || res.statusCode >= 400) return
    const target = auditTarget(req)
    auditStore.record({
      actor: req.adminUser,
      action: `${req.method} ${target.pathName}`,
      targetType: target.targetType,
      targetId: target.targetId,
      summary: auditSummary(req, target),
      metadata: { status_code: res.statusCode, actor_role: req.adminRole || '', ...(req.auditMetadata || {}) }
    }).catch(() => {})
  })
  next()
})

const resolveNoticeIndex = (notices, noticeId) => {
  const idIndex = notices.findIndex((notice) => String(notice.id || '') === String(noticeId))
  if (idIndex >= 0) return idIndex
  if (/^\d+$/.test(noticeId) && Number(noticeId) >= 0 && Number(noticeId) < notices.length) return Number(noticeId)
  return -1
}

const canManageWall = (req) => hasPermission(req.adminPermissions, 'manage_wall_message')
const canReviewPosts = (req) => canManageWall(req) || hasPermission(req.adminPermissions, 'review_posts')
const isReviewOnly = (req) => hasPermission(req.adminPermissions, 'review_posts') && !canManageWall(req)
const canManageSettings = (req) => hasPermission(req.adminPermissions, 'manage_settings')
const canManageFeedback = (req) => hasPermission(req.adminPermissions, 'view_user_log')
const canManageAdmins = (req) => req.adminRole === 'super_admin' && hasPermission(req.adminPermissions, 'manage_roles')
const canManageUsers = (req) => hasPermission(req.adminPermissions, 'manage_users')
const userMutationOptions = (req) => ({ requireUserRole: req.adminRole !== 'super_admin' })
const protectedUserTarget = async (req, res) => {
  const target = await userStore.getById(req.params.userId)
  if (!target) {
    res.status(404).json({ success: false, error: '用户不存在' })
    return null
  }
  if (req.adminRole !== 'super_admin' && target.role !== 'user') {
    res.status(403).json({ success: false, error: '只有超级管理员可以管理审核员或管理员账号' })
    return null
  }
  return target
}

const noticeActor = (req) => `${({
  reviewer: '审核员',
  admin: '管理员',
  super_admin: '超级管理员'
}[req.adminRole] || '管理成员')} ${req.adminUser}`
const cleanupUnreferencedFiles = (filenames = []) => {
  removeUploadedFiles(filenames.filter((filename) => !messageStore.isFileReferenced(filename)))
}

const sendAdminError = (res, error) => {
  if (error?.statusCode) {
    res.status(error.statusCode).json({ success: false, error: error.message || '请求失败' })
    return true
  }
  return false
}

const enrichMessageUser = async (message) => {
  if (!message) return message
  const copy = JSON.parse(JSON.stringify(message))
  if (copy.user_id) copy.user = await userStore.getById(copy.user_id)
  if (Array.isArray(copy.comments)) {
    copy.comments = await Promise.all(copy.comments.map(async (comment) => {
      if (!comment.user_id) return comment
      return { ...comment, user: await userStore.getById(comment.user_id) }
    }))
  }
  return copy
}

const withReviewCapabilities = (message) => {
  if (!message) return message
  const copy = JSON.parse(JSON.stringify(message))
  copy.can_approve = true
  delete copy.is_own_submission
  delete copy.self_review_forbidden
  delete copy.approval_block_reason
  delete copy.review_constraint
  return copy
}

const redactReviewIdentity = (message) => {
  if (!message) return message
  const copy = withReviewCapabilities(message)
  copy.review_identity_redacted = true
  for (const field of ['user_id', 'submitted_by_user_id', 'username', 'user', 'admin_username', 'reviewed_by', 'review_hold_by', 'restored_by', 'hidden_by', 'deleted_by']) delete copy[field]
  // Post reviewers assess the submitted post itself. Historical comments can
  // contain unrelated, hidden, or deleted content and are outside this role.
  delete copy.comments
  return copy
}

const isReviewQueueMessage = (message) => Boolean(message)
  && !['hidden', 'deleted'].includes(message.moderation_status)

const reviewQueueCounts = (messages) => ({
  pending: messages.filter((message) => message.review_status !== 'approved').length,
  approved: messages.filter((message) => message.review_status === 'approved').length,
  awaiting_publication: messages.filter((message) => message.moderation_status === 'pending').length
})

const applyReviewState = async ({ messageId, approved, reviewer }) => {
  const current = messageStore.getMessage(messageId)
  if (!current) return { success: false, error: '消息不存在', statusCode: 404 }
  const result = await messageStore.setReviewState(messageId, {
    approved,
    reviewer
  })
  if (!result.success) return result

  const changed = current.review_status !== result.message.review_status
    || current.moderation_status !== result.message.moderation_status
  if (changed && current.user_id) {
    await userStore.createNotification({
      userId: current.user_id,
      type: 'moderation',
      messageId,
      content: approved
        ? '你的留言已通过审核并公开展示'
        : '你的留言已退回待审核，暂不公开展示'
    })
  }
  return { ...result, changed }
}

const enrichCommentUser = async (comment) => {
  if (!comment) return comment
  const copy = JSON.parse(JSON.stringify(comment))
  if (copy.user_id) copy.user = await userStore.getById(copy.user_id)
  return copy
}

const enrichTrashItem = async (item) => {
  const copy = JSON.parse(JSON.stringify(item))
  if (copy.user_id) copy.user = await userStore.getById(copy.user_id)
  return copy
}

const applyCommentModeration = async ({ messageId, commentId, hidden, hiddenReason = '', reviewer }) => {
  const current = messageStore.getComment(messageId, commentId)
  if (!current) return { success: false, error: '评论不存在', statusCode: 404 }
  const result = await messageStore.setCommentModerationState(messageId, commentId, {
    hidden,
    hiddenReason,
    hiddenBy: reviewer
  })
  if (!result.success) return result
  const changed = current.moderation_status !== result.comment.moderation_status
  if (changed && current.user_id) {
    await userStore.createNotification({
      userId: current.user_id,
      type: 'comment_moderation',
      messageId,
      content: hidden
        ? `你的评论已被管理员下架：${result.comment.hidden_reason}`
        : '你的评论已恢复公开展示'
    })
  }
  return { ...result, changed }
}

adminRouter.get('/verify', asyncRoute(async (req, res) => {
  const admin = await authenticatedAdmin(req)
  res.json(admin
    ? { success: true, admin: { ...admin.user, permissions: admin.permissions } }
    : { success: false, error: '未登录或登录过期' })
}))

adminRouter.post('/login', requireTrustedOrigin, loginRateLimit, form, asyncRoute(async (req, res) => {
  const loginResult = await userStore.login(req.body.username || '', req.body.password || '')
  if (!loginResult || !['reviewer', 'admin', 'super_admin'].includes(loginResult.user.role)) {
    res.status(401).json({ success: false, error: '用户名或密码错误，或账号没有后台权限' })
    return
  }
  const admin = { ...loginResult.user, permissions: permissionsForRole(loginResult.user.role) }
  res.cookie(sessionCookieName, createSession(loginResult.user, loginResult.sessionVersion), adminCookieOptions())
  res.clearCookie(userSessionCookieName, { path: '/' })
  res.clearCookie('admin_password')
  res.json({ success: true, admin_user: loginResult.user.username, admin })
}))

const logout = (req, res) => {
  res.clearCookie(sessionCookieName, { path: '/' })
  res.clearCookie(userSessionCookieName, { path: '/' })
  res.clearCookie('admin_user')
  res.clearCookie('admin_password')
  res.json({ success: true })
}

adminRouter.post('/logout', requireTrustedOrigin, logout)
adminRouter.get('/logout', (req, res) => {
  res.status(405).json({ success: false, error: 'Use POST /logout' })
})

adminRouter.get('/log', requireAdmin, (req, res) => {
  if (!hasPermission(req.adminPermissions, 'view_log')) {
    res.status(403).json({ success: false, error: '无权查看错误日志' })
    return
  }
  const search = String(req.query.search || '').toLowerCase()
  const logPath = resolveBackend('error.log')
  if (!fs.existsSync(logPath)) {
    res.json({ log_content: [] })
    return
  }
  let lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/)
  if (lines.length > 1000) lines = lines.slice(-1000)
  if (search) lines = lines.filter((line) => line.toLowerCase().includes(search))
  res.json({ log_content: lines, search_query: req.query.search || '' })
})

adminRouter.get('/admin_log', requireAdmin, (req, res) => {
  if (!hasPermission(req.adminPermissions, 'view_admin_log')) {
    res.status(403).json({ success: false, error: '无权查看管理员日志' })
    return
  }
  const search = String(req.query.search || '').toLowerCase()
  let logs = readJson('admin_log.json', [])
  if (logs.length > 1000) logs = logs.slice(-1000)
  if (search) logs = logs.filter((line) => String(line).toLowerCase().includes(search))
  res.json({ log_content: logs, search_query: req.query.search || '' })
})

adminRouter.get('/audit', requireAdmin, asyncRoute(async (req, res) => {
  if (!hasPermission(req.adminPermissions, 'view_admin_log')) {
    res.status(403).json({ success: false, error: '无权查看操作审计' })
    return
  }
  const result = await auditStore.list({
    page: req.query.page,
    pageSize: req.query.page_size,
    q: req.query.q,
    actor: req.query.actor,
    action: req.query.action,
    targetType: req.query.target_type
  })
  res.json({ success: true, ...result })
}))

adminRouter.get('/report', requireAdmin, (req, res) => {
  if (!hasPermission(req.adminPermissions, 'view_report')) {
    res.status(403).json({ success: false, error: '无权查看举报' })
    return
  }
  const reports = reportStore.pending()
  res.json({ message_ids: Object.keys(reports), reports, processed_total: normalizedProcessedReports().length })
})

const reportTimestamp = (value) => {
  const parsed = Date.parse(String(value || '').replace(' ', 'T'))
  return Number.isFinite(parsed) ? parsed : 0
}

const normalizedProcessedReports = () => {
  return reportStore.processedItems()
}

adminRouter.get('/reports/history', requireAdmin, (req, res) => {
  if (!hasPermission(req.adminPermissions, 'view_report')) {
    res.status(403).json({ success: false, error: '无权查看举报记录' })
    return
  }
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
  const pageSize = Math.max(1, Math.min(50, Math.floor(Number(req.query.page_size) || 20)))
  const action = String(req.query.action || '').trim()
  const targetType = String(req.query.target_type || '').trim()
  const query = String(req.query.q || '').trim().toLowerCase().slice(0, 100)
  let items = normalizedProcessedReports()

  if (['dismiss', 'delete_comment', 'delete_message'].includes(action)) {
    items = items.filter((item) => item.resolution === action)
  }
  if (['message', 'comment'].includes(targetType)) {
    items = items.filter((item) => item.target_type === targetType)
  }
  if (query) {
    items = items.filter((item) => [
      item.message_id,
      item.comment_id,
      item.category,
      item.text,
      item.email,
      item.target_excerpt,
      item.public_reply,
      item.processed_by
    ].some((value) => String(value || '').toLowerCase().includes(query)))
  }

  items.sort((a, b) => reportTimestamp(b.processed_at) - reportTimestamp(a.processed_at) || String(b.id || '').localeCompare(String(a.id || '')))
  const total = items.length
  const totalPages = Math.ceil(total / pageSize)
  const offset = (page - 1) * pageSize
  res.json({
    success: true,
    items: items.slice(offset, offset + pageSize),
    page,
    page_size: pageSize,
    total,
    total_pages: totalPages
  })
})

adminRouter.get('/feedback', requireAdmin, (req, res) => {
  if (!canManageFeedback(req)) {
    res.status(403).json({ success: false, error: '无权查看反馈工单' })
    return
  }
  const result = feedbackStore.list({
    page: req.query.page,
    pageSize: req.query.page_size,
    q: req.query.q,
    status: req.query.status,
    category: req.query.category
  })
  res.json({ success: true, ...result, categories: feedbackCategories, statuses: feedbackStatuses })
})

adminRouter.put('/feedback/:ticketId', requireAdmin, (req, res) => {
  if (!canManageFeedback(req)) {
    res.status(403).json({ success: false, error: '无权处理反馈工单' })
    return
  }
  try {
    const ticket = feedbackStore.update(req.params.ticketId, req.body || {}, req.adminUser)
    appendAdminLog(`${nowText()}    ${req.adminUser} 更新反馈工单 ${ticket.id}：${feedbackStatuses[ticket.status]}`)
    res.json({ success: true, ticket })
  } catch (error) {
    if (!sendAdminError(res, error)) throw error
  }
})

adminRouter.post('/reports/:messageId/:reportId/resolve', requireAdmin, asyncRoute(async (req, res) => {
  if (!hasPermission(req.adminPermissions, 'view_report')) {
    res.status(403).json({ success: false, error: '无权处理举报' })
    return
  }
  const action = String(req.body?.action || 'dismiss')
  const publicReply = String(req.body?.public_reply || '').trim()
  if (!['dismiss', 'delete_comment', 'delete_message'].includes(action)) {
    res.status(400).json({ success: false, error: '不支持的处理方式' })
    return
  }
  if (publicReply.length > 1000) {
    res.status(400).json({ success: false, error: '公开处理说明不能超过 1000 字' })
    return
  }
  if (action !== 'dismiss' && !hasPermission(req.adminPermissions, 'manage_wall_message')) {
    res.status(403).json({ success: false, error: '无权删除墙内内容' })
    return
  }

  const messageId = String(req.params.messageId)
  const reports = reportStore.pending()
  const items = Array.isArray(reports[messageId]) ? reports[messageId] : []
  const report = items.find((item) => String(item.id) === String(req.params.reportId))
  if (!report) {
    res.status(404).json({ success: false, error: '举报不存在或已处理' })
    return
  }

  let resolvedItems = [report]
  if (action === 'delete_comment') {
    if (report.target_type !== 'comment' || !report.comment_id) {
      res.status(400).json({ success: false, error: '该举报未关联评论' })
      return
    }
    const result = await messageStore.deleteComment(Number(messageId), report.comment_id, {
      deletedBy: req.adminUser,
      reason: `举报处理：${report.category || '内容违规'}`,
      origin: 'report'
    })
    if (!result.success) {
      res.status(404).json({ success: false, error: '被举报评论已不存在，可改为仅标记处理' })
      return
    }
    if (result.comment?.user_id) {
      await userStore.createNotification({
        userId: result.comment.user_id,
        type: 'comment_moderation',
        messageId: Number(messageId),
        content: '你的评论因举报处理已被管理员移入回收站'
      })
    }
    resolvedItems = items.filter((item) => item.target_type === 'comment' && String(item.comment_id) === String(report.comment_id))
  } else if (action === 'delete_message') {
    const result = await messageStore.deleteMessage(Number(messageId), {
      deletedBy: req.adminUser,
      reason: `举报处理：${report.category || '内容违规'}`,
      origin: 'report'
    })
    if (!result.success) {
      res.status(404).json({ success: false, error: '被举报留言已不存在，可改为仅标记处理' })
      return
    }
    resolvedItems = items
  }

  const { processedAt, archived } = reportStore.archive(messageId, resolvedItems, {
    resolution: action,
    processedBy: req.adminUser,
    publicReply
  })
  if (archived.length === 0) {
    res.status(409).json({ success: false, error: '举报状态已变化，请刷新后重试' })
    return
  }

  const actionText = action === 'delete_comment' ? '评论移入回收站并处理' : (action === 'delete_message' ? '留言移入回收站并处理' : '标记处理')
  appendAdminLog(`${processedAt}    ${req.adminUser} ${actionText}：留言 ${messageId}，结清 ${archived.length} 条举报`)
  res.json({ success: true, action, resolved: archived.length })
}))

adminRouter.get('/dashboard/stats', requireAdmin, asyncRoute(async (req, res) => {
  if (isReviewOnly(req)) {
    const messages = messageStore.allMessages().filter(isReviewQueueMessage)
    const counts = reviewQueueCounts(messages)
    res.json({
      success: true,
      generated_at: new Date().toISOString(),
      stats: {
        messages: {
          total: messages.length,
          visible: counts.approved,
          pending: counts.pending,
          pending_review: counts.pending,
          approved: counts.approved,
          awaiting_publication: counts.awaiting_publication
        }
      }
    })
    return
  }
  const reports = reportStore.pending()
  const reportCount = Object.values(reports).reduce((total, items) => total + (Array.isArray(items) ? items.length : 0), 0)
  const commentReportCount = Object.values(reports).reduce(
    (total, items) => total + (Array.isArray(items) ? items.filter((item) => item?.target_type === 'comment').length : 0),
    0
  )
  const messageStats = messageStore.stats()
  const [community, audit] = await Promise.all([settingsStore.communityPublic(), auditStore.stats()])
  const managers = await userStore.roleStats()
  const feedback = feedbackStore.stats()
  const adminLogs = readJson('admin_log.json', [])
  const processedReports = normalizedProcessedReports()
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

  res.json({
    success: true,
    generated_at: new Date().toISOString(),
    stats: {
      messages: {
        ...messageStats
      },
      feedback,
      community: {
        posting_enabled: community.posting_enabled,
        commenting_enabled: community.commenting_enabled,
        guest_posting_enabled: community.guest_posting_enabled,
        guest_commenting_enabled: community.guest_commenting_enabled,
        require_post_approval: community.require_post_approval
      },
      reports: {
        total: reportCount,
        affected_messages: Object.keys(reports).length,
        comment_reports: commentReportCount,
        processed_total: processedReports.length,
        processed_last_7_days: processedReports.filter((item) => reportTimestamp(item.processed_at) >= sevenDaysAgo).length
      },
      managers,
      trash: messageStore.trashCounts(),
      audit,
      admin_logs: Array.isArray(adminLogs) ? adminLogs.length : 0
    }
  })
}))

adminRouter.get('/managers', requireAdmin, asyncRoute(async (req, res) => {
  if (!canManageAdmins(req)) {
    res.status(403).json({ success: false, error: '无权管理管理员账号' })
    return
  }
  const accounts = await userStore.listPrivilegedUsers()
  res.set('Cache-Control', 'no-store')
  res.json({
    success: true,
    managers: accounts.map((account) => ({
      ...account,
      permissions: permissionsForRole(account.role)
    })),
    stats: await userStore.roleStats(),
    permissions: adminPermissionDefinitions,
    roles: roleDefinitions,
    current_username: req.adminUser
  })
}))

const disabledManagerMutation = (req, res) => {
  if (!canManageAdmins(req)) {
    res.status(403).json({ success: false, error: '无权管理管理员账号' })
    return
  }
  res.status(410).json({ success: false, error: '管理员账号已合并到注册用户，请在用户管理中分配角色' })
}

adminRouter.post('/managers', requireAdmin, disabledManagerMutation)

adminRouter.put('/managers/:username', requireAdmin, disabledManagerMutation)

adminRouter.post('/managers/:username/reset_password', requireAdmin, disabledManagerMutation)

adminRouter.post('/managers/me/password', requireAdmin, asyncRoute(async (req, res) => {
  const currentPassword = String(req.body?.current_password || '')
  const newPassword = String(req.body?.new_password || '')
  if (newPassword.length < 8 || newPassword.length > 128 || currentPassword === newPassword) {
    res.status(400).json({ success: false, error: '新密码需为 8-128 位，且不能与当前密码相同' })
    return
  }
  const result = await userStore.changePassword(req.adminAccount.id, currentPassword, newPassword)
  if (!result.success) {
    res.status(400).json(result)
    return
  }
  res.cookie(sessionCookieName, createSession(result.user, result.sessionVersion), adminCookieOptions())
  res.clearCookie(userSessionCookieName, { path: '/' })
  appendAdminLog(`${nowText()}    ${req.adminUser} 修改了自己的管理员密码`)
  res.json({ success: true, manager: result.user })
}))

adminRouter.get('/settings/captcha', requireAdmin, asyncRoute(async (req, res) => {
  if (!canManageSettings(req)) {
    res.status(403).json({ success: false, error: '无权管理平台设置' })
    return
  }
  res.set('Cache-Control', 'no-store')
  res.json({ success: true, settings: await settingsStore.captchaAdmin() })
}))

adminRouter.put('/settings/captcha', requireAdmin, asyncRoute(async (req, res) => {
  if (!canManageSettings(req)) {
    res.status(403).json({ success: false, error: '无权管理平台设置' })
    return
  }
  try {
    const settings = await settingsStore.updateCaptcha(req.body || {})
    appendAdminLog(`${nowText()}    ${req.adminUser} 更新人机验证设置：${settings.enabled ? `启用 ${settings.provider}` : '关闭'}`)
    res.json({ success: true, settings })
  } catch (error) {
    if (!sendAdminError(res, error)) throw error
  }
}))

adminRouter.get('/settings/community', requireAdmin, asyncRoute(async (req, res) => {
  if (!canManageSettings(req)) {
    res.status(403).json({ success: false, error: '无权管理平台设置' })
    return
  }
  res.set('Cache-Control', 'no-store')
  res.json({ success: true, settings: await settingsStore.communityAdmin() })
}))

adminRouter.put('/settings/community', requireAdmin, asyncRoute(async (req, res) => {
  if (!canManageSettings(req)) {
    res.status(403).json({ success: false, error: '无权管理平台设置' })
    return
  }
  try {
    const settings = await settingsStore.updateCommunity(req.body || {})
    appendAdminLog(`${nowText()}    ${req.adminUser} 更新社区运营设置：发帖${settings.posting_enabled ? '开启' : '关闭'}，评论${settings.commenting_enabled ? '开启' : '关闭'}，发帖审核固定开启，敏感词 ${settings.sensitive_words.length} 个`)
    res.json({ success: true, settings, released_pending: 0 })
  } catch (error) {
    if (!sendAdminError(res, error)) throw error
  }
}))

adminRouter.get('/users/stats', requireAdmin, asyncRoute(async (req, res) => {
  if (!canManageUsers(req)) {
    res.status(403).json({ success: false, error: '无权管理用户' })
    return
  }
  res.json({ success: true, stats: await userStore.stats() })
}))

adminRouter.get('/users', requireAdmin, asyncRoute(async (req, res) => {
  if (!canManageUsers(req)) {
    res.status(403).json({ success: false, error: '无权管理用户' })
    return
  }
  const data = await userStore.listUsers({
    page: req.query.page,
    pageSize: req.query.page_size,
    q: req.query.q || '',
    status: req.query.status || '',
    muted: req.query.muted || '',
    role: req.query.role || ''
  })
  res.json({ success: true, ...data })
}))

adminRouter.get('/roles', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({
    success: true,
    roles: roleDefinitions,
    can_manage_roles: canManageAdmins(req)
  })
})

const updateUserRole = asyncRoute(async (req, res) => {
  if (!canManageAdmins(req)) {
    res.status(403).json({ success: false, error: '只有超级管理员可以分配角色' })
    return
  }
  const result = await userStore.setRole({
    actorId: req.adminAccount.id,
    targetId: req.params.userId,
    role: req.body?.role
  })
  if (!result.success) {
    res.status(result.statusCode || 400).json(result)
    return
  }
  req.auditMetadata = {
    previous_role: result.previousRole,
    next_role: result.user.role,
    changed: result.changed
  }
  if (result.changed) {
    appendAdminLog(`${nowText()}    ${req.adminUser} 将用户 ${result.user.username} 的角色从 ${result.previousRole} 改为 ${result.user.role}`)
  }
  res.json({ success: true, user: result.user, changed: result.changed })
})

adminRouter.put('/users/:userId/role', requireAdmin, updateUserRole)
adminRouter.patch('/users/:userId/role', requireAdmin, updateUserRole)

adminRouter.post('/users/import', requireAdmin, (_req, res) => {
  res.status(410).json({ success: false, error: '账号批量导入功能已停用，请由用户自行注册' })
})

adminRouter.put('/users/:userId', requireAdmin, userForm, asyncRoute(async (req, res) => {
  if (!canManageUsers(req)) {
    res.status(403).json({ success: false, error: '无权管理用户' })
    return
  }
  if (String(req.body?.bio || '').length > 200) {
    res.status(400).json({ success: false, error: '个人简介不能超过 200 个字符' })
    return
  }
  const target = await protectedUserTarget(req, res)
  if (!target) return
  if (target.role === 'super_admin') req.body.status = 'active'
  const user = await userStore.adminUpdateUser(req.params.userId, req.body, userMutationOptions(req))
  if (!user) {
    res.status(404).json({ success: false, error: '用户不存在' })
    return
  }
  appendAdminLog(`${nowText()}    ${req.adminUser} 编辑用户 ${user.username}`)
  res.json({ success: true, user })
}))

adminRouter.post('/users/:userId/mute', requireAdmin, userForm, asyncRoute(async (req, res) => {
  if (!canManageUsers(req)) {
    res.status(403).json({ success: false, error: '无权管理用户' })
    return
  }
  if (!await protectedUserTarget(req, res)) return
  const mutedUntil = req.body.muted_until || req.body.until || ''
  if (!mutedUntil || Number.isNaN(new Date(mutedUntil).getTime())) {
    res.status(400).json({ success: false, error: '请提供有效的禁言到期时间' })
    return
  }
  const user = await userStore.setMute(req.params.userId, mutedUntil, req.body.reason || '', userMutationOptions(req))
  if (!user) {
    res.status(404).json({ success: false, error: '用户不存在' })
    return
  }
  appendAdminLog(`${nowText()}    ${req.adminUser} 禁言用户 ${user.username} 至 ${mutedUntil}`)
  res.json({ success: true, user })
}))

adminRouter.post('/users/:userId/unmute', requireAdmin, asyncRoute(async (req, res) => {
  if (!canManageUsers(req)) {
    res.status(403).json({ success: false, error: '无权管理用户' })
    return
  }
  if (!await protectedUserTarget(req, res)) return
  const user = await userStore.unmute(req.params.userId, userMutationOptions(req))
  if (!user) {
    res.status(404).json({ success: false, error: '用户不存在' })
    return
  }
  appendAdminLog(`${nowText()}    ${req.adminUser} 解除用户 ${user.username} 的禁言`)
  res.json({ success: true, user })
}))

adminRouter.post('/users/:userId/disable', requireAdmin, asyncRoute(async (req, res) => {
  if (!canManageUsers(req)) {
    res.status(403).json({ success: false, error: '无权管理用户' })
    return
  }
  const target = await protectedUserTarget(req, res)
  if (!target) return
  if (Number(target.id) === Number(req.adminAccount.id) || target.role === 'super_admin') {
    res.status(403).json({ success: false, error: '不能停用当前账号或超级管理员；请先安全调整角色' })
    return
  }
  const user = await userStore.disable(req.params.userId, userMutationOptions(req))
  if (!user) {
    res.status(404).json({ success: false, error: '用户不存在' })
    return
  }
  appendAdminLog(`${nowText()}    ${req.adminUser} 停用用户 ${user.username}`)
  res.json({ success: true, user })
}))

adminRouter.post('/users/:userId/reset_password', requireAdmin, userForm, asyncRoute(async (req, res) => {
  if (!canManageUsers(req)) {
    res.status(403).json({ success: false, error: '无权管理用户' })
    return
  }
  const target = await protectedUserTarget(req, res)
  if (!target) return
  if (Number(target.id) === Number(req.adminAccount.id)) {
    res.status(400).json({ success: false, error: '请使用“修改我的密码”更新当前账号密码' })
    return
  }
  const password = String(req.body.password || '')
  if (password.length < 8 || password.length > 128) {
    res.status(400).json({ success: false, error: '新密码长度需要在 8 到 128 个字符之间' })
    return
  }
  const user = await userStore.resetPassword(req.params.userId, password, userMutationOptions(req))
  if (!user) {
    res.status(404).json({ success: false, error: '用户不存在' })
    return
  }
  appendAdminLog(`${nowText()}    ${req.adminUser} 重置用户 ${user.username} 的密码`)
  res.json({ success: true, user })
}))

adminRouter.get('/trash', requireAdmin, asyncRoute(async (req, res) => {
  if (!hasPermission(req.adminPermissions, 'manage_wall_message')) {
    res.status(403).json({ success: false, error: '无权查看内容回收站' })
    return
  }
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
  const pageSize = Math.max(1, Math.min(100, Math.floor(Number(req.query.page_size) || 20)))
  const requestedType = String(req.query.type || 'all')
  const type = ['all', 'message', 'comment'].includes(requestedType) ? requestedType : 'all'
  const items = messageStore.getTrash({ type, word: req.query.q || '' })
  const offset = (page - 1) * pageSize
  const pageItems = await Promise.all(items.slice(offset, offset + pageSize).map(enrichTrashItem))
  res.json({
    success: true,
    items: pageItems,
    counts: messageStore.trashCounts(),
    page,
    page_size: pageSize,
    total: items.length,
    total_pages: Math.ceil(items.length / pageSize),
    type
  })
}))

adminRouter.post('/trash/messages/:messageId/restore', requireAdmin, asyncRoute(async (req, res) => {
  if (!hasPermission(req.adminPermissions, 'manage_wall_message')) {
    res.status(403).json({ success: false, error: '无权恢复留言' })
    return
  }
  const result = await messageStore.restoreMessage(Number(req.params.messageId), { restoredBy: req.adminUser })
  if (result.success && result.message?.user_id) {
    await userStore.createNotification({
      userId: result.message.user_id,
      type: 'moderation',
      messageId: Number(req.params.messageId),
      content: result.message.moderation_status === 'visible' ? '你的留言已从回收站恢复并重新公开' : '你的留言已从回收站恢复'
    })
  }
  if (result.success) appendAdminLog(`${nowText()}    ${req.adminUser} 从回收站恢复留言 ${req.params.messageId}`)
  res.status(result.code === 'NOT_FOUND' ? 404 : (result.success ? 200 : 409)).json(result)
}))

adminRouter.delete('/trash/messages/:messageId', requireAdmin, asyncRoute(async (req, res) => {
  if (!hasPermission(req.adminPermissions, 'manage_wall_message')) {
    res.status(403).json({ success: false, error: '无权彻底删除留言' })
    return
  }
  if (req.body?.confirm !== 'PURGE') {
    res.status(400).json({ success: false, error: '彻底删除确认无效' })
    return
  }
  const result = await messageStore.purgeMessage(Number(req.params.messageId))
  if (result.success) {
    cleanupUnreferencedFiles(messageStore.attachedFiles(result.purged_message))
    delete result.purged_message
    appendAdminLog(`${nowText()}    ${req.adminUser} 彻底删除回收站留言 ${req.params.messageId}`)
  }
  res.status(result.code === 'NOT_FOUND' ? 404 : (result.success ? 200 : 409)).json(result)
}))

adminRouter.post('/trash/comments/:messageId/:commentId/restore', requireAdmin, asyncRoute(async (req, res) => {
  if (!hasPermission(req.adminPermissions, 'manage_wall_message')) {
    res.status(403).json({ success: false, error: '无权恢复评论' })
    return
  }
  const result = await messageStore.restoreComment(Number(req.params.messageId), req.params.commentId, { restoredBy: req.adminUser })
  if (result.success && result.comment?.user_id) {
    await userStore.createNotification({
      userId: result.comment.user_id,
      type: 'comment_moderation',
      messageId: Number(req.params.messageId),
      content: result.comment.moderation_status === 'visible' ? '你的评论已从回收站恢复并重新公开' : '你的评论已从回收站恢复'
    })
  }
  if (result.success) appendAdminLog(`${nowText()}    ${req.adminUser} 从回收站恢复留言 ${req.params.messageId} 的评论 ${req.params.commentId}`)
  res.status(result.code === 'NOT_FOUND' ? 404 : (result.success ? 200 : 409)).json(result)
}))

adminRouter.delete('/trash/comments/:messageId/:commentId', requireAdmin, asyncRoute(async (req, res) => {
  if (!hasPermission(req.adminPermissions, 'manage_wall_message')) {
    res.status(403).json({ success: false, error: '无权彻底删除评论' })
    return
  }
  if (req.body?.confirm !== 'PURGE') {
    res.status(400).json({ success: false, error: '彻底删除确认无效' })
    return
  }
  const result = await messageStore.purgeComment(Number(req.params.messageId), req.params.commentId)
  if (result.success) {
    cleanupUnreferencedFiles(result.purged_comment?.files || [])
    delete result.purged_comment
    appendAdminLog(`${nowText()}    ${req.adminUser} 彻底删除回收站留言 ${req.params.messageId} 的评论 ${req.params.commentId}`)
  }
  res.status(result.code === 'NOT_FOUND' ? 404 : (result.success ? 200 : 409)).json(result)
}))

adminRouter.post('/trash/bulk', requireAdmin, asyncRoute(async (req, res) => {
  if (!hasPermission(req.adminPermissions, 'manage_wall_message')) {
    res.status(403).json({ success: false, error: '无权批量处理回收站' })
    return
  }
  const action = String(req.body?.action || '')
  if (!['restore', 'purge'].includes(action)) {
    res.status(400).json({ success: false, error: '批量操作无效' })
    return
  }
  if (action === 'purge' && req.body?.confirm !== 'PURGE') {
    res.status(400).json({ success: false, error: '彻底删除确认无效' })
    return
  }
  const targets = Array.isArray(req.body?.targets) ? req.body.targets : []
  const uniqueTargets = [...new Map(targets.map((target) => {
    const type = target?.type === 'comment' ? 'comment' : 'message'
    const messageId = Number(target?.message_id)
    const commentId = type === 'comment' ? String(target?.comment_id || target?.id || '') : ''
    return [`${type}:${messageId}:${commentId}`, { type, messageId, commentId }]
  })).values()].filter((target) => Number.isSafeInteger(target.messageId) && target.messageId > 0 && (target.type === 'message' || /^[a-zA-Z0-9_-]{1,80}$/.test(target.commentId)))
  if (!uniqueTargets.length || uniqueTargets.length > 100) {
    res.status(400).json({ success: false, error: '请选择 1 至 100 条回收站内容' })
    return
  }

  const results = []
  for (const target of uniqueTargets) {
    let result
    if (target.type === 'message') {
      result = action === 'restore'
        ? await messageStore.restoreMessage(target.messageId, { restoredBy: req.adminUser })
        : await messageStore.purgeMessage(target.messageId)
      if (action === 'purge' && result.success) cleanupUnreferencedFiles(messageStore.attachedFiles(result.purged_message))
      if (action === 'restore' && result.success && result.message?.user_id) {
        await userStore.createNotification({
          userId: result.message.user_id,
          type: 'moderation',
          messageId: target.messageId,
          content: result.message.moderation_status === 'visible' ? '你的留言已从回收站恢复并重新公开' : '你的留言已从回收站恢复'
        })
      }
    } else {
      result = action === 'restore'
        ? await messageStore.restoreComment(target.messageId, target.commentId, { restoredBy: req.adminUser })
        : await messageStore.purgeComment(target.messageId, target.commentId)
      if (action === 'purge' && result.success) cleanupUnreferencedFiles(result.purged_comment?.files || [])
      if (action === 'restore' && result.success && result.comment?.user_id) {
        await userStore.createNotification({
          userId: result.comment.user_id,
          type: 'comment_moderation',
          messageId: target.messageId,
          content: result.comment.moderation_status === 'visible' ? '你的评论已从回收站恢复并重新公开' : '你的评论已从回收站恢复'
        })
      }
    }
    results.push({ type: target.type, message_id: target.messageId, comment_id: target.commentId, success: Boolean(result.success), error: result.error || '' })
  }
  const succeeded = results.filter((item) => item.success).length
  appendAdminLog(`${nowText()}    ${req.adminUser} 批量${action === 'restore' ? '恢复' : '彻底删除'}回收站内容：成功 ${succeeded}/${uniqueTargets.length}`)
  res.json({ success: succeeded > 0, succeeded, failed: uniqueTargets.length - succeeded, results })
}))

adminRouter.post('/delete_message/:messageId', requireAdmin, asyncRoute(async (req, res) => {
  if (!hasPermission(req.adminPermissions, 'manage_wall_message')) {
    res.status(403).json({ success: false, error: '无权限' })
    return
  }
  const messageId = Number(req.params.messageId)
  const pendingReports = reportStore.pending()[String(messageId)] || []
  const result = await messageStore.deleteMessage(messageId, {
    deletedBy: req.adminUser,
    reason: String(req.body?.reason || '管理员删除').trim().slice(0, 200),
    origin: 'admin'
  })
  if (result.success) {
    delete result.deleted_message
    if (pendingReports.length) {
      reportStore.archive(messageId, pendingReports, {
        resolution: 'delete_message',
        processedBy: req.adminUser
      })
    }
  }
  if (result.success) appendAdminLog(`${nowText()}    ${req.adminUser} 将校园墙消息 ${messageId} 移入回收站`)
  res.json(result)
}))

adminRouter.post('/messages/:messageId/moderation', requireAdmin, asyncRoute(async (req, res) => {
  if (!hasPermission(req.adminPermissions, 'manage_wall_message')) {
    res.status(403).json({ success: false, error: '无权限' })
    return
  }
  const messageId = Number(req.params.messageId)
  const current = messageStore.getMessage(messageId)
  if (!current) {
    res.status(404).json({ success: false, error: '消息不存在' })
    return
  }
  const update = {}
  if (typeof req.body?.pinned === 'boolean') update.pinned = req.body.pinned
  if (typeof req.body?.featured === 'boolean') update.featured = req.body.featured
  if (typeof req.body?.hidden === 'boolean') {
    update.hidden = req.body.hidden
    update.hiddenReason = String(req.body?.hidden_reason || '').trim().slice(0, 200)
  }
  if (Object.keys(update).length === 0) {
    res.status(400).json({ success: false, error: '没有可更新的管理状态' })
    return
  }
  const result = await messageStore.setModerationState(messageId, update)
  if (result.success) {
    const actions = []
    if (typeof update.pinned === 'boolean') actions.push(update.pinned ? '置顶' : '取消置顶')
    if (typeof update.featured === 'boolean') actions.push(update.featured ? '设为精华' : '取消精华')
    if (typeof update.hidden === 'boolean') actions.push(update.hidden
      ? `下架（${result.message.hidden_reason}）`
      : (result.message.moderation_status === 'visible' ? '恢复展示' : '恢复为待审核'))
    appendAdminLog(`${nowText()}    ${req.adminUser} 对消息 ${messageId} 执行：${actions.join('、')}`)
    if (update.featured === true && current.featured !== true && current.user_id) {
      await userStore.createNotification({
        userId: current.user_id,
        type: 'featured',
        messageId,
        content: '你的留言已被管理员设为精华内容'
      })
    }
    if (typeof update.hidden === 'boolean' && current.moderation_status !== result.message.moderation_status && current.user_id) {
      await userStore.createNotification({
        userId: current.user_id,
        type: 'moderation',
        messageId,
        content: update.hidden
          ? `你的留言已被管理员下架：${result.message.hidden_reason}`
          : (result.message.moderation_status === 'visible' ? '你的留言已恢复公开展示' : '你的留言已恢复为待审核状态')
      })
    }
  }
  res.json(result)
}))

adminRouter.post('/api/delete_comment/:messageId/:commentId', requireAdmin, asyncRoute(async (req, res) => {
  if (!hasPermission(req.adminPermissions, 'manage_wall_message')) {
    res.status(403).json({ success: false, error: '无权限' })
    return
  }
  const result = await messageStore.deleteComment(Number(req.params.messageId), req.params.commentId, {
    deletedBy: req.adminUser,
    reason: String(req.body?.reason || '管理员删除').trim().slice(0, 200),
    origin: 'admin'
  })
  if (result.success) {
    if (result.comment?.user_id) {
      await userStore.createNotification({
        userId: result.comment.user_id,
        type: 'comment_moderation',
        messageId: Number(req.params.messageId),
        content: '你的评论已被管理员移入回收站'
      })
    }
    delete result.comment
    const pendingReports = reportStore.pending()[String(req.params.messageId)] || []
    const matchingReports = pendingReports.filter((item) => (
      item.target_type === 'comment' && String(item.comment_id) === String(req.params.commentId)
    ))
    if (matchingReports.length) {
      reportStore.archive(req.params.messageId, matchingReports, {
        resolution: 'delete_comment',
        processedBy: req.adminUser
      })
    }
    appendAdminLog(`${nowText()}    ${req.adminUser} 将消息 ${req.params.messageId} 的评论 ${req.params.commentId} 移入回收站`)
  }
  res.json(result)
}))

adminRouter.get('/comments', requireAdmin, asyncRoute(async (req, res) => {
  if (!hasPermission(req.adminPermissions, 'manage_wall_message')) {
    res.status(403).json({ success: false, error: '无权查看评论管理数据' })
    return
  }
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
  const pageSize = Math.max(1, Math.min(100, Math.floor(Number(req.query.page_size) || 20)))
  const requestedStatus = String(req.query.status || 'all')
  const status = ['all', 'visible', 'hidden'].includes(requestedStatus) ? requestedStatus : 'all'
  const allComments = messageStore.getComments({ status: 'all', word: req.query.q || '' })
  const counts = {
    all: allComments.length,
    visible: allComments.filter((comment) => messageStore.isPublicComment(comment)).length,
    hidden: allComments.filter((comment) => !messageStore.isPublicComment(comment)).length
  }
  const comments = status === 'all'
    ? allComments
    : allComments.filter((comment) => status === 'visible' ? messageStore.isPublicComment(comment) : !messageStore.isPublicComment(comment))
  const total = comments.length
  const offset = (page - 1) * pageSize
  const pageComments = await Promise.all(comments.slice(offset, offset + pageSize).map(enrichCommentUser))
  res.json({
    success: true,
    comments: pageComments,
    page,
    page_size: pageSize,
    total,
    total_pages: Math.ceil(total / pageSize),
    status,
    counts
  })
}))

adminRouter.post('/comments/:messageId/:commentId/moderation', requireAdmin, asyncRoute(async (req, res) => {
  if (!hasPermission(req.adminPermissions, 'manage_wall_message')) {
    res.status(403).json({ success: false, error: '无权管理评论' })
    return
  }
  if (typeof req.body?.hidden !== 'boolean') {
    res.status(400).json({ success: false, error: '没有可更新的评论状态' })
    return
  }
  const result = await applyCommentModeration({
    messageId: Number(req.params.messageId),
    commentId: req.params.commentId,
    hidden: req.body.hidden,
    hiddenReason: String(req.body?.hidden_reason || '').trim().slice(0, 200),
    reviewer: req.adminUser
  })
  if (result.success && result.changed) {
    appendAdminLog(`${nowText()}    ${req.adminUser} ${req.body.hidden ? '下架' : '恢复'}消息 ${req.params.messageId} 的评论 ${req.params.commentId}`)
  }
  res.status(result.statusCode || 200).json(result)
}))

adminRouter.post('/comments/bulk-moderation', requireAdmin, asyncRoute(async (req, res) => {
  if (!hasPermission(req.adminPermissions, 'manage_wall_message')) {
    res.status(403).json({ success: false, error: '无权管理评论' })
    return
  }
  const action = String(req.body?.action || '')
  if (!['hide', 'restore'].includes(action)) {
    res.status(400).json({ success: false, error: '批量评论操作无效' })
    return
  }
  const targets = Array.isArray(req.body?.targets) ? req.body.targets : []
  const uniqueTargets = [...new Map(targets.map((target) => {
    const messageId = Number(target?.message_id)
    const commentId = String(target?.comment_id || '')
    return [`${messageId}:${commentId}`, { messageId, commentId }]
  })).values()].filter((target) => Number.isSafeInteger(target.messageId) && target.messageId > 0 && /^[a-zA-Z0-9_-]{1,80}$/.test(target.commentId))
  if (!uniqueTargets.length || uniqueTargets.length > 100) {
    res.status(400).json({ success: false, error: '请选择 1 至 100 条评论' })
    return
  }
  const hiddenReason = String(req.body?.hidden_reason || '违反社区规范').trim().slice(0, 200) || '违反社区规范'
  const results = []
  for (const target of uniqueTargets) {
    const result = await applyCommentModeration({
      ...target,
      hidden: action === 'hide',
      hiddenReason,
      reviewer: req.adminUser
    })
    results.push({ message_id: target.messageId, comment_id: target.commentId, success: Boolean(result.success), error: result.error || '' })
  }
  const succeeded = results.filter((item) => item.success).length
  appendAdminLog(`${nowText()}    ${req.adminUser} 批量${action === 'hide' ? '下架' : '恢复'}评论：成功 ${succeeded}/${uniqueTargets.length}`)
  res.json({ success: succeeded > 0, succeeded, failed: uniqueTargets.length - succeeded, results })
}))

adminRouter.post('/api/delete_report/:messageId/:reportId', requireAdmin, (req, res) => {
  if (!hasPermission(req.adminPermissions, 'view_report')) {
    res.status(403).json({ success: false, error: '无权限' })
    return
  }
  const reports = reportStore.pending()
  const items = reports[req.params.messageId] || []
  const report = items.find((item) => item.id === req.params.reportId)
  if (!report) {
    res.json({ success: false, error: '举报不存在' })
    return
  }
  reportStore.archive(req.params.messageId, [report], {
    resolution: 'dismiss',
    processedBy: req.adminUser
  })
  res.json({ success: true })
})

adminRouter.get('/api/messages', requireAdmin, asyncRoute(async (req, res) => {
  if (!canReviewPosts(req)) {
    res.status(403).json({ success: false, error: '无权查看留言管理数据' })
    return
  }
  const reviewOnly = isReviewOnly(req)
  const pageSize = Math.max(1, Math.min(Number(req.query.page_size) || 20, 100))
  const page = Math.max(Number(req.query.page || 1), 1)
  const allowedStatuses = reviewOnly
    ? new Set(['pending', 'approved', 'awaiting_publication'])
    : new Set(['pending', 'approved', 'visible', 'hidden', 'awaiting_publication', 'all'])
  const legacyShowAll = String(req.query.show_all) === 'true'
  const requestedStatus = String(req.query.status || (legacyShowAll ? 'all' : 'pending'))
  if (!allowedStatuses.has(requestedStatus)) {
    res.status(403).json({ success: false, error: '审核员只能查看待审核与已审核队列' })
    return
  }
  const status = allowedStatuses.has(requestedStatus) ? requestedStatus : 'pending'
  let messages = messageStore.getMessages({
    likeList: messageStore.parseCookieIds(req.cookies?.likes || ''),
    dislikeList: messageStore.parseCookieIds(req.cookies?.dislikes || ''),
    word: req.query.q || '',
    filterType: 'all',
    includeHidden: true
  })
  if (reviewOnly) messages = messages.filter(isReviewQueueMessage)
  if (status === 'pending') messages = messages.filter((message) => message.review_status !== 'approved')
  if (status === 'approved') messages = messages.filter((message) => message.review_status === 'approved')
  if (status === 'visible') messages = messages.filter((message) => message.moderation_status === 'visible')
  if (status === 'hidden') messages = messages.filter((message) => message.moderation_status === 'hidden')
  if (status === 'awaiting_publication') messages = messages.filter((message) => message.moderation_status === 'pending')
  const total = messages.length
  const totalPages = Math.ceil(messages.length / pageSize)
  const pageItems = messages.slice((page - 1) * pageSize, page * pageSize)
  const pageMessages = reviewOnly
    ? pageItems.map((message) => redactReviewIdentity(message))
    : (await Promise.all(pageItems.map(enrichMessageUser)))
        .map((message) => withReviewCapabilities(message))
  const counts = reviewOnly
    ? reviewQueueCounts(messageStore.getMessages({ includeHidden: true }).filter(isReviewQueueMessage))
    : messageStore.reviewStatusCounts()
  res.json({
    success: true,
    messages: pageMessages,
    page,
    page_size: pageSize,
    total,
    total_pages: totalPages,
    status,
    counts
  })
}))

adminRouter.get('/api/get_message/:messageId', requireAdmin, asyncRoute(async (req, res) => {
  const reviewAccess = canReviewPosts(req)
  if (!reviewAccess && !hasPermission(req.adminPermissions, 'view_report')) {
    res.status(403).json({ success: false, error: '无权查看留言管理详情' })
    return
  }
  const message = messageStore.getMessage(Number(req.params.messageId), messageStore.parseCookieIds(req.cookies?.likes || ''), messageStore.parseCookieIds(req.cookies?.dislikes || ''))
  if (!message) {
    res.status(404).json({ success: false, error: '留言不存在' })
    return
  }
  if (isReviewOnly(req) && !isReviewQueueMessage(message)) {
    res.status(404).json({ success: false, error: '审核队列中不存在该留言' })
    return
  }
  res.json(isReviewOnly(req)
    ? redactReviewIdentity(message)
    : withReviewCapabilities(await enrichMessageUser(message)))
}))

adminRouter.get('/api/approved_ids', requireAdmin, (req, res) => {
  if (!hasPermission(req.adminPermissions, 'manage_wall_message')) {
    res.status(403).json({ success: false, error: '无权查看审核状态' })
    return
  }
  res.json(messageStore.approvedMessageIds())
})

adminRouter.post('/approve_message/:messageId', requireAdmin, asyncRoute(async (req, res) => {
  if (!hasPermission(req.adminPermissions, 'manage_wall_message')) {
    res.status(403).json({ success: false, error: '无权限' })
    return
  }
  const messageId = Number(req.params.messageId)
  const current = messageStore.getMessage(messageId)
  if (!current) {
    res.status(404).json({ success: false, error: '消息不存在' })
    return
  }
  const approved = current.review_status !== 'approved'
  const result = await applyReviewState({ messageId, approved, reviewer: req.adminUser })
  if (result.success) {
    appendAdminLog(`${nowText()}    ${req.adminUser} ${approved ? '通过审核' : '退回待审'}消息 ${messageId}`)
  }
  res.status(result.statusCode || 200).json({ ...result, action: approved ? '消息已通过审核' : '消息已退回待审' })
}))

adminRouter.post('/messages/:messageId/review', requireAdmin, asyncRoute(async (req, res) => {
  if (!canReviewPosts(req)) {
    res.status(403).json({ success: false, error: '无权限' })
    return
  }
  const action = String(req.body?.action || '')
  if (!['approve', 'return'].includes(action)) {
    res.status(400).json({ success: false, error: '审核操作无效' })
    return
  }
  const messageId = Number(req.params.messageId)
  const current = messageStore.getMessage(messageId)
  if (!current) {
    res.status(404).json({ success: false, error: '消息不存在' })
    return
  }
  if (isReviewOnly(req) && !isReviewQueueMessage(current)) {
    res.status(403).json({ success: false, error: '审核员不能处理已下架或已删除留言' })
    return
  }
  const result = await applyReviewState({
    messageId,
    approved: action === 'approve',
    reviewer: req.adminUser
  })
  if (result.success) appendAdminLog(`${nowText()}    ${req.adminUser} ${action === 'approve' ? '通过审核' : '退回待审'}消息 ${messageId}`)
  const response = result.message
    ? {
        ...result,
        message: isReviewOnly(req)
          ? redactReviewIdentity(result.message)
          : withReviewCapabilities(result.message)
      }
    : result
  res.status(result.statusCode || 200).json(response)
}))

adminRouter.post('/messages/bulk-moderation', requireAdmin, asyncRoute(async (req, res) => {
  if (!canReviewPosts(req)) {
    res.status(403).json({ success: false, error: '无权限' })
    return
  }
  const action = String(req.body?.action || '')
  if (!['approve', 'return', 'hide', 'restore'].includes(action)) {
    res.status(400).json({ success: false, error: '批量操作无效' })
    return
  }
  if (['hide', 'restore'].includes(action) && !canManageWall(req)) {
    res.status(403).json({ success: false, error: '审核员只能批量通过或退回留言' })
    return
  }
  const messageIds = [...new Set((Array.isArray(req.body?.message_ids) ? req.body.message_ids : [])
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0))]
  if (!messageIds.length || messageIds.length > 100) {
    res.status(400).json({ success: false, error: '请选择 1 至 100 条留言' })
    return
  }
  const hiddenReason = String(req.body?.hidden_reason || '违反社区规范').trim().slice(0, 200) || '违反社区规范'
  const results = []
  for (const messageId of messageIds) {
    const current = messageStore.getMessage(messageId)
    if (!current) {
      results.push({ id: messageId, success: false, error: '消息不存在' })
      continue
    }
    if (isReviewOnly(req) && !isReviewQueueMessage(current)) {
      results.push({ id: messageId, success: false, error: '不能处理已下架或已删除留言' })
      continue
    }
    let result
    if (action === 'approve' || action === 'return') {
      result = await applyReviewState({
        messageId,
        approved: action === 'approve',
        reviewer: req.adminUser
      })
    } else {
      result = await messageStore.setModerationState(messageId, {
        hidden: action === 'hide',
        hiddenReason
      })
      if (result.success && current.user_id && current.moderation_status !== result.message.moderation_status) {
        await userStore.createNotification({
          userId: current.user_id,
          type: 'moderation',
          messageId,
          content: action === 'hide'
            ? `你的留言已被管理员下架：${result.message.hidden_reason}`
            : (result.message.moderation_status === 'visible' ? '你的留言已恢复公开展示' : '你的留言已恢复为待审核状态')
        })
      }
    }
    results.push({ id: messageId, success: Boolean(result.success), error: result.error || '' })
  }
  const succeeded = results.filter((item) => item.success).length
  appendAdminLog(`${nowText()}    ${req.adminUser} 批量${action}留言：成功 ${succeeded}/${messageIds.length}`)
  res.json({ success: succeeded > 0, succeeded, failed: messageIds.length - succeeded, results })
}))

adminRouter.post('/repair_message/:messageId', requireAdmin, (req, res) => {
  if (!hasPermission(req.adminPermissions, 'manage_wall_message')) {
    res.status(403).json({ success: false, error: '无权修复留言媒体' })
    return
  }
  const message = messageStore.getMessage(Number(req.params.messageId))
  if (!message) {
    res.json({ success: false, error: '消息不存在' })
    return
  }
  if (message.files?.length) makeTinyFiles(message.files).catch(() => {})
  appendAdminLog(`${nowText()}    ${req.adminUser}修复了消息 ${req.params.messageId}`)
  res.json({ success: true, errors: [] })
})

adminRouter.get('/notice', requireAdmin, (req, res) => {
  if (!hasPermission(req.adminPermissions, 'notice')) {
    res.status(403).json({ success: false, error: '无权查看公告管理数据' })
    return
  }
  res.json({ success: true, content: readNotices({ ensureIds: true }), max_length: config.maxTextLength })
})

adminRouter.post('/notice', requireAdmin, noticeForm, (req, res) => {
  if (!hasPermission(req.adminPermissions, 'notice')) {
    res.status(403).json({ success: false, error: '无权限' })
    return
  }
  const content = String(req.body.text || '').trim()
  if (!content) {
    res.status(400).json({ success: false, error: '公告内容不能为空' })
    return
  }
  if (content.length > config.maxTextLength) {
    res.status(400).json({ success: false, error: `公告内容不能超过 ${config.maxTextLength} 个字符` })
    return
  }
  const notices = readNotices({ ensureIds: true })
  const notice = {
    id: createNoticeId(),
    timestamp: nowText(),
    user: noticeActor(req),
    author_role: req.adminRole,
    content
  }
  notices.push(notice)
  writeNotices(notices)
  req.auditTargetId = notice.id
  res.status(201).json({ success: true, notice })
})

adminRouter.put('/notice/:noticeId', requireAdmin, noticeForm, (req, res) => {
  if (!hasPermission(req.adminPermissions, 'notice')) {
    res.status(403).json({ success: false, error: '无权限' })
    return
  }
  const content = String(req.body.text || '').trim()
  if (content.length > config.maxTextLength) {
    res.status(400).json({ success: false, error: `公告内容不能超过 ${config.maxTextLength} 个字符` })
    return
  }
  if (!content) {
    res.status(400).json({ success: false, error: '公告内容不能为空' })
    return
  }
  const notices = readNotices({ ensureIds: true })
  const index = resolveNoticeIndex(notices, req.params.noticeId)
  if (index < 0) {
    res.status(404).json({ success: false, error: '公告不存在' })
    return
  }
  notices[index].content = content
  notices[index].updated_at = nowText()
  notices[index].updated_by = noticeActor(req)
  notices[index].updated_by_role = req.adminRole
  writeNotices(notices)
  res.json({ success: true, notice: notices[index] })
})

adminRouter.delete('/notice/:noticeId', requireAdmin, (req, res) => {
  if (!hasPermission(req.adminPermissions, 'notice')) {
    res.status(403).json({ success: false, error: '无权限' })
    return
  }
  const notices = readNotices({ ensureIds: true })
  const index = resolveNoticeIndex(notices, req.params.noticeId)
  if (index < 0) {
    res.status(404).json({ success: false, error: '公告不存在' })
    return
  }
  const [notice] = notices.splice(index, 1)
  req.auditMetadata = {
    notice_timestamp: String(notice.timestamp || ''),
    notice_preview: String(notice.content || '').slice(0, 200)
  }
  writeNotices(notices)
  res.json({ success: true, notice })
})
