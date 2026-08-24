import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const migrationFilenamePattern = /^(\d{4,})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/
const checksumPattern = /^[0-9a-f]{64}$/
const int32Min = -2147483648
const int32Max = 2147483647

export const DEFAULT_MIGRATIONS_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
export const MIGRATION_ADVISORY_LOCK = Object.freeze([0x43414d50, 0x57414c4c])

export class MigrationError extends Error {
  constructor(message, { code = 'MIGRATION_ERROR', cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = new.target.name
    this.code = code
  }
}

export class MigrationDefinitionError extends MigrationError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 'MIGRATION_DEFINITION_ERROR' })
  }
}

export class MigrationIntegrityError extends MigrationError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 'MIGRATION_INTEGRITY_ERROR' })
  }
}

export class MigrationExecutionError extends MigrationError {
  constructor(migration, cause) {
    super(`Migration ${migration.filename} failed: ${cause?.message || String(cause)}`, {
      code: 'MIGRATION_EXECUTION_ERROR',
      cause
    })
    this.migration = {
      version: migration.version,
      name: migration.name,
      filename: migration.filename,
      checksum: migration.checksum
    }
  }
}

export const parseMigrationFilename = (filename) => {
  const match = typeof filename === 'string' ? filename.match(migrationFilenamePattern) : null
  if (!match) {
    throw new MigrationDefinitionError(
      `Invalid migration filename "${String(filename)}"; expected NNNN_name.sql`
    )
  }

  const version = Number(match[1])
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new MigrationDefinitionError(`Invalid migration version in "${filename}"`)
  }

  return {
    version,
    versionLabel: match[1],
    name: match[2],
    filename
  }
}

export const checksumMigration = (source) => {
  if (typeof source !== 'string' && !Buffer.isBuffer(source) && !(source instanceof Uint8Array)) {
    throw new TypeError('Migration source must be a string, Buffer, or Uint8Array')
  }
  return createHash('sha256').update(source).digest('hex')
}

export const loadMigrations = async (directory = DEFAULT_MIGRATIONS_DIRECTORY) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const sqlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'))
    .map((entry) => entry.name)

  if (sqlFiles.length === 0) {
    throw new MigrationDefinitionError(`No SQL migrations found in ${directory}`)
  }

  const migrations = await Promise.all(sqlFiles.map(async (filename) => {
    const parsed = parseMigrationFilename(filename)
    const source = await readFile(path.join(directory, filename))
    const sql = source.toString('utf8')
    if (!sql.trim()) {
      throw new MigrationDefinitionError(`Migration ${filename} is empty`)
    }
    return {
      ...parsed,
      sql,
      checksum: checksumMigration(source)
    }
  }))

  migrations.sort((left, right) => left.version - right.version)
  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index - 1].version === migrations[index].version) {
      throw new MigrationDefinitionError(
        `Duplicate migration version ${migrations[index].version}: `
        + `${migrations[index - 1].filename} and ${migrations[index].filename}`
      )
    }
  }

  return migrations
}

const databaseVersion = (value) => {
  const text = String(value)
  if (!/^[1-9]\d*$/.test(text)) {
    throw new MigrationIntegrityError(`Invalid migration version stored in database: "${text}"`)
  }
  const version = Number(text)
  if (!Number.isSafeInteger(version)) {
    throw new MigrationIntegrityError(`Migration version is outside JavaScript's safe integer range: "${text}"`)
  }
  return version
}

