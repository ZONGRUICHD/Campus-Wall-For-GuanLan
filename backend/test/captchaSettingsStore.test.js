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

test('captcha settings encrypt the secret and expose action-scoped public config', async () => {
  const store = new SettingsStore()
  const pool = memorySettingsPool()
  store.pool = pool
  const secret = 'production-turnstile-secret'

  const admin = await store.updateCaptcha({
    enabled: true,
    provider: 'turnstile',
    site_key: '0x4AAAA-test-site-key',
    secret_key: secret,
    protect_login: true,
    protect_register: false,
    protect_admin_login: true,
    allowed_hostnames: 'wall.zongtech.xyz\nwall-preview.zongtech.xyz'
  }, { actor: 'ZongRui' })

  assert.equal(admin.enabled, true)
  assert.equal(admin.configured, true)
  assert.equal(admin.has_secret, true)
  assert.equal(admin.updated_by, 'ZongRui')
  assert.deepEqual(admin.allowed_hostnames, ['wall.zongtech.xyz', 'wall-preview.zongtech.xyz'])
  assert.equal(JSON.stringify(admin).includes(secret), false)
  assert.equal(JSON.stringify(pool.rows.get('captcha')?.data).includes(secret), false)

  const runtime = await store.captchaRuntime()
  assert.equal(runtime.secret_key, secret)
  assert.deepEqual(await store.captchaPublic(), {
    enabled: true,
    provider: 'turnstile',
    site_key: '0x4AAAA-test-site-key',
    protected_actions: { login: true, register: false, admin_login: true }
  })
})

test('captcha secret is write-only, blank preserves it, and explicit clear fails closed', async () => {
  const store = new SettingsStore()
  store.pool = memorySettingsPool()
  await store.updateCaptcha({
    enabled: true,
    provider: 'turnstile',
    site_key: 'site-key',
    secret_key: 'secret-key',
    allowed_hostnames: 'wall.zongtech.xyz'
  })

  const preserved = await store.updateCaptcha({
    enabled: false,
    provider: 'turnstile',
    site_key: 'site-key',
    secret_key: '',
    allowed_hostnames: 'wall.zongtech.xyz'
  })
  assert.equal(preserved.has_secret, true)

  const cleared = await store.updateCaptcha({
    enabled: false,
    provider: 'turnstile',
    site_key: 'site-key',
    clear_secret: true,
    allowed_hostnames: 'wall.zongtech.xyz'
  })
  assert.equal(cleared.enabled, false)
  assert.equal(cleared.has_secret, false)
  assert.equal(cleared.configured, false)
  await assert.rejects(store.updateCaptcha({
    enabled: true,
    provider: 'turnstile',
    site_key: 'site-key',
    allowed_hostnames: 'wall.zongtech.xyz'
  }), /服务端密钥/)
})

test('production captcha settings reject Cloudflare always-pass test keys', async () => {
  const previousEnvironment = config.environment
  const store = new SettingsStore()
  store.pool = memorySettingsPool()
  try {
    config.environment = 'production'
    await assert.rejects(store.updateCaptcha({
      enabled: true,
      provider: 'turnstile',
      site_key: '1x00000000000000000000AA',
      secret_key: '1x0000000000000000000000000000000AA',
      allowed_hostnames: 'wall.zongtech.xyz'
    }), /不能使用.*测试密钥/)
  } finally {
    config.environment = previousEnvironment
  }
})
