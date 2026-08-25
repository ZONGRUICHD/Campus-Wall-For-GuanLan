import { randomUUID } from 'node:crypto'
import { createPostgresPool, initMessageSchema } from './postgres.js'
import { nowText } from './jsonStore.js'
import { isLostFoundMessage, isLostFoundTag, lostFoundTags, normalizeLostFoundType } from './lostFound.js'
import { moderationNotifier } from './moderationNotifier.js'

const clone = (value) => JSON.parse(JSON.stringify(value))
const nonNegativeNumber = (value) => {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : 0
}
const normalizeTags = (tags) => Array.isArray(tags)
  ? tags.map((tag) => String(tag || '').trim()).filter(Boolean)
  : []
const moderationStatuses = new Set(['pending', 'visible', 'hidden', 'deleted'])
const commentModerationStatuses = new Set(['visible', 'hidden', 'deleted'])
const normalizeComment = (comment = {}) => {
  const next = { ...comment, files: Array.isArray(comment?.files) ? comment.files : [] }
  next.moderation_status = commentModerationStatuses.has(next.moderation_status) ? next.moderation_status : 'visible'
  if (next.moderation_status !== 'hidden' && next.moderation_status !== 'deleted') {
    delete next.hidden_reason
    delete next.hidden_at
    delete next.hidden_by
  }
  if (next.moderation_status !== 'deleted') {
    delete next.deleted_at
    delete next.deleted_by
    delete next.deletion_reason
    delete next.deletion_origin
    delete next.deleted_from_status
  }
  return next
}
const normalizePoll = (poll) => {
  if (!poll || typeof poll !== 'object') return null
  const question = String(poll.question || '').trim()
  const options = Array.isArray(poll.options)
    ? poll.options.map((option, index) => ({
        id: String(option?.id || `option-${index + 1}`).trim(),
        text: String(option?.text || '').trim(),
        votes: nonNegativeNumber(option?.votes)
      })).filter((option) => option.id && option.text)
    : []
  if (!question || options.length < 2) return null
  const closesAt = poll.closes_at && !Number.isNaN(Date.parse(poll.closes_at))
    ? new Date(poll.closes_at).toISOString()
    : null
  return {
    question,
    options,
    total_votes: options.reduce((total, option) => total + option.votes, 0),
    closes_at: closesAt
  }
}

export class MessageStore {
  constructor() {
    this.pool = createPostgresPool()
    this.messages = new Map()
    this.partitions = new Map()
    this.hotMessages = []
    this.hotMessagesWithoutLostFound = []
    this.hotTimer = null
    this.messageLocks = new Map()
  }

  async init() {
    await initMessageSchema(this.pool)
    await this.load()
    await this.backfillPendingSince()
    this.refreshHotMessages()
    this.hotTimer = setInterval(() => this.refreshHotMessages(), 60 * 60 * 1000)
    this.hotTimer.unref()
  }

  async close() {
    if (this.hotTimer) clearInterval(this.hotTimer)
    await this.pool.end()
  }

  async load() {
    this.messages.clear()
    const messageRows = await this.pool.query('SELECT id, data FROM messages ORDER BY id')
    for (const row of messageRows.rows) {
      const message = typeof row.data === 'string' ? JSON.parse(row.data) : clone(row.data)
      this.normalizeMessage(message, row.id)
      this.messages.set(Number(row.id), message)
    }

    this.partitions.clear()
    const partitionRows = await this.pool.query('SELECT tag, message_id FROM partitions ORDER BY tag, message_id')
    for (const row of partitionRows.rows) {
      if (!this.partitions.has(row.tag)) this.partitions.set(row.tag, [])
      this.partitions.get(row.tag).push(Number(row.message_id))
    }
    await this.backfillMissingPartitions()
  }

  normalizeMessage(message, id) {
    const hasStoredReviewStatus = Object.hasOwn(message, 'review_status')
    message.id = Number(message.id ?? id)
    message.comments = Array.isArray(message.comments)
      ? message.comments.map(normalizeComment)
      : []
    message.files = Array.isArray(message.files) ? message.files : []
    message.tags = normalizeTags(message.tags)
    message.likes = nonNegativeNumber(message.likes)
    message.dislikes = nonNegativeNumber(message.dislikes)
    message.pinned = message.pinned === true
    message.featured = message.featured === true
    message.moderation_status = moderationStatuses.has(message.moderation_status) ? message.moderation_status : 'visible'
    // Messages created before the review workflow existed were already public.
    // Preserve that state, while every newly-created message stores an explicit
    // pending review status below in postMessage.
    message.review_status = hasStoredReviewStatus
      ? (message.review_status === 'approved' ? 'approved' : 'pending')
      : (message.moderation_status === 'pending' ? 'pending' : 'approved')
    if (message.moderation_status === 'pending') {
      message.review_status = 'pending'
      const pendingSince = Date.parse(String(message.pending_since || '').replace(' ', 'T'))
      if (!Number.isFinite(pendingSince)) delete message.pending_since
    } else {
      delete message.pending_since
    }
    if (message.moderation_status !== 'hidden' && message.moderation_status !== 'deleted') {
      delete message.hidden_reason
      delete message.hidden_at
      delete message.hidden_by
    }
    if (message.moderation_status !== 'deleted') {
      delete message.deleted_at
      delete message.deleted_by
      delete message.deletion_reason
      delete message.deletion_origin
      delete message.deleted_from_status
    }
    message.poll = normalizePoll(message.poll)
    if (message.user_id !== undefined && message.user_id !== null) message.user_id = Number(message.user_id)
    if (message.submitted_by_user_id !== undefined && message.submitted_by_user_id !== null) {
      message.submitted_by_user_id = Number(message.submitted_by_user_id)
    }
    if (message.anonymous === undefined) message.anonymous = true
    return message
  }

  async backfillMissingPartitions() {
    for (const message of this.messages.values()) {
      const tags = normalizeTags(message.tags)
      for (const tag of tags) {
        if (this.partitions.get(tag)?.includes(message.id)) continue
        await this.savePartition(tag, message.id)
        this.setPartitionInMemory(tag, message.id)
      }
    }
  }

