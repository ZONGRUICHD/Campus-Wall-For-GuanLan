import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { config } from '../config.js'
import { createPostgresPool } from './postgres.js'

const captchaProviders = new Set(['none', 'turnstile', 'recaptcha'])
const captchaSettingKey = 'captcha'
const communitySettingKey = 'community'
const encryptionKey = () => createHash('sha256').update(config.secretKey).digest()

export const communityDefaults = Object.freeze({
  posting_enabled: true,
  commenting_enabled: true,
  guest_posting_enabled: true,
  guest_commenting_enabled: true,
  require_post_approval: false,
  pause_reason: '',
  community_rules: [
    '尊重他人，不发布人身攻击、歧视、骚扰或恶意曝光隐私的内容。',
    '不发布违法违规、低俗色情、诈骗、恶意广告或虚假信息。',
    '涉及失物招领、求助和校园通知时，请尽量提供可核实的信息。',
    '匿名不代表免责，请为自己的表达负责，共同维护友善的校园社区。'
  ].join('\n'),
  sensitive_words: []
})

const encryptSecret = (value) => {
  const secret = String(value || '')
  if (!secret) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.')
}

const decryptSecret = (value) => {
  try {
    const [ivValue, tagValue, encryptedValue] = String(value || '').split('.')
    if (!ivValue || !tagValue || !encryptedValue) return ''
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final()
    ]).toString('utf8')
  } catch {
    return ''
  }
}

const normalizeProvider = (value) => {
  const provider = String(value || 'none').trim().toLowerCase()
  return captchaProviders.has(provider) ? provider : 'none'
}

const boolValue = (value, fallback = false) => {
  if (typeof value === 'boolean') return value
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

const splitSensitiveWords = (value) => {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\n,，]+/)
  return source.map((word) => String(word || '').trim()).filter(Boolean)
}

const normalizeMatchText = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, '')

const normalizeSensitiveWords = (value) => {
  const words = splitSensitiveWords(value).filter((word) => word.length <= 50)
  const entries = words.map((word) => [normalizeMatchText(word), word]).filter(([key]) => key)
  return [...new Map(entries).values()].slice(0, 200)
}

const fail = (message) => {
  const error = new Error(message)
  error.statusCode = 400
  throw error
}

const normalizeCommunity = (data = {}) => ({
  posting_enabled: boolValue(data.posting_enabled, communityDefaults.posting_enabled),
  commenting_enabled: boolValue(data.commenting_enabled, communityDefaults.commenting_enabled),
  guest_posting_enabled: boolValue(data.guest_posting_enabled, communityDefaults.guest_posting_enabled),
  guest_commenting_enabled: boolValue(data.guest_commenting_enabled, communityDefaults.guest_commenting_enabled),
  require_post_approval: boolValue(data.require_post_approval, communityDefaults.require_post_approval),
  pause_reason: String(data.pause_reason || '').trim().slice(0, 300),
  community_rules: String(data.community_rules ?? communityDefaults.community_rules).trim().slice(0, 10000),
  sensitive_words: normalizeSensitiveWords(data.sensitive_words)
})

export class SettingsStore {
  constructor() {
    this.pool = createPostgresPool()
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        key TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
  }

  environmentCaptcha() {
    const provider = normalizeProvider(config.captchaProvider)
    const siteKey = String(config.captchaSiteKey || '').trim()
    const secretKey = String(config.captchaSecretKey || '').trim()
    return {
      provider,
      enabled: provider !== 'none' && config.captchaEnabled,
      site_key: siteKey,
      secret_key: secretKey,
      has_secret: Boolean(secretKey),
      source: 'environment'
    }
  }

  async captchaRuntime() {
    const result = await this.pool.query('SELECT data FROM platform_settings WHERE key = $1', [captchaSettingKey])
    if (!result.rowCount) return this.environmentCaptcha()
    const data = result.rows[0].data || {}
    const provider = normalizeProvider(data.provider)
    const secretKey = decryptSecret(data.encrypted_secret)
    const siteKey = String(data.site_key || '').trim()
    return {
      provider,
      enabled: provider !== 'none' && boolValue(data.enabled),
      site_key: siteKey,
      secret_key: secretKey,
      has_secret: Boolean(secretKey),
      source: 'database'
    }
  }

