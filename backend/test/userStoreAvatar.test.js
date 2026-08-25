import assert from 'node:assert/strict'
import test from 'node:test'
import { UserStore } from '../src/services/userStore.js'

const createStoreWithClient = async (query) => {
  const store = new UserStore()
  await store.pool.end()
  let released = false
  store.pool = {
    connect: async () => ({
      query,
      release: () => { released = true }
    })
  }
  return { store, released: () => released }
}

test('avatar database swap locks the user row and returns the previous filename', async () => {
  const statements = []
  const { store, released } = await createStoreWithClient(async (sql) => {
    const normalized = String(sql).replace(/\s+/g, ' ').trim()
    statements.push(normalized)
    if (normalized.startsWith('SELECT avatar_file')) return { rows: [{ avatar_file: 'old-avatar.png' }] }
    if (normalized.startsWith('UPDATE users')) {
      return {
        rows: [{
          id: 17,
          username: 'avatar-user',
          role: 'student',
          status: 'active',
          nickname: 'Avatar User'
        }]
      }
    }
    return { rows: [] }
  })

  const result = await store.updateAvatar(17, 'new-avatar.webp')

  assert.equal(result.user.id, 17)
  assert.equal(result.previousAvatarFile, 'old-avatar.png')
  assert.deepEqual(statements.map((sql) => sql.split(' ')[0]), ['BEGIN', 'SELECT', 'UPDATE', 'COMMIT'])
  assert.match(statements[1], /FOR UPDATE$/)
  assert.equal(released(), true)
})
test('avatar database swap rolls back and releases the client on failure', async () => {
  const statements = []
  const { store, released } = await createStoreWithClient(async (sql) => {
    const normalized = String(sql).replace(/\s+/g, ' ').trim()
    statements.push(normalized)
    if (normalized.startsWith('SELECT avatar_file')) return { rows: [{ avatar_file: 'old.webp' }] }
    if (normalized.startsWith('UPDATE users')) throw new Error('write failed')
    return { rows: [] }
  })

  await assert.rejects(store.updateAvatar(18, 'new.webp'), /write failed/)
  assert.equal(statements.at(-1), 'ROLLBACK')
  assert.equal(released(), true)
})