  async saveMessage(message, queryable = this.pool) {
    this.normalizeMessage(message, message.id)
    await queryable.query(
      `INSERT INTO messages (id, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (id)
       DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [message.id, JSON.stringify(message)]
    )
  }

  async insertMessage(message, queryable = this.pool) {
    this.normalizeMessage(message, message.id)
    return queryable.query(
      `INSERT INTO messages (id, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [message.id, JSON.stringify(message)]
    )
  }

  findPartition(tag) {
    const query = String(tag || '')
    if (!query) return ''
    for (const key of this.partitions.keys()) {
      if (key.toLowerCase().includes(query.toLowerCase()) || query.toLowerCase().includes(key.toLowerCase())) return key
    }
    return query
  }

  setPartitionInMemory(tag, messageId) {
    if (!this.partitions.has(tag)) this.partitions.set(tag, [])
    if (!this.partitions.get(tag).includes(messageId)) this.partitions.get(tag).push(messageId)
  }

  async savePartition(tag, messageId, queryable = this.pool) {
    await queryable.query(
      'INSERT INTO partitions (tag, message_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [tag, messageId]
    )
  }

  parseCookieIds(value = '') {
    return String(value).split(',').filter((item) => /^\d+$/.test(item)).map(Number)
  }

  parsePollSelections(value = '') {
    const selections = new Map()
    for (const item of String(value).split(',')) {
      const match = item.match(/^(\d+):([a-zA-Z0-9-]{1,80})$/)
      if (match) selections.set(Number(match[1]), match[2])
    }
    return selections
  }

  withLikeState(message, likeList = [], dislikeList = []) {
    const copy = clone(message)
    copy.liked = likeList.includes(Number(copy.id))
    copy.disliked = dislikeList.includes(Number(copy.id))
    return copy
  }

  withPollState(message, pollSelections = new Map()) {
    const copy = clone(message)
    if (!copy.poll) return copy
    const selectedOptionId = pollSelections.get(Number(copy.id)) || null
    copy.poll.selected_option_id = selectedOptionId
    copy.poll.has_voted = Boolean(selectedOptionId)
    copy.poll.is_closed = Boolean(copy.poll.closes_at && Date.parse(copy.poll.closes_at) <= Date.now())
    return copy
  }

  async withViewerState(messages, {
    reactorKey = '',
    likeList = [],
    dislikeList = [],
    pollSelections = new Map()
  } = {}) {
    const items = Array.isArray(messages) ? messages : [messages]
    const ids = items.filter(Boolean).map((message) => Number(message.id)).filter(Number.isSafeInteger)
    const reactions = new Map()
    const storedPollSelections = new Map()
    if (reactorKey && ids.length) {
      const [reactionRows, pollRows] = await Promise.all([
        this.pool.query(
          'SELECT message_id, reaction FROM message_reactions WHERE reactor_key = $1 AND message_id = ANY($2::bigint[])',
          [reactorKey, ids]
        ),
        this.pool.query(
          'SELECT message_id, option_id FROM poll_votes WHERE voter_key = $1 AND message_id = ANY($2::bigint[])',
          [reactorKey, ids]
        )
      ])
      for (const row of reactionRows.rows) reactions.set(Number(row.message_id), Number(row.reaction))
      for (const row of pollRows.rows) storedPollSelections.set(Number(row.message_id), row.option_id)
    }
    const effectivePollSelections = new Map([...pollSelections, ...storedPollSelections])
    const decorated = items.map((message) => {
      if (!message) return message
      const copy = this.withLikeState(message, likeList, dislikeList)
      if (reactions.has(Number(copy.id))) {
        copy.liked = reactions.get(Number(copy.id)) === 1
        copy.disliked = reactions.get(Number(copy.id)) === -1
      }
      return this.withPollState(copy, effectivePollSelections)
    })
    return Array.isArray(messages) ? decorated : decorated[0]
  }

  allMessages() {
    return Array.from(this.messages.values())
  }

  isPublicMessage(message) {
    return Boolean(message) && message.moderation_status === 'visible' && message.review_status === 'approved'
  }

  isPublicComment(comment) {
    return Boolean(comment) && comment.moderation_status === 'visible'
  }

  visibleComments(message) {
    return (Array.isArray(message?.comments) ? message.comments : []).filter((comment) => this.isPublicComment(comment))
  }

  reviewStatusCounts() {
    const messages = this.allMessages().filter((message) => message.moderation_status !== 'deleted')
    return {
      all: messages.length,
      pending: messages.filter((message) => message.review_status !== 'approved').length,
      approved: messages.filter((message) => message.review_status === 'approved').length,
      visible: messages.filter((message) => this.isPublicMessage(message)).length,
      hidden: messages.filter((message) => message.moderation_status === 'hidden').length,
      awaiting_publication: messages.filter((message) => message.moderation_status === 'pending').length,
      deleted: this.allMessages().filter((message) => message.moderation_status === 'deleted').length
    }
  }

  approvedMessageIds() {
    return this.allMessages()
      .filter((message) => message.moderation_status !== 'deleted' && message.review_status === 'approved')
      .map((message) => Number(message.id))
  }

  attachedFiles(message) {
    if (!message) return []
    return [
      ...(Array.isArray(message.files) ? message.files : []),
      ...(Array.isArray(message.comments)
        ? message.comments.flatMap((comment) => Array.isArray(comment.files) ? comment.files : [])
        : [])
    ]
  }

  isFileReferenced(filename) {
    const target = String(filename || '')
    return Boolean(target) && this.allMessages().some((message) => this.attachedFiles(message).includes(target))
  }

  async enqueueModerationNotification(message, client, eventType) {
    if (!moderationNotifier.active) return 0
    await client.query('SAVEPOINT moderation_notification_outbox')
    try {
      const inserted = await moderationNotifier.enqueuePendingPost(message, client, eventType)
      await client.query('RELEASE SAVEPOINT moderation_notification_outbox')
      return inserted
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT moderation_notification_outbox')
      await client.query('RELEASE SAVEPOINT moderation_notification_outbox')
      console.error(`Failed to persist moderation notification event for message ${message?.id || 'unknown'}`)
      return 0
    }
  }

  async backfillPendingSince() {
    const backfilledAt = new Date().toISOString()
    for (const [messageId, message] of this.messages.entries()) {
      if (message.moderation_status !== 'pending' || message.review_status === 'approved' || message.pending_since) continue
      const next = { ...message, pending_since: backfilledAt }
      await this.saveMessage(next)
      this.messages.set(messageId, next)
    }
  }

  isFilePubliclyReferenced(filename) {
    const target = String(filename || '')
    if (!target) return false
    return this.allMessages().some((message) => {
      if (!this.isPublicMessage(message)) return false
      if ((Array.isArray(message.files) ? message.files : []).includes(target)) return true
      return (Array.isArray(message.comments) ? message.comments : []).some((comment) => (
        this.isPublicComment(comment) && (Array.isArray(comment.files) ? comment.files : []).includes(target)
      ))
    })
  }

  isFileGuestAccessible(filename) {
    const target = String(filename || '')
    if (!target) return false
    return this.allMessages().some((message) => {
      if (!this.isPublicMessage(message) || isLostFoundMessage(message)) return false
      if ((Array.isArray(message.files) ? message.files : []).includes(target)) return true
      return (Array.isArray(message.comments) ? message.comments : []).some((comment) => (
        this.isPublicComment(comment) && (Array.isArray(comment.files) ? comment.files : []).includes(target)
      ))
    })
  }

  isFileReviewable(filename) {
    const target = String(filename || '')
    if (!target) return false
    return this.allMessages().some((message) => (
      !['hidden', 'deleted'].includes(message.moderation_status)
      && (Array.isArray(message.files) ? message.files : []).includes(target)
    ))
  }

  async expirePendingAttachments(retentionMs, now = Date.now(), messageIds = null) {
    const cutoff = now - Math.max(0, Number(retentionMs) || 0)
    const targets = Array.isArray(messageIds) ? new Set(messageIds.map(Number)) : null
    const candidates = this.allMessages()
      .filter((message) => !targets || targets.has(Number(message.id)))
      .filter((message) => message.moderation_status === 'pending' && message.review_status !== 'approved' && (message.files || []).length)
      .filter((message) => {
        const pendingSince = Date.parse(String(message.pending_since || '').replace(' ', 'T'))
        return Number.isFinite(pendingSince) && pendingSince <= cutoff
      })
      .map((message) => Number(message.id))
    const removed = []
    for (const messageId of candidates) {
      const result = await this.mutateStoredMessage(messageId, async (message) => {
        if (message.moderation_status !== 'pending' || message.review_status === 'approved' || !(message.files || []).length) {
          return { message, result: { success: false, files: [] } }
        }
        const pendingSince = Date.parse(String(message.pending_since || '').replace(' ', 'T'))
        if (!Number.isFinite(pendingSince) || pendingSince > cutoff) return { message, result: { success: false, files: [] } }
        const next = clone(message)
        const files = [...next.files]
        next.files = []
        next.attachments_expired_at = new Date(now).toISOString()
        return { message: next, result: { success: true, files } }
      })
      if (result?.success) removed.push(...result.files)
    }
    return [...new Set(removed)]
  }

  getMessage(id, likeList = [], dislikeList = []) {
    const message = this.messages.get(Number(id))
    return message ? this.withLikeState(message, likeList, dislikeList) : null
  }

  getMessages({ likeList = [], dislikeList = [], sort = 'newest', word = '', tag = '', filterType = 'all', includeHidden = false, includeDeleted = false } = {}) {
    let items = this.allMessages().map((item) => clone(item))
    if (!includeDeleted) items = items.filter((item) => item.moderation_status !== 'deleted')
    if (!includeHidden) items = items.filter((item) => this.isPublicMessage(item))
    const exactTag = String(tag || '').trim()
    if (exactTag) items = items.filter((item) => Array.isArray(item.tags) && item.tags.includes(exactTag))
    if (word) items = items.filter((item) => `${item.text || ''} ${item.poll?.question || ''} ${(item.tags || []).join(' ')}`.includes(word))
    if (filterType === 'files') items = items.filter((item) => Array.isArray(item.files) && item.files.length > 0)
    if (filterType === 'polls') items = items.filter((item) => Boolean(item.poll))
    const compareContent = (a, b) => {
      if (sort === 'likes') return (b.likes || 0) - (a.likes || 0)
      if (sort === 'dislikes') return (b.dislikes || 0) - (a.dislikes || 0)
      return String(b.timestamp || '').localeCompare(String(a.timestamp || ''))
    }
    items.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || compareContent(a, b))
    return items.map((item) => this.withLikeState(item, likeList, dislikeList))
  }

