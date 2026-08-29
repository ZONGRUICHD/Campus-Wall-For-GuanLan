import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyCaptchaToken } from '../src/services/captcha.js'

const settings = Object.freeze({
  provider: 'turnstile',
  site_key: 'site-key',
  secret_key: 'secret-key',
  allowed_hostnames: ['wall.zongtech.xyz']
})

test('Turnstile validation sends the token server-side and checks action plus hostname', async () => {
  let request = null
  const result = await verifyCaptchaToken({
    token: 'browser-token',
    remoteIp: '203.0.113.7',
    expectedAction: 'login',
    settings,
    fetchImpl: async (url, options) => {
      request = { url, options }
      return {
        ok: true,
        async json() {
          return { success: true, action: 'login', hostname: 'wall.zongtech.xyz', challenge_ts: '2026-08-29T12:00:00Z' }
        }
      }
    }
  })

  assert.equal(result.success, true)
  assert.equal(request.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify')
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.body.get('secret'), 'secret-key')
  assert.equal(request.options.body.get('response'), 'browser-token')
  assert.equal(request.options.body.get('remoteip'), '203.0.113.7')
  assert.match(request.options.body.get('idempotency_key'), /^[0-9a-f-]{36}$/)
})

test('Turnstile validation rejects replay-like action and hostname mismatches', async () => {
  const actionMismatch = await verifyCaptchaToken({
    token: 'token-one',
    expectedAction: 'register',
    settings,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ success: true, action: 'login', hostname: 'wall.zongtech.xyz' })
    })
  })
  assert.equal(actionMismatch.code, 'CAPTCHA_ACTION_MISMATCH')

  const hostnameMismatch = await verifyCaptchaToken({
    token: 'token-two',
    expectedAction: 'login',
    settings,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ success: true, action: 'login', hostname: 'evil.example' })
    })
  })
  assert.equal(hostnameMismatch.code, 'CAPTCHA_HOSTNAME_MISMATCH')
})

test('Turnstile validation rejects missing, oversized and upstream-rejected tokens', async () => {
  assert.equal((await verifyCaptchaToken({ token: '', settings })).code, 'CAPTCHA_REQUIRED')
  assert.equal((await verifyCaptchaToken({ token: 'x'.repeat(2049), settings })).code, 'CAPTCHA_TOKEN_INVALID')
  const rejected = await verifyCaptchaToken({
    token: 'rejected-token',
    settings,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['timeout-or-duplicate'] })
    })
  })
  assert.equal(rejected.code, 'CAPTCHA_REJECTED')
  assert.deepEqual(rejected.upstream_codes, ['timeout-or-duplicate'])
})
