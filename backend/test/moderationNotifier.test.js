import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildFeishuPayload,
  buildWecomPayload,
  generateFeishuSignature,
  isSuccessfulBotResponse,
  ModerationNotifier,
  moderationEventPayload,
  reviewUrlFor,
  validateWebhookTarget
} from '../src/services/moderationNotifier.js'

test('accepts only exact official bot webhook origins and paths', () => {
  assert.equal(validateWebhookTarget({
    provider: 'feishu',
    webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/example-token'
  }).valid, true)
  assert.equal(validateWebhookTarget({
    provider: 'wecom',
    webhook: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=example-key'
  }).valid, true)

  const rejected = [
    ['feishu', 'http://open.feishu.cn/open-apis/bot/v2/hook/token'],
    ['feishu', 'https://open.feishu.cn.evil.example/open-apis/bot/v2/hook/token'],
    ['feishu', 'https://open.feishu.cn:8443/open-apis/bot/v2/hook/token'],
    ['feishu', 'https://user:pass@open.feishu.cn/open-apis/bot/v2/hook/token'],
    ['wecom', 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=token&next=http://127.0.0.1'],
    ['wecom', 'https://qyapi.weixin.qq.com.evil.example/cgi-bin/webhook/send?key=token'],
    ['wecom', 'https://qyapi.weixin.qq.com/cgi-bin/other?key=token']
  ]
  for (const [provider, webhook] of rejected) {
    assert.equal(validateWebhookTarget({ provider, webhook }).valid, false, webhook)
  }
})

test('generates the documented Feishu timestamp signature', () => {
  assert.equal(
    generateFeishuSignature(1700000000, 'test-secret'),
    'mbm4Y4oluIPQ00qlBIhX8vAZ0EKv3nw0LuTb91jPL84='
  )
})

test('notification metadata omits post body, identity, contact and attachment paths', () => {
  const payload = moderationEventPayload({
    id: 42,
    pending_since: '2026-08-25T12:00:00.000Z',
    text: '秘密正文 13800138000',
    username: 'private-user',
    user_id: 9,
    files: ['private-upload.jpg'],
    tags: ['表白', '日常](https://evil.example)'],
    lost_found: { kind: 'lost', item: '校卡', contact: 'wechat-secret' }
  })
  const serialized = JSON.stringify(payload)
  assert.equal(payload.message_id, 42)
  assert.equal(payload.category, '失物招领 · 寻物启事')
  assert.equal(payload.attachment_count, 1)
  assert.equal(serialized.includes('https://evil.example'), false)
  for (const secret of ['秘密正文', '13800138000', 'private-user', 'private-upload.jpg', 'wechat-secret']) {
    assert.equal(serialized.includes(secret), false)
  }
})

test('builds privacy-safe Feishu and WeCom messages with an HTTPS review deep link', () => {
  const payload = moderationEventPayload({ id: 88, tags: ['表白'], files: [], pending_since: '2026-08-25T12:00:00Z' })
  const reviewUrl = reviewUrlFor(88, 'https://wall.example.com')
  assert.equal(reviewUrl, 'https://wall.example.com/admin/wall?status=pending&message=88')
  assert.equal(reviewUrlFor(88, 'http://wall.example.com'), '')
  assert.equal(reviewUrlFor(88, 'http://localhost:1145'), 'http://localhost:1145/admin/wall?status=pending&message=88')
  assert.equal(reviewUrlFor(88, 'http://localhost:1145', 'production'), '')
  assert.equal(reviewUrlFor(88, '', 'production'), '')

  const feishu = buildFeishuPayload({ payload, pendingCount: 3, reviewUrl, secret: 'signing-secret', timestamp: 1700000000 })
  const wecom = buildWecomPayload({ payload, pendingCount: 3, reviewUrl })
  assert.equal(feishu.msg_type, 'interactive')
  assert.equal(typeof feishu.sign, 'string')
  assert.equal(wecom.msgtype, 'markdown_v2')
  assert.match(JSON.stringify(feishu), /进入审核后台/)
  assert.match(JSON.stringify(wecom), /message=88/)

  const digest = buildWecomPayload({
    payload: { message_id: 0, message_ids: [88, 89], category: '校园动态', attachment_count: 0, has_poll: false },
    pendingCount: 5,
    batchCount: 2,
    reviewUrl: reviewUrlFor(0, 'https://wall.example.com')
  })
  assert.match(JSON.stringify(digest), /新增 2 条待审核/)
  assert.match(JSON.stringify(digest), /#88、#89/)
})

test('recognizes platform success response codes', () => {
  assert.equal(isSuccessfulBotResponse('feishu', { code: 0 }), true)
  assert.equal(isSuccessfulBotResponse('feishu', { StatusCode: 0 }), true)
  assert.equal(isSuccessfulBotResponse('feishu', { code: 19021 }), false)
  assert.equal(isSuccessfulBotResponse('feishu', { code: null }), false)
  assert.equal(isSuccessfulBotResponse('wecom', { errcode: 0 }), true)
  assert.equal(isSuccessfulBotResponse('wecom', { errcode: null }), false)
  assert.equal(isSuccessfulBotResponse('wecom', { errcode: 93000 }), false)
})

test('collapses the initial backlog and enforces the provider digest cooldown', async () => {
  const calls = []
  const notifier = new ModerationNotifier()
  notifier.targets = [{ provider: 'feishu', webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/example' }]
  notifier.initialBacklogProviders = new Set(['feishu'])
  notifier.pool = {
    query: async (sql, params) => {
      calls.push({ sql, params })
      return { rows: [{ id: 1, provider: 'feishu' }] }
    }
  }

  const initial = await notifier.claimBatch()
  assert.equal(initial.length, 1)
  assert.deepEqual(calls[0].params.slice(1), [['feishu'], true])
  assert.equal(notifier.initialBacklogProviders.has('feishu'), true)

  notifier.lastDeliveryAt.set('feishu', Date.now())
  assert.deepEqual(await notifier.claimBatch(), [])
  assert.equal(calls.length, 1)
})