export const validateAppliedMigrations = (migrations, rows) => {
  const localByVersion = new Map()
  for (const migration of migrations) {
    if (localByVersion.has(migration.version)) {
      throw new MigrationDefinitionError(`Duplicate local migration version ${migration.version}`)
    }
    localByVersion.set(migration.version, migration)
  }

  const appliedVersions = new Set()
  for (const row of rows) {
    const version = databaseVersion(row.version)
    if (appliedVersions.has(version)) {
      throw new MigrationIntegrityError(`Migration version ${version} is recorded more than once`)
    }
    appliedVersions.add(version)

    const migration = localByVersion.get(version)
    if (!migration) {
      throw new MigrationIntegrityError(
        `Applied migration version ${version} is missing from the migration directory`
      )
    }
    if (row.name !== migration.name) {
      throw new MigrationIntegrityError(
        `Applied migration ${version} was renamed: database has "${row.name}", `
        + `local file is "${migration.name}"`
      )
    }

    const storedChecksum = String(row.checksum || '')
    if (!checksumPattern.test(storedChecksum) || storedChecksum !== migration.checksum) {
      throw new MigrationIntegrityError(
        `Checksum mismatch for applied migration ${migration.filename}: `
        + `database has "${storedChecksum}", local file has "${migration.checksum}"`
      )
    }
  }

  const highestAppliedVersion = appliedVersions.size ? Math.max(...appliedVersions) : 0
  for (const migration of migrations) {
    if (migration.version < highestAppliedVersion && !appliedVersions.has(migration.version)) {
      throw new MigrationIntegrityError(
        `Migration ${migration.filename} is pending even though a later migration is already applied`
      )
    }
  }

  return appliedVersions
}

const validateAdvisoryLock = (lock) => {
  if (
    !Array.isArray(lock)
    || lock.length !== 2
    || lock.some((value) => !Number.isInteger(value) || value < int32Min || value > int32Max)
  ) {
    throw new TypeError('advisoryLock must contain two signed 32-bit integers')
  }
}

const acquireClient = async (queryable) => {
  if (!queryable || typeof queryable.query !== 'function') {
    throw new TypeError('runMigrations requires a pg Pool or connected Client')
  }

  if (typeof queryable.connect === 'function' && typeof queryable.totalCount === 'number') {
    const client = await queryable.connect()
    return {
      client,
      release: () => client.release()
    }
  }

  return { client: queryable, release: null }
}

const transaction = async (client, operation) => {
  await client.query('BEGIN')
  try {
    const result = await operation()
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
}

const ensureMigrationTable = (client) => transaction(client, () => client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version BIGINT PRIMARY KEY CHECK (version > 0),
    name TEXT NOT NULL CHECK (length(name) > 0),
    checksum TEXT NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
  )
`))

const publicMigration = (migration) => ({
  version: migration.version,
  name: migration.name,
  filename: migration.filename,
  checksum: migration.checksum
})

export const runMigrations = async (queryable, {
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY,
  advisoryLock = MIGRATION_ADVISORY_LOCK
} = {}) => {
  validateAdvisoryLock(advisoryLock)
  const migrations = await loadMigrations(migrationsDirectory)
  const { client, release } = await acquireClient(queryable)
  let lockAcquired = false
  let operationError = null

  try {
    await client.query(
      'SELECT pg_advisory_lock($1::integer, $2::integer)',
      advisoryLock
    )
    lockAcquired = true

    await ensureMigrationTable(client)
    const appliedResult = await client.query(
      'SELECT version::text AS version, name, checksum, applied_at FROM schema_migrations ORDER BY version'
    )
    const appliedVersions = validateAppliedMigrations(migrations, appliedResult.rows)
    const applied = []

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue
      try {
        await transaction(client, async () => {
          await client.query(migration.sql)
          await client.query(
            `INSERT INTO schema_migrations (version, name, checksum)
             VALUES ($1, $2, $3)`,
            [migration.version, migration.name, migration.checksum]
          )
        })
      } catch (error) {
        throw new MigrationExecutionError(migration, error)
      }
      applied.push(publicMigration(migration))
    }

    return {
      applied,
      appliedCount: applied.length,
      previouslyAppliedCount: appliedVersions.size,
      totalCount: migrations.length
    }
  } catch (error) {
    operationError = error
    throw error
  } finally {
    try {
      if (lockAcquired) {
        await client.query(
          'SELECT pg_advisory_unlock($1::integer, $2::integer)',
          advisoryLock
        )
      }
    } catch (unlockError) {
      if (!operationError) throw unlockError
      operationError.unlockError = unlockError
    } finally {
      if (release) {
        try {
          release()
        } catch (releaseError) {
          if (!operationError) throw releaseError
          operationError.releaseError = releaseError
        }
      }
    }
  }
}
