import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createFeishuAuth,
  isAllowedFeishuRedirectUri,
  isValidFeishuAppId,
  isValidFeishuChatId,
  safeNextPath
} from '../src/services/feishuAuth.js'

const configured = {
  secretKey: 'test-feishu-secret-key',
  publicSiteUrl: 'https://wall.zongtech.xyz',
  allowedOrigins: ['https://wall.zongtech.xyz'],
  appId: 'cli_testdevapp0001',
  appSecret: 'rotated-test-secret',
  chatId: 'oc_a0553eda9014c201e6969b478895c230',
  redirectUri: 'https://api-wall.zongtech.xyz/api/user/feishu/callback',
  timeoutMs: 50
}

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
})

const createMockFetch = (handlers) => async (url, options = {}) => {
  const href = String(url)
  const match = handlers.find((handler) => href.includes(handler.includes))
  if (!match) throw new Error(`unexpected fetch: ${href}`)
  return match.respond(href, options)
}

test('safe next path rejects open redirects and admin/login targets', () => {
  assert.equal(safeNextPath('/lost-found'), '/lost-found')
  assert.equal(safeNextPath('/me/posts?tab=1'), '/me/posts?tab=1')
  assert.equal(safeNextPath('https://evil.example/phish'), '/me')
  assert.equal(safeNextPath('//evil.example'), '/me')
  assert.equal(safeNextPath('/\\evil'), '/me')
  assert.equal(safeNextPath('/login'), '/me')
  assert.equal(safeNextPath('/admin/users'), '/me')
  assert.equal(safeNextPath('/login?next=/me'), '/me')
})

test('feishu identifiers reject names and open redirects', () => {
  assert.equal(isValidFeishuAppId('cli_testdevapp0001'), true)
  assert.equal(isValidFeishuAppId('not-an-id'), false)
  assert.equal(isValidFeishuChatId('oc_a0553eda9014c201e6969b478895c230'), true)
  assert.equal(isValidFeishuChatId('观澜中学校园墙'), false)
  assert.equal(isValidFeishuChatId('../evil'), false)
  assert.equal(isAllowedFeishuRedirectUri('https://api-wall.zongtech.xyz/api/user/feishu/callback'), true)
  assert.equal(isAllowedFeishuRedirectUri('http://localhost:5412/api/user/feishu/callback'), true)
  assert.equal(isAllowedFeishuRedirectUri('http://evil.example/api/user/feishu/callback'), false)
  assert.equal(isAllowedFeishuRedirectUri('https://api-wall.zongtech.xyz/api/user/login'), false)
})

test('oauth state is bound to nonce cookie and expires', () => {
  let now = 1_000_000
  const auth = createFeishuAuth({ nowFn: () => now, readConfig: () => configured })
  const created = auth.createState('/lost-found')
  assert.equal(auth.parseState(created.state, created.nonce).ok, true)
  assert.equal(auth.parseState(created.state, created.nonce).next, '/lost-found')
  assert.equal(auth.parseState(created.state, 'other-nonce').ok, false)
  assert.equal(auth.parseState(`${created.state}tampered`, created.nonce).ok, false)
  now += 11 * 60 * 1000
  assert.equal(auth.parseState(created.state, created.nonce).ok, false)
})

test('error redirects go to /login and success next stays on the public site', () => {
  const auth = createFeishuAuth({ readConfig: () => configured })
  assert.equal(
    auth.frontendUrl('/lost-found', 'not_in_group'),
    'https://wall.zongtech.xyz/login?feishu_error=not_in_group'
  )
  assert.equal(auth.frontendUrl('/lost-found'), 'https://wall.zongtech.xyz/lost-found')
})

test('authorize URL uses official accounts host and signed state', () => {
  const auth = createFeishuAuth({ readConfig: () => configured })
  const { state } = auth.createState('/me')
  const url = new URL(auth.buildAuthorizeUrl(state))
  assert.equal(url.origin, 'https://accounts.feishu.cn')
  assert.equal(url.searchParams.get('client_id'), configured.appId)
  assert.equal(url.searchParams.get('redirect_uri'), configured.redirectUri)
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('state'), state)
})

