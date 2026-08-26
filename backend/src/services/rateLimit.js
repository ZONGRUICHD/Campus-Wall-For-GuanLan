import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { config } from '../config.js'

const ipKey = (req) => `ip:${ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown')}`
const uploadByteWindowMs = 15 * 60 * 1000
const uploadByteWindows = new Map()
let lastUploadByteSweep = 0
const concurrentUploadsByIp = new Map()
let concurrentUploadsGlobal = 0

const createLimiter = ({ windowMs, limit, message, keyGenerator = ipKey }) => rateLimit({
  windowMs,
  limit,
  keyGenerator,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  validate: {
    trustProxy: false,
    xForwardedForHeader: false
  },
  handler(req, res) {
    const resetTime = req.rateLimit?.resetTime?.getTime?.()
    res.status(429).json({
      success: false,
      error: message,
      retry_after: Number.isFinite(resetTime) ? Math.max(Math.ceil((resetTime - Date.now()) / 1000), 1) : null
    })
  }
})

const sweepExpiredUploadByteWindows = (now) => {
  if (now - lastUploadByteSweep < uploadByteWindowMs) return
  lastUploadByteSweep = now
  for (const [key, bucket] of uploadByteWindows) {
    if (bucket.resetAt <= now) uploadByteWindows.delete(key)
  }
}

export const consumeUploadBytes = (req, res, byteCount) => {
  const bytes = Number(byteCount)
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    res.status(400).json({ success: false, error: 'Invalid upload size' })
    return false
  }

  const now = Date.now()
  sweepExpiredUploadByteWindows(now)
  const key = ipKey(req)
  let bucket = uploadByteWindows.get(key)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { bytes: 0, resetAt: now + uploadByteWindowMs }
    uploadByteWindows.set(key, bucket)
  }

  if (bucket.bytes + bytes > config.rateLimitUploadBytes) {
    const retryAfter = Math.max(Math.ceil((bucket.resetAt - now) / 1000), 1)
    res.set('Retry-After', String(retryAfter))
    res.status(429).json({
      success: false,
      error: '上传流量过大，请稍后再试',
      retry_after: retryAfter
    })
    return false
  }

  bucket.bytes += bytes
  return true
}

export const uploadConcurrencyLimit = (req, res, next) => {
  const key = ipKey(req)
  const concurrentForIp = concurrentUploadsByIp.get(key) || 0
  if (concurrentForIp >= config.maxConcurrentUploadsPerIp || concurrentUploadsGlobal >= config.maxConcurrentUploadsGlobal) {
    res.set('Retry-After', '1')
    res.status(429).json({
      success: false,
      error: '同时上传任务过多，请稍后再试',
      retry_after: 1
    })
    return
  }

  concurrentUploadsByIp.set(key, concurrentForIp + 1)
  concurrentUploadsGlobal += 1
  let released = false
  const release = () => {
    if (released) return
    released = true
    const remainingForIp = (concurrentUploadsByIp.get(key) || 1) - 1
    if (remainingForIp > 0) concurrentUploadsByIp.set(key, remainingForIp)
    else concurrentUploadsByIp.delete(key)
    concurrentUploadsGlobal = Math.max(concurrentUploadsGlobal - 1, 0)
  }
  res.once('finish', release)
  res.once('close', release)
  res.once('error', release)
  next()
}

export const loginRateLimit = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: config.rateLimitLogin,
  keyGenerator: ipKey,
  message: '登录尝试过于频繁，请稍后再试'
})

export const registerRateLimit = createLimiter({
  windowMs: 60 * 60 * 1000,
  limit: config.rateLimitRegister,
  keyGenerator: ipKey,
  message: '注册尝试过于频繁，请稍后再试'
})

export const contentWriteRateLimit = createLimiter({
  windowMs: 10 * 60 * 1000,
  limit: config.rateLimitWrite,
  message: '发布或评论过于频繁，请稍后再试'
})

export const interactionRateLimit = createLimiter({
  windowMs: 10 * 60 * 1000,
  limit: config.rateLimitInteraction,
  message: '互动操作过于频繁，请稍后再试'
})

export const uploadRateLimit = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: config.rateLimitUpload,
  message: '上传请求过于频繁，请稍后再试'
})

export const feedbackRateLimit = createLimiter({
  windowMs: 30 * 60 * 1000,
  limit: config.rateLimitFeedback,
  message: '提交次数过多，请稍后再试'
})

export const notificationTestRateLimit = createLimiter({
  windowMs: 10 * 60 * 1000,
  limit: config.rateLimitNotificationTest,
  keyGenerator: (req) => `${ipKey(req)}:admin:${String(req.adminUser || 'unknown')}:provider:${String(req.params?.provider || '').trim().toLowerCase()}`,
  message: '测试提醒发送过于频繁，请稍后再试'
})

export const passwordChangeRateLimit = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: config.rateLimitPasswordChange,
  keyGenerator: (req) => {
    const accountId = req.user?.id || req.adminAccount?.id
    return accountId ? `password:${accountId}` : ipKey(req)
  },
  message: '修改密码过于频繁，请稍后再试'
})

export const emailChangeRateLimit = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: config.rateLimitEmail,
  keyGenerator: (req) => {
    const accountId = req.user?.id
    return accountId ? `email:${accountId}` : ipKey(req)
  },
  message: '验证邮件发送过于频繁，请稍后再试'
})
