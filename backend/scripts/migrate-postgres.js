#!/usr/bin/env node

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPostgresPool, runMigrations } from '../src/services/postgres.js'

export const migratePostgres = async ({
  pool: suppliedPool,
  migrationsDirectory,
  logger = console
} = {}) => {
  const pool = suppliedPool || createPostgresPool()
  const ownsPool = !suppliedPool

  try {
    const result = await runMigrations(pool, {
      ...(migrationsDirectory ? { migrationsDirectory } : {})
    })
    if (result.appliedCount > 0) {
      logger.log(
        `Applied ${result.appliedCount} PostgreSQL migration(s): `
        + result.applied.map((migration) => migration.filename).join(', ')
      )
    } else {
      logger.log(`PostgreSQL schema is current; verified ${result.totalCount} migration(s).`)
    }
    return result
  } finally {
    if (ownsPool) await pool.end()
  }
}

export const main = migratePostgres

const invokedAsScript = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (invokedAsScript) {
  main().catch((error) => {
    const label = error?.code ? `${error.code}: ` : ''
    console.error(`${label}${error?.message || String(error)}`)
    process.exitCode = 1
  })
}
