import assert from 'node:assert/strict'
import test from 'node:test'

import {
  communityDefaults,
  SettingsStore
} from '../src/services/settingsStore.js'

class MemorySettingsPool {
  constructor() {
    this.records = new Map()
  }

  async query(sql, params = []) {
    if (/SELECT data(?:, updated_at)? FROM platform_settings/.test(sql)) {
      const data = this.records.get(params[0])
      return data
        ? {
            rowCount: 1,
            rows: [{
              data: structuredClone(data),
              updated_at: '2026-08-24T07:19:00.000Z'
            }]
          }
        : { rowCount: 0, rows: [] }
    }
    if (/INSERT INTO platform_settings/.test(sql)) {
      this.records.set(params[0], JSON.parse(params[1]))
      return { rowCount: 1, rows: [] }
    }
    throw new Error(`Unexpected test query: ${sql}`)
  }
}

const createStore = async () => {
  const store = new SettingsStore()
  await store.pool.end()
  store.pool = new MemorySettingsPool()
  return store
}

test('community settings normalize sensitive words and redact them publicly', async () => {
  const store = await createStore()
  const admin = await store.updateCommunity({
    ...communityDefaults,
    pause_reason: '  scheduled maintenance  ',
    sensitive_words: ['ＢＡＤ', 'bad', 'zero\u200bword', '  another  ']
  })

  assert.equal(admin.pause_reason, 'scheduled maintenance')
  assert.deepEqual(
    admin.sensitive_words.map((word) => word.normalize('NFKC').toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, '')),
    ['bad', 'zeroword', 'another']
  )

  const publicSettings = await store.communityPublic()
  assert.equal(Object.hasOwn(publicSettings, 'sensitive_words'), false)
  assert.equal(JSON.stringify(publicSettings).includes('ＢＡＤ'), false)
})

test('server-side policy enforces platform, guest, and sensitive-word rules', async () => {
  const store = await createStore()
  const base = {
    ...communityDefaults,
    sensitive_words: ['ＢＡＤ', 'zero\u200bword']
  }

  store.communityRuntime = async () => ({ ...base, posting_enabled: false })
  assert.deepEqual(
    await store.checkCommunityWrite('post', { values: ['ordinary'] }),
    {
      success: false,
      statusCode: 403,
      code: 'POSTING_DISABLED',
      error: '管理员暂时关闭了发帖功能'
    }
  )

  store.communityRuntime = async () => ({
    ...base,
    commenting_enabled: false,
    pause_reason: 'comments paused'
  })
  assert.equal((await store.checkCommunityWrite('comment', { values: ['ordinary'] })).code, 'COMMENTING_DISABLED')

  store.communityRuntime = async () => ({ ...base, guest_posting_enabled: false })
  const guestDenied = await store.checkCommunityWrite('post', { values: ['ordinary'] })
  assert.equal(guestDenied.statusCode, 401)
  assert.equal(guestDenied.code, 'GUEST_POSTING_DISABLED')
  assert.equal(
    (await store.checkCommunityWrite('post', {
      user: { id: 1 },
      values: ['ordinary']
    })).success,
    true
  )

  store.communityRuntime = async () => ({ ...base })
  for (const content of ['prefix bad suffix', 'ZEROword', 'safe title', 'ＢＡＤ']) {
    const result = await store.checkCommunityWrite('post', {
      values: content === 'safe title' ? [content, 'zero\u200bword in a tag'] : [content]
    })
    assert.equal(result.code, 'CONTENT_POLICY_REJECTED', `expected rejection for ${content}`)
  }
  assert.equal((await store.checkCommunityWrite('comment', {
    values: ['ordinary content']
  })).success, true)
})

test('sensitive-word count and length limits reject invalid settings', async () => {
  const store = await createStore()
  await assert.rejects(
    store.updateCommunity({
      ...communityDefaults,
      sensitive_words: ['x'.repeat(51)]
    }),
    /单个敏感词不能超过 50 个字符/
  )
  await assert.rejects(
    store.updateCommunity({
      ...communityDefaults,
      sensitive_words: Array.from({ length: 201 }, (_, index) => `word-${index}`)
    }),
    /敏感词不能超过 200 个/
  )
  await assert.rejects(
    store.updateCommunity({
      ...communityDefaults,
      pause_reason: 'x'.repeat(301)
    }),
    /暂停说明不能超过 300 个字符/
  )
})
