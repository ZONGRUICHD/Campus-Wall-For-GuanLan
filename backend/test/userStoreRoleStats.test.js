import assert from 'node:assert/strict'
import test from 'node:test'
import { UserStore } from '../src/services/userStore.js'

test('roleStats returns active and disabled privileged-account totals', async () => {
  const store = new UserStore()
  await store.pool.end()
  let statement = ''
  store.pool = {
    query: async (sql) => {
      statement = String(sql).replace(/\s+/g, ' ').trim()
      return {
        rows: [
          { role: 'user', status: 'active', count: 20 },
          { role: 'reviewer', status: 'active', count: 3 },
          { role: 'reviewer', status: 'disabled', count: 1 },
          { role: 'admin', status: 'active', count: 2 },
          { role: 'admin', status: 'disabled', count: 2 },
          { role: 'super_admin', status: 'active', count: 1 }
        ]
      }
    }
  }

  const stats = await store.roleStats()

  assert.match(statement, /SELECT role, status, count\(\*\)::int AS count/)
  assert.match(statement, /GROUP BY role, status/)
  assert.deepEqual(stats, {
    user: 20,
    reviewer: 4,
    admin: 4,
    super_admin: 1,
    total: 9,
    active: 6,
    disabled: 3,
    super_admins: 1
  })
})
