import assert from 'node:assert/strict'
import test from 'node:test'
import { UserStore } from '../src/services/userStore.js'

const baseUser = (overrides = {}) => ({
  id: 2,
  username: 'student2',
  username_key: 'student2',
  role: 'user',
  status: 'active',
  permission_version: 4,
  session_version: 7,
  nickname: 'Student 2',
  real_name: '',
  gender: 0,
  bio: '',
  mute_reason: '',
  muted_until: null,
  permission_overrides: {},
  ...overrides
})

const permissionHarness = async ({ target = baseUser(), existingOverrides = [] } = {}) => {
  const store = new UserStore()
  await store.pool.end()
  const calls = []
  let overrides = [...existingOverrides]
  let nextTarget = { ...target }
  const client = {
    query: async (sql, values = []) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      calls.push({ sql: normalized, values })
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') return { rows: [], rowCount: 0 }
      if (normalized === 'SELECT * FROM users WHERE id = $1 FOR UPDATE') {
        if (Number(values[0]) === 1) return { rows: [baseUser({ id: 1, username: 'root', username_key: 'root', role: 'super_admin' })] }
        return { rows: [nextTarget] }
      }
      if (normalized.startsWith('SELECT permission_key, effect FROM user_permission_overrides')) return { rows: overrides }
      if (normalized === 'DELETE FROM user_permission_overrides WHERE user_id = $1') {
        const count = overrides.length
        overrides = []
        return { rows: [], rowCount: count }
      }
      if (normalized.startsWith('INSERT INTO user_permission_overrides')) {
        overrides = values[1].map((permissionKey, index) => ({ permission_key: permissionKey, effect: values[2][index] }))
        return { rows: [], rowCount: overrides.length }
      }
      if (normalized.startsWith('UPDATE users SET permission_version = permission_version + 1')) {
        nextTarget = {
          ...nextTarget,
          permission_version: Number(nextTarget.permission_version) + 1,
          session_version: Number(nextTarget.session_version) + 1
        }
        return { rows: [], rowCount: 1 }
      }
      if (normalized.includes('jsonb_object_agg') && normalized.endsWith('WHERE u.id = $1')) {
        return {
          rows: [{
            ...nextTarget,
            permission_overrides: Object.fromEntries(overrides.map((item) => [item.permission_key, item.effect]))
          }]
        }
      }
      throw new Error(`Unexpected SQL: ${normalized}`)
    },
    release: () => {}
  }
  store.pool = { connect: async () => client }
  return { store, calls }
}

test('replacePermissionOverrides writes one normalized batch and revokes existing sessions', async () => {
  const { store, calls } = await permissionHarness()
  const result = await store.replacePermissionOverrides({
    actorId: 1,
    targetId: 2,
    permissionVersion: 4,
    reason: '负责公告初审',
    allow: ['notice.read', 'notice.create'],
    deny: ['feedback.read']
  })

  assert.equal(result.success, true)
  assert.equal(result.changed, true)
  assert.equal(result.sessionRevoked, true)
  assert.equal(result.state.permission_version, 5)
  assert.deepEqual(result.state.overrides.allow, ['notice.create', 'notice.read'])
  assert.deepEqual(result.state.overrides.deny, ['feedback.read'])
  const inserts = calls.filter((call) => call.sql.startsWith('INSERT INTO user_permission_overrides'))
  assert.equal(inserts.length, 1, 'all overrides are inserted with one unnest query')
  assert.deepEqual(inserts[0].values[1], ['notice.create', 'notice.read', 'feedback.read'])
  assert.match(calls.find((call) => call.sql.startsWith('UPDATE users SET permission_version'))?.sql || '', /session_version = session_version \+ 1/)
})

test('replacePermissionOverrides rejects stale versions before changing rows', async () => {
  const { store, calls } = await permissionHarness()
  const result = await store.replacePermissionOverrides({
    actorId: 1,
    targetId: 2,
    permissionVersion: 3,
    reason: '过期修改',
    allow: ['notice.read'],
    deny: []
  })
  assert.equal(result.code, 'PERMISSION_VERSION_CONFLICT')
  assert.equal(result.statusCode, 409)
  assert.equal(calls.some((call) => call.sql.startsWith('DELETE FROM user_permission_overrides')), false)
})

test('reviewer and super-admin overrides are locked in the store boundary', async () => {
  for (const role of ['reviewer', 'super_admin']) {
    const { store } = await permissionHarness({ target: baseUser({ role }) })
    const result = await store.replacePermissionOverrides({
      actorId: 1,
      targetId: 2,
      permissionVersion: 4,
      reason: '不应保存',
      allow: ['notice.read'],
      deny: []
    })
    assert.equal(result.code, 'PERMISSION_OVERRIDES_LOCKED', role)
    assert.equal(result.statusCode, 409, role)
  }
})

test('a session_version change immediately invalidates an existing signed session', async () => {
  const store = new UserStore()
  await store.pool.end()
  const user = baseUser()
  const cookie = store.createSession(user, user.session_version)
  store.getRawById = async () => baseUser({ session_version: user.session_version + 1 })
  const result = await store.getSessionUser({ cookies: { user_session: cookie } })
  assert.equal(result, null)
})

test('changing a role clears personal overrides and increments both versions atomically', async () => {
  const store = new UserStore()
  await store.pool.end()
  const calls = []
  const target = baseUser()
  const client = {
    query: async (sql, values = []) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      calls.push({ sql: normalized, values })
      if (['BEGIN', 'COMMIT', 'ROLLBACK', 'LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE'].includes(normalized)) return { rows: [], rowCount: 0 }
      if (normalized === 'SELECT * FROM users WHERE id = $1 FOR UPDATE') {
        return Number(values[0]) === 1
          ? { rows: [baseUser({ id: 1, username: 'root', username_key: 'root', role: 'super_admin' })] }
          : { rows: [target] }
      }
      if (normalized === 'DELETE FROM user_permission_overrides WHERE user_id = $1') return { rows: [], rowCount: 2 }
      if (normalized.startsWith('UPDATE users SET role = $2')) {
        return {
          rows: [{
            ...target,
            role: values[1],
            permission_version: target.permission_version + 1,
            session_version: target.session_version + 1
          }],
          rowCount: 1
        }
      }
      throw new Error(`Unexpected SQL: ${normalized}`)
    },
    release: () => {}
  }
  store.pool = { connect: async () => client }

  const result = await store.setRole({ actorId: 1, targetId: 2, role: 'admin' })
  assert.equal(result.success, true)
  assert.equal(result.changed, true)
  assert.equal(result.overridesCleared, true)
  assert.equal(result.user.role, 'admin')
  assert.equal(result.user.permission_version, 5)
  assert.equal(calls.filter((call) => call.sql === 'DELETE FROM user_permission_overrides WHERE user_id = $1').length, 1)
  assert.match(calls.find((call) => call.sql.startsWith('UPDATE users SET role = $2'))?.sql || '', /session_version = session_version \+ 1/)
})