  getMessagesByUser(userId, likeList = [], dislikeList = []) {
    const ownerId = Number(userId)
    if (!Number.isSafeInteger(ownerId) || ownerId <= 0) return []
    return this.allMessages()
      .filter((message) => message.moderation_status !== 'deleted' && Number(message.user_id) === ownerId)
      .map((message) => clone(message))
      .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
      .map((message) => this.withLikeState(message, likeList, dislikeList))
  }

  getCommentsByUser(userId) {
    const ownerId = Number(userId)
    if (!Number.isSafeInteger(ownerId) || ownerId <= 0) return []
    const items = []
    for (const message of this.allMessages()) {
      if (message.moderation_status === 'deleted') continue
      const messageOwned = Number(message.user_id) === ownerId
      const messageHidden = !this.isPublicMessage(message)
      const previewSource = String(message.text || message.poll?.question || ((message.files || []).length ? '附件留言' : ''))
      for (const comment of message.comments || []) {
        if (Number(comment.user_id) !== ownerId) continue
        if (comment.moderation_status === 'deleted') continue
        const replyIndex = comment.refer_id
          ? message.comments.findIndex((item) => String(item.id) === String(comment.refer_id))
          : -1
        const copy = clone(comment)
        delete copy.user_id
        delete copy.username
        delete copy.hidden_by
        copy.owned = true
        copy.message_id = Number(message.id)
        copy.message_hidden = messageHidden
        copy.message_owned = messageOwned
        copy.message_preview = messageHidden && !messageOwned ? '' : previewSource.slice(0, 180)
        copy.message_timestamp = message.timestamp || ''
        copy.comment_hidden = !this.isPublicComment(comment)
        copy.refer_floor = replyIndex >= 0 ? replyIndex + 1 : null
        items.push(copy)
      }
    }
    return items.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
  }

  getComments({ status = 'all', word = '' } = {}) {
    const query = String(word || '').trim().toLowerCase()
    const items = []
    for (const message of this.allMessages()) {
      if (message.moderation_status === 'deleted') continue
      const messagePreview = String(message.text || message.poll?.question || ((message.files || []).length ? '附件留言' : '')).slice(0, 180)
      for (let index = 0; index < (message.comments || []).length; index += 1) {
        const comment = message.comments[index]
        if (comment.moderation_status === 'deleted') continue
        const hidden = !this.isPublicComment(comment)
        if (status === 'visible' && hidden) continue
        if (status === 'hidden' && !hidden) continue
        if (query && !`${comment.text || ''} ${messagePreview} ${comment.username || ''}`.toLowerCase().includes(query)) continue
        items.push({
          ...clone(comment),
          floor: index + 1,
          message_id: Number(message.id),
          message_preview: messagePreview,
          message_timestamp: message.timestamp || '',
          message_moderation_status: message.moderation_status,
          message_user_id: message.user_id || null
        })
      }
    }
    return items.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
  }

  getComment(messageId, commentId) {
    const message = this.messages.get(Number(messageId))
    const comment = message?.comments?.find((item) => String(item.id) === String(commentId))
    return comment ? clone(comment) : null
  }

