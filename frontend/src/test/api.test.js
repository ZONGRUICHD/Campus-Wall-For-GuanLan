import assert from 'node:assert/strict'
import test from 'node:test'
import api from '../services/api.js'

const jsonResponse = (data) => new Response(JSON.stringify(data), {
  status: 200,
  headers: { 'content-type': 'application/json' }
})

const withFetch = async (implementation, callback) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = implementation
  try {
    await callback()
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('admin API request contracts', async (t) => {
  const originalWindow = globalThis.window
  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  }
  t.after(() => {
    globalThis.window = originalWindow
  })

  await t.test('submits biography when an administrator edits a user', async () => {
    let request
    await withFetch(async (url, options) => {
      request = { url, options }
      return jsonResponse({ success: true })
    }, () => api.adminUpdateUser(17, {
      real_name: '张三',
      nickname: '小张',
      gender: 1,
      bio: '校园摄影爱好者',
      status: 'active'
    }))

    assert.equal(request.url, '/api/admin/users/17')
    assert.equal(request.options.method, 'PUT')
    assert.equal(request.options.body.get('bio'), '校园摄影爱好者')
  })

  await t.test('sends purge confirmation as JSON in DELETE request bodies', async () => {
    const requests = []
    await withFetch(async (url, options) => {
      requests.push({ url, options })
      return jsonResponse({ success: true })
    }, async () => {
      await api.adminPurgeTrashMessage(23)
      await api.adminPurgeTrashComment(23, 'comment/1')
    })

    assert.deepEqual(requests.map(({ url }) => url), [
      '/api/admin/trash/messages/23',
      '/api/admin/trash/comments/23/comment%2F1'
    ])
    requests.forEach(({ options }) => {
      assert.equal(options.method, 'DELETE')
      assert.equal(options.headers.get('content-type'), 'application/json')
      assert.deepEqual(JSON.parse(options.body), { confirm: 'PURGE' })
    })
  })

  await t.test('caches verified admin data without skipping backend verification', async () => {
    let requestCount = 0
    await withFetch(async () => {
      requestCount += 1
      return jsonResponse({
        success: true,
        admin: { username: `admin-${requestCount}`, permissions: [] }
      })
    }, async () => {
      await api.adminVerify()
      await api.adminVerify()
    })

    assert.equal(requestCount, 2)
    assert.equal(api.adminGetCachedAdmin().username, 'admin-2')
  })
})
