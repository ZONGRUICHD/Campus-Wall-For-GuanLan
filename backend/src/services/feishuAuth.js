import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'

export const feishuOauthCookieName = 'feishu_oauth'
const stateTtlMs = 10 * 60 * 1000
const maxMemberPages = 50
const openApiBase = 'https://open.feishu.cn'
const authorizeBase = 'https://accounts.feishu.cn'
const appIdPattern = /^cli_[a-zA-Z0-9]{8,64}$/
const chatIdPattern = /^oc_[a-zA-Z0-9]{8,64}$/

export class FeishuAuthError extends Error {
  constructor(reason = 'oauth_failed') {
    super(reason)
    this.name = 'FeishuAuthError'
    this.reason = reason
  }
}

const defaultFetch = (...args) => globalThis.fetch(...args)

const hmac = (payload, secretKey) => createHmac('sha256', `feishu-oauth:${secretKey}`).update(payload).digest('base64url')

const equal = (left, right) => {
  const actual = Buffer.from(String(left || ''))
  const expected = Buffer.from(String(right || ''))
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export const isValidFeishuAppId = (value = '') => appIdPattern.test(String(value || '').trim())
export const isValidFeishuChatId = (value = '') => chatIdPattern.test(String(value || '').trim())
export const isAllowedFeishuRedirectUri = (value = '') => {
  try {
    const url = new URL(String(value || '').trim())
    if (!['http:', 'https:'].includes(url.protocol)) return false
    if (url.username || url.password || url.hash) return false
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) return false
    return url.pathname.replace(/\/+$/, '') === '/api/user/feishu/callback'
  } catch {
    return false
  }
}

export const safeNextPath = (value = '') => {
  const raw = String(value || '').trim()
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /[^\u0020-\u007E]/.test(raw)) return '/me'
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return '/me'
  }
  if (decoded.includes('://') || decoded.includes('\\') || decoded.startsWith('//')) return '/me'
  try {
    const url = new URL(decoded, 'https://wall.zongtech.xyz')
    if (url.origin !== 'https://wall.zongtech.xyz') return '/me'
    const path = `${url.pathname}${url.search}${url.hash}` || '/me'
    if (path.startsWith('/login') || path.startsWith('/admin')) return '/me'
    return path
  } catch {
    return '/me'
  }
}