  getTrash({ type = 'all', word = '' } = {}) {
    const query = String(word || '').trim().toLowerCase()
    const items = []
    for (const message of this.allMessages()) {
      const messagePreview = String(message.text || message.poll?.question || ((message.files || []).length ? '附件留言' : '')).slice(0, 220)
      if ((type === 'all' || type === 'message') && message.moderation_status === 'deleted') {
        items.push({
          type: 'message',
          id: String(message.id),
          message_id: Number(message.id),
          text: messagePreview,
          files: Array.isArray(message.files) ? clone(message.files) : [],
          user_id: message.user_id || null,
          username: message.username || '',
          deleted_at: message.deleted_at || '',
          deleted_by: message.deleted_by || '',
          deletion_reason: message.deletion_reason || '',
          deletion_origin: message.deletion_origin || '',
          deleted_from_status: message.deleted_from_status || 'hidden',
          timestamp: message.timestamp || ''
        })
      }
      if (message.moderation_status === 'deleted' || (type !== 'all' && type !== 'comment')) continue
      for (let index = 0; index < (message.comments || []).length; index += 1) {
        const comment = message.comments[index]
        if (comment.moderation_status !== 'deleted') continue
        items.push({
          type: 'comment',
          id: String(comment.id),
          comment_id: String(comment.id),
          message_id: Number(message.id),
          floor: index + 1,
          text: String(comment.text || ((comment.files || []).length ? '附件评论' : '')).slice(0, 220),
          files: Array.isArray(comment.files) ? clone(comment.files) : [],
          message_preview: messagePreview,
          user_id: comment.user_id || null,
          username: comment.username || '',
          deleted_at: comment.deleted_at || '',
          deleted_by: comment.deleted_by || '',
          deletion_reason: comment.deletion_reason || '',
          deletion_origin: comment.deletion_origin || '',
          deleted_from_status: comment.deleted_from_status || 'hidden',
          timestamp: comment.timestamp || ''
        })
      }
    }
    const filtered = query
      ? items.filter((item) => `${item.id} ${item.message_id} ${item.text} ${item.message_preview || ''} ${item.username} ${item.deleted_by} ${item.deletion_reason}`.toLowerCase().includes(query))
      : items
    return filtered.sort((a, b) => String(b.deleted_at || b.timestamp || '').localeCompare(String(a.deleted_at || a.timestamp || '')))
  }

  trashCounts() {
    let messages = 0
    let comments = 0
    for (const message of this.allMessages()) {
      if (message.moderation_status === 'deleted') {
        messages += 1
        continue
      }
      comments += (message.comments || []).filter((comment) => comment.moderation_status === 'deleted').length
    }
    return { all: messages + comments, messages, comments }
  }

  getTags({ includeHidden = false } = {}) {
    if (includeHidden) return Array.from(this.partitions.keys())
    return Array.from(this.partitions.entries())
      .filter(([, ids]) => ids.some((id) => this.isPublicMessage(this.messages.get(id))))
      .map(([tag]) => tag)
  }

  getTagMessageIds(tag, { includeHidden = false } = {}) {
    const partition = this.findPartition(tag)
    const ids = partition ? (this.partitions.get(partition) || []) : []
    return includeHidden ? [...ids] : ids.filter((id) => this.isPublicMessage(this.messages.get(id)))
  }

  createId() {
    let id = Math.floor(1000000 + Math.random() * 9000000)
    while (this.messages.has(id)) id = Math.floor(1000000 + Math.random() * 9000000)
    return id
  }

  async withMessageLock(id, handler) {
    const messageId = Number(id)
    const previous = this.messageLocks.get(messageId) || Promise.resolve()
    let release
    const current = new Promise((resolve) => {
      release = resolve
    })
    this.messageLocks.set(messageId, current)
    await previous.catch(() => {})
    try {
      return await handler()
    } finally {
      release()
      if (this.messageLocks.get(messageId) === current) this.messageLocks.delete(messageId)
    }
  }

  removeMessageFromMemory(messageId) {
    this.messages.delete(messageId)
    this.removeMessageFromPartitions(messageId)
  }

  removeMessageFromPartitions(messageId) {
    for (const [tag, ids] of this.partitions.entries()) {
      const next = ids.filter((item) => item !== messageId)
      if (next.length) this.partitions.set(tag, next)
      else this.partitions.delete(tag)
    }
  }

  replaceMessagePartitionsInMemory(messageId, partitions = []) {
    this.removeMessageFromPartitions(messageId)
    for (const partition of partitions) this.setPartitionInMemory(partition, messageId)
  }

  async mutateStoredMessage(id, mutator) {
    const messageId = Number(id)
    return this.withMessageLock(messageId, async () => {
      const client = await this.pool.connect()
      let finished = false
      try {
        await client.query('BEGIN')
        const selected = await client.query('SELECT id, data FROM messages WHERE id = $1 FOR UPDATE', [messageId])
        if (selected.rowCount === 0) {
          await client.query('ROLLBACK')
          finished = true
          return null
        }

        const current = typeof selected.rows[0].data === 'string' ? JSON.parse(selected.rows[0].data) : clone(selected.rows[0].data)
        this.normalizeMessage(current, selected.rows[0].id)
        const mutation = await mutator(current, client)
        const next = mutation?.message || current

        if (mutation?.delete) {
          await client.query('DELETE FROM messages WHERE id = $1', [messageId])
        } else {
          await this.saveMessage(next, client)
        }
        await client.query('COMMIT')
        finished = true

        if (mutation?.delete) this.removeMessageFromMemory(messageId)
        else this.messages.set(messageId, next)
        return mutation?.result
      } catch (error) {
        if (!finished) await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally {
        client.release()
      }
    })
  }

  async postMessage({ text = '', files = [], tags = [], user = null, admin = null, anonymous = true, poll = null, lostFound = null }) {
    const cleanTags = [...new Set(normalizeTags(tags))]
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const id = this.createId()
      const partitions = cleanTags.map((tag) => this.findPartition(tag)).filter(Boolean)
      const isAnonymous = admin ? false : (user ? anonymous !== false : true)
      const createdAt = nowText()
      const message = {
        id,
        timestamp: createdAt,
        text,
        files,
        likes: 0,
        dislikes: 0,
        tags: cleanTags,
        comments: [],
        partitions,
        moderation_status: 'pending',
        review_status: 'pending',
        pending_since: createdAt,
        review_revision: 1,
        author_type: admin ? 'admin' : (user ? 'student' : 'guest'),
        anonymous: isAnonymous
      }
      const normalizedPoll = normalizePoll(poll)
      if (normalizedPoll) message.poll = normalizedPoll
      if (lostFound && typeof lostFound === 'object') message.lost_found = clone(lostFound)
      if (admin) {
        message.admin_username = String(admin.username || '').trim().slice(0, 100)
        if (Number.isSafeInteger(Number(admin.userId)) && Number(admin.userId) > 0) {
          message.submitted_by_user_id = Number(admin.userId)
        }
        message.display_name_snapshot = String(admin.displayName || '校园墙管理员').trim().slice(0, 100) || '校园墙管理员'
        message.official = true
      } else if (user) {
        message.user_id = Number(user.id)
        message.submitted_by_user_id = Number(user.id)
        message.username = user.username
        message.anonymous = isAnonymous
        message.display_name_snapshot = isAnonymous ? '匿名用户' : (user.nickname || `用户${user.id}`)
      }

      const client = await this.pool.connect()
      try {
        await client.query('BEGIN')
        const inserted = await this.insertMessage(message, client)
        if (inserted.rowCount === 0) {
          await client.query('ROLLBACK')
          continue
        }
        for (const partition of partitions) await this.savePartition(partition, id, client)
        await this.enqueueModerationNotification(message, client, 'message.created_pending')
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }

      this.messages.set(id, message)
      for (const partition of partitions) this.setPartitionInMemory(partition, id)
      this.refreshHotMessages()
      moderationNotifier.kick()
      return id
    }
    throw new Error('Could not allocate a unique message id')
  }

