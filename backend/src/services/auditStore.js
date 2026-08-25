import { createPostgresPool } from './postgres.js'
import { readJson } from './jsonStore.js'

const safeText = (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength)
const safeMetadata = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

const parseLegacyLog = (line) => {
  const text = String(line || '').trim()
  const match = text.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+(\S+)\s+(.+)$/)
  return {
    actor: safeText(match?.[2] || 'legacy', 100),
    summary: safeText(match?.[3] || text, 1000),
    createdAt: match?.[1] ? new Date(match[1].replace(' ', 'T')) : new Date()
  }
}

export class AuditStore {
  constructor() {
    this.pool = createPostgresPool()
    this.pending = Promise.resolve()
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_events (
        id BIGSERIAL PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT '',
        target_id TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS admin_audit_events_created_idx
        ON admin_audit_events(created_at DESC, id DESC);

      CREATE INDEX IF NOT EXISTS admin_audit_events_actor_idx
        ON admin_audit_events(actor, created_at DESC);

      CREATE INDEX IF NOT EXISTS admin_audit_events_target_idx
        ON admin_audit_events(target_type, target_id, created_at DESC);
    `)
    await this.importLegacyLogs()
  }

  async importLegacyLogs() {
    const count = await this.pool.query('SELECT COUNT(*)::int AS count FROM admin_audit_events')
    if (Number(count.rows[0]?.count) > 0) return 0
    const logs = readJson('admin_log.json', [])
    if (!Array.isArray(logs) || logs.length === 0) return 0
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      for (const line of logs.slice(-5000)) {
        const parsed = parseLegacyLog(line)
        const createdAt = Number.isNaN(parsed.createdAt.getTime()) ? new Date() : parsed.createdAt
        await client.query(
          `INSERT INTO admin_audit_events
             (actor, action, target_type, target_id, summary, metadata, created_at)
           VALUES ($1, 'legacy.import', 'legacy_log', '', $2, $3::jsonb, $4)`,
          [parsed.actor, parsed.summary, JSON.stringify({ source: 'admin_log.json' }), createdAt]
        )
      }
      await client.query('COMMIT')
      return Math.min(logs.length, 5000)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  record(event = {}) {
    const payload = {
      actor: safeText(event.actor || 'unknown', 100) || 'unknown',
      action: safeText(event.action || 'admin.request', 160) || 'admin.request',
      targetType: safeText(event.targetType, 80),
      targetId: safeText(event.targetId, 160),
      summary: safeText(event.summary || event.action || '管理员操作', 1000) || '管理员操作',
      metadata: safeMetadata(event.metadata)
    }
    const operation = this.pending.then(() => this.pool.query(
      `INSERT INTO admin_audit_events
         (actor, action, target_type, target_id, summary, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, actor, action, target_type, target_id, summary, metadata, created_at`,
      [payload.actor, payload.action, payload.targetType, payload.targetId, payload.summary, JSON.stringify(payload.metadata)]
    )).then((result) => result.rows[0])
    this.pending = operation.catch((error) => {
      console.error(`Failed to write admin audit event: ${error.message}`)
    })
    return operation
  }

  async list({ page = 1, pageSize = 20, q = '', actor = '', action = '', targetType = '', maxId = '' } = {}) {
    await this.pending
    const safePage = Math.max(1, Math.floor(Number(page) || 1))
    const safePageSize = Math.max(1, Math.min(100, Math.floor(Number(pageSize) || 20)))
    const conditions = []
    const values = []
    const add = (column, value) => {
      values.push(value)
      conditions.push(`${column} = $${values.length}`)
    }
    const query = safeText(q, 120)
    if (query) {
      values.push(query)
      const index = values.length
      conditions.push(`(actor ILIKE '%' || $${index} || '%' OR action ILIKE '%' || $${index} || '%' OR target_id ILIKE '%' || $${index} || '%' OR summary ILIKE '%' || $${index} || '%')`)
    }
    if (safeText(actor, 100)) add('actor', safeText(actor, 100))
    if (safeText(action, 160)) add('action', safeText(action, 160))
    if (safeText(targetType, 80)) add('target_type', safeText(targetType, 80))
    const baseWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    let snapshotId = /^\d+$/.test(String(maxId || '')) ? String(maxId) : ''
    if (!snapshotId) {
      const snapshot = await this.pool.query(`SELECT MAX(id)::text AS id FROM admin_audit_events ${baseWhere}`, values)
      snapshotId = snapshot.rows[0]?.id || ''
    }
    if (snapshotId) {
      values.push(snapshotId)
      conditions.push(`id <= $${values.length}`)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const count = await this.pool.query(`SELECT COUNT(*)::int AS count FROM admin_audit_events ${where}`, values)
    values.push(safePageSize, (safePage - 1) * safePageSize)
    const rows = await this.pool.query(
      `SELECT id, actor, action, target_type, target_id, summary, metadata, created_at
       FROM admin_audit_events
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    )
    const total = Number(count.rows[0]?.count) || 0
    return {
      items: rows.rows,
      page: safePage,
      page_size: safePageSize,
      total,
      total_pages: Math.ceil(total / safePageSize),
      snapshot_id: snapshotId
    }
  }

  async stats() {
    await this.pending
    const result = await this.pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS last_24_hours,
        COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS last_7_days
      FROM admin_audit_events
    `)
    return result.rows[0] || { total: 0, last_24_hours: 0, last_7_days: 0 }
  }

  async close() {
    await this.pending
    await this.pool.end()
  }
}

export const auditStore = new AuditStore()
