import { config } from '../config.js'
import { userCookieOptions, userSessionCookieName, userStore } from './userStore.js'
import { canAccessAdmin, hasCapability as accountHasCapability } from './roles.js'

export const sessionCookieName = 'admin_session'

export const createSession = (user, sessionVersion = 0) => userStore.createSession(user, sessionVersion)

export const readSession = (req) => userStore.readSessionPayload(req, sessionCookieName)

export const hasPermission = (permissions, name) => (Array.isArray(permissions) ? permissions : [])
  .some((permission) => permission.name === name)

export const hasCapability = (capabilities, name) => accountHasCapability(capabilities, name)

export const authenticatedAccount = (req) => userStore.getSessionUser(req, {
  cookieNames: [sessionCookieName, userSessionCookieName]
})

export const authenticatedAdmin = async (req) => {
  const user = await authenticatedAccount(req)
  if (!user || !canAccessAdmin(user)) return null
  return {
    username: user.username,
    user,
    manager: user,
    role: user.role,
    permissions: user.permissions || [],
    capabilities: user.capabilities || []
  }
}

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

export const requireAdmin = async (req, res, next) => {
  try {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !isTrustedAdminOrigin(req)) {
      res.status(403).json({ success: false, error: 'Invalid request origin' })
      return
    }
    const admin = await authenticatedAdmin(req)
    if (!admin) {
      res.status(401).json({ success: false, error: '请先登录' })
      return
    }
    req.adminUser = admin.username
    req.adminAccount = admin.user
    req.adminManager = admin.user
    req.adminRole = admin.role
    req.adminPermissions = admin.permissions
    req.adminCapabilities = admin.capabilities
    next()
  } catch (error) {
    next(error)
  }
}

export const adminCookieOptions = () => userCookieOptions()