  isMessageExist(id) {
    return this.messages.has(Number(id))
  }

  unavailableMessageResult(message, action = '互动') {
    const pending = message?.moderation_status === 'pending' || message?.review_status !== 'approved'
    return {
      success: false,
      error: pending ? `留言尚未通过审核，暂时不能${action}` : `留言已下架，暂时不能${action}`,
      code: pending ? 'MESSAGE_PENDING' : 'MESSAGE_HIDDEN'
    }
  }

  async commentMessage({ id, text, files = [], referId = '', user = null }) {
    const result = await this.mutateStoredMessage(id, async (message) => {
      if (!this.isPublicMessage(message)) {
        return { message, result: this.unavailableMessageResult(message, '评论') }
      }
      const next = clone(message)
      const replyTarget = referId
        ? next.comments.find((comment) => String(comment.id) === String(referId) && this.isPublicComment(comment))
        : null
      if (referId && !replyTarget) {
        return { message, result: { success: false, error: '要回复的评论不存在或已被删除', code: 'REPLY_NOT_FOUND' } }
      }
      const comment = {
        id: randomUUID().replaceAll('-', ''),
        text,
        timestamp: nowText(),
        likes: 0,
        dislikes: 0,
        files,
        moderation_status: 'visible'
      }
      if (replyTarget) {
        comment.refer_id = String(replyTarget.id)
        comment.refer = String(replyTarget.text || '附件评论').trim().slice(0, 120) || '附件评论'
      }
      if (user) {
        comment.user_id = Number(user.id)
        comment.username = user.username
        comment.anonymous = true
      }
      next.comments.push(comment)
      return {
        message: next,
        result: {
          success: true,
          comment,
          reply_to_user_id: replyTarget?.user_id ? Number(replyTarget.user_id) : null
        }
      }
    })
    return result || { success: false, error: 'Message not found' }
  }

  async updateOwnedMessage({ id, userId, text = '', tags = [], anonymous = true, displayName = '' }) {
    const messageId = Number(id)
    const ownerId = Number(userId)
    const requestedTags = [...new Set(normalizeTags(tags))]
    const result = await this.mutateStoredMessage(messageId, async (message, client) => {
      if (Number(message.user_id) !== ownerId) {
        return { message, result: { success: false, error: '留言不存在或不属于当前账号', code: 'FORBIDDEN' } }
      }
      if (message.moderation_status === 'deleted') {
        return { message, result: { success: false, error: '留言已删除，不能继续编辑', code: 'MESSAGE_DELETED' } }
      }
      let cleanTags = requestedTags
      if (isLostFoundMessage(message)) {
        const kind = normalizeLostFoundType(message.lost_found?.kind) || 'lost'
        const statusTag = message.lost_found?.resolved === true ? '已找回' : (kind === 'found' ? '待认领' : '待找回')
        const lostFoundStatusTags = new Set(['待找回', '待认领', '已找回'])
        const customTags = requestedTags.filter((tag) => !isLostFoundTag(tag) && !lostFoundStatusTags.has(tag))
        cleanTags = [...new Set([...lostFoundTags(kind), statusTag, ...customTags])]
      }
      const partitions = [...new Set(cleanTags.map((tag) => this.findPartition(tag)).filter(Boolean))]
      const next = clone(message)
      next.text = String(text || '').trim()
      next.tags = cleanTags
      next.partitions = partitions
      next.anonymous = anonymous !== false
      next.display_name_snapshot = next.anonymous ? '匿名用户' : (String(displayName || '').trim() || `用户${ownerId}`)
      next.edited_at = nowText()
      next.edit_count = Math.max(Number(next.edit_count) || 0, 0) + 1
      next.review_revision = Math.max(Number(next.review_revision) || 1, 1) + 1
      next.review_status = 'pending'
      next.pending_since = new Date().toISOString()
      delete next.reviewed_at
      delete next.reviewed_by
      if (next.moderation_status !== 'hidden') next.moderation_status = 'pending'

      await client.query('DELETE FROM partitions WHERE message_id = $1', [messageId])
      for (const partition of partitions) await this.savePartition(partition, messageId, client)
      await this.enqueueModerationNotification(next, client, 'message.edited_pending')
      return { message: next, result: { success: true, message: clone(next) } }
    })
    if (result?.success) {
      this.replaceMessagePartitionsInMemory(messageId, result.message.partitions || result.message.tags)
      this.refreshHotMessages()
      moderationNotifier.kick()
    }
    return result || { success: false, error: '留言不存在', code: 'NOT_FOUND' }
  }

  async deleteOwnedMessage(id, userId) {
    const ownerId = Number(userId)
    const result = await this.mutateStoredMessage(id, async (message) => {
      if (Number(message.user_id) !== ownerId) {
        return { message, result: { success: false, error: '留言不存在或不属于当前账号', code: 'FORBIDDEN' } }
      }
      if (message.moderation_status === 'deleted') {
        return { message, result: { success: false, error: '留言已删除', code: 'ALREADY_DELETED' } }
      }
      const next = clone(message)
      next.deleted_from_status = next.moderation_status
      next.moderation_status = 'deleted'
      next.deleted_at = new Date().toISOString()
      next.deleted_by = `user:${ownerId}`
      next.deletion_reason = '用户自行删除'
      next.deletion_origin = 'user'
      return { message: next, result: { success: true, message: 'Moved to trash', deleted_message: clone(next) } }
    })
    if (result?.success) this.refreshHotMessages()
    return result || { success: false, error: '留言不存在', code: 'NOT_FOUND' }
  }

  async deleteOwnedComment(messageId, commentId, userId) {
    const ownerId = Number(userId)
    const targetCommentId = String(commentId || '')
    const result = await this.mutateStoredMessage(messageId, async (message) => {
      const next = clone(message)
      const index = next.comments.findIndex((comment) => String(comment.id) === targetCommentId)
      if (index < 0) {
        return { message, result: { success: false, error: '评论不存在', code: 'NOT_FOUND' } }
      }
      if (Number(next.comments[index].user_id) !== ownerId) {
        return { message, result: { success: false, error: '不能删除其他用户的评论', code: 'FORBIDDEN' } }
      }
      const comment = normalizeComment(next.comments[index])
      if (comment.moderation_status === 'deleted') {
        return { message, result: { success: false, error: '评论已删除', code: 'ALREADY_DELETED' } }
      }
      comment.deleted_from_status = comment.moderation_status
      comment.moderation_status = 'deleted'
      comment.deleted_at = new Date().toISOString()
      comment.deleted_by = `user:${ownerId}`
      comment.deletion_reason = '用户自行删除'
      comment.deletion_origin = 'user'
      next.comments[index] = comment
      return { message: next, result: { success: true, comment: clone(comment) } }
    })
    if (result?.success) this.refreshHotMessages()
    return result || { success: false, error: '留言不存在', code: 'NOT_FOUND' }
  }

