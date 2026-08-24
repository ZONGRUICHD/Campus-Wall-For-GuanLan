import assert from 'node:assert/strict'
import test from 'node:test'

import { config } from '../src/config.js'
import {
  adminCookieOptions,
  createSession as createAdminSession,
  isTrustedAdminOrigin,
  readSession as readAdminSession,
  verifyAdmin
} from '../src/services/auth.js'
import { managerStore } from '../src/services/managerStore.js'
import {
  UserStore,
  userCookieOptions,
  userSessionCookieName
} from '../src/services/userStore.js'

const tamper = (value) => `${value.slice(0, -1)}${value.endsWith('a') ? 'b' : 'a'}`

test('administrator sessions are signed, expire, and follow session-version invalidation', () => {
  const originalGet = managerStore.get
  const originalVerifySession = managerStore.verifySession
  const originalMaxAge = config.sessionMaxAge
  const manager = {
    username: 'root-admin',
    status: 'active',
    session_version: 7,
    permissions: []
  }

  managerStore.get = () => ({ ...manager })
  managerStore.verifySession = (username, version) => (
    username === manager.username
    && manager.status === 'active'
    && Number(version) === manager.session_version
  )

  try {
    const token = createAdminSession(manager.username)
    const request = { cookies: { admin_session: token } }
    assert.deepEqual(readAdminSession(request), [manager.username, '__signed_session__', 7])
    assert.equal(verifyAdmin(...readAdminSession(request)), true)

    manager.session_version += 1
    assert.equal(verifyAdmin(...readAdminSession(request)), false, 'a version bump must revoke an old cookie')
    assert.deepEqual(readAdminSession({ cookies: { admin_session: tamper(token) } }), ['', '', 0])

    config.sessionMaxAge = -1
    const expired = createAdminSession(manager.username)
    assert.deepEqual(readAdminSession({ cookies: { admin_session: expired } }), ['', '', 0])
    assert.deepEqual(readAdminSession({ cookies: { admin_session: `${token}.extra` } }), ['', '', 0])
  } finally {
    managerStore.get = originalGet
    managerStore.verifySession = originalVerifySession
    config.sessionMaxAge = originalMaxAge
  }
})

test('student sessions reject tampering, expiry, disabled users, and stale versions', async () => {
  const store = new UserStore()
  await store.pool.end()
  const originalMaxAge = config.sessionMaxAge
  const row = {
    id: 42,
    username: '20260042',
    real_name: 'Private Name',
    nickname: 'Public Nickname',
    gender: 0,
    bio: '',
    status: 'active',
    session_version: 3,
    mute_reason: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
  store.getRawById = async () => ({ ...row })

  try {
    const token = store.createSession(row, row.session_version)
    const request = { cookies: { [userSessionCookieName]: token } }
    assert.equal((await store.getSessionUser(request))?.id, row.id)

    row.session_version += 1
    assert.equal(await store.getSessionUser(request), null, 'password/reset version changes must revoke old sessions')
    row.session_version -= 1
    row.status = 'disabled'
    assert.equal(await store.getSessionUser(request), null)
    row.status = 'active'

    assert.equal(await store.getSessionUser({
      cookies: { [userSessionCookieName]: tamper(token) }
    }), null)

    config.sessionMaxAge = -1
    const expired = store.createSession(row, row.session_version)
    assert.equal(await store.getSessionUser({
      cookies: { [userSessionCookieName]: expired }
    }), null)
    config.sessionMaxAge = originalMaxAge
    assert.equal(await store.getSessionUser({
      cookies: { [userSessionCookieName]: `${token}.extra` }
    }), null)
  } finally {
    config.sessionMaxAge = originalMaxAge
  }
})

test('session cookies keep browser-only security attributes', () => {
  for (const options of [adminCookieOptions(), userCookieOptions()]) {
    assert.equal(options.httpOnly, true)
    assert.equal(options.path, '/')
    assert.ok(['lax', 'strict', 'none'].includes(options.sameSite))
    assert.equal(typeof options.secure, 'boolean')
    assert.ok(options.maxAge > 0)
  }
})

test('write Origin evaluation accepts only same-origin or configured origins', () => {
  const originalAllowedOrigins = config.allowedOrigins
  config.allowedOrigins = ['https://frontend.example.test']

  const request = (headers = {}, protocol = 'https') => ({
    headers: {
      host: 'api.example.test',
      ...headers
    },
    protocol
  })

  try {
    assert.equal(isTrustedAdminOrigin(request({ origin: 'https://api.example.test' })), true)
    assert.equal(isTrustedAdminOrigin(request({ origin: 'https://api.example.test/' })), true)
    assert.equal(isTrustedAdminOrigin(request({ origin: 'https://frontend.example.test' })), true)
    assert.equal(isTrustedAdminOrigin(request({ referer: 'https://api.example.test/wall?from=test' })), true)
    assert.equal(isTrustedAdminOrigin(request({
      host: 'internal.example.test',
      origin: 'https://public.example.test',
      'x-forwarded-proto': 'https'
    })), false)
    assert.equal(isTrustedAdminOrigin(request({ origin: 'https://evil.example.test' })), false)
    assert.equal(isTrustedAdminOrigin(request({ referer: 'not a URL' })), false)
    assert.equal(
      isTrustedAdminOrigin(request()),
      false,
      'x-trusted-origin-required operations must not silently accept a missing Origin and Referer'
    )
  } finally {
    config.allowedOrigins = originalAllowedOrigins
  }
})
