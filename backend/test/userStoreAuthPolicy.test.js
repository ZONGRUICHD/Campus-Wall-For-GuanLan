import assert from 'node:assert/strict'
import test from 'node:test'
import { UserStore, feishuUsernameForOpenId } from '../src/services/userStore.js'

const endAndStub = async (store, { query, connect }) => {
  await store.pool.end()
  store.pool = { query, connect }
}

const staffRow = {
  id: 1,
  username: 'root',
  username_key: 'root',
  role: 'super_admin',
  status: 'active',
  password_hash: 'hash',
  password_salt: 'salt',
  nickname: 'root',
  real_name: '',
  gender: 0,
  bio: '',
  mute_reason: '',
  muted_until: null,
  permission_overrides: {},
  session_version: 0,
  permission_version: 0
}

test('feishu usernames stay within the existing username length rule', () => {
  const username = feishuUsernameForOpenId('ou_open_id_example')
  assert.match(username, /^fs_[a-f0-9]{16}$/)
  assert.ok(username.length <= 24)
})

test('password login works for active ordinary accounts with a password', async () => {
  const store = new UserStore()
  const { salt, hash } = await store.hashPassword('correct-password')
  await endAndStub(store, {
    query: async (sql) => {
      if (String(sql).includes('username_key')) {
        return {
          rows: [{
            ...staffRow,
            id: 8,
            username: 'student',
            username_key: 'student',
            role: 'user',
            password_hash: hash,
            password_salt: salt
          }]
        }
      }
      if (String(sql).includes('last_login_at')) {
        return { rows: [{ last_login_at: new Date(), updated_at: new Date(), session_version: 0 }] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    },
    connect: async () => {
      throw new Error('login should not open a transaction')
    }
  })
  const result = await store.login('student', 'correct-password')
  assert.equal(result.user.username, 'student')
  assert.equal(result.user.role, 'user')
})

test('password login tells pending registrations to wait for review', async () => {
  const store = new UserStore()
  const { salt, hash } = await store.hashPassword('correct-password')
  let seenLastLogin = false
  await endAndStub(store, {
    query: async (sql) => {
      if (String(sql).includes('username_key')) {
        return {
          rows: [{
            ...staffRow,
            id: 9,
            username: 'waiting',
            username_key: 'waiting',
            role: 'user',
            status: 'pending',
            password_hash: hash,
            password_salt: salt
          }]
        }
      }
      if (String(sql).includes('last_login_at')) {
        seenLastLogin = true
        return { rows: [{ last_login_at: new Date(), updated_at: new Date(), session_version: 0 }] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    },
    connect: async () => {
      throw new Error('pending login should not open a transaction')
    }
  })
  const result = await store.login('waiting', 'correct-password')
  assert.equal(result.pending, true)
  assert.match(result.error, /审核/)
  assert.equal(seenLastLogin, false)
})

test('password login still works for privileged accounts with a password', async () => {
  const store = new UserStore()
  const { salt, hash } = await store.hashPassword('staff-secret-1')
  await endAndStub(store, {
    query: async (sql) => {
      if (String(sql).includes('username_key')) {
        return {
          rows: [{
            ...staffRow,
            password_hash: hash,
            password_salt: salt
          }]
        }
      }
      if (String(sql).includes('last_login_at')) {
        return { rows: [{ last_login_at: new Date(), updated_at: new Date(), session_version: 3 }] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    },
    connect: async () => {
      throw new Error('login should not open a transaction')
    }
  })
  const result = await store.login('root', 'staff-secret-1')
  assert.equal(result.user.role, 'super_admin')
  assert.equal(result.sessionVersion, 3)
  assert.equal(result.user.has_password, true)
})

test('password login rejects privileged accounts that have no password hash', async () => {
  const store = new UserStore()
  await endAndStub(store, {
    query: async (sql) => {
      if (String(sql).includes('username_key')) {
        return {
          rows: [{
            ...staffRow,
            role: 'admin',
            password_hash: null,
            password_salt: null
          }]
        }
      }
      throw new Error(`unexpected sql: ${sql}`)
    },
    connect: async () => {
      throw new Error('login should not open a transaction')
    }
  })
  assert.equal(await store.login('root', 'anything'), null)
})

test('createStaffUser rejects ordinary-user role and reserved feishu names', async () => {
  const store = new UserStore()
  await endAndStub(store, {
    query: async () => ({ rows: [] }),
    connect: async () => {
      throw new Error('validation should fail before connect')
    }
  })
  const asUser = await store.createStaffUser({
    username: 'reviewer1',
    password: 'password12',
    role: 'user'
  }, { actorId: 1 })
  assert.equal(asUser.success, false)
  assert.equal(asUser.statusCode, 400)

  const reserved = await store.createStaffUser({
    username: feishuUsernameForOpenId('ou_reserved'),
    password: 'password12',
    role: 'admin'
  }, { actorId: 1 })
  assert.equal(reserved.success, false)
  assert.match(reserved.error, /飞书/)
})

test('createStaffUser inserts a privileged account for a super admin actor', async () => {
  const store = new UserStore()
  const sqlLog = []
  await endAndStub(store, {
    query: async () => ({ rows: [] }),
    connect: async () => ({
      query: async (sql, values = []) => {
        const normalized = String(sql).replace(/\s+/g, ' ').trim()
        sqlLog.push({ sql: normalized, values })
        if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') return { rows: [] }
        if (normalized === 'LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE') return { rows: [] }
        if (normalized.startsWith('SELECT * FROM users WHERE id = $1 FOR UPDATE')) return { rows: [staffRow] }
        if (normalized.startsWith('INSERT INTO users')) {
          return {
            rows: [{
              ...staffRow,
              id: 9,
              username: values[0],
              username_key: values[1],
              nickname: values[4],
              role: values[5],
              password_hash: values[2],
              password_salt: values[3]
            }]
          }
        }
        throw new Error(`unexpected sql: ${normalized}`)
      },
      release: () => {}
    })
  })
  const result = await store.createStaffUser({
    username: 'shenhe2',
    password: 'password12',
    role: 'reviewer',
    nickname: '审核乙'
  }, { actorId: 1 })
  assert.equal(result.success, true)
  assert.equal(result.user.role, 'reviewer')
  assert.equal(result.user.username, 'shenhe2')
  assert.equal(result.user.has_password, true)
  assert.equal(sqlLog.some((item) => item.sql.startsWith('INSERT INTO users')), true)
})

test('register creates a pending password account without a session cookie side effect', async () => {
  const store = new UserStore()
  await endAndStub(store, {
    query: async (sql, values = []) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      if (normalized.startsWith('INSERT INTO users')) {
        assert.match(normalized, /'pending'/)
        return {
          rows: [{
            ...staffRow,
            id: 31,
            username: values[0],
            username_key: values[1],
            nickname: values[0],
            role: 'user',
            status: 'pending',
            password_hash: values[2],
            password_salt: values[3]
          }]
        }
      }
      throw new Error(`unexpected sql: ${normalized}`)
    },
    connect: async () => {
      throw new Error('register should not need a client')
    }
  })
  const result = await store.register('xiaoming', 'password12')
  assert.equal(result.success, true)
  assert.equal(result.pending, true)
  assert.equal(result.user.status, 'pending')
  assert.equal(result.user.has_password, true)
  assert.equal(result.user.role, 'user')

  const reserved = await store.register(feishuUsernameForOpenId('ou_reserved'), 'password12')
  assert.equal(reserved.success, false)
  assert.match(reserved.error, /飞书/)
})

test('reviewRegistration only activates or disables pending ordinary users', async () => {
  const store = new UserStore()
  await endAndStub(store, {
    query: async (sql, values = []) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      if (normalized.startsWith('UPDATE users') && normalized.includes("status = 'pending'")) {
        return {
          rows: [{
            ...staffRow,
            id: 31,
            username: 'xiaoming',
            role: 'user',
            status: values[1]
          }]
        }
      }
      if (normalized.includes('WHERE u.id = $1')) {
        return {
          rows: [{
            ...staffRow,
            id: 31,
            username: 'xiaoming',
            role: 'user',
            status: 'active',
            password_hash: 'hash',
            password_salt: 'salt'
          }]
        }
      }
      throw new Error(`unexpected sql: ${normalized}`)
    },
    connect: async () => {
      throw new Error('review should be a single update')
    }
  })
  const approved = await store.reviewRegistration(31, { approve: true })
  assert.equal(approved.success, true)
  assert.equal(approved.approved, true)
  const rejected = await store.reviewRegistration(31, { approve: false })
  assert.equal(rejected.success, true)
  assert.equal(rejected.approved, false)
})

test('upsertFeishuUser creates a passwordless ordinary account', async () => {
  const store = new UserStore()
  await endAndStub(store, {
    query: async (sql, values = []) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      if (normalized.includes('WHERE u.feishu_open_id = $1')) return { rows: [] }
      if (normalized.startsWith('INSERT INTO users')) {
        return {
          rows: [{
            ...staffRow,
            id: 22,
            username: values[0],
            username_key: values[1],
            nickname: values[2],
            role: 'user',
            password_hash: null,
            password_salt: null,
            feishu_open_id: values[3],
            feishu_user_id: values[4],
            session_version: 0
          }]
        }
      }
      throw new Error(`unexpected sql: ${normalized}`)
    },
    connect: async () => {
      throw new Error('upsert should not need a client')
    }
  })
  const result = await store.upsertFeishuUser({ openId: 'ou_member', userId: 'u1', name: '同学甲' })
  assert.equal(result.success, true)
  assert.equal(result.user.role, 'user')
  assert.equal(result.user.has_password, false)
  assert.equal(result.user.feishu_login, true)
  assert.equal(result.user.nickname, '同学甲')
  assert.match(result.user.username, /^fs_[a-f0-9]+$/)
})

test('changePassword refuses feishu-only accounts', async () => {
  const store = new UserStore()
  await endAndStub(store, {
    query: async (sql) => {
      if (String(sql).includes('WHERE u.id = $1')) {
        return {
          rows: [{
            ...staffRow,
            id: 22,
            role: 'user',
            password_hash: null,
            password_salt: null,
            feishu_open_id: 'ou_member'
          }]
        }
      }
      throw new Error(`unexpected sql: ${sql}`)
    },
    connect: async () => {
      throw new Error('changePassword should fail before update')
    }
  })
  const result = await store.changePassword(22, 'old', 'new-password')
  assert.equal(result.success, false)
  assert.match(result.error, /飞书/)
})