  async reactMessage(id, reaction, reactorKey, legacyReaction = 0) {
    const normalizedReaction = Number(reaction) === -1 ? -1 : 1
    const result = await this.mutateStoredMessage(id, async (message, client) => {
      if (!this.isPublicMessage(message)) {
        return { message, result: this.unavailableMessageResult(message, '互动') }
      }
      const messageId = Number(id)
      const next = clone(message)
      const existingRow = await client.query(
        'SELECT reaction FROM message_reactions WHERE message_id = $1 AND reactor_key = $2',
        [messageId, reactorKey]
      )
      const storedReaction = existingRow.rowCount ? Number(existingRow.rows[0].reaction) : 0
      const currentReaction = storedReaction || ([-1, 1].includes(Number(legacyReaction)) ? Number(legacyReaction) : 0)

      if (currentReaction === normalizedReaction) {
        if (storedReaction) {
          await client.query('DELETE FROM message_reactions WHERE message_id = $1 AND reactor_key = $2', [messageId, reactorKey])
        }
        if (normalizedReaction === 1) next.likes = Math.max((next.likes || 0) - 1, 0)
        else next.dislikes = Math.max((next.dislikes || 0) - 1, 0)
        return {
          message: next,
          result: { success: true, likes: next.likes, dislikes: next.dislikes, reaction: 0, action: 'cancel' }
        }
      }

      if (currentReaction === 1) next.likes = Math.max((next.likes || 0) - 1, 0)
      if (currentReaction === -1) next.dislikes = Math.max((next.dislikes || 0) - 1, 0)
      if (normalizedReaction === 1) next.likes += 1
      else next.dislikes += 1
      await client.query(
        `INSERT INTO message_reactions (message_id, reactor_key, reaction, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (message_id, reactor_key)
         DO UPDATE SET reaction = EXCLUDED.reaction, updated_at = now()`,
        [messageId, reactorKey, normalizedReaction]
      )
      return {
        message: next,
        result: {
          success: true,
          likes: next.likes,
          dislikes: next.dislikes,
          reaction: normalizedReaction,
          action: normalizedReaction === 1 ? 'like' : 'dislike',
          switched: Boolean(currentReaction && currentReaction !== normalizedReaction)
        }
      }
    })
    if (result?.success) this.refreshHotMessages()
    return result || { success: false, error: 'Message not found' }
  }

  likeMessage(id, reactorKey, legacyReaction = 0) {
    return this.reactMessage(id, 1, reactorKey, legacyReaction)
  }

  dislikeMessage(id, reactorKey, legacyReaction = 0) {
    return this.reactMessage(id, -1, reactorKey, legacyReaction)
  }

  async votePoll(id, optionId, voterKey) {
    const result = await this.mutateStoredMessage(id, async (message, client) => {
      if (!this.isPublicMessage(message)) return { message, result: this.unavailableMessageResult(message, '投票') }
      if (!message.poll) return { message, result: { success: false, error: '这条留言不是投票帖', code: 'NOT_A_POLL' } }
      if (message.poll.closes_at && Date.parse(message.poll.closes_at) <= Date.now()) {
        return { message, result: { success: false, error: '投票已经结束', code: 'POLL_CLOSED' } }
      }
      const selected = message.poll.options.find((option) => option.id === optionId)
      if (!selected) return { message, result: { success: false, error: '投票选项不存在', code: 'INVALID_OPTION' } }

      const inserted = await client.query(
        `INSERT INTO poll_votes (message_id, voter_key, option_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (message_id, voter_key) DO NOTHING
         RETURNING option_id`,
        [Number(id), voterKey, optionId]
      )
      if (inserted.rowCount === 0) {
        const existing = await client.query(
          'SELECT option_id FROM poll_votes WHERE message_id = $1 AND voter_key = $2',
          [Number(id), voterKey]
        )
        return {
          message,
          result: {
            success: false,
            error: '你已经参与过这次投票',
            code: 'ALREADY_VOTED',
            selected_option_id: existing.rows[0]?.option_id || null,
            poll: message.poll
          }
        }
      }

      const next = clone(message)
      next.poll.options = next.poll.options.map((option) => option.id === optionId
        ? { ...option, votes: (option.votes || 0) + 1 }
        : option)
      next.poll.total_votes = next.poll.options.reduce((total, option) => total + (option.votes || 0), 0)
      return {
        message: next,
        result: { success: true, poll: next.poll, selected_option_id: optionId }
      }
    })
    if (result?.success) this.refreshHotMessages()
    return result || { success: false, error: 'Message not found', code: 'NOT_FOUND' }
  }

  async setModerationState(id, { pinned, featured, hidden, hiddenReason = '' }) {
    const result = await this.mutateStoredMessage(id, async (message, client) => {
      if (message.moderation_status === 'deleted') {
        return { message, result: { success: false, error: '留言位于回收站，请先恢复', code: 'MESSAGE_DELETED' } }
      }
      const next = clone(message)
      if (typeof pinned === 'boolean') {
        next.pinned = pinned
        if (pinned) next.pinned_at = new Date().toISOString()
        else delete next.pinned_at
      }
      if (typeof featured === 'boolean') next.featured = featured
      if (typeof hidden === 'boolean') {
        const previousModerationStatus = next.moderation_status
        next.moderation_status = hidden
          ? 'hidden'
          : (next.review_status === 'approved' ? 'visible' : 'pending')
        if (hidden) {
          next.hidden_reason = String(hiddenReason || '违反社区规范').trim().slice(0, 200) || '违反社区规范'
          next.hidden_at = new Date().toISOString()
        } else {
          delete next.hidden_reason
          delete next.hidden_at
          const becamePending = previousModerationStatus !== 'pending' && next.moderation_status === 'pending'
          if (becamePending) {
            next.pending_since = new Date().toISOString()
            next.review_revision = Math.max(Number(next.review_revision) || 1, 1) + 1
            await this.enqueueModerationNotification(next, client, 'message.unhidden_pending')
          }
        }
      }
      return {
        message: next,
        result: { success: true, message: clone(next) }
      }
    })
    if (result?.success) {
      this.refreshHotMessages()
      if (result.message?.moderation_status === 'pending') moderationNotifier.kick()
    }
    return result || { success: false, error: '消息不存在' }
  }

