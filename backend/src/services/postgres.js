import pg from 'pg'
import { config } from '../config.js'

const { Pool } = pg

const sslOptions = () => {
  if (!config.pgSsl) return undefined
  return { rejectUnauthorized: config.pgSslRejectUnauthorized }
}

export const createPostgresPool = () => new Pool(
  config.databaseUrl
    ? {
        connectionString: config.databaseUrl,
        ssl: sslOptions()
      }
    : {
        host: config.pgHost,
        port: config.pgPort,
        database: config.pgDatabase,
        user: config.pgUser,
        password: config.pgPassword,
        ssl: sslOptions()
      }
)

export const initMessageSchema = async (queryable) => {
  await queryable.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGINT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS partitions (
      tag TEXT NOT NULL,
      message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      PRIMARY KEY (tag, message_id)
    );

    CREATE INDEX IF NOT EXISTS partitions_tag_idx ON partitions(tag);

    CREATE TABLE IF NOT EXISTS poll_votes (
      message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      voter_key TEXT NOT NULL,
      option_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id, voter_key)
    );

    CREATE INDEX IF NOT EXISTS poll_votes_message_idx ON poll_votes(message_id);

    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      reactor_key TEXT NOT NULL,
      reaction SMALLINT NOT NULL CHECK (reaction IN (-1, 1)),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id, reactor_key)
    );

    CREATE INDEX IF NOT EXISTS message_reactions_reactor_idx
      ON message_reactions(reactor_key, message_id);

    CREATE TABLE IF NOT EXISTS moderation_notification_outbox (
      id BIGSERIAL PRIMARY KEY,
      event_key TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      locked_at TIMESTAMPTZ,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      delivered_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS moderation_notification_outbox_due_idx
      ON moderation_notification_outbox(status, next_attempt_at, id);

    CREATE INDEX IF NOT EXISTS moderation_notification_outbox_message_idx
      ON moderation_notification_outbox(message_id, created_at DESC);
  `)
}
