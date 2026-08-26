import assert from 'node:assert/strict'
import test from 'node:test'
import { ModerationNotifier } from '../src/services/moderationNotifier.js'

test('runtime reconfiguration starts and stops the notification worker without a restart', async () => {
  const notifier = new ModerationNotifier()
  notifier.replaceTargets([])
  notifier.pool = {
    async query(sql) {
      if (sql.includes('SELECT id, data')) return { rows: [], rowCount: 0 }
      if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: 0 }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    }
  }

  try {
    await notifier.reconfigure([{
      provider: 'wecom',
      webhook: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=runtime-key',
      secret: ''
    }])
    assert.equal(notifier.active, true)
    assert.ok(notifier.timer)
    assert.ok(notifier.reconcileTimer)

    await notifier.reconfigure([])
    assert.equal(notifier.active, false)
    assert.equal(notifier.timer, null)
    assert.equal(notifier.reconcileTimer, null)
  } finally {
    await notifier.close()
  }
})

test('test delivery uses a fixed privacy-safe message and the registered provider transport', async () => {
  let request = null
  const notifier = new ModerationNotifier({
    fetchImpl: async (url, options) => {
      request = { url, options }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ code: 0 })
      }
    }
  })
  notifier.replaceTargets([])
  const target = {
    provider: 'feishu',
    webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-delivery-token',
    secret: 'private-signing-secret'
  }

  const result = await notifier.testTarget(target)
  const body = JSON.parse(request.options.body)
  const serialized = JSON.stringify(body)
  assert.equal(result.provider, 'feishu')
  assert.equal(request.url, target.webhook)
  assert.equal(request.options.redirect, 'error')
  assert.match(serialized, /审核提醒测试/)
  assert.match(serialized, /不包含任何用户内容或身份信息/)
  assert.equal(serialized.includes(target.secret), false)
})

test('concurrent runtime reconfiguration is serialized and the last saved target wins', async () => {
  const notifier = new ModerationNotifier()
  notifier.replaceTargets([])
  notifier.pool = {}
  let activeStarts = 0
  let maxActiveStarts = 0
  let startCount = 0
  notifier.startWorker = async () => {
    activeStarts += 1
    maxActiveStarts = Math.max(maxActiveStarts, activeStarts)
    await new Promise((resolve) => setImmediate(resolve))
    startCount += 1
    activeStarts -= 1
  }
  const firstWebhook = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=first-runtime-key'
  const secondWebhook = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=second-runtime-key'

  try {
    await Promise.all([
      notifier.reconfigure([{ provider: 'wecom', webhook: firstWebhook }]),
      notifier.reconfigure([{ provider: 'wecom', webhook: secondWebhook }])
    ])
    assert.equal(maxActiveStarts, 1)
    assert.equal(startCount, 2)
    assert.equal(notifier.targets[0]?.webhook, secondWebhook)
  } finally {
    await notifier.close()
  }
})

test('concurrent tests for one provider share the cooldown and only send once', async () => {
  let deliveries = 0
  const notifier = new ModerationNotifier({
    fetchImpl: async () => {
      deliveries += 1
      await new Promise((resolve) => setImmediate(resolve))
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ errcode: 0 })
      }
    }
  })
  notifier.replaceTargets([])
  const target = {
    provider: 'wecom',
    webhook: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=concurrent-test-key'
  }

  const results = await Promise.allSettled([
    notifier.testTarget(target),
    notifier.testTarget(target)
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason?.statusCode === 429).length, 1)
  assert.equal(deliveries, 1)
})