  async setReviewState(id, { approved, reviewer = '' }) {
    const result = await this.mutateStoredMessage(id, async (message, client) => {
      if (message.moderation_status === 'deleted') {
        return { message, result: { success: false, error: '留言位于回收站，请先恢复', code: 'MESSAGE_DELETED' } }
      }
      const next = clone(message)
      if (approved) {
        next.review_status = 'approved'
        delete next.pending_since
        if (next.moderation_status !== 'hidden') next.moderation_status = 'visible'
        next.reviewed_at = new Date().toISOString()
        next.reviewed_by = String(reviewer || '').trim().slice(0, 100)
        if (next.moderation_status !== 'hidden') {
          delete next.hidden_reason
          delete next.hidden_at
          delete next.hidden_by
        }
      } else {
        if (message.review_status !== 'approved' && message.moderation_status === 'pending') {
          return { message, result: { success: true, message: clone(message), changed: false } }
        }
        next.review_status = 'pending'
        next.pending_since = new Date().toISOString()
        next.review_revision = Math.max(Number(next.review_revision) || 1, 1) + 1
        delete next.reviewed_at
        delete next.reviewed_by
        if (next.moderation_status !== 'hidden') next.moderation_status = 'pending'
        await this.enqueueModerationNotification(next, client, 'message.returned_pending')
      }
      return {
        message: next,
        result: { success: true, message: clone(next) }
      }
    })
    if (result?.success) {
      this.refreshHotMessages()
      if (!approved) moderationNotifier.kick()
    }
    return result || { success: false, error: '消息不存在' }
  }

  async migrateLegacyReviews(items = []) {
    let migrated = 0
    for (const item of items) {
      const messageId = Number(item?.id)
      if (!Number.isSafeInteger(messageId) || !this.messages.has(messageId)) continue
      const current = this.messages.get(messageId)
      if (current.review_status === 'approved') continue
      const result = await this.mutateStoredMessage(messageId, async (message) => {
        const next = clone(message)
        next.review_status = 'approved'
        delete next.pending_since
        if (next.moderation_status !== 'hidden') next.moderation_status = 'visible'
        next.reviewed_at = item?.timestamp || new Date().toISOString()
        next.reviewed_by = String(item?.by || 'legacy').slice(0, 100)
        return { message: next, result: { success: true } }
      })
      if (result?.success) migrated += 1
    }
    if (migrated) this.refreshHotMessages()
    return migrated
  }

  async releasePendingMessages() {
    // Kept for API compatibility. Mandatory review means pending messages can
    // only become public through setReviewState(..., { approved: true }).
    return []
  }

  async deleteMessage(id, { deletedBy = '', reason = '管理员删除', origin = 'admin' } = {}) {
    const result = await this.mutateStoredMessage(id, async (message) => {
      if (message.moderation_status === 'deleted') {
        return { message, result: { success: false, error: '留言已在回收站中', code: 'ALREADY_DELETED' } }
      }
      const next = clone(message)
      next.deleted_from_status = next.moderation_status
      next.moderation_status = 'deleted'
      next.deleted_at = new Date().toISOString()
      next.deleted_by = String(deletedBy || '').trim().slice(0, 100)
      next.deletion_reason = String(reason || '管理员删除').trim().slice(0, 200) || '管理员删除'
      next.deletion_origin = String(origin || 'admin').trim().slice(0, 40) || 'admin'
      return { message: next, result: { success: true, message: 'Moved to trash', deleted_message: clone(next) } }
    })
    if (result?.success) this.refreshHotMessages()
    return result || { success: false, error: '留言不存在', code: 'NOT_FOUND' }
  }

  async deleteComment(messageId, commentId, { deletedBy = '', reason = '管理员删除', origin = 'admin' } = {}) {
    const result = await this.mutateStoredMessage(messageId, async (message) => {
      const next = clone(message)
      const index = next.comments.findIndex((comment) => String(comment.id) === String(commentId))
      if (index < 0) return { message, result: { success: false, error: '评论不存在', code: 'NOT_FOUND' } }
      const comment = normalizeComment(next.comments[index])
      if (comment.moderation_status === 'deleted') {
        return { message, result: { success: false, error: '评论已在回收站中', code: 'ALREADY_DELETED' } }
      }
      comment.deleted_from_status = comment.moderation_status
      comment.moderation_status = 'deleted'
      comment.deleted_at = new Date().toISOString()
      comment.deleted_by = String(deletedBy || '').trim().slice(0, 100)
      comment.deletion_reason = String(reason || '管理员删除').trim().slice(0, 200) || '管理员删除'
      comment.deletion_origin = String(origin || 'admin').trim().slice(0, 40) || 'admin'
      next.comments[index] = comment
      return { message: next, result: { success: true, message: 'Moved to trash', comment: clone(comment) } }
    })
    if (result?.success) this.refreshHotMessages()
    return result || { success: false, error: '留言不存在', code: 'NOT_FOUND' }
  }

  async restoreMessage(id, { restoredBy = '' } = {}) {
    const result = await this.mutateStoredMessage(id, async (message, client) => {
      if (message.moderation_status !== 'deleted') {
        return { message, result: { success: false, error: '留言不在回收站中', code: 'NOT_DELETED' } }
      }
      const next = clone(message)
      const previousStatus = ['pending', 'visible', 'hidden'].includes(next.deleted_from_status) ? next.deleted_from_status : 'hidden'
      next.moderation_status = previousStatus === 'visible' && next.review_status !== 'approved' ? 'pending' : previousStatus
      if (next.moderation_status === 'pending') {
        next.pending_since = new Date().toISOString()
        next.review_revision = Math.max(Number(next.review_revision) || 1, 1) + 1
        await this.enqueueModerationNotification(next, client, 'message.restored_pending')
      }
      if (next.moderation_status !== 'hidden') {
        delete next.hidden_reason
        delete next.hidden_at
        delete next.hidden_by
      }
      next.restored_at = new Date().toISOString()
      next.restored_by = String(restoredBy || '').trim().slice(0, 100)
      delete next.deleted_at
      delete next.deleted_by
      delete next.deletion_reason
      delete next.deletion_origin
      delete next.deleted_from_status
      return { message: next, result: { success: true, message: clone(next) } }
    })
    if (result?.success) {
      this.refreshHotMessages()
      if (result.message?.moderation_status === 'pending') moderationNotifier.kick()
    }
    return result || { success: false, error: '留言不存在', code: 'NOT_FOUND' }
  }

  async purgeMessage(id) {
    const result = await this.mutateStoredMessage(id, async (message) => {
      if (message.moderation_status !== 'deleted') {
        return { message, result: { success: false, error: '只能彻底删除回收站中的留言', code: 'NOT_DELETED' } }
      }
      return { delete: true, result: { success: true, message: 'Permanently deleted', purged_message: clone(message) } }
    })
    if (result?.success) this.refreshHotMessages()
    return result || { success: false, error: '留言不存在', code: 'NOT_FOUND' }
  }

