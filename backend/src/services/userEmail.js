import { createHash, randomBytes } from 'node:crypto'
import { config } from '../config.js'
import { isSmtpConfigured, normalizeEmail, sendMail } from './smtpMailer.js'

export { normalizeEmail, isSmtpConfigured }

export const hashEmailToken = (token) => createHash('sha256').update(String(token || '')).digest('hex')

export const createEmailToken = () => randomBytes(32).toString('hex')

export const emailVerifyUrl = (token) => {
  const base = String(config.publicSiteUrl || '').trim().replace(/\/+$/, '')
  if (!base || !token) return ''
  return `${base}/api/user/email/verify?token=${encodeURIComponent(token)}`
}

export const sendVerificationEmail = async ({ to, token }) => {
  const link = emailVerifyUrl(token)
  if (!link) throw Object.assign(new Error('email_not_configured'), { permanent: true })
  await sendMail({
    to,
    subject: '验证校园墙邮箱',
    text: [
      '请打开下面的链接完成邮箱验证，链接 24 小时内有效。',
      '',
      link,
      '',
      '如果不是你本人操作，请忽略这封邮件。'
    ].join('\n')
  })
}

export const sendAccountNotificationEmail = async ({ to, content, type = 'comment' }) => {
  const kind = type === 'comment' ? '评论' : '消息'
  await sendMail({
    to,
    subject: `校园墙有新的${kind}通知`,
    text: [
      String(content || '你有一条新的校园墙通知。').trim() || '你有一条新的校园墙通知。',
      '',
      '登录校园墙主页即可查看详情。',
      String(config.publicSiteUrl || '').trim()
    ].filter(Boolean).join('\n')
  })
}
