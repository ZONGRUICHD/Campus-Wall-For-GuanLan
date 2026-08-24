import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'
import { managerStore } from './managerStore.js'

export const sessionCookieName = 'admin_session'
const sessionPassword = '__signed_session__'

const base64url = (value) => Buffer.from(value).toString('base64url')

const sign = (payload) => createHmac('sha256', config.secretKey).update(payload).digest('base64url')

export const createSession = (adminUser) => {
  const manager = managerStore.get(adminUser)
  const payload = base64url(JSON.stringify({
    admin_user: adminUser,
    session_version: Number(manager?.session_version || 0),
    exp: Date.now() + config.sessionMaxAge * 1000
  }))
  return `${payload}.${sign(payload)}`
}

export const readSession = (req) => {
  const raw = req.cookies?.[sessionCookieName]
  if (!raw || !raw.includes('.')) return ['', '', 0]
  const [payload, signature] = raw.split('.')
  const expected = sign(payload)
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return ['', '', 0]
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!Number.isFinite(Number(data.exp)) || Number(data.exp) < Date.now()) return ['', '', 0]
    return [data.admin_user || '', sessionPassword, Number(data.session_version || 0)]
  } catch {
    return ['', '', 0]
  }
}

export const managers = () => managerStore.load()

export const verifyAdmin = (name, password, sessionVersion = 0) => password === sessionPassword
  ? managerStore.verifySession(name, sessionVersion)
  : managerStore.verifyPassword(name, password)

export const getPermissions = (name) => managerStore.get(name)?.permissions || []

export const hasPermission = (permissions, name) => (Array.isArray(permissions) ? permissions : []).some((permission) => permission.name === name)

const normalizeOrigin = (value = '') => String(value).trim().replace(/\/+$/, '')

const requestOrigin = (req) => {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim()
  return normalizeOrigin(`${proto}://${req.headers.host || ''}`)
}

const submittedOrigin = (req) => {
  const origin = req.headers.origin
  if (origin) return normalizeOrigin(origin)
  const referer = req.headers.referer
  if (!referer) return ''
  try {
    return normalizeOrigin(new URL(referer).origin)
  } catch {
    return ''
  }
}

export const isTrustedAdminOrigin = (req) => {
  const origin = submittedOrigin(req)
  if (!origin) return true
  return origin === requestOrigin(req) || config.allowedOrigins.includes(origin)
}

export const requireTrustedOrigin = (req, res, next) => {
  if (!isTrustedAdminOrigin(req)) {
    res.status(403).json({ success: false, error: 'Invalid request origin' })
    return
  }
  next()
}

export const requireAdmin = (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !isTrustedAdminOrigin(req)) {
    res.status(403).json({ success: false, error: 'Invalid request origin' })
    return
  }
  const [adminUser, adminPassword, sessionVersion] = readSession(req)
  if (!verifyAdmin(adminUser, adminPassword, sessionVersion)) {
    res.status(401).json({ success: false, error: '请先登录' })
    return
  }
  req.adminUser = adminUser
  req.adminManager = managerStore.get(adminUser)
  req.adminPermissions = getPermissions(adminUser)
  next()
}

export const adminCookieOptions = () => ({
  maxAge: config.sessionMaxAge * 1000,
  path: '/',
  httpOnly: true,
  sameSite: config.sessionCookieSameSite.toLowerCase(),
  secure: config.sessionCookieSecure
})
