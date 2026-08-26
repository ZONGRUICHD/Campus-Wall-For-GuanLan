import {
  notificationDetailLines,
  reviewEntryLabel,
  reviewHeadline
} from '../messageTemplate.js'
import { isSmtpConfigured, parseEmailList, sendMail } from '../../smtpMailer.js'
import { config } from '../../../config.js'

const validateTarget = ({ webhook }) => {
  const parsed = parseEmailList(webhook)
  if (!parsed.valid) return { valid: false, reason: parsed.reason || 'invalid_email' }
  return { valid: true, url: parsed.emails.join(',') }
}

export const emailWebhookProvider = Object.freeze({
  id: 'email',
  label: '审核邮箱',
  description: '把待审核提醒发到指定邮箱，SMTP 凭据只保存在服务器环境',
  capabilities: Object.freeze({
    destination: 'email',
    inbound: false,
    supportsCallbacks: false,
    supportsSigningSecret: false
  }),
  minIntervalMs: 1500,
  invalidTargetMessage: '请填写有效的收件邮箱，多个地址用逗号分隔',
  readConfig: (settings) => ({
    provider: 'email',
    webhook: settings.moderationNotifyEmailTo,
    secret: ''
  }),
  validateTarget,
  buildMessage: ({ payload, pendingCount, batchCount, reviewUrl }) => {
    const lines = notificationDetailLines(payload, pendingCount, batchCount)
    if (reviewUrl) lines.push(`${reviewEntryLabel(payload)}：${reviewUrl}`)
    return {
      subject: reviewHeadline(payload, batchCount),
      text: lines.join('\n')
    }
  },
  classifyResponse: ({ body = {} } = {}) => ({
    ok: body.ok === true,
    code: body.ok === true ? 0 : (body.code || 'email_failed'),
    message: body.message || '',
    permanent: body.permanent === true
  }),
  deliver: async ({ target, body }) => {
    if (!isSmtpConfigured(config)) {
      throw Object.assign(new Error('email_not_configured'), { permanent: true })
    }
    const parsed = parseEmailList(target.webhook)
    if (!parsed.valid) throw Object.assign(new Error('invalid_email'), { permanent: true })
    await sendMail({
      to: parsed.emails,
      subject: body.subject,
      text: body.text
    })
    return { ok: true }
  }
})