export function createFeishuAuth({
  fetchFn = defaultFetch,
  nowFn = Date.now,
  timeoutMs = config.feishuTimeoutMs,
  readConfig = () => ({
    secretKey: config.secretKey,
    publicSiteUrl: config.publicSiteUrl,
    allowedOrigins: config.allowedOrigins,
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    chatId: config.feishuLoginChatId,
    redirectUri: config.feishuRedirectUri,
    timeoutMs: config.feishuTimeoutMs
  })
} = {}) {
  let tenantCache = null

  const settings = () => {
    const current = readConfig()
    return {
      secretKey: current.secretKey || config.secretKey,
      publicSiteUrl: String(current.publicSiteUrl || '').trim().replace(/\/+$/, ''),
      allowedOrigins: Array.isArray(current.allowedOrigins) ? current.allowedOrigins : config.allowedOrigins,
      appId: String(current.appId || '').trim(),
      appSecret: String(current.appSecret || '').trim(),
      chatId: String(current.chatId || '').trim(),
      redirectUri: String(current.redirectUri || '').trim(),
      timeoutMs: Number.isInteger(current.timeoutMs) ? current.timeoutMs : timeoutMs
    }
  }

  const frontendBase = () => {
    const current = settings()
    return current.publicSiteUrl || String(current.allowedOrigins?.[0] || '').trim().replace(/\/+$/, '')
  }

  const isConfigured = () => {
    const current = settings()
    return Boolean(
      isValidFeishuAppId(current.appId)
      && current.appSecret
      && current.appSecret.length >= 8
      && isValidFeishuChatId(current.chatId)
      && isAllowedFeishuRedirectUri(current.redirectUri)
      && frontendBase()
    )
  }

  const createState = (nextPath = '/me') => {
    const options = nextPath && typeof nextPath === 'object' ? nextPath : { next: nextPath }
    const intent = options.intent === 'bind' ? 'bind' : 'login'
    const userId = intent === 'bind' ? (Number.parseInt(String(options.userId || ''), 10) || 0) : 0
    const nonce = randomBytes(16).toString('hex')
    const payload = Buffer.from(JSON.stringify({
      n: nonce,
      next: safeNextPath(options.next),
      exp: nowFn() + stateTtlMs,
      intent,
      uid: userId
    })).toString('base64url')
    return { nonce, state: `${payload}.${hmac(payload, settings().secretKey)}` }
  }

  const parseState = (rawState, expectedNonce) => {
    const value = String(rawState || '')
    const separator = value.lastIndexOf('.')
    if (separator <= 0) return { ok: false, reason: 'invalid_state' }
    const payload = value.slice(0, separator)
    const signature = value.slice(separator + 1)
    if (!equal(signature, hmac(payload, settings().secretKey))) return { ok: false, reason: 'invalid_state' }
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      if (!data?.n || !Number.isFinite(Number(data.exp)) || Number(data.exp) < nowFn()) {
        return { ok: false, reason: 'invalid_state' }
      }
      if (!equal(data.n, expectedNonce)) return { ok: false, reason: 'invalid_state' }
      const intent = data.intent === 'bind' ? 'bind' : 'login'
      const userId = Number.parseInt(String(data.uid || ''), 10) || 0
      if (intent === 'bind' && userId < 1) return { ok: false, reason: 'invalid_state' }
      return { ok: true, next: safeNextPath(data.next), intent, userId }
    } catch {
      return { ok: false, reason: 'invalid_state' }
    }
  }

  const buildAuthorizeUrl = (state) => {
    const current = settings()
    const url = new URL('/open-apis/authen/v1/authorize', authorizeBase)
    url.searchParams.set('client_id', current.appId)
    url.searchParams.set('redirect_uri', current.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state', state)
    return url.toString()
  }

  const frontendUrl = (path = '/me', error = '') => {
    const base = frontendBase()
    if (!base) return ''
    const fallback = String(path || '').startsWith('/me') ? '/me' : '/login'
    const resolved = error ? fallback : safeNextPath(path)
    const url = new URL(resolved, `${base}/`)
    if (error) url.searchParams.set('feishu_error', error)
    return url.toString()
  }

  const requestJson = async (url, { method = 'GET', headers = {}, body } = {}) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), settings().timeoutMs)
    timer.unref?.()
    try {
      const response = await fetchFn(url, {
        method,
        headers,
        body,
        redirect: 'error',
        signal: controller.signal
      })
      if (response.status >= 300 && response.status < 400) throw new FeishuAuthError('oauth_failed')
      const data = await response.json().catch(() => null)
      if (!response.ok || !data || Number(data.code || 0) !== 0) throw new FeishuAuthError('oauth_failed')
      return data
    } catch (error) {
      if (error instanceof FeishuAuthError) throw error
      if (error?.name === 'AbortError') throw new FeishuAuthError('oauth_failed')
      throw new FeishuAuthError('oauth_failed')
    } finally {
      clearTimeout(timer)
    }
  }

  const getTenantAccessToken = async () => {
    const now = nowFn()
    if (tenantCache?.token && tenantCache.expiresAt > now + 15_000) return tenantCache.token
    const current = settings()
    const data = await requestJson(`${openApiBase}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: current.appId, app_secret: current.appSecret })
    })
    const token = String(data.tenant_access_token || '').trim()
    const expire = Math.max(30, Number(data.expire) || 0)
    if (!token) throw new FeishuAuthError('oauth_failed')
    tenantCache = { token, expiresAt: now + expire * 1000 }
    return token
  }

  const exchangeCode = async (code) => {
    const current = settings()
    const data = await requestJson(`${openApiBase}/open-apis/authen/v2/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: current.appId,
        client_secret: current.appSecret,
        code: String(code || ''),
        redirect_uri: current.redirectUri
      })
    })
    const accessToken = String(data.access_token || data.data?.access_token || '').trim()
    if (!accessToken) throw new FeishuAuthError('oauth_failed')
    return accessToken
  }

  const getUserInfo = async (accessToken) => {
    const data = await requestJson(`${openApiBase}/open-apis/authen/v1/user_info`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    const info = data.data && typeof data.data === 'object' ? data.data : data
    const openId = String(info.open_id || '').trim()
    if (!openId || openId.length > 128) throw new FeishuAuthError('oauth_failed')
    return {
      openId,
      userId: String(info.user_id || '').trim().slice(0, 64),
      name: String(info.name || info.en_name || '').trim().slice(0, 40)
    }
  }

  const isCallerInChat = async (accessToken, chatId) => {
    const data = await requestJson(
      `${openApiBase}/open-apis/im/v1/chats/${encodeURIComponent(chatId)}/members/is_in_chat`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    return data.data?.is_in_chat === true
  }

  const memberIdOf = (item) => String(item?.member_id || item?.open_id || item?.user_id || '').trim()

  const findOpenIdInMembers = async (accessToken, chatId, openId) => {
    let pageToken = ''
    for (let page = 0; page < maxMemberPages; page += 1) {
      const url = new URL(`${openApiBase}/open-apis/im/v1/chats/${encodeURIComponent(chatId)}/members`)
      url.searchParams.set('member_id_type', 'open_id')
      url.searchParams.set('page_size', '100')
      if (pageToken) url.searchParams.set('page_token', pageToken)
      const data = await requestJson(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      const items = Array.isArray(data.data?.items) ? data.data.items : []
      if (items.some((item) => memberIdOf(item) === openId)) return true
      if (!data.data?.has_more) return false
      pageToken = String(data.data?.page_token || '')
      if (!pageToken) return false
    }
    return false
  }

  const assertLoginChatMember = async ({ openId }) => {
    const current = settings()
    if (!isValidFeishuChatId(current.chatId) || !openId) return { ok: false, reason: 'not_in_group' }
    const tenantToken = await getTenantAccessToken()
    const botInChat = await isCallerInChat(tenantToken, current.chatId)
    if (!botInChat) return { ok: false, reason: 'not_in_group' }
    const userInChat = await findOpenIdInMembers(tenantToken, current.chatId, openId)
    if (!userInChat) return { ok: false, reason: 'not_in_group' }
    return { ok: true }
  }

  const completeOAuthUser = async (code) => {
    const accessToken = await exchangeCode(code)
    const user = await getUserInfo(accessToken)
    return { ok: true, user }
  }

  const completeLogin = async (code) => {
    const result = await completeOAuthUser(code)
    const membership = await assertLoginChatMember({ openId: result.user.openId })
    if (!membership.ok) return { ok: false, reason: membership.reason }
    return result
  }

  const inviteToLoginChat = async (openId) => {
    const current = settings()
    const targetOpenId = String(openId || '').trim()
    if (!isValidFeishuChatId(current.chatId) || !targetOpenId) return { ok: false, reason: 'join_failed' }
    try {
      const tenantToken = await getTenantAccessToken()
      if (await findOpenIdInMembers(tenantToken, current.chatId, targetOpenId)) {
        return { ok: true, already: true }
      }
      const url = `${openApiBase}/open-apis/im/v1/chats/${encodeURIComponent(current.chatId)}/members?member_id_type=open_id`
      const data = await requestJson(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ id_list: [targetOpenId] })
      })
      const invalid = Array.isArray(data.data?.invalid_id_list)
        ? data.data.invalid_id_list.map((id) => String(id))
        : []
      if (invalid.includes(targetOpenId)) return { ok: false, reason: 'join_failed' }
      return { ok: true }
    } catch {
      try {
        const tenantToken = await getTenantAccessToken()
        if (await findOpenIdInMembers(tenantToken, current.chatId, targetOpenId)) {
          return { ok: true, already: true }
        }
      } catch {
        // keep join_failed
      }
      return { ok: false, reason: 'join_failed' }
    }
  }

  const resetCaches = () => {
    tenantCache = null
  }

  return {
    isConfigured,
    createState,
    parseState,
    buildAuthorizeUrl,
    frontendUrl,
    frontendBase,
    completeOAuthUser,
    completeLogin,
    inviteToLoginChat,
    assertLoginChatMember,
    resetCaches
  }
}

export const feishuAuth = createFeishuAuth()

export const feishuOauthCookieOptions = () => ({
  maxAge: stateTtlMs,
  path: '/',
  httpOnly: true,
  sameSite: String(config.sessionCookieSameSite || 'Lax').toLowerCase(),
  secure: config.sessionCookieSecure
})
