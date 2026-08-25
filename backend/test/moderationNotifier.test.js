import assert from 'node:assert/strict'
import test from 'node:test'
import { config } from '../src/config.js'
import {
  buildFeishuPayload,
  buildWecomPayload,
  generateFeishuSignature,
  isSuccessfulBotResponse,
  ModerationNotifier,
  moderationEventPayload,
  notificationScopeForPayload,
  parseRetryAfterMs,
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
  assert.equal(payload.moderation_scope, 'posts')
  assert.equal(payload.attachment_count, 1)
  assert.equal(serialized.includes('https://evil.example'), false)
  for (const secret of ['秘密正文', '13800138000', 'private-user', 'private-upload.jpg', 'wechat-secret']) {
    assert.equal(serialized.includes(secret), false)
  }
})

test('builds privacy-safe Feishu and WeCom messages with an HTTPS review deep link', () => {
  const payload = moderationEventPayload({ id: 88, tags: ['表白'], files: [], pending_since: '2026-08-25T12:00:00Z' })
  const reviewUrl = reviewUrlFor(88, 'https://wall.example.com', 'development', 'confessions')
  assert.equal(payload.moderation_scope, 'confessions')
  assert.equal(reviewUrl, 'https://wall.example.com/admin/confessions?status=pending&message=88')
  assert.equal(reviewUrlFor(88, 'https://wall.example.com'), 'https://wall.example.com/admin/wall?status=pending&message=88')
  assert.equal(reviewUrlFor(0, 'https://wall.example.com', 'development', 'all'), 'https://wall.example.com/admin')
  assert.equal(reviewUrlFor(88, 'http://wall.example.com'), '')
  assert.equal(reviewUrlFor(88, 'http://localhost:1145'), 'http://localhost:1145/admin/wall?status=pending&message=88')
  assert.equal(reviewUrlFor(88, 'http://localhost:1145', 'production'), '')
  assert.equal(reviewUrlFor(88, '', 'production'), '')

  const feishu = buildFeishuPayload({ payload, pendingCount: 3, reviewUrl, secret: 'signing-secret', timestamp: 1700000000 })
  const wecom = buildWecomPayload({ payload, pendingCount: 3, reviewUrl })
  assert.equal(feishu.msg_type, 'interactive')
  assert.equal(typeof feishu.sign, 'string')
  assert.equal(wecom.msgtype, 'markdown_v2')
  assert.match(JSON.stringify(feishu), /表白墙有新便签待审核/)
  assert.match(JSON.stringify(feishu), /进入表白墙审核/)
  assert.match(JSON.stringify(wecom), /message=88/)

  const digest = buildWecomPayload({
    payload: { message_id: 0, message_ids: [88, 89], category: '校园动态', moderation_scope: 'posts', attachment_count: 0, has_poll: false },
    pendingCount: 5,
    batchCount: 2,
    reviewUrl: reviewUrlFor(0, 'https://wall.example.com')
  })
  assert.match(JSON.stringify(digest), /新增 2 条待审核/)
  assert.match(JSON.stringify(digest), /#88、#89/)

  const mixed = buildFeishuPayload({
    payload: { message_id: 0, message_ids: [88, 89], category: '校园动态、表白墙便签', moderation_scope: 'all', attachment_count: 0, has_poll: false },
    pendingCount: 5,
    batchCount: 2,
    reviewUrl: reviewUrlFor(0, 'https://wall.example.com', 'development', 'all')
  })
  assert.match(JSON.stringify(mixed), /待审核内容/)
  assert.match(JSON.stringify(mixed), /进入审核后台/)
  assert.match(JSON.stringify(mixed), /全站当前待审/)
})

test('routes legacy notification payloads to the matching separated queue', () => {
  assert.equal(notificationScopeForPayload({ category: '表白墙便签' }), 'confessions')
  assert.equal(notificationScopeForPayload({ category: '校园动态' }), 'posts')
  assert.equal(notificationScopeForPayload({ category: '表白墙便签', moderation_scope: 'posts' }), 'posts')
})

test('refreshes legacy fuzzy notification categories from the current message', async () => {
  const notifier = new ModerationNotifier()
  notifier.pool = {
    query: async (sql) => {
      if (sql.includes('SELECT id, data FROM messages')) {
        return {
          rows: [{
            id: 7,
            data: {
              id: 7,
              tags: ['#表白'],
              timestamp: '2026-08-25 12:00:00',
              moderation_status: 'pending',
              review_status: 'pending'
            }
          }]
        }
      }
      return { rows: [{ count: 1 }] }
    }
  }

  const contexts = await notifier.pendingContexts([{
    id: 1,
    message_id: 7,
    payload: {
      message_id: 7,
      submitted_at: '2026-08-25 12:00:00',
      category: '表白墙便签'
    }
  }])

  assert.equal(contexts.get('1').pending, true)
  assert.equal(contexts.get('1').deliveryPayload.category, '校园动态')
  assert.equal(contexts.get('1').deliveryPayload.moderation_scope, 'posts')
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

test('parses Retry-After seconds and HTTP dates with safe bounds', () => {
  const now = Date.UTC(2026, 7, 26, 0, 0, 0)
  assert.equal(parseRetryAfterMs('15', now), 15000)
  assert.equal(parseRetryAfterMs(new Date(now + 45000).toUTCString(), now), 45000)
  assert.equal(parseRetryAfterMs('-1', now), 0)
  assert.equal(parseRetryAfterMs('1.5', now), 0)
  assert.equal(parseRetryAfterMs('not-a-date', now), 0)
  assert.equal(parseRetryAfterMs(new Date(now - 1000).toUTCString(), now), 0)
  assert.equal(parseRetryAfterMs('999999999999999999999999999999', now), 24 * 60 * 60 * 1000)
  assert.equal(parseRetryAfterMs(new Date(now + 7 * 24 * 60 * 60 * 1000).toUTCString(), now), 24 * 60 * 60 * 1000)
})

test('startup recovery keeps dead jobs dead and only requeues bounded stale sending jobs', async () => {
  const previousEnabled = config.moderationNotifyEnabled
  config.moderationNotifyEnabled = true
  const calls = []
  const notifier = new ModerationNotifier()
  notifier.targets = [{ provider: 'feishu', webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/example' }]
  const pool = {
    query: async (sql, params = []) => {
      calls.push({ sql, params })
      if (sql.includes('SELECT id, data')) return { rows: [], rowCount: 0 }
      return { rows: [], rowCount: 0 }
    }
  }

  try {
    await notifier.init(pool)
    const recovery = calls.find(({ sql }) => sql.includes('WITH stale AS'))
    assert.ok(recovery)
    assert.match(recovery.sql, /WHERE status = 'sending'/)
    assert.match(recovery.sql, /locked_at < now\(\) - interval '2 minutes'/)
    assert.match(recovery.sql, /LIMIT \$1::int/)
    assert.doesNotMatch(recovery.sql, /status = 'dead'/)
    assert.doesNotMatch(recovery.sql, /attempts\s*=\s*0/)
    assert.deepEqual(recovery.params, [config.moderationNotifyBatchSize])
  } finally {
    await notifier.close()
    config.moderationNotifyEnabled = previousEnabled
  }
})

test('reconciliation scans pending messages in hard-limited progressive pages', async () => {
  const previousBatchSize = config.moderationNotifyBatchSize
  config.moderationNotifyBatchSize = 2
  const selectCalls = []
  const notifier = new ModerationNotifier()
  notifier.targets = [{ provider: 'feishu', webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/example' }]
  notifier.pool = {
    query: async (sql, params = []) => {
      if (sql.includes('WITH stale AS')) return { rows: [], rowCount: 0 }
      if (sql.includes('SELECT id, data')) {
        selectCalls.push({ sql, params })
        if (String(params[0]) === '0') {
          return {
            rows: [1, 2].map((id) => ({
              id,
              data: { id, timestamp: `2026-08-26 00:00:0${id}`, review_status: 'pending', moderation_status: 'pending' }
            })),
            rowCount: 2
          }
        }
        return {
          rows: [{
            id: 3,
            data: { id: 3, timestamp: '2026-08-26 00:00:03', review_status: 'pending', moderation_status: 'pending' }
          }],
          rowCount: 1
        }
      }
      if (sql.includes('INSERT INTO moderation_notification_outbox')) return { rows: [], rowCount: 1 }
      throw new Error(`Unexpected query: ${sql}`)
    }
  }

  try {
    assert.equal(await notifier.reconcilePendingMessages(), 2)
    assert.equal(notifier.reconcileCursor, '2')
    assert.equal(await notifier.reconcilePendingMessages(), 1)
    assert.equal(notifier.reconcileCursor, '0')
    assert.equal(selectCalls.length, 2)
    assert.deepEqual(selectCalls.map(({ params }) => params), [['0', 2], ['2', 2]])
    for (const { sql } of selectCalls) {
      assert.match(sql, /ORDER BY id\s+LIMIT \$2::int/)
    }
  } finally {
    await notifier.close()
    config.moderationNotifyBatchSize = previousBatchSize
  }
})

test('always applies the configured hard limit and enforces provider cooldown', async () => {
  const calls = []
  const notifier = new ModerationNotifier()
  notifier.targets = [{ provider: 'feishu', webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/example' }]
  notifier.pool = {
    query: async (sql, params) => {
      calls.push({ sql, params })
      return { rows: [{ id: 1, provider: 'feishu' }] }
    }
  }

  const initial = await notifier.claimBatch()
  assert.equal(initial.length, 1)
  assert.match(calls[0].sql, /LIMIT \$1::int/)
  assert.doesNotMatch(calls[0].sql, /THEN NULL/)
  assert.deepEqual(calls[0].params, [config.moderationNotifyBatchSize, ['feishu']])

  notifier.lastDeliveryAt.set('feishu', Date.now())
  assert.deepEqual(await notifier.claimBatch(), [])
  assert.equal(calls.length, 1)
})