  async restoreComment(messageId, commentId, { restoredBy = '' } = {}) {
    const result = await this.mutateStoredMessage(messageId, async (message) => {
      const next = clone(message)
      const index = next.comments.findIndex((comment) => String(comment.id) === String(commentId))
      if (index < 0) return { message, result: { success: false, error: '评论不存在', code: 'NOT_FOUND' } }
      const comment = normalizeComment(next.comments[index])
      if (comment.moderation_status !== 'deleted') {
        return { message, result: { success: false, error: '评论不在回收站中', code: 'NOT_DELETED' } }
      }
      comment.moderation_status = comment.deleted_from_status === 'visible' ? 'visible' : 'hidden'
      if (comment.moderation_status !== 'hidden') {
        delete comment.hidden_reason
        delete comment.hidden_at
        delete comment.hidden_by
      }
      comment.restored_at = new Date().toISOString()
      comment.restored_by = String(restoredBy || '').trim().slice(0, 100)
      delete comment.deleted_at
      delete comment.deleted_by
      delete comment.deletion_reason
      delete comment.deletion_origin
      delete comment.deleted_from_status
      next.comments[index] = comment
      return { message: next, result: { success: true, comment: clone(comment), message_id: Number(message.id) } }
    })
    if (result?.success) this.refreshHotMessages()
    return result || { success: false, error: '留言不存在', code: 'NOT_FOUND' }
  }

  async purgeComment(messageId, commentId) {
    const result = await this.mutateStoredMessage(messageId, async (message) => {
      const next = clone(message)
      const index = next.comments.findIndex((comment) => String(comment.id) === String(commentId))
      if (index < 0) return { message, result: { success: false, error: '评论不存在', code: 'NOT_FOUND' } }
      if (next.comments[index].moderation_status !== 'deleted') {
        return { message, result: { success: false, error: '只能彻底删除回收站中的评论', code: 'NOT_DELETED' } }
      }
      const [comment] = next.comments.splice(index, 1)
      return { message: next, result: { success: true, message: 'Permanently deleted', purged_comment: clone(comment) } }
    })
    if (result?.success) this.refreshHotMessages()
    return result || { success: false, error: '留言不存在', code: 'NOT_FOUND' }
  }

  async setCommentModerationState(messageId, commentId, { hidden, hiddenReason = '', hiddenBy = '' }) {
    if (typeof hidden !== 'boolean') return { success: false, error: '评论管理状态无效' }
    const result = await this.mutateStoredMessage(messageId, async (message) => {
      const next = clone(message)
      const index = next.comments.findIndex((comment) => String(comment.id) === String(commentId))
      if (index < 0) return { message, result: { success: false, error: '评论不存在', code: 'NOT_FOUND' } }
      const comment = normalizeComment(next.comments[index])
      if (comment.moderation_status === 'deleted') {
        return { message, result: { success: false, error: '评论位于回收站，请先恢复', code: 'COMMENT_DELETED' } }
      }
      comment.moderation_status = hidden ? 'hidden' : 'visible'
      if (hidden) {
        comment.hidden_reason = String(hiddenReason || '违反社区规范').trim().slice(0, 200) || '违反社区规范'
        comment.hidden_at = new Date().toISOString()
        comment.hidden_by = String(hiddenBy || '').trim().slice(0, 100)
      } else {
        delete comment.hidden_reason
        delete comment.hidden_at
        delete comment.hidden_by
      }
      next.comments[index] = comment
      return { message: next, result: { success: true, comment: clone(comment), message_id: Number(message.id) } }
    })
    if (result?.success) this.refreshHotMessages()
    return result || { success: false, error: '留言不存在', code: 'NOT_FOUND' }
  }

  scoreMessage(message) {
    let score = 0
    score += ((message.likes || 0) - (message.dislikes || 0)) * 10
    score += (message.files || []).length * 5
    score += (message.tags || []).length * 2
    score += this.visibleComments(message).length * 10
    score += (message.poll?.total_votes || 0) * 3
    score += String(message.text || '').length
    const time = Date.parse(String(message.timestamp || '').replace(' ', 'T'))
    if (!Number.isNaN(time)) score -= (Date.now() - time) / 86400000
    return score
  }

  stats() {
    const storedMessages = this.allMessages().map((message) => clone(message))
    const messages = storedMessages.filter((message) => message.moderation_status !== 'deleted')
    const visible = messages.filter((message) => this.isPublicMessage(message))
    const timestampOf = (message) => Date.parse(String(message.timestamp || '').replace(' ', 'T'))
    const now = Date.now()
    const daily = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now - (6 - index) * 86400000)
      const key = date.toISOString().slice(0, 10)
      return {
        date: key,
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        count: visible.filter((message) => {
          const time = timestampOf(message)
          return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === key
        }).length
      }
    })
    const tags = new Map()
    for (const message of visible) {
      for (const tag of message.tags || []) tags.set(tag, (tags.get(tag) || 0) + 1)
    }
    return {
      total: messages.length,
      visible: visible.length,
      hidden: messages.filter((message) => message.moderation_status === 'hidden').length,
      deleted: storedMessages.filter((message) => message.moderation_status === 'deleted').length,
      pending_review: messages.filter((message) => message.review_status !== 'approved').length,
      approved: messages.filter((message) => message.review_status === 'approved').length,
      awaiting_publication: messages.filter((message) => message.moderation_status === 'pending').length,
      pinned: visible.filter((message) => message.pinned).length,
      featured: visible.filter((message) => message.featured).length,
      polls: visible.filter((message) => message.poll).length,
      comments: visible.reduce((sum, message) => sum + this.visibleComments(message).length, 0),
      comments_hidden: messages.reduce((sum, message) => sum + (message.comments || []).filter((comment) => comment.moderation_status === 'hidden').length, 0),
      comments_deleted: messages.reduce((sum, message) => sum + (message.comments || []).filter((comment) => comment.moderation_status === 'deleted').length, 0),
      likes: visible.reduce((sum, message) => sum + (message.likes || 0), 0),
      dislikes: visible.reduce((sum, message) => sum + (message.dislikes || 0), 0),
      last_24_hours: visible.filter((message) => {
        const time = timestampOf(message)
        return Number.isFinite(time) && time <= now && now - time <= 86400000
      }).length,
      last_7_days: visible.filter((message) => {
        const time = timestampOf(message)
        return Number.isFinite(time) && time <= now && now - time <= 7 * 86400000
      }).length,
      daily,
      top_tags: Array.from(tags.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag, count]) => ({ tag, count }))
    }
  }

  refreshHotMessages() {
    const ranked = this.allMessages().filter((message) => this.isPublicMessage(message)).map((item) => clone(item)).sort((a, b) => (
      Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || this.scoreMessage(b) - this.scoreMessage(a)
    ))
    this.hotMessages = ranked.slice(0, 20)
    this.hotMessagesWithoutLostFound = ranked.filter((message) => !isLostFoundMessage(message)).slice(0, 20)
    return this.hotMessages
  }

  getHotMessages(likeList = [], dislikeList = [], { includeLostFound = true } = {}) {
    const messages = includeLostFound ? this.hotMessages : this.hotMessagesWithoutLostFound
    return messages.filter((message) => this.isPublicMessage(message)).map((item) => this.withLikeState(item, likeList, dislikeList))
  }
}

export const messageStore = new MessageStore()
