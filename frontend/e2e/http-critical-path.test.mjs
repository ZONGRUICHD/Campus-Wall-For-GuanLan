import assert from 'node:assert/strict'
import test from 'node:test'

const configuredBaseUrl = String(process.env.E2E_BASE_URL || '').trim().replace(/\/+$/, '')
const hasBaseUrl = Boolean(configuredBaseUrl)
const baseSkip = 'HTTP E2E requires E2E_BASE_URL (for example http://127.0.0.1:5412)'
const allowWrites = /^(1|true|yes)$/i.test(String(process.env.E2E_ALLOW_WRITES || ''))
const writeSkip = !hasBaseUrl
  ? baseSkip
  : 'feedback round-trip requires explicit E2E_ALLOW_WRITES=1'

const endpoint = (path) => `${configuredBaseUrl}${path}`

const json = async (response) => {
  const contentType = response.headers.get('content-type') || ''
  assert.match(contentType, /application\/json/)
  return response.json()
}

const assertPublicJson = (value) => {
  if (Array.isArray(value)) {
    value.forEach(assertPublicJson)
    return
  }
  if (!value || typeof value !== 'object') return
  assert.equal(Object.hasOwn(value, 'username'), false)
  assert.equal(Object.hasOwn(value, 'real_name'), false)
  assert.equal(Object.hasOwn(value, 'password_hash'), false)
  assert.equal(Object.hasOwn(value, 'password_salt'), false)
  if (value.anonymous === true) assert.equal(Object.hasOwn(value, 'user_id'), false)
  Object.values(value).forEach(assertPublicJson)
}

test('health and anonymous session probes are safe', {
  skip: hasBaseUrl ? false : baseSkip
}, async () => {
  const healthResponse = await fetch(endpoint('/health'))
  assert.equal(healthResponse.status, 200)
  assert.deepEqual(await json(healthResponse), { status: 'ok' })

  const sessionResponse = await fetch(endpoint('/api/user/session'))
  assert.equal(sessionResponse.status, 200)
  const session = await json(sessionResponse)
  assert.equal(session.success, false)
  assertPublicJson(session)
})

test('public configuration and message windows do not disclose private policy or identity data', {
  skip: hasBaseUrl ? false : baseSkip
}, async () => {
  const configResponse = await fetch(endpoint('/api/community/config'))
  assert.equal(configResponse.status, 200)
  assert.match(configResponse.headers.get('cache-control') || '', /no-store/i)
  const community = await json(configResponse)
  assert.equal(Object.hasOwn(community.community, 'sensitive_words'), false)

  const messagesResponse = await fetch(endpoint('/api/get_messages?start=0&end=5'))
  assert.equal(messagesResponse.status, 200)
  const messages = await json(messagesResponse)
  assert.ok(Array.isArray(messages.data))
  assertPublicJson(messages)
})

test('trusted-origin writes reject hostile and missing origins before request processing', {
  skip: hasBaseUrl ? false : baseSkip
}, async () => {
  const hostile = await fetch(endpoint('/api/help/form'), {
    method: 'POST',
    headers: {
      origin: 'https://hostile.invalid',
      'content-type': 'application/json'
    },
    body: '{}'
  })
  assert.equal(hostile.status, 403)

  const missing = await fetch(endpoint('/api/help/form'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  })
  assert.equal(missing.status, 403)
})

test('unknown feedback and report tracking codes return a uniform not-found response', {
  skip: hasBaseUrl ? false : baseSkip
}, async () => {
  for (const path of [
    '/api/help/status/not-a-valid-tracking-code',
    '/api/help/report/status/not-a-valid-tracking-code'
  ]) {
    const response = await fetch(endpoint(path))
    assert.equal(response.status, 404)
    const body = await json(response)
    assert.equal(body.success, false)
    assert.equal(JSON.stringify(body).includes('@'), false)
  }
})

test('feedback submission returns a queryable, redacted tracking record', {
  skip: hasBaseUrl && allowWrites ? false : writeSkip
}, async () => {
  const form = new FormData()
  form.append('category', 'bug')
  form.append('title', 'E2E tracking check')
  form.append('email', 'private-e2e@example.test')
  form.append('text', `E2E private body ${Date.now()}`)

  const trustedOrigin = process.env.E2E_TRUSTED_ORIGIN || new URL(configuredBaseUrl).origin
  const createdResponse = await fetch(endpoint('/api/help/form'), {
    method: 'POST',
    headers: { origin: trustedOrigin },
    body: form
  })
  assert.equal(createdResponse.status, 200)
  const created = await json(createdResponse)
  assert.match(created.ticket_id, /^[a-f0-9]{32}$/)

  const statusResponse = await fetch(endpoint(`/api/help/status/${created.ticket_id}`))
  assert.equal(statusResponse.status, 200)
  const status = await json(statusResponse)
  assert.equal(status.ticket.id, created.ticket_id)
  assert.equal(status.ticket.status, 'pending')
  assert.equal(Object.hasOwn(status.ticket, 'email'), false)
  assert.equal(Object.hasOwn(status.ticket, 'text'), false)
  assert.equal(JSON.stringify(status).includes('private-e2e@example.test'), false)
  assert.equal(JSON.stringify(status).includes('E2E private body'), false)
})
