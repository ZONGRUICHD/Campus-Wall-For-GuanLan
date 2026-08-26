import {
  notificationDetailLines,
  reviewEntryLabel,
  reviewHeadline,
  safeNotificationText
} from '../messageTemplate.js'

const isExplicitZero = (value) => value === 0 || value === '0'

export const buildWecomPayload = ({ payload, pendingCount, batchCount = 1, reviewUrl }) => {
  const lines = notificationDetailLines(payload, pendingCount, batchCount)
  if (reviewUrl) lines.push(`[${reviewEntryLabel(payload)}](${reviewUrl})`)
  return {
    msgtype: 'markdown_v2',
    markdown_v2: { content: `## ${reviewHeadline(payload, batchCount)}\n${lines.map((line) => safeNotificationText(line, 300)).join('\n')}` }
  }
}

const validateTarget = ({ webhook }) => {
  try {
    const url = new URL(String(webhook || '').trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
      return { valid: false, reason: 'invalid_url_security' }
    }
    if (url.hostname !== 'qyapi.weixin.qq.com' || url.pathname !== '/cgi-bin/webhook/send') {
      return { valid: false, reason: 'invalid_wecom_webhook' }
    }
    const keys = [...url.searchParams.keys()]
    if (keys.length !== 1 || keys[0] !== 'key' || !url.searchParams.get('key')) {
      return { valid: false, reason: 'invalid_wecom_key' }
    }
    return { valid: true, url: url.toString() }
  } catch {
    return { valid: false, reason: 'invalid_url' }
  }
}

const classifyResponse = ({ body = {} } = {}) => ({
  ok: isExplicitZero(body.errcode),
  code: body.errcode,
  message: body.errmsg,
  permanent: false
})

export const wecomWebhookProvider = Object.freeze({
  id: 'wecom',
  label: '企业微信群机器人',
  capabilities: Object.freeze({ destination: 'group', inbound: false, supportsCallbacks: false }),
  minIntervalMs: 3100,
  readConfig: (config) => ({
    provider: 'wecom',
    webhook: config.moderationNotifyWecomWebhook,
    secret: ''
  }),
  validateTarget,
  buildMessage: ({ payload, pendingCount, batchCount, reviewUrl }) => buildWecomPayload({ payload, pendingCount, batchCount, reviewUrl }),
  classifyResponse
})
