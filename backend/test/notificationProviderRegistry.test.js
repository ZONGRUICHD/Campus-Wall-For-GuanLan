import assert from 'node:assert/strict'
import test from 'node:test'
import { config } from '../src/config.js'
import { ModerationNotifier } from '../src/services/moderationNotifier.js'
import {
  createNotificationProviderRegistry,
  getNotificationProvider,
  listNotificationProviders,
  notificationProviderManifest,
  validateNotificationTarget
} from '../src/services/notifications/providerRegistry.js'

test('provider registry exposes only privacy-safe static metadata', () => {
  assert.deepEqual(listNotificationProviders().map((provider) => provider.id), ['feishu', 'wecom', 'email'])
  const manifest = notificationProviderManifest()
  assert.deepEqual(manifest.map((provider) => provider.id), ['feishu', 'wecom', 'email'])
  assert.equal(JSON.stringify(manifest).includes('webhook'), false)
  assert.equal(JSON.stringify(manifest).includes('secret'), false)
  assert.equal(manifest.every((provider) => ['group', 'email'].includes(provider.capabilities.destination)), true)
  assert.equal(manifest.every((provider) => provider.capabilities.supportsCallbacks === false), true)
  assert.equal(manifest.every((provider) => typeof provider.description === 'string' && provider.description.length > 0), true)
})

test('provider registry rejects duplicate or incomplete adapters at startup', () => {
  const valid = getNotificationProvider('feishu')
  assert.throws(() => createNotificationProviderRegistry([valid, valid]), /Duplicate notification provider/)
  assert.throws(
    () => createNotificationProviderRegistry([{ ...valid, id: 'unfinished', classifyResponse: undefined }]),
    /missing classifyResponse/
  )
})

test('unknown providers fail closed before any target or network handling', async () => {
  assert.equal(getNotificationProvider('unknown'), null)
  assert.deepEqual(
    validateNotificationTarget({ provider: 'unknown', webhook: 'https://example.com/hook' }),
    { valid: false, reason: 'unsupported_provider' }
  )

  let fetchCalls = 0
  const notifier = new ModerationNotifier({
    fetchImpl: async () => {
      fetchCalls += 1
      throw new Error('network must not be reached')
    }
  })
  notifier.targets = [{ provider: 'unknown', webhook: 'https://example.com/hook' }]

  await assert.rejects(
    notifier.deliver([{ provider: 'unknown', message_id: 7, payload: { message_id: 7, category: '校园动态' } }], 1),
    (error) => error?.permanent === true && /unavailable/.test(error.message)
  )
  assert.equal(fetchCalls, 0)
})

test('registered provider owns payload construction and response classification', async () => {
  let captured = null
  const notifier = new ModerationNotifier({
    fetchImpl: async (url, options) => {
      captured = { url, options }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ code: 0 })
      }
    }
  })
  notifier.targets = [{
    provider: 'feishu',
    webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token',
    secret: 'test-secret'
  }]

  await notifier.deliver([{
    provider: 'feishu',
    message_id: 8,
    payload: {
      message_id: 8,
      category: '校园动态',
      moderation_scope: 'posts',
      submitted_at: '2026-08-26T00:00:00Z',
      attachment_count: 0,
      has_poll: false
    }
  }], 2)

  assert.equal(captured.url, notifier.targets[0].webhook)
  assert.equal(captured.options.redirect, 'error')
  assert.equal(captured.options.method, 'POST')
  const body = JSON.parse(captured.options.body)
  assert.equal(body.msg_type, 'interactive')
  assert.equal(typeof body.sign, 'string')
  assert.equal(JSON.stringify(body).includes('test-secret'), false)

  notifier.targets = [{
    provider: 'wecom',
    webhook: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key',
    secret: ''
  }]
  notifier.fetchImpl = async (url, options) => {
    captured = { url, options }
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ errcode: 0, errmsg: 'ok' })
    }
  }
  await notifier.deliver([{
    provider: 'wecom',
    message_id: 10,
    payload: {
      message_id: 10,
      category: '表白墙便签',
      moderation_scope: 'confessions',
      submitted_at: '2026-08-26T00:01:00Z'
    }
  }], 1)
  assert.equal(captured.url, notifier.targets[0].webhook)
  assert.equal(captured.options.redirect, 'error')
  assert.equal(JSON.parse(captured.options.body).msgtype, 'markdown_v2')
})

test('delivery keeps retry, permanent failure and timeout semantics behind the provider contract', async () => {
  const job = {
    provider: 'wecom',
    message_id: 9,
    payload: {
      message_id: 9,
      category: '校园动态',
      moderation_scope: 'posts',
      submitted_at: '2026-08-26T00:00:00Z'
    }
  }
  const target = {
    provider: 'wecom',
    webhook: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key',
    secret: ''
  }

  const rateLimited = new ModerationNotifier({
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '2' }),
      json: async () => ({ errcode: 45009, errmsg: 'rate limited https://secret.invalid/token' })
    })
  })
  rateLimited.targets = [target]
  await assert.rejects(rateLimited.deliver([job], 1), (error) => {
    assert.equal(error.permanent, false)
    assert.equal(error.retryAfterMs, 2000)
    assert.equal(error.message.includes('secret.invalid'), false)
    return true
  })

  const invalidResponse = new ModerationNotifier({
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      headers: new Headers(),
      json: async () => { throw new Error('invalid json') }
    })
  })
  invalidResponse.targets = [target]
  await assert.rejects(invalidResponse.deliver([job], 1), (error) => error.permanent === true && /http_400/.test(error.message))

  const previousTimeout = config.moderationNotifyTimeoutMs
  const keepAlive = setTimeout(() => {}, 250)
  config.moderationNotifyTimeoutMs = 10
  try {
    const timedOut = new ModerationNotifier({
      fetchImpl: async (_url, { signal }) => await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    })
    timedOut.targets = [target]
    await assert.rejects(timedOut.deliver([job], 1), /wecom: timeout/)
  } finally {
    clearTimeout(keepAlive)
    config.moderationNotifyTimeoutMs = previousTimeout
  }
})
