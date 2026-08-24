import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import pg from 'pg'
import {
  DEFAULT_MIGRATIONS_DIRECTORY,
  MigrationExecutionError,
  MigrationIntegrityError,
  runMigrations
} from '../../migrations/runner.js'

const { Client } = pg
const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || ''
const hasDiscreteConnection = Boolean(
  process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER
)
const hasPostgresEnvironment = Boolean(connectionString || hasDiscreteConnection)
const sslEnabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.PGSSL || '').toLowerCase()
)

const expectedTables = [
  'admin_audit_events',
  'apps',
  'feedback_history',
  'feedback_tickets',
  'manager_permissions',
  'managers',
  'message_reactions',
  'messages',
  'notices',
  'partitions',
  'platform_settings',
  'poll_votes',
  'reports',
  'schema_migrations',
  'user_favorites',
  'user_notifications',
  'users'
]

test('migrations apply atomically and repeatably on PostgreSQL', {
  skip: hasPostgresEnvironment
    ? false
    : 'set TEST_DATABASE_URL, DATABASE_URL, or PGHOST/PGDATABASE/PGUSER for integration coverage'
}, async (t) => {
  const schema = `migration_test_${randomUUID().replaceAll('-', '')}`
  const client = new Client({
    ...(connectionString ? { connectionString } : {}),
    ...(sslEnabled ? { ssl: { rejectUnauthorized: false } } : {})
  })
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'campuswall-pg-migrations-'))
  let schemaCreated = false

  try {
    await client.connect()
    const serverVersion = await client.query('SHOW server_version')
    t.diagnostic(`PostgreSQL ${serverVersion.rows[0].server_version}`)

    await client.query(`CREATE SCHEMA "${schema}"`)
    schemaCreated = true
    await client.query(`SET search_path TO "${schema}", public`)

    const firstRun = await runMigrations(client)
    assert.equal(firstRun.appliedCount, 1)
    assert.equal(firstRun.totalCount, 1)

    const tableResult = await client.query(
      `SELECT tablename
       FROM pg_catalog.pg_tables
       WHERE schemaname = $1
       ORDER BY tablename`,
      [schema]
    )
    assert.deepEqual(tableResult.rows.map((row) => row.tablename), expectedTables)

    const migrationRows = await client.query(
      `SELECT version::int AS version, name, checksum
       FROM schema_migrations
       ORDER BY version`
    )
    assert.equal(migrationRows.rowCount, 1)
    assert.equal(migrationRows.rows[0].version, 1)
    assert.equal(migrationRows.rows[0].name, 'initial_schema')
    assert.match(migrationRows.rows[0].checksum, /^[0-9a-f]{64}$/)

    const secondRun = await runMigrations(client)
    assert.equal(secondRun.appliedCount, 0)
    assert.equal(secondRun.previouslyAppliedCount, 1)

    const initialFilename = '0001_initial_schema.sql'
    const initialSource = await readFile(path.join(DEFAULT_MIGRATIONS_DIRECTORY, initialFilename))
    await writeFile(path.join(temporaryDirectory, initialFilename), initialSource)
    const failingFilename = '0002_transaction_probe.sql'
    await writeFile(
      path.join(temporaryDirectory, failingFilename),
      `CREATE TABLE migration_transaction_probe (id INTEGER PRIMARY KEY);
SELECT * FROM migration_runner_relation_that_must_not_exist;
`
    )

    await assert.rejects(
      () => runMigrations(client, { migrationsDirectory: temporaryDirectory }),
      MigrationExecutionError
    )
    const rollbackProbe = await client.query(
      `SELECT to_regclass($1) AS relation`,
      [`${schema}.migration_transaction_probe`]
    )
    assert.equal(rollbackProbe.rows[0].relation, null)
    const failedVersion = await client.query(
      'SELECT count(*)::int AS count FROM schema_migrations WHERE version = 2'
    )
    assert.equal(failedVersion.rows[0].count, 0)

    await unlink(path.join(temporaryDirectory, failingFilename))
    await writeFile(
      path.join(temporaryDirectory, initialFilename),
      Buffer.concat([initialSource, Buffer.from('\n-- changed after application\n')])
    )
    await assert.rejects(
      () => runMigrations(client, { migrationsDirectory: temporaryDirectory }),
      MigrationIntegrityError
    )
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
    if (schemaCreated) {
      await client.query('SET search_path TO public').catch(() => {})
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {})
    }
    await client.end().catch(() => {})
  }
})