test('login refuses users when the bot is not in the configured chat', async () => {
  const fetchFn = createMockFetch([
    {
      includes: '/auth/v3/tenant_access_token/internal',
      respond: () => jsonResponse({ code: 0, tenant_access_token: 't-test', expire: 7200 })
    },
    {
      includes: '/oauth/token',
      respond: () => jsonResponse({ code: 0, access_token: 'u-test' })
    },
    {
      includes: '/authen/v1/user_info',
      respond: () => jsonResponse({ code: 0, data: { open_id: 'ou_member', name: '同学甲', user_id: 'u1' } })
    },
    {
      includes: '/members/is_in_chat',
      respond: () => jsonResponse({ code: 0, data: { is_in_chat: false } })
    }
  ])
  const auth = createFeishuAuth({ fetchFn, readConfig: () => configured })
  const result = await auth.completeLogin('code-1')
  assert.deepEqual(result, { ok: false, reason: 'not_in_group' })
})

test('login refuses users missing from the chat member list', async () => {
  const fetchFn = createMockFetch([
    {
      includes: '/auth/v3/tenant_access_token/internal',
      respond: () => jsonResponse({ code: 0, tenant_access_token: 't-test', expire: 7200 })
    },
    {
      includes: '/oauth/token',
      respond: () => jsonResponse({ code: 0, access_token: 'u-test' })
    },
    {
      includes: '/authen/v1/user_info',
      respond: () => jsonResponse({ code: 0, data: { open_id: 'ou_outsider', name: '校外', user_id: 'u2' } })
    },
    {
      includes: '/members/is_in_chat',
      respond: () => jsonResponse({ code: 0, data: { is_in_chat: true } })
    },
    {
      includes: '/members?',
      respond: () => jsonResponse({
        code: 0,
        data: { items: [{ member_id: 'ou_someone_else' }], has_more: false }
      })
    }
  ])
  const auth = createFeishuAuth({ fetchFn, readConfig: () => configured })
  const result = await auth.completeLogin('code-2')
  assert.deepEqual(result, { ok: false, reason: 'not_in_group' })
})

test('login succeeds only after bot and open_id membership checks', async () => {
  const fetchFn = createMockFetch([
    {
      includes: '/auth/v3/tenant_access_token/internal',
      respond: () => jsonResponse({ code: 0, tenant_access_token: 't-test', expire: 7200 })
    },
    {
      includes: '/oauth/token',
      respond: () => jsonResponse({ code: 0, access_token: 'u-test' })
    },
    {
      includes: '/authen/v1/user_info',
      respond: () => jsonResponse({ code: 0, data: { open_id: 'ou_member', name: '同学甲', user_id: 'u1' } })
    },
    {
      includes: '/members/is_in_chat',
      respond: () => jsonResponse({ code: 0, data: { is_in_chat: true } })
    },
    {
      includes: '/members?',
      respond: (href) => jsonResponse({
        code: 0,
        data: href.includes('page_token=p2')
          ? { items: [{ member_id: 'ou_member', name: '同学甲' }], has_more: false }
          : { items: [{ member_id: 'ou_other' }], has_more: true, page_token: 'p2' }
      })
    }
  ])
  const auth = createFeishuAuth({ fetchFn, readConfig: () => configured })
  const result = await auth.completeLogin('code-3')
  assert.equal(result.ok, true)
  assert.equal(result.user.openId, 'ou_member')
  assert.equal(result.user.name, '同学甲')
})

test('feishu HTTP failures do not leak upstream messages and ignore redirects', async () => {
  const authRedirect = createFeishuAuth({
    fetchFn: async () => {
      const error = new TypeError('redirect')
      error.code = 'ERR_INVALID_REDIRECT'
      throw error
    },
    readConfig: () => configured
  })
  await assert.rejects(authRedirect.completeLogin('code'), (error) => {
    assert.equal(error.reason, 'oauth_failed')
    assert.equal(error.message.includes('secret'), false)
    return true
  })

  const authBody = createFeishuAuth({
    fetchFn: async () => jsonResponse({ code: 9999, msg: 'app secret invalid leaked-value' }),
    readConfig: () => configured
  })
  await assert.rejects(authBody.completeLogin('code'), (error) => {
    assert.equal(error.reason, 'oauth_failed')
    assert.doesNotMatch(String(error.message), /leaked-value|secret/i)
    return true
  })
})
