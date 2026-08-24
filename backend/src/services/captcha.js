import { config } from '../config.js'
import { settingsStore } from './settingsStore.js'

const endpoints = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify'
}

export const verifyCaptcha = async (token, req) => {
  const settings = await settingsStore.captchaRuntime()
  if (!settings.enabled || settings.provider === 'none') return { success: true }

  const responseToken = String(token || '').trim()
  if (!responseToken) return { success: false, error: '请先完成人机验证' }
  if (responseToken.length > 4096) return { success: false, error: '人机验证令牌无效' }
  if (!settings.site_key || !settings.secret_key || !endpoints[settings.provider]) {
    return { success: false, error: '人机验证配置不完整，请联系管理员' }
  }

  const body = new URLSearchParams({
    secret: settings.secret_key,
    response: responseToken
  })
  if (req?.ip) body.set('remoteip', req.ip)

  try {
    const response = await fetch(endpoints[settings.provider], {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(config.captchaTimeoutMs)
    })
    if (!response.ok) return { success: false, error: '人机验证服务暂时不可用，请稍后重试' }
    const result = await response.json()
    return result?.success
      ? { success: true }
      : { success: false, error: '人机验证未通过，请刷新后重试' }
  } catch {
    return { success: false, error: '人机验证服务暂时不可用，请稍后重试' }
  }
}
