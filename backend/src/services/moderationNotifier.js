import { config } from '../config.js'
import { isConfessionMessage, moderationScopeForMessage, normalizeModerationScope } from './contentCategories.js'
import {
  getNotificationProvider,
  listNotificationProviders,
  validateNotificationTarget
} from './notifications/providerRegistry.js'
import { notificationScopeForPayload, safeNotificationText } from './notifications/messageTemplate.js'
import { buildFeishuPayload, generateFeishuSignature } from './notifications/providers/feishuWebhook.js'
import { buildWecomPayload } from './notifications/providers/wecomWebhook.js'

const retryDelays = Object.freeze([2000, 10000, 60000, 5 * 60000, 30 * 60000, 60 * 60000])
const maxRetryAfterMs = 24 * 60 * 60 * 1000
const safeText = safeNotificationText

export { buildFeishuPayload, buildWecomPayload, generateFeishuSignature, notificationScopeForPayload }

const messageCategory = (message = {}) => {
  if (message.lost_found) return message.lost_found.kind === 'found' ? '失物招领 · 招领启事' : '失物招领 · 寻物启事'
  if (isConfessionMessage(message)) return '表白墙便签'
  if (message.official) return '官方帖子'
  if (message.poll) return '校园投票'
  return '校园动态'
}

export const moderationEventPayload = (message = {}) => ({
  message_id: Number(message.id),
  submitted_at: safeText(message.pending_since || message.timestamp, 80),
  review_revision: Math.max(Number(message.review_revision) || 0, 0),
  category: messageCategory(message),
  moderation_scope: moderationScopeForMessage(message),
  attachment_count: Array.isArray(message.files) ? message.files.length : 0,
  has_poll: Boolean(message.poll),
  official: Boolean(message.official)
})

