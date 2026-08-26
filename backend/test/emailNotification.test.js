import assert from 'node:assert/strict'
import test from 'node:test'
import { emailVerifyUrl, resolveEmailApiOrigin } from '../src/services/userEmail.js'
import { buildMimeMessage, parseEmailList } from '../src/services/smtpMailer.js'
import { getNotificationProvider, validateNotificationTarget } from '../src/services/notifications/providerRegistry.js'

test('parseEmailList accepts comma-separated addresses and rejects junk', () => {
  assert.deepEqual(parseEmailList('A@School.edu, b@school.edu').emails, ['a@school.edu', 'b@school.edu'])
  assert.equal(parseEmailList('not-an-email').valid, false)
  assert.equal(parseEmailList('').valid, false)
})

test('email moderation provider stores recipients in the webhook field', async () => {
  const adapter = getNotificationProvider('email')
  assert.equal(adapter.id, 'email')
  assert.deepEqual(
    adapter.validateTarget({ webhook: 'review@example.com, ops@example.com' }),
    { valid: true, url: 'review@example.com,ops@example.com' }
  )
  assert.equal(validateNotificationTarget({ provider: 'email', webhook: 'nope' }).valid, false)
  await assert.rejects(
    adapter.deliver({ target: { webhook: 'review@example.com' }, body: { subject: 's', text: 't' } }),
    (error) => error?.permanent === true && /email_not_configured/.test(error.message)
  )
  const body = adapter.buildMessage({
    payload: { test_mode: true, category: '审核提醒测试' },
    pendingCount: 0,
    batchCount: 1,
    reviewUrl: 'https://wall.zongtech.xyz/admin/wall'
  })
  assert.equal(body.subject, '校园墙审核提醒测试')
  assert.match(body.text, /固定测试消息/)
})

test('verification links use the API origin instead of the Pages hostname', () => {
  assert.equal(
    resolveEmailApiOrigin({ publicSiteUrl: 'https://wall.zongtech.xyz' }),
    'https://api-wall.zongtech.xyz'
  )
  assert.equal(
    resolveEmailApiOrigin({
      feishuRedirectUri: 'https://api-wall.zongtech.xyz/api/user/feishu/callback',
      publicSiteUrl: 'https://wall.zongtech.xyz'
    }),
    'https://api-wall.zongtech.xyz'
  )
  assert.equal(
    resolveEmailApiOrigin({ publicApiUrl: 'https://api.example.test' }),
    'https://api.example.test'
  )
  assert.match(
    emailVerifyUrl('abc123', {
      publicSiteUrl: 'https://wall.zongtech.xyz',
      feishuRedirectUri: 'https://api-wall.zongtech.xyz/api/user/feishu/callback'
    }),
    /^https:\/\/api-wall\.zongtech\.xyz\/api\/user\/email\/verify\?token=abc123$/
  )
})

test('mime builder keeps headers single-line', () => {
  const mime = buildMimeMessage({
    from: '校园墙 <wall@example.com>',
    to: ['a@example.com'],
    subject: '标题\n注入',
    text: '正文'
  })
  assert.match(mime, /Subject: 标题 注入/)
  assert.match(mime, /正文/)
})
