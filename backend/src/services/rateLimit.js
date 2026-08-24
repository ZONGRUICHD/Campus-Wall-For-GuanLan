import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { config } from '../config.js'

const ipKey = (req) => `ip:${ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown')}`
const uploadByteWindowMs = 15 * 60 * 1000
const uploadByteWindows = new Map()
let lastUploadByteSweep = 0

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

export const loginRateLimit = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: config.rateLimitLogin,
  keyGenerator: ipKey,
  message: '登录尝试过于频繁，请稍后再试'
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
