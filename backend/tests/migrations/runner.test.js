import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  MigrationDefinitionError,
  MigrationIntegrityError,
  checksumMigration,
  loadMigrations,
  parseMigrationFilename,
  runMigrations,
  validateAppliedMigrations
} from '../../migrations/runner.js'

const withMigrationDirectory = async (handler) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'campuswall-migrations-'))
  try {
    return await handler(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('parseMigrationFilename accepts canonical names and rejects ambiguous versions', () => {
  assert.deepEqual(parseMigrationFilename('0001_initial_schema.sql'), {
    version: 1,
    versionLabel: '0001',
    name: 'initial_schema',
    filename: '0001_initial_schema.sql'
  })
  assert.deepEqual(parseMigrationFilename('0010_add_reports.sql'), {
    version: 10,
    versionLabel: '0010',
    name: 'add_reports',
    filename: '0010_add_reports.sql'
  })

  for (const invalid of [
    '1_too_short.sql',
    '0000_zero.sql',
    '0001-incorrect-separator.sql',
    '0001_Uppercase.sql',
    '0001_missing_extension',
    '../0001_escape.sql'
  ]) {
    assert.throws(() => parseMigrationFilename(invalid), MigrationDefinitionError)
  }
})

test('loadMigrations orders numeric versions and rejects duplicates', async () => {
  await withMigrationDirectory(async (directory) => {
    await Promise.all([
      writeFile(path.join(directory, '0010_tenth.sql'), 'SELECT 10;\n'),
      writeFile(path.join(directory, '0002_second.sql'), 'SELECT 2;\n'),
      writeFile(path.join(directory, 'README.md'), 'ignored\n')
    ])

    const migrations = await loadMigrations(directory)
    assert.deepEqual(migrations.map(({ version, filename }) => ({ version, filename })), [
      { version: 2, filename: '0002_second.sql' },
      { version: 10, filename: '0010_tenth.sql' }
    ])
  })

  await withMigrationDirectory(async (directory) => {
    await Promise.all([
      writeFile(path.join(directory, '0001_first.sql'), 'SELECT 1;\n'),
      writeFile(path.join(directory, '00001_duplicate.sql'), 'SELECT 2;\n')
    ])
    await assert.rejects(() => loadMigrations(directory), MigrationDefinitionError)
  })
})

test('checksumMigration hashes exact migration bytes', () => {
  assert.equal(
    checksumMigration('SELECT 1;\n'),
    'b4e0497804e46e0a0b0b8c31975b062152d551bac49c3c2e80932567b4085dcd'
  )
  assert.notEqual(checksumMigration('SELECT 1;\n'), checksumMigration('SELECT 1; \n'))
  assert.equal(
    checksumMigration(Buffer.from('SELECT 1;\n')),
    checksumMigration('SELECT 1;\n')
  )
})

test('validateAppliedMigrations rejects changed, renamed, missing, and out-of-order migrations', () => {
  const first = {
    version: 1,
    name: 'first',
    filename: '0001_first.sql',
    checksum: checksumMigration('SELECT 1;\n')
  }
  const second = {
    version: 2,
    name: 'second',
    filename: '0002_second.sql',
    checksum: checksumMigration('SELECT 2;\n')
  }
  const rows = [{ version: '1', name: first.name, checksum: first.checksum }]

  assert.deepEqual([...validateAppliedMigrations([first, second], rows)], [1])
  assert.throws(
    () => validateAppliedMigrations([first], [{ ...rows[0], checksum: '0'.repeat(64) }]),
    MigrationIntegrityError
  )
  assert.throws(
    () => validateAppliedMigrations([first], [{ ...rows[0], name: 'renamed' }]),
    MigrationIntegrityError
  )
  assert.throws(
    () => validateAppliedMigrations([first], [{ version: '2', name: second.name, checksum: second.checksum }]),
    MigrationIntegrityError
  )
  assert.throws(
    () => validateAppliedMigrations([first, second], [{ version: '2', name: second.name, checksum: second.checksum }]),
    /pending even though a later migration/
  )
})

class RecordingClient {
  constructor() {
    this.applied = []
    this.queries = []
  }

  async query(source, values = []) {
    const text = String(source)
    this.queries.push({ text, values })
    const normalized = text.trim().replace(/\s+/g, ' ')

    if (normalized.startsWith('SELECT version::text AS version')) {
      return { rows: this.applied.map((row) => ({ ...row })), rowCount: this.applied.length }
    }
    if (normalized.startsWith('INSERT INTO schema_migrations')) {
      this.applied.push({
        version: String(values[0]),
        name: values[1],
        checksum: values[2],
        applied_at: new Date()
      })
      return { rows: [], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  }
}

test('runMigrations uses an advisory lock, transactions, and checksum verification', async () => {
  await withMigrationDirectory(async (directory) => {
    const filename = '0001_probe.sql'
    const migrationPath = path.join(directory, filename)
    const originalSql = 'SELECT 42;\n'
    await writeFile(migrationPath, originalSql)
    const client = new RecordingClient()

    const first = await runMigrations(client, { migrationsDirectory: directory })
    assert.equal(first.appliedCount, 1)
    assert.equal(first.previouslyAppliedCount, 0)
    assert.equal(client.applied.length, 1)

    const statements = client.queries.map(({ text }) => text.trim())
    assert.match(statements[0], /^SELECT pg_advisory_lock/)
    assert.equal(statements.filter((statement) => statement === 'BEGIN').length, 2)
    assert.equal(statements.filter((statement) => statement === 'COMMIT').length, 2)
    assert.equal(statements.filter((statement) => statement === originalSql.trim()).length, 1)
    assert.match(statements.at(-1), /^SELECT pg_advisory_unlock/)

    const second = await runMigrations(client, { migrationsDirectory: directory })
    assert.equal(second.appliedCount, 0)
    assert.equal(second.previouslyAppliedCount, 1)
    assert.equal(
      client.queries.filter(({ text }) => text.trim() === originalSql.trim()).length,
      1
    )

    await writeFile(migrationPath, `${originalSql}-- changed after application\n`)
    await assert.rejects(
      () => runMigrations(client, { migrationsDirectory: directory }),
      (error) => error instanceof MigrationIntegrityError
        && error.code === 'MIGRATION_INTEGRITY_ERROR'
        && /Checksum mismatch/.test(error.message)
    )
    assert.match(client.queries.at(-1).text.trim(), /^SELECT pg_advisory_unlock/)
  })
})
