import { createHmac } from 'node:crypto'
import {
  notificationDetailLines,
  reviewEntryLabel,
  reviewHeadline,
  safeNotificationText
} from '../messageTemplate.js'

const permanentPlatformCodes = new Set([9499, 19001, 19021, 19022, 19024])
const isExplicitZero = (value) => value === 0 || value === '0'

export const generateFeishuSignature = (timestamp, secret) => createHmac(
  'sha256',
  `${timestamp}\n${String(secret || '')}`
).digest('base64')

export const buildFeishuPayload = ({ payload, pendingCount, batchCount = 1, reviewUrl, secret = '', timestamp = Math.floor(Date.now() / 1000) }) => {
  const lines = notificationDetailLines(payload, pendingCount, batchCount)
  const elements = [
    { tag: 'div', text: { tag: 'lark_md', content: lines.map((line) => safeNotificationText(line, 300)).join('\n') } }
  ]
  if (reviewUrl) {
    elements.push({
      tag: 'action',
      actions: [{ tag: 'button', type: 'primary', text: { tag: 'plain_text', content: reviewEntryLabel(payload) }, url: reviewUrl }]
    })
  }
  const body = {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: { template: 'orange', title: { tag: 'plain_text', content: reviewHeadline(payload, batchCount) } },
      elements
    }
  }
  if (secret) {
    body.timestamp = String(timestamp)
    body.sign = generateFeishuSignature(timestamp, secret)
  }
  return body
}

const validateTarget = ({ webhook }) => {
  try {
    const url = new URL(String(webhook || '').trim())
    const validHost = url.hostname === 'open.feishu.cn' || url.hostname === 'open.larksuite.com'
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
      return { valid: false, reason: 'invalid_url_security' }
    }
    if (!validHost || !/^\/open-apis\/bot\/v2\/hook\/[^/]+$/.test(url.pathname) || url.search) {
      return { valid: false, reason: 'invalid_feishu_webhook' }
    }
    return { valid: true, url: url.toString() }
  } catch {
    return { valid: false, reason: 'invalid_url' }
  }
}

const classifyResponse = ({ body = {} } = {}) => {
  const code = body.code ?? body.StatusCode
  return {
    ok: isExplicitZero(code),
    code,
    message: body.msg ?? body.StatusMessage,
    permanent: permanentPlatformCodes.has(Number(code))
  }
}

export const feishuWebhookProvider = Object.freeze({
  id: 'feishu',
  label: '飞书自定义群机器人',
  description: '飞书 / Lark 群自定义机器人',
  capabilities: Object.freeze({ destination: 'group', inbound: false, supportsCallbacks: false, supportsSigningSecret: true }),
  minIntervalMs: 650,
  readConfig: (config) => ({
    provider: 'feishu',
    webhook: config.moderationNotifyFeishuWebhook,
    secret: config.moderationNotifyFeishuSecret
  }),
  validateTarget,
  buildMessage: ({ target, ...context }) => buildFeishuPayload({ ...context, secret: target.secret }),
  classifyResponse
})
