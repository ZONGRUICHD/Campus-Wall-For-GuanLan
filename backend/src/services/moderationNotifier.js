import { createHmac } from 'node:crypto'
import { config } from '../config.js'

const supportedProviders = new Set(['feishu', 'wecom'])
const targetIntervals = Object.freeze({ feishu: 650, wecom: 3100 })
const retryDelays = Object.freeze([2000, 10000, 60000, 5 * 60000, 30 * 60000, 60 * 60000])

const safeText = (value, maxLength = 160) => String(value || '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLength)

const messageCategory = (message = {}) => {
  if (message.lost_found) return message.lost_found.kind === 'found' ? '失物招领 · 招领启事' : '失物招领 · 寻物启事'
  if ((message.tags || []).some((tag) => String(tag).includes('表白'))) return '表白墙便签'
  if (message.official) return '官方帖子'
  if (message.poll) return '校园投票'
  return '校园动态'
}

export const moderationEventPayload = (message = {}) => ({
  message_id: Number(message.id),
  submitted_at: safeText(message.pending_since || message.timestamp, 80),
  review_revision: Math.max(Number(message.review_revision) || 0, 0),
  category: messageCategory(message),
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

export const reviewUrlFor = (messageId, configuredUrl = config.publicSiteUrl, environment = config.environment) => {
  const fallback = environment === 'production'
    ? ''
    : config.allowedOrigins.find((origin) => !/localhost|127\.0\.0\.1/i.test(origin)) || config.allowedOrigins[0]
  const base = normalizeBaseUrl(configuredUrl || fallback, environment)
  if (!base) return ''
  const url = new URL('/admin/wall', base)
  url.searchParams.set('status', 'pending')
  if (Number(messageId) > 0) url.searchParams.set('message', String(messageId))
  return url.toString()
}

export const validateWebhookTarget = ({ provider, webhook }) => {
  if (!supportedProviders.has(provider)) return { valid: false, reason: 'unsupported_provider' }
  try {
    const url = new URL(String(webhook || '').trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
      return { valid: false, reason: 'invalid_url_security' }
    }
    if (provider === 'feishu') {
      const validHost = url.hostname === 'open.feishu.cn' || url.hostname === 'open.larksuite.com'
      if (!validHost || !/^\/open-apis\/bot\/v2\/hook\/[^/]+$/.test(url.pathname) || url.search) {
        return { valid: false, reason: 'invalid_feishu_webhook' }
      }
    }
    if (provider === 'wecom') {
      if (url.hostname !== 'qyapi.weixin.qq.com' || url.pathname !== '/cgi-bin/webhook/send') {
        return { valid: false, reason: 'invalid_wecom_webhook' }
      }
      const keys = [...url.searchParams.keys()]
      if (keys.length !== 1 || keys[0] !== 'key' || !url.searchParams.get('key')) {
        return { valid: false, reason: 'invalid_wecom_key' }
      }
    }
    return { valid: true, url: url.toString() }
  } catch {
    return { valid: false, reason: 'invalid_url' }
  }
}

export const generateFeishuSignature = (timestamp, secret) => createHmac(
  'sha256',
  `${timestamp}\n${String(secret || '')}`
).digest('base64')

const detailLines = (payload, pendingCount, batchCount = 1) => {
  const details = batchCount > 1
    ? [
        `本批新增：${batchCount} 条`,
        `帖子编号：${(payload.message_ids || []).map((id) => `#${id}`).join('、')}${batchCount > (payload.message_ids || []).length ? ' 等' : ''}`,
        `内容类型：${payload.category}`,
        `当前待审：${pendingCount} 条`
      ]
    : [
        `帖子编号：#${payload.message_id}`,
        `内容类型：${payload.category}`,
        `提交时间：${payload.submitted_at || '刚刚'}`,
        `当前待审：${pendingCount} 条`
      ]
  if (payload.attachment_count) details.push(`附件：${payload.attachment_count} 个（请在后台鉴权查看）`)
  if (payload.has_poll) details.push('附带投票')
  details.push('为保护校园隐私，群提醒不包含正文、发布者身份或联系方式。')
  return details
}

export const buildFeishuPayload = ({ payload, pendingCount, batchCount = 1, reviewUrl, secret = '', timestamp = Math.floor(Date.now() / 1000) }) => {
  const lines = detailLines(payload, pendingCount, batchCount)
  const elements = [
    { tag: 'div', text: { tag: 'lark_md', content: lines.map((line) => safeText(line, 300)).join('\n') } }
  ]
  if (reviewUrl) {
    elements.push({
      tag: 'action',
      actions: [{ tag: 'button', type: 'primary', text: { tag: 'plain_text', content: '进入审核后台' }, url: reviewUrl }]
    })
  }
  const body = {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: { template: 'orange', title: { tag: 'plain_text', content: batchCount > 1 ? `校园墙新增 ${batchCount} 条待审核` : '校园墙有新帖子待审核' } },
      elements
    }
  }
  if (secret) {
    body.timestamp = String(timestamp)
    body.sign = generateFeishuSignature(timestamp, secret)
  }
  return body
}

export const buildWecomPayload = ({ payload, pendingCount, batchCount = 1, reviewUrl }) => {
  const lines = detailLines(payload, pendingCount, batchCount)
  if (reviewUrl) lines.push(`[进入审核后台](${reviewUrl})`)
  return {
    msgtype: 'markdown_v2',
    markdown_v2: { content: `## ${batchCount > 1 ? `校园墙新增 ${batchCount} 条待审核` : '校园墙有新帖子待审核'}\n${lines.map((line) => safeText(line, 300)).join('\n')}` }
  }
}

export const isSuccessfulBotResponse = (provider, response = {}) => provider === 'feishu'
  ? (response.code ?? response.StatusCode) != null && Number(response.code ?? response.StatusCode) === 0
  : response.errcode != null && Number(response.errcode) === 0

const redactError = (provider, { status = 0, code = '', message = '' } = {}) => {
  const safeProvider = supportedProviders.has(provider) ? provider : 'unknown'
  const safeCode = safeText(code, 40).replace(/[^\w.-]/g, '')
  const safeMessage = safeText(message, 120).replace(/https?:\/\/\S+/gi, '[redacted-url]').replace(/[A-Fa-f0-9_-]{24,}/g, '[redacted-token]')
  return [safeProvider, status ? `http_${status}` : '', safeCode ? `code_${safeCode}` : '', safeMessage].filter(Boolean).join(': ')
}

const configuredTargets = () => {
  if (!config.moderationNotifyEnabled) return []
  const candidates = [
    { provider: 'feishu', webhook: config.moderationNotifyFeishuWebhook, secret: config.moderationNotifyFeishuSecret },
    { provider: 'wecom', webhook: config.moderationNotifyWecomWebhook, secret: '' }
  ].filter((target) => target.webhook)
  return candidates.flatMap((target) => {
    const result = validateWebhookTarget(target)
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
    this.kickTimer = null
    this.currentRun = null
    this.closing = false
    this.lastDeliveryAt = new Map()
    this.initialBacklogProviders = new Set()
  }

  get active() {
    return this.targets.length > 0
  }

  async init(pool) {
    this.pool = pool
    if (!config.moderationNotifyEnabled) {
      console.log('Moderation notifications are disabled')
      return
    }
    if (!this.active) {
      console.error('Moderation notifications are enabled but no valid bot webhook is configured')
      return
    }
    await this.pool.query(`
      UPDATE moderation_notification_outbox AS job
      SET status = 'pending', locked_at = NULL, attempts = 0, next_attempt_at = now(), last_error = ''
      FROM messages AS message
      WHERE job.message_id = message.id
        AND (
          (job.status = 'sending' AND job.locked_at < now() - interval '2 minutes')
          OR job.status = 'dead'
        )
        AND COALESCE(message.data->>'review_status', 'approved') <> 'approved'
        AND COALESCE(message.data->>'moderation_status', 'visible') = 'pending'
    `)
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
    await this.reconcilePendingMessages()
    this.initialBacklogProviders = new Set(this.targets.map((target) => target.provider))
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

  async reconcilePendingMessages() {
    if (!this.active || !this.pool) return 0
    await this.pool.query(`
      UPDATE moderation_notification_outbox
      SET status = 'pending', locked_at = NULL, next_attempt_at = now(), last_error = 'recovered stale worker lock'
      WHERE status = 'sending'
        AND locked_at < now() - interval '2 minutes'
    `)
    const result = await this.pool.query(`
      SELECT data
      FROM messages
      WHERE COALESCE(data->>'review_status', 'approved') <> 'approved'
        AND COALESCE(data->>'moderation_status', 'visible') = 'pending'
    `)
    let inserted = 0
    for (const row of result.rows) {
      const message = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
      const eventType = Number(message?.edit_count) > 0 ? 'message.edited_pending' : 'message.created_pending'
      inserted += await this.enqueuePendingPost(message, this.pool, eventType)
    }
    return inserted
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
    return Math.max(targetIntervals[provider] || 1000, config.moderationNotifyMinIntervalMs)
  }

  deliveryCooldown(provider) {
    return Math.max(0, (this.lastDeliveryAt.get(provider) || 0) + this.deliveryInterval(provider) - Date.now())
  }

  availableProviders() {
    return this.targets
      .map((target) => target.provider)
      .filter((provider) => this.deliveryCooldown(provider) === 0)
  }

  async claimBatch() {
    const available = this.availableProviders()
    if (!available.length) return []
    const initialProviders = available.filter((provider) => this.initialBacklogProviders.has(provider))
    const collapseInitialBacklog = initialProviders.length > 0
    const providers = collapseInitialBacklog ? initialProviders : available
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
        LIMIT CASE WHEN $3::boolean THEN NULL ELSE $1::int END
        FOR UPDATE SKIP LOCKED
      )
      UPDATE moderation_notification_outbox AS job
      SET status = 'sending', locked_at = now(), attempts = attempts + 1
      FROM due
      WHERE job.id = due.id
      RETURNING job.*
    `, [config.moderationNotifyBatchSize, providers, collapseInitialBacklog])
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
        pendingCount
      }]
    }))
  }

  targetFor(provider) {
    return this.targets.find((target) => target.provider === provider) || null
  }

  async deliver(jobs, pendingCount) {
    const provider = jobs[0]?.provider
    const target = this.targetFor(provider)
    if (!target) throw Object.assign(new Error('configured target unavailable'), { permanent: true })
    const batchCount = jobs.length
    const payload = batchCount === 1 ? jobs[0].payload : {
      message_id: 0,
      message_ids: jobs.slice(0, 8).map((job) => Number(job.message_id)),
      category: [...new Set(jobs.map((job) => safeText(job.payload?.category, 40)).filter(Boolean))].slice(0, 4).join('、') || '校园动态',
      submitted_at: '',
      attachment_count: jobs.reduce((total, job) => total + Math.max(Number(job.payload?.attachment_count) || 0, 0), 0),
      has_poll: jobs.some((job) => job.payload?.has_poll)
    }
    const reviewUrl = reviewUrlFor(batchCount === 1 ? jobs[0].message_id : 0)
    const body = provider === 'feishu'
      ? buildFeishuPayload({ payload, pendingCount, batchCount, reviewUrl, secret: target.secret })
      : buildWecomPayload({ payload, pendingCount, batchCount, reviewUrl })
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
      if (!response.ok || !isSuccessfulBotResponse(provider, data)) {
        const code = provider === 'feishu' ? (data.code ?? data.StatusCode) : data.errcode
        const message = provider === 'feishu' ? (data.msg ?? data.StatusMessage) : data.errmsg
        const retryAfterSeconds = Number(response.headers.get('retry-after'))
        const error = new Error(redactError(provider, { status: response.status, code, message }))
        error.retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 0
        const permanentPlatformCodes = provider === 'feishu' ? new Set([9499, 19001, 19021, 19022, 19024]) : new Set()
        error.permanent = permanentPlatformCodes.has(Number(code))
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
      if (jobs[0]?.provider) this.initialBacklogProviders.delete(jobs[0].provider)
      return
    }
    const pendingCount = contexts.get(String(active[0].id))?.pendingCount || 0
    try {
      await this.deliver(active, pendingCount)
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
        this.initialBacklogProviders.delete(active[0].provider)
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
    if (this.timer) clearInterval(this.timer)
    if (this.reconcileTimer) clearInterval(this.reconcileTimer)
    if (this.kickTimer) clearTimeout(this.kickTimer)
    if (this.currentRun) await this.currentRun.catch(() => {})
  }
}

export const moderationNotifier = new ModerationNotifier()
