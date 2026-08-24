import { createHash } from 'node:crypto'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { config } from '../config.js'

const hashedCookie = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 24)

const userOrIpKey = (req) => {
  const session = req.cookies?.user_session
  if (session) return `user:${hashedCookie(session)}`
  return `ip:${ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown')}`
}

const ipKey = (req) => `ip:${ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown')}`

const createLimiter = ({ windowMs, limit, message, keyGenerator = userOrIpKey }) => rateLimit({
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
