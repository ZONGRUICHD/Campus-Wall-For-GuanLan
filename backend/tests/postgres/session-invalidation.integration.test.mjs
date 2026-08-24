import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import pg from 'pg'

import { initMessageSchema } from '../../src/services/postgres.js'
import {
  UserStore,
  userSessionCookieName
} from '../../src/services/userStore.js'

const { Client } = pg
const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || ''
const hasDiscreteConnection = Boolean(
  process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER
)
const hasPostgresConfiguration = Boolean(connectionString || hasDiscreteConnection)
const skipReason = 'PostgreSQL integration requires TEST_DATABASE_URL, DATABASE_URL, or PGHOST/PGDATABASE/PGUSER'
const sslEnabled = /^(1|true|yes|on)$/i.test(String(process.env.PGSSL || ''))
const clientOptions = {
  ...(connectionString ? { connectionString } : {}),
  ...(sslEnabled ? { ssl: { rejectUnauthorized: false } } : {})
}

test('PostgreSQL-backed student sessions are invalidated by version and account changes', {
  skip: hasPostgresConfiguration ? false : skipReason
}, async () => {
  const client = new Client(clientOptions)
  const schema = `campuswall_test_${randomBytes(8).toString('hex')}`
  let schemaCreated = false

  try {
    await client.connect()
    await client.query(`CREATE SCHEMA "${schema}"`)
    schemaCreated = true
    await client.query(`SET search_path TO "${schema}"`)
    await initMessageSchema(client)

    const store = new UserStore()
    await store.pool.end()
    store.pool = client
    await store.init()

    const credentials = await store.hashPassword('initial-password')
    const inserted = await client.query(
      `INSERT INTO users (username, password_hash, password_salt, real_name, nickname)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      ['integration-student', credentials.hash, credentials.salt, 'Private Name', 'Public Nickname']
    )
    const original = inserted.rows[0]
    const originalToken = store.createSession(original, original.session_version)
    const originalRequest = {
      cookies: { [userSessionCookieName]: originalToken }
    }
    assert.equal((await store.getSessionUser(originalRequest))?.id, Number(original.id))

    await client.query(
      'UPDATE users SET session_version = session_version + 1 WHERE id = $1',
      [original.id]
    )
    assert.equal(await store.getSessionUser(originalRequest), null)

    const current = await store.getRawById(original.id)
    const currentToken = store.createSession(current, current.session_version)
    const currentRequest = {
      cookies: { [userSessionCookieName]: currentToken }
    }
    assert.equal((await store.getSessionUser(currentRequest))?.id, Number(original.id))

    const versionBeforeDisable = Number(current.session_version)
    await store.disable(original.id)
    const disabled = await store.getRawById(original.id)
    assert.equal(disabled.status, 'disabled')
    assert.equal(
      Number(disabled.session_version),
      versionBeforeDisable + 1,
      'disabling a user must also revoke every issued session by incrementing session_version'
    )
    assert.equal(await store.getSessionUser(currentRequest), null)

    await client.query(
      "UPDATE users SET status = 'active' WHERE id = $1",
      [original.id]
    )
    const beforeReset = await store.getRawById(original.id)
    const resetToken = store.createSession(beforeReset, beforeReset.session_version)
    await store.resetPassword(original.id, 'replacement-password')
    assert.equal(await store.getSessionUser({
      cookies: { [userSessionCookieName]: resetToken }
    }), null)
  } finally {
    if (schemaCreated) {
      await client.query('SET search_path TO public').catch(() => {})
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {})
    }
    await client.end().catch(() => {})
  }
})
