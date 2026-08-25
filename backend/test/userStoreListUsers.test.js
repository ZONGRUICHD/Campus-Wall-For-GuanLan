import assert from 'node:assert/strict'
import test from 'node:test'
import { UserStore } from '../src/services/userStore.js'

const aggregateRow = (overrides = {}) => ({
  filtered_total: 250,
  total: 10050,
  active: 9800,
  disabled: 250,
  muted: 12,
  role_user: 10000,
  role_reviewer: 30,
  role_admin: 15,
  role_super_admin: 5,
  ...overrides
})

test('listUsers performs bounded server-side pagination with filtered totals and aggregate stats', async () => {
  const store = new UserStore()
  await store.pool.end()
  const calls = []
  store.pool = {
    query: async (sql, values = []) => {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), values })
      if (calls.length === 1) return { rows: [aggregateRow()] }
      return {
        rows: [{
          id: 301,
          username: 'admin_a',
          username_key: 'admin_a',
          nickname: '管理员 A',
          real_name: '',
          role: 'admin',
          status: 'active',
          gender: 0,
          bio: '',
          mute_reason: '',
          muted_until: null,
          created_at: '2026-08-01T00:00:00.000Z',
          updated_at: '2026-08-01T00:00:00.000Z',
          last_login_at: null
        }]
      }
    }
  }

  const result = await store.listUsers({
    page: 4,
    pageSize: 500,
    q: `Admin_%\\${'A'.repeat(100)}`,
    status: 'active',
    muted: 'true',
    role: 'admin',
    sortBy: 'username',
    sortOrder: 'asc'
  })

  assert.equal(calls.length, 2)
  assert.match(calls[0].sql, /^WITH filtered AS \( SELECT id FROM users WHERE/)
  assert.match(calls[0].sql, /username_key LIKE \$1 ESCAPE/)
  assert.match(calls[0].sql, /status = \$2/)
  assert.match(calls[0].sql, /role = \$3/)
  assert.match(calls[0].sql, /muted_until IS NOT NULL AND muted_until > now\(\)/)
  assert.equal(calls[0].values.length, 3)
  assert.ok(calls[0].values[0].endsWith('%'))
  assert.ok(calls[0].values[0].length <= 69, 'search input is truncated before wildcard escaping')
  assert.ok(calls[0].values[0].includes('\\_\\%\\\\'), 'SQL wildcard characters are escaped')
  assert.deepEqual(calls[0].values.slice(1), ['active', 'admin'])

  assert.match(calls[1].sql, /ORDER BY username_key ASC, id ASC LIMIT \$4 OFFSET \$5$/)
  assert.deepEqual(calls[1].values.slice(-2), [100, 200])
  assert.equal(result.page, 3, 'out-of-range pages are clamped after the count query')
  assert.equal(result.page_size, 100)
  assert.equal(result.total, 250)
  assert.equal(result.total_pages, 3)
  assert.equal(result.users[0].username, 'admin_a')
  assert.deepEqual(result.stats, {
    total: 10050,
    active: 9800,
    disabled: 250,
    muted: 12,
    by_role: { user: 10000, reviewer: 30, admin: 15, super_admin: 5 }
  })
})

test('listUsers ignores unsupported filters and sort SQL while supporting exact numeric IDs', async () => {
  const store = new UserStore()
  await store.pool.end()
  const calls = []
  store.pool = {
    query: async (sql, values = []) => {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), values })
      if (calls.length === 1) return { rows: [aggregateRow({ filtered_total: 0 })] }
      return { rows: [] }
    }
  }

  const result = await store.listUsers({
    page: -8,
    pageSize: 1,
    q: '42',
    status: 'not-a-status',
    role: 'owner',
    sortBy: 'created_at; DROP TABLE users',
    sortOrder: 'sideways'
  })

  assert.match(calls[0].sql, /OR id = \$2/)
  assert.doesNotMatch(calls[1].sql, /DROP TABLE/)
  assert.match(calls[1].sql, /ORDER BY created_at DESC, id DESC LIMIT \$3 OFFSET \$4$/)
  assert.deepEqual(calls[0].values, ['42%', 42])
  assert.deepEqual(calls[1].values.slice(-2), [10, 0])
  assert.equal(result.page, 1)
  assert.equal(result.page_size, 10)
  assert.equal(result.total_pages, 0)
  assert.equal(result.sort_by, 'created_at')
  assert.equal(result.sort_order, 'desc')
})