const normalizeBaseUrl = (value, environment = config.environment) => {
  try {
    const parsed = new URL(String(value || '').trim())
    const localDevelopmentHost = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    const localDevelopmentUrl = environment !== 'production' && parsed.protocol === 'http:' && localDevelopmentHost
    if ((parsed.protocol !== 'https:' && !localDevelopmentUrl) || parsed.username || parsed.password || parsed.hash) return ''
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

export const reviewUrlFor = (messageId, configuredUrl = config.publicSiteUrl, environment = config.environment, moderationScope = 'posts') => {
  const fallback = environment === 'production'
    ? ''
    : config.allowedOrigins.find((origin) => !/localhost|127\.0\.0\.1/i.test(origin)) || config.allowedOrigins[0]
  const base = normalizeBaseUrl(configuredUrl || fallback, environment)
  if (!base) return ''
  const scope = normalizeModerationScope(moderationScope)
  const url = new URL(scope === 'confessions' ? '/admin/confessions' : (scope === 'posts' ? '/admin/wall' : '/admin'), base)
  if (scope !== 'all') url.searchParams.set('status', 'pending')
  if (Number(messageId) > 0) url.searchParams.set('message', String(messageId))
  return url.toString()
}

export const validateWebhookTarget = validateNotificationTarget

export const isSuccessfulBotResponse = (provider, response = {}) => {
  const adapter = getNotificationProvider(provider)
  return adapter ? adapter.classifyResponse({ body: response }).ok : false
}

export const parseRetryAfterMs = (value, now = Date.now()) => {
  const text = String(value ?? '').trim()
  if (!text) return 0
  if (/^\d+$/.test(text)) {
    const seconds = Number(text)
    if (!Number.isFinite(seconds)) return maxRetryAfterMs
    return Math.min(seconds * 1000, maxRetryAfterMs)
  }
  if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) return 0
  const retryAt = Date.parse(text)
  const currentTime = Number(now)
  if (!Number.isFinite(retryAt) || !Number.isFinite(currentTime)) return 0
  return Math.min(Math.max(retryAt - currentTime, 0), maxRetryAfterMs)
}

const redactError = (provider, { status = 0, code = '', message = '' } = {}) => {
  const safeProvider = getNotificationProvider(provider) ? provider : 'unknown'
  const safeCode = safeText(code, 40).replace(/[^\w.-]/g, '')
  const safeMessage = safeText(message, 120).replace(/https?:\/\/\S+/gi, '[redacted-url]').replace(/[A-Fa-f0-9_-]{24,}/g, '[redacted-token]')
  return [safeProvider, status ? `http_${status}` : '', safeCode ? `code_${safeCode}` : '', safeMessage].filter(Boolean).join(': ')
}

const configuredTargets = () => {
  if (!config.moderationNotifyEnabled) return []
  return listNotificationProviders().flatMap((adapter) => {
    const target = adapter.readConfig(config)
    if (!target.webhook) return []
    const result = adapter.validateTarget(target)
    if (!result.valid) {
      console.error(`Moderation notifier target rejected: ${target.provider}: ${result.reason}`)
      return []
    }
    return [{ ...target, webhook: result.url }]
  })
}

export class ModerationNotifier {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    this.fetchImpl = fetchImpl
    this.pool = null
    this.targets = configuredTargets()
    this.timer = null
    this.reconcileTimer = null
    this.reconcileFollowupTimer = null
    this.kickTimer = null
    this.currentRun = null
    this.currentReconcile = null
    this.closing = false
    this.lastDeliveryAt = new Map()
    this.reconcileCursor = '0'
    this.retentionCleaned = false
    this.currentReconfigure = null
    this.deliveryLocks = new Map()
  }

  get active() {
    return this.targets.length > 0
  }

  replaceTargets(targets = []) {
    const next = []
    const seen = new Set()
    for (const candidate of Array.isArray(targets) ? targets : []) {
      const provider = String(candidate?.provider || '').trim().toLowerCase()
      const adapter = getNotificationProvider(provider)
      if (!adapter || seen.has(provider)) continue
      const validation = adapter.validateTarget(candidate)
      if (!validation.valid) continue
      seen.add(provider)
      next.push({
        provider,
        webhook: validation.url,
        secret: String(candidate.secret || '')
      })
    }
    this.targets = next
    return this.targets.map(({ provider }) => provider)
  }

  stopScheduling() {
    if (this.timer) clearInterval(this.timer)
    if (this.reconcileTimer) clearInterval(this.reconcileTimer)
    if (this.reconcileFollowupTimer) clearTimeout(this.reconcileFollowupTimer)
    if (this.kickTimer) clearTimeout(this.kickTimer)
    this.timer = null
    this.reconcileTimer = null
    this.reconcileFollowupTimer = null
    this.kickTimer = null
  }

  async startWorker() {
    if (!this.pool || !this.active || this.closing || this.timer) return
    if (!this.retentionCleaned) {
      await this.pool.query(`
        DELETE FROM moderation_notification_outbox AS job
        USING messages AS message
        WHERE job.message_id = message.id
          AND job.status IN ('cancelled', 'dead', 'sent')
          AND job.created_at < now() - ($1::int * interval '1 day')
          AND NOT (
            COALESCE(message.data->>'review_status', 'approved') <> 'approved'
            AND COALESCE(message.data->>'moderation_status', 'visible') = 'pending'
          )
      `, [config.moderationNotifyRetentionDays])
      this.retentionCleaned = true
    }
    await this.reconcilePendingMessages()
    this.timer = setInterval(() => this.kick(), config.moderationNotifyPollMs)
    this.timer.unref()
    this.reconcileTimer = setInterval(() => {
      this.reconcilePendingMessages().then(() => this.kick()).catch((error) => {
        console.error(`Moderation notifier reconciliation failed: ${redactError('worker', { message: error?.message })}`)
      })
    }, 60000)
    this.reconcileTimer.unref()
    this.kick()
    if (!reviewUrlFor(0)) console.warn('Moderation review links are omitted until PUBLIC_SITE_URL uses HTTPS')
    console.log(`Moderation notifications active for: ${this.targets.map((target) => target.provider).join(', ')}`)
  }

  async reconfigure(targets = []) {
    const nextTargets = Array.isArray(targets) ? targets.map((target) => ({ ...target })) : []
    const apply = async () => {
      this.stopScheduling()
      if (this.currentReconcile) await this.currentReconcile.catch(() => {})
      if (this.currentRun) await this.currentRun.catch(() => {})
      await Promise.all([...this.deliveryLocks.values()].map((operation) => operation.catch(() => {})))
      this.stopScheduling()
      this.replaceTargets(nextTargets)
      if (this.pool && this.active) await this.startWorker()
      return this.targets.map(({ provider }) => provider)
    }
    const previous = this.currentReconfigure || Promise.resolve()
    const current = previous.catch(() => {}).then(apply)
    this.currentReconfigure = current
    try {
      return await current
    } finally {
      if (this.currentReconfigure === current) this.currentReconfigure = null
    }
  }

  async init(pool) {
    this.pool = pool
    const knownProviders = listNotificationProviders().map((provider) => provider.id)
    const quarantined = await this.pool.query(`
      UPDATE moderation_notification_outbox
      SET status = 'dead', locked_at = NULL, last_error = 'unsupported notification provider'
      WHERE status IN ('pending', 'sending')
        AND (provider IS NULL OR NOT (provider = ANY($1::text[])))
      RETURNING id
    `, [knownProviders])
    if (quarantined.rowCount) console.error(`Moderation notifier quarantined ${quarantined.rowCount} unsupported job(s)`)
    if (!this.active) {
      console.log('Moderation notifications are disabled or no valid bot webhook is configured')
      return
    }
    await this.startWorker()
  }

  async enqueuePendingPost(message, queryable, eventType = 'message.created_pending') {
    if (!this.active || !queryable || !message?.id || message.review_status === 'approved' || message.moderation_status !== 'pending') return 0
    const payload = moderationEventPayload(message)
    const revision = Number(message.review_revision)
    const fallbackVersion = safeText(message.pending_since || message.timestamp || 'legacy', 80).replace(/[^\w.-]/g, '_')
    const version = Number.isSafeInteger(revision) && revision > 0 ? `r${revision}` : fallbackVersion
    let inserted = 0
    for (const target of this.targets) {
      const eventKey = `message:${message.id}:pending:${version}:${target.provider}`
      const result = await queryable.query(
        `INSERT INTO moderation_notification_outbox
           (event_key, event_type, provider, message_id, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (event_key) DO NOTHING`,
        [eventKey, eventType, target.provider, Number(message.id), JSON.stringify(payload)]
      )
      inserted += result.rowCount || 0
    }
    return inserted
  }

  scheduleReconciliationFollowup() {
    if (this.closing || this.reconcileFollowupTimer) return
    const delay = Math.max(250, Math.min(config.moderationNotifyPollMs, 2000))
    this.reconcileFollowupTimer = setTimeout(() => {
      this.reconcileFollowupTimer = null
      this.reconcilePendingMessages().then(() => this.kick()).catch((error) => {
        console.error(`Moderation notifier reconciliation failed: ${redactError('worker', { message: error?.message })}`)
      })
    }, delay)
    this.reconcileFollowupTimer.unref()
  }

  async performReconciliation() {
    if (!this.active || !this.pool) return 0
    const batchSize = config.moderationNotifyBatchSize
    const recovered = await this.pool.query(`
      WITH stale AS (
        SELECT id
        FROM moderation_notification_outbox
        WHERE status = 'sending'
          AND locked_at < now() - interval '2 minutes'
        ORDER BY locked_at, id
        LIMIT $1::int
        FOR UPDATE SKIP LOCKED
      )
      UPDATE moderation_notification_outbox AS job
      SET status = 'pending', locked_at = NULL, next_attempt_at = now(), last_error = 'recovered stale worker lock'
      FROM stale
      WHERE job.id = stale.id
      RETURNING job.id
    `, [batchSize])
    const result = await this.pool.query(`
      SELECT id, data
      FROM messages
      WHERE COALESCE(data->>'review_status', 'approved') <> 'approved'
        AND COALESCE(data->>'moderation_status', 'visible') = 'pending'
        AND id > $1::bigint
      ORDER BY id
      LIMIT $2::int
    `, [this.reconcileCursor, batchSize])
    let inserted = 0
    for (const row of result.rows) {
      const message = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
      const eventType = Number(message?.edit_count) > 0 ? 'message.edited_pending' : 'message.created_pending'
      inserted += await this.enqueuePendingPost(message, this.pool, eventType)
    }
    const lastMessage = result.rows.at(-1)
    this.reconcileCursor = result.rows.length >= batchSize && lastMessage?.id
      ? String(lastMessage.id)
      : '0'
    if ((recovered.rowCount || 0) >= batchSize || result.rows.length >= batchSize) {
      this.scheduleReconciliationFollowup()
    }
    return inserted
  }

  async reconcilePendingMessages() {
    if (this.currentReconcile) return this.currentReconcile
    const run = this.performReconciliation()
    this.currentReconcile = run
    try {
      return await run
    } finally {
      if (this.currentReconcile === run) this.currentReconcile = null
    }
  }

  kick() {
    if (!this.active || !this.pool || this.closing || this.currentRun || this.kickTimer) return
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null
      if (this.currentRun || this.closing) return
      this.currentRun = this.drain().catch((error) => {
        console.error(`Moderation notifier worker failed: ${redactError('worker', { message: error?.message })}`)
      }).finally(() => {
        this.currentRun = null
      })
    }, config.moderationNotifyCoalesceMs)
    this.kickTimer.unref()
  }

  deliveryInterval(provider) {
    const adapter = getNotificationProvider(provider)
    return Math.max(adapter?.minIntervalMs || 1000, config.moderationNotifyMinIntervalMs)
  }

  deliveryCooldown(provider) {
    return Math.max(0, (this.lastDeliveryAt.get(provider) || 0) + this.deliveryInterval(provider) - Date.now())
  }

  async withProviderDeliveryLock(provider, task) {
    const previous = this.deliveryLocks.get(provider) || Promise.resolve()
    const current = previous.catch(() => {}).then(async () => {
      const cooldown = this.deliveryCooldown(provider)
      if (cooldown > 0) {
        const error = new Error('notification delivery cooldown')
        error.statusCode = 429
        error.retryAfterMs = cooldown
        throw error
      }
      return task()
    })
    this.deliveryLocks.set(provider, current)
    try {
      return await current
    } finally {
      if (this.deliveryLocks.get(provider) === current) this.deliveryLocks.delete(provider)
    }
  }

  availableProviders() {
    return this.targets
      .map((target) => target.provider)
      .filter((provider) => this.deliveryCooldown(provider) === 0)
  }

  async claimBatch() {
    const available = this.availableProviders()
    if (!available.length) return []
    const result = await this.pool.query(`
      WITH first_due AS (
        SELECT provider
        FROM moderation_notification_outbox
        WHERE status = 'pending'
          AND next_attempt_at <= now()
          AND provider = ANY($2::text[])
        ORDER BY next_attempt_at, id
        LIMIT 1
      ),
      due AS (
        SELECT id
        FROM moderation_notification_outbox
        WHERE status = 'pending'
          AND next_attempt_at <= now()
          AND provider = (SELECT provider FROM first_due)
        ORDER BY next_attempt_at, id
        LIMIT $1::int
        FOR UPDATE SKIP LOCKED
      )
      UPDATE moderation_notification_outbox AS job
      SET status = 'sending', locked_at = now(), attempts = attempts + 1
      FROM due
      WHERE job.id = due.id
      RETURNING job.*
    `, [config.moderationNotifyBatchSize, available])
    return result.rows
  }

  async pendingContexts(jobs) {
    const messageIds = [...new Set(jobs.map((job) => Number(job.message_id)).filter(Number.isSafeInteger))]
    const [messagesResult, countResult] = await Promise.all([
      this.pool.query('SELECT id, data FROM messages WHERE id = ANY($1::bigint[])', [messageIds]),
      this.pool.query(`
        SELECT COUNT(*)::int AS count
        FROM messages
        WHERE COALESCE(data->>'review_status', 'approved') <> 'approved'
          AND COALESCE(data->>'moderation_status', 'visible') = 'pending'
      `)
    ])
    const messages = new Map(messagesResult.rows.map((row) => [String(row.id), typeof row.data === 'string' ? JSON.parse(row.data) : row.data]))
    const pendingCount = Number(countResult.rows[0]?.count) || 0
    return new Map(jobs.map((job) => {
      const message = messages.get(String(job.message_id))
      if (!message) return [String(job.id), { pending: false, pendingCount }]
      const expectedRevision = Number(job.payload?.review_revision) || 0
      const samePendingRevision = expectedRevision > 0
        ? Number(message.review_revision) === expectedRevision
        : safeText(message.pending_since || message.timestamp, 80) === safeText(job.payload?.submitted_at, 80)
      return [String(job.id), {
        pending: message.review_status !== 'approved' && message.moderation_status === 'pending' && samePendingRevision,
        pendingCount,
        deliveryPayload: { ...job.payload, ...moderationEventPayload(message) }
      }]
    }))
  }

  targetFor(provider) {
    return this.targets.find((target) => target.provider === provider) || null
  }

  async deliverToTarget(target, jobs, pendingCount) {
    const provider = jobs[0]?.provider
    const adapter = getNotificationProvider(provider)
    if (!target || target.provider !== provider || !adapter) throw Object.assign(new Error('configured target unavailable'), { permanent: true })
    const validation = adapter.validateTarget(target)
    if (!validation.valid) throw Object.assign(new Error('configured target unavailable'), { permanent: true })
    const batchCount = jobs.length
    const batchScopes = [...new Set(jobs.map((job) => normalizeModerationScope(notificationScopeForPayload(job.payload))))]
    const payload = batchCount === 1 ? jobs[0].payload : {
      message_id: 0,
      message_ids: jobs.slice(0, 8).map((job) => Number(job.message_id)),
      category: [...new Set(jobs.map((job) => safeText(job.payload?.category, 40)).filter(Boolean))].slice(0, 4).join('、') || '校园动态',
      moderation_scope: batchScopes.length === 1 ? batchScopes[0] : 'all',
      submitted_at: '',
      attachment_count: jobs.reduce((total, job) => total + Math.max(Number(job.payload?.attachment_count) || 0, 0), 0),
      has_poll: jobs.some((job) => job.payload?.has_poll)
    }
    const reviewUrl = reviewUrlFor(
      batchCount === 1 ? jobs[0].message_id : 0,
      config.publicSiteUrl,
      config.environment,
      notificationScopeForPayload(payload)
    )
    const body = adapter.buildMessage({ target, payload, pendingCount, batchCount, reviewUrl })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.moderationNotifyTimeoutMs)
    timeout.unref()
    try {
      const response = await this.fetchImpl(target.webhook, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      this.lastDeliveryAt.set(provider, Date.now())
      const data = await response.json().catch(() => ({}))
      const classification = adapter.classifyResponse({ body: data })
      if (!response.ok || !classification.ok) {
        const { code, message } = classification
        const error = new Error(redactError(provider, { status: response.status, code, message }))
        error.retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'))
        error.permanent = classification.permanent
          || (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429)
        throw error
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`${provider}: timeout`)
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  async deliver(jobs, pendingCount) {
    const provider = jobs[0]?.provider
    return this.withProviderDeliveryLock(provider, () => this.deliverToTarget(this.targetFor(provider), jobs, pendingCount))
  }

  async testTarget(target) {
    const provider = String(target?.provider || '').trim().toLowerCase()
    const adapter = getNotificationProvider(provider)
    const validation = adapter?.validateTarget(target)
    if (!adapter || !validation?.valid) {
      throw Object.assign(new Error('configured target unavailable'), { permanent: true, statusCode: 409 })
    }
    await this.withProviderDeliveryLock(provider, () => this.deliverToTarget({ ...target, webhook: validation.url }, [{
      provider,
      message_id: 0,
      payload: {
        message_id: 0,
        category: '审核提醒测试',
        moderation_scope: 'all',
        submitted_at: new Date().toISOString(),
        attachment_count: 0,
        has_poll: false,
        test_mode: true
      }
    }], 0))
    return { provider, sent_at: new Date().toISOString() }
  }

  async finish(jobs, contexts) {
    const cancelled = jobs.filter((job) => !contexts.get(String(job.id))?.pending)
    const active = jobs.filter((job) => contexts.get(String(job.id))?.pending)
    if (cancelled.length) {
      await this.pool.query(
        `UPDATE moderation_notification_outbox
         SET status = 'cancelled', locked_at = NULL, last_error = 'message no longer pending'
         WHERE id = ANY($1::bigint[])`,
        [cancelled.map((job) => job.id)]
      )
    }
    if (!active.length) {
      return
    }
    const pendingCount = contexts.get(String(active[0].id))?.pendingCount || 0
    const deliveryJobs = active.map((job) => ({
      ...job,
      payload: contexts.get(String(job.id))?.deliveryPayload || job.payload
    }))
    try {
      await this.deliver(deliveryJobs, pendingCount)
    } catch (error) {
      const lastError = redactError(active[0].provider, { message: error?.message || 'delivery failed' })
      for (const job of active) {
        const exhausted = error?.permanent || Number(job.attempts) >= config.moderationNotifyMaxAttempts
        const baseDelay = retryDelays[Math.min(Math.max(Number(job.attempts) - 1, 0), retryDelays.length - 1)]
        const retryAt = new Date(Date.now() + Math.max(Number(error?.retryAfterMs) || 0, baseDelay))
        await this.pool.query(
          `UPDATE moderation_notification_outbox
           SET status = $2, locked_at = NULL, last_error = $3, next_attempt_at = $4
           WHERE id = $1`,
          [job.id, exhausted ? 'dead' : 'pending', lastError, retryAt]
        )
      }
      console.error(`Moderation notification failed: ${active[0].provider}: ${active.length} message(s)`)
      return
    }

    const receiptRetryDelays = [0, 100, 500, 2000]
    for (const delay of receiptRetryDelays) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      try {
        await this.pool.query(
          `UPDATE moderation_notification_outbox
           SET status = 'sent', delivered_at = now(), locked_at = NULL, last_error = ''
           WHERE id = ANY($1::bigint[])`,
          [active.map((job) => job.id)]
        )
        console.log(`Moderation notification delivered: ${active[0].provider}: ${active.length} message(s)`)
        return
      } catch (error) {
        if (delay === receiptRetryDelays.at(-1)) {
          console.error(`Moderation notification receipt persistence failed: ${active[0].provider}: ${active.length} message(s)`)
        }
      }
    }
  }

  async releaseClaimedJobs(jobs) {
    if (!jobs.length) return
    await this.pool.query(
      `UPDATE moderation_notification_outbox
       SET status = 'pending', locked_at = NULL, next_attempt_at = now() + interval '10 seconds', last_error = 'worker interrupted'
       WHERE id = ANY($1::bigint[]) AND status = 'sending'`,
      [jobs.map((job) => job.id)]
    )
  }

  async drain() {
    for (let processed = 0; processed < 25 && !this.closing; processed += 1) {
      const jobs = await this.claimBatch()
      if (!jobs.length) return
      try {
        const contexts = await this.pendingContexts(jobs)
        await this.finish(jobs, contexts)
      } catch (error) {
        await this.releaseClaimedJobs(jobs).catch(() => {})
        throw error
      }
    }
  }

  async close() {
    this.closing = true
    this.stopScheduling()
    if (this.currentReconfigure) await this.currentReconfigure.catch(() => {})
    if (this.currentReconcile) await this.currentReconcile.catch(() => {})
    if (this.currentRun) await this.currentRun.catch(() => {})
    await Promise.all([...this.deliveryLocks.values()].map((operation) => operation.catch(() => {})))
  }
}

export const moderationNotifier = new ModerationNotifier()
