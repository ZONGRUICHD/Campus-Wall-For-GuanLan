import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'

const visitorCookieName = 'poll_voter'

const signVisitorId = (id) => createHmac('sha256', `visitor:${config.secretKey}`).update(id).digest('base64url')

export const parseVisitorToken = (raw = '') => {
  const value = String(raw || '')
  const separator = value.lastIndexOf('.')
  if (separator <= 0) return ''
  const id = value.slice(0, separator)
  const signature = value.slice(separator + 1)
  if (!/^[a-f0-9-]{36}$/i.test(id) || !signature) return ''
  const expected = signVisitorId(id)
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return ''
  return id
}

export const createVisitorToken = (id = randomUUID()) => {
  const visitorId = /^[a-f0-9-]{36}$/i.test(id) ? id : randomUUID()
  return { id: visitorId, token: `${visitorId}.${signVisitorId(visitorId)}` }
}

export const visitorKeyFromRequest = (req, res = null, { issue = false, cookieOptions = {} } = {}) => {
  const existing = parseVisitorToken(req.cookies?.[visitorCookieName])
  if (existing) return `guest:${existing}`
  if (!issue || !res) return ''
  const issued = createVisitorToken()
  res.cookie(visitorCookieName, issued.token, cookieOptions)
  return `guest:${issued.id}`
}
