import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { config, resolveBackend } from '../src/config.js'
import { createPostgresPool, initMessageSchema } from '../src/services/postgres.js'

const sqlitePath = resolveBackend(config.sqliteMessageDbPath)
if (!fs.existsSync(sqlitePath)) {
  console.error(`SQLite source not found: ${sqlitePath}`)
  process.exit(1)
}

const sqlite = new DatabaseSync(sqlitePath, { readOnly: true })
const pool = createPostgresPool()

const sqliteTableExists = (name) => Boolean(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))

const normalizeTags = (tags) => Array.isArray(tags)
  ? tags.map((tag) => String(tag || '').trim()).filter(Boolean)
  : []

const nonNegativeNumber = (value) => {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : 0
}

const normalizeMessage = (message, id) => {
  message.id = Number(message.id ?? id)
  message.comments = Array.isArray(message.comments) ? message.comments : []
  message.files = Array.isArray(message.files) ? message.files : []
  message.tags = normalizeTags(message.tags)
  message.likes = nonNegativeNumber(message.likes)
  message.dislikes = nonNegativeNumber(message.dislikes)
  return message
}

try {
  await initMessageSchema(pool)

  const messages = sqlite.prepare('SELECT id, data FROM messages').all()
  const partitions = sqliteTableExists('partitions') ? sqlite.prepare('SELECT tag, message_id FROM partitions').all() : []
  const messageIds = new Set(messages.map((row) => Number(row.id)))
  const normalizedMessages = messages.map((row) => ({ row, message: normalizeMessage(JSON.parse(row.data), row.id) }))
  const partitionPairs = new Map()
  let skippedPartitions = 0

  for (const { row, message } of normalizedMessages) {
    const messageId = Number(row.id)
    for (const tag of message.tags) partitionPairs.set(`${tag}\0${messageId}`, { tag, messageId })
  }

  for (const row of partitions) {
    const messageId = Number(row.message_id)
    const tag = String(row.tag || '').trim()
    if (!tag || !messageIds.has(messageId)) {
      skippedPartitions += 1
      continue
    }
    partitionPairs.set(`${tag}\0${messageId}`, { tag, messageId })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (const { row, message } of normalizedMessages) {
      await client.query(
        `INSERT INTO messages (id, data, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (id)
         DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [Number(row.id), JSON.stringify(message)]
      )
    }

    for (const { tag, messageId } of partitionPairs.values()) {
      await client.query(
        'INSERT INTO partitions (tag, message_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [tag, messageId]
      )
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  const pgMessages = await pool.query('SELECT count(*)::int AS count FROM messages')
  const pgPartitions = await pool.query('SELECT count(*)::int AS count FROM partitions')
  console.log(`Migrated ${messages.length} SQLite messages into PostgreSQL (${pgMessages.rows[0].count} rows present).`)
  console.log(`Migrated ${partitionPairs.size} partitions into PostgreSQL (${pgPartitions.rows[0].count} rows present).`)
  if (skippedPartitions) console.log(`Skipped ${skippedPartitions} partitions whose messages were missing.`)
} finally {
  sqlite.close()
  await pool.end()
}
