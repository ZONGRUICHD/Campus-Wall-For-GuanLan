import pg from 'pg'
import { config } from '../config.js'
import { runMigrations } from '../../migrations/runner.js'

const { Pool } = pg

export { runMigrations }

export const createPostgresPool = () => new Pool(
  config.databaseUrl
    ? {
        connectionString: config.databaseUrl,
        ssl: config.pgSsl ? { rejectUnauthorized: false } : undefined
      }
    : {
        host: config.pgHost,
        port: config.pgPort,
        database: config.pgDatabase,
        user: config.pgUser,
        password: config.pgPassword,
        ssl: config.pgSsl ? { rejectUnauthorized: false } : undefined
      }
)

// Shared schema initialization entry point used by the PostgreSQL stores.
export const initMessageSchema = (queryable) => runMigrations(queryable)
