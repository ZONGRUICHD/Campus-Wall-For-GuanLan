import assert from 'node:assert/strict'
import test from 'node:test'
import { config } from '../src/config.js'
import { SettingsStore } from '../src/services/settingsStore.js'

const memorySettingsPool = () => {
  const rows = new Map()
  return {
    rows,
    async query(sql, params = []) {
      if (sql.includes('SELECT data, updated_at FROM platform_settings')) {
        const row = rows.get(params[0])
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] }
      }
      if (sql.includes('INSERT INTO platform_settings')) {
        rows.set(params[0], { data: JSON.parse(params[1]), updated_at: new Date().toISOString() })
        return { rowCount: 1, rows: [] }
      }
      throw new Error(`Unexpected settings query: ${sql}`)
    }
  }
}

test('notification settings encrypt write-only credentials and expose only safe status', async () => {
  const store = new SettingsStore()
  const pool = memorySettingsPool()
  store.pool = pool
  const webhook = 'https://open.feishu.cn/open-apis/bot/v2/hook/sensitive-test-token'
  const secret = 'sensitive-signing-secret'

  const admin = await store.updateNotificationProvider('feishu', {
    enabled: true,
    webhook,
    secret
  }, { actor: 'ZongRui' })

  assert.deepEqual(admin.providers.map((provider) => provider.id), ['feishu', 'wecom', 'email'])
  const feishu = admin.providers.find((provider) => provider.id === 'feishu')
  assert.equal(feishu.enabled, true)
  assert.equal(feishu.configured, true)
  assert.equal(feishu.has_webhook, true)
  assert.equal(feishu.has_secret, true)
  assert.equal(feishu.updated_by, 'ZongRui')
  const publicJson = JSON.stringify(admin)
  assert.equal(publicJson.includes(webhook), false)
  assert.equal(publicJson.includes(secret), false)

  const storedJson = JSON.stringify(pool.rows.get('moderation_notification:feishu')?.data)
  assert.equal(storedJson.includes(webhook), false)
  assert.equal(storedJson.includes(secret), false)
  const target = await store.notificationTarget('feishu', { includeDisabled: true })
  assert.deepEqual(target, { provider: 'feishu', webhook, secret })
})

test('blank credential fields preserve saved values while explicit clear fails closed', async () => {
  const store = new SettingsStore()
  store.pool = memorySettingsPool()
  const webhook = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=sensitive-test-key'

  await store.updateNotificationProvider('wecom', { enabled: true, webhook }, { actor: 'ZongRui' })
  await store.updateNotificationProvider('wecom', { enabled: false, webhook: '', secret: '' }, { actor: 'ZongRui' })
  assert.deepEqual(await store.notificationTarget('wecom', { includeDisabled: true }), {
    provider: 'wecom',
    webhook,
    secret: ''
  })

  const cleared = await store.clearNotificationProvider('wecom', { actor: 'ZongRui' })
  const state = cleared.providers.find((provider) => provider.id === 'wecom')
  assert.equal(state.enabled, false)
  assert.equal(state.configured, false)
  assert.equal(state.has_webhook, false)
  assert.equal(await store.notificationTarget('wecom', { includeDisabled: true }), null)
})

test('notification settings reject unsupported providers, unsafe URLs and conflicting writes', async () => {
  const store = new SettingsStore()
  store.pool = memorySettingsPool()

  await assert.rejects(store.updateNotificationProvider('qq', { enabled: true }), /不支持的提醒渠道/)
  await assert.rejects(store.updateNotificationProvider('feishu', {
    enabled: true,
    webhook: 'https://open.feishu.cn.evil.example/open-apis/bot/v2/hook/token'
  }), /Webhook 地址无效/)
  await assert.rejects(store.updateNotificationProvider('wecom', {
    enabled: false,
    webhook: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=value',
    clear_webhook: true
  }), /不能同时填写并清除 Webhook/)
  await assert.rejects(store.updateNotificationProvider('email', {
    enabled: true,
    webhook: 'not-an-email'
  }), /有效的收件邮箱/)
})

test('environment notification credentials remain a fallback until a database row exists', async () => {
  const previous = {
    enabled: config.moderationNotifyEnabled,
    webhook: config.moderationNotifyWecomWebhook
  }
  const store = new SettingsStore()
  store.pool = memorySettingsPool()
  try {
    config.moderationNotifyEnabled = true
    config.moderationNotifyWecomWebhook = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=environment-key'
    const fromEnvironment = await store.notificationAdmin()
    const state = fromEnvironment.providers.find((provider) => provider.id === 'wecom')
    assert.equal(state.source, 'environment')
    assert.equal(state.enabled, true)
    assert.equal(state.configured, true)

    await store.clearNotificationProvider('wecom', { actor: 'ZongRui' })
    const databaseState = (await store.notificationAdmin()).providers.find((provider) => provider.id === 'wecom')
    assert.equal(databaseState.source, 'database')
    assert.equal(databaseState.enabled, false)
    assert.equal(databaseState.configured, false)
  } finally {
    config.moderationNotifyEnabled = previous.enabled
    config.moderationNotifyWecomWebhook = previous.webhook
  }
})
