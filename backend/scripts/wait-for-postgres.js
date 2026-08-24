import { setTimeout as sleep } from 'node:timers/promises'
import { createPostgresPool } from '../src/services/postgres.js'

const pool = createPostgresPool()
const deadline = Date.now() + 60_000
let lastError

while (Date.now() < deadline) {
  try {
    await pool.query('SELECT 1')
    console.log('PostgreSQL is ready')
    await pool.end()
    process.exit(0)
  } catch (error) {
    lastError = error
    await sleep(1000)
  }
}

await pool.end().catch(() => {})
console.error(`PostgreSQL did not become ready: ${lastError?.message || 'unknown error'}`)
process.exit(1)

