import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { settingsStore } from './settingsStore.js'

const endpoints = Object.freeze({
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify'
})

const normalizeHostname = (value) => String(value || '').trim().toLowerCase().replace(/\.$/, '')

const actionIsProtected = (settings, action) => {
  if (action === 'login') return settings.protect_login !== false
  if (action === 'register') return settings.protect_register !== false
  if (action === 'admin_login') return settings.protect_admin_login !== false
  return true
}

export const verifyCaptchaToken = async ({
  token,
  remoteIp = '',
  expectedAction = '',
  settings,
  fetchImpl = globalThis.fetch
}) => {
  const responseToken = String(token || '').trim()
  if (!responseToken) return { success: false, error: '请先完成人机验证', code: 'CAPTCHA_REQUIRED' }
  if (responseToken.length > 2048) return { success: false, error: '人机验证令牌无效', code: 'CAPTCHA_TOKEN_INVALID' }
  if (!settings?.site_key || !settings?.secret_key || !endpoints[settings?.provider]) {
    return { success: false, error: '人机验证配置不完整，请联系管理员', code: 'CAPTCHA_NOT_CONFIGURED' }
  }
  if (typeof fetchImpl !== 'function') {
    return { success: false, error: '人机验证服务暂时不可用，请稍后重试', code: 'CAPTCHA_SERVICE_UNAVAILABLE' }
  }

  const body = new URLSearchParams({
    secret: settings.secret_key,
    response: responseToken,
    idempotency_key: randomUUID()
  })
  if (remoteIp) body.set('remoteip', remoteIp)

  try {
    const response = await fetchImpl(endpoints[settings.provider], {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(config.captchaTimeoutMs)
    })
    if (!response.ok) {
      return { success: false, error: '人机验证服务暂时不可用，请稍后重试', code: 'CAPTCHA_UPSTREAM_ERROR' }
    }
    const result = await response.json()
    if (!result?.success) {
      return {
        success: false,
        error: '人机验证未通过，请刷新后重试',
        code: 'CAPTCHA_REJECTED',
        upstream_codes: Array.isArray(result?.['error-codes']) ? result['error-codes'].map(String).slice(0, 5) : []
      }
    }

    const action = String(result.action || '')
    if (settings.provider === 'turnstile' && expectedAction && action !== expectedAction) {
      return { success: false, error: '人机验证用途不匹配，请刷新后重试', code: 'CAPTCHA_ACTION_MISMATCH' }
    }

    const hostname = normalizeHostname(result.hostname)
    const allowedHostnames = new Set((settings.allowed_hostnames || []).map(normalizeHostname).filter(Boolean))
    if (settings.provider === 'turnstile' && allowedHostnames.size > 0 && !allowedHostnames.has(hostname)) {
      return { success: false, error: '人机验证来源不匹配，请刷新后重试', code: 'CAPTCHA_HOSTNAME_MISMATCH' }
    }

    return {
      success: true,
      provider: settings.provider,
      action,
      hostname,
      challenge_ts: result.challenge_ts || null
    }
  } catch {
    return { success: false, error: '人机验证服务暂时不可用，请稍后重试', code: 'CAPTCHA_SERVICE_UNAVAILABLE' }
  }
}

export const verifyCaptcha = async (token, req, { action = '', force = false } = {}) => {
  const settings = await settingsStore.captchaRuntime()
  if (!force && (!settings.enabled || settings.provider === 'none' || !actionIsProtected(settings, action))) {
    return { success: true, skipped: true }
  }
  if (force && (settings.provider === 'none' || !settings.configured)) {
    return { success: false, error: '请先保存完整的人机验证配置', code: 'CAPTCHA_NOT_CONFIGURED' }
  }
  return verifyCaptchaToken({
    token,
    remoteIp: req?.ip || '',
    expectedAction: action,
    settings
  })
}