  async captchaAdmin() {
    const runtime = await this.captchaRuntime()
    return {
      provider: runtime.provider,
      enabled: runtime.enabled,
      site_key: runtime.site_key,
      has_secret: runtime.has_secret,
      source: runtime.source
    }
  }

  async captchaPublic() {
    const runtime = await this.captchaRuntime()
    return {
      enabled: runtime.enabled,
      provider: runtime.enabled ? runtime.provider : 'none',
      site_key: runtime.enabled ? runtime.site_key : ''
    }
  }

  async updateCaptcha(input = {}) {
    const current = await this.captchaRuntime()
    const provider = normalizeProvider(input.provider)
    const siteKey = String(input.site_key || '').trim().slice(0, 500)
    const requestedSecret = String(input.secret_key || '').trim().slice(0, 1000)
    const secretKey = requestedSecret || current.secret_key
    const enabled = provider !== 'none' && boolValue(input.enabled)

    if (enabled && !siteKey) {
      const error = new Error('启用人机验证前必须填写站点密钥')
      error.statusCode = 400
      throw error
    }
    if (enabled && !secretKey) {
      const error = new Error('启用人机验证前必须填写服务端密钥')
      error.statusCode = 400
      throw error
    }

    const data = {
      provider,
      enabled,
      site_key: siteKey,
      encrypted_secret: encryptSecret(secretKey)
    }
    await this.pool.query(
      `INSERT INTO platform_settings (key, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key)
       DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [captchaSettingKey, JSON.stringify(data)]
    )
    return this.captchaAdmin()
  }

  async communityRuntime() {
    const result = await this.pool.query('SELECT data, updated_at FROM platform_settings WHERE key = $1', [communitySettingKey])
    if (!result.rowCount) return { ...communityDefaults, sensitive_words: [], source: 'default', updated_at: null }
    return {
      ...normalizeCommunity(result.rows[0].data || {}),
      source: 'database',
      updated_at: result.rows[0].updated_at
    }
  }

  async communityAdmin() {
    return this.communityRuntime()
  }

  async communityPublic() {
    const { sensitive_words: ignored, ...publicSettings } = await this.communityRuntime()
    return publicSettings
  }

  async updateCommunity(input = {}) {
    const pauseReason = String(input.pause_reason || '')
    const communityRules = String(input.community_rules ?? '')
    const sensitiveWords = splitSensitiveWords(input.sensitive_words)
    if (pauseReason.length > 300) fail('暂停说明不能超过 300 个字符')
    if (communityRules.length > 10000) fail('社区公约不能超过 10000 个字符')
    if (sensitiveWords.some((word) => word.length > 50)) fail('单个敏感词不能超过 50 个字符')
    if (new Set(sensitiveWords.map(normalizeMatchText).filter(Boolean)).size > 200) fail('敏感词不能超过 200 个')
    const data = normalizeCommunity(input)
    await this.pool.query(
      `INSERT INTO platform_settings (key, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key)
       DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [communitySettingKey, JSON.stringify(data)]
    )
    return this.communityAdmin()
  }

  async checkCommunityWrite(type, { user = null, values = [] } = {}) {
    const policy = await this.communityRuntime()
    const isComment = type === 'comment'
    const enabled = isComment ? policy.commenting_enabled : policy.posting_enabled
    const guestEnabled = isComment ? policy.guest_commenting_enabled : policy.guest_posting_enabled
    const actionText = isComment ? '评论' : '发帖'

    if (!enabled) {
      return {
        success: false,
        statusCode: 403,
        code: isComment ? 'COMMENTING_DISABLED' : 'POSTING_DISABLED',
        error: policy.pause_reason || `管理员暂时关闭了${actionText}功能`
      }
    }
    if (!user && !guestEnabled) {
      return {
        success: false,
        statusCode: 401,
        code: isComment ? 'GUEST_COMMENTING_DISABLED' : 'GUEST_POSTING_DISABLED',
        error: `当前仅登录学生可以${actionText}`
      }
    }

    const content = (Array.isArray(values) ? values : [values]).map(normalizeMatchText).join('\n')
    const matched = policy.sensitive_words.some((word) => content.includes(normalizeMatchText(word)))
    if (matched) {
      return {
        success: false,
        statusCode: 400,
        code: 'CONTENT_POLICY_REJECTED',
        error: '内容包含不适宜词语，请修改后重试'
      }
    }
    return { success: true, policy }
  }
}

export const settingsStore = new SettingsStore()
