import { randomUUID } from 'node:crypto'
import { readJson, writeJson } from './jsonStore.js'

const noticePath = 'static/notice.json'

export const noticeLimits = Object.freeze({ title: 80, summary: 200 })
export const noticePriorities = Object.freeze(['normal', 'important', 'urgent'])
export const noticeStatuses = Object.freeze(['draft', 'published', 'archived'])

export const createNoticeId = () => randomUUID().replaceAll('-', '')

export const plainNoticeText = (value, { multiline = false } = {}) => {
  const text = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u202a-\u202e\u2066-\u2069]/gi, '')
  if (!multiline) {
    return text
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

const firstContentLine = (content) => String(content || '')
  .split('\n')
  .map((line) => plainNoticeText(line))
  .find(Boolean) || '校园公告'

const normalizeChoice = (value, choices, fallback) => {
  const candidate = String(value || '').trim().toLowerCase()
  return choices.includes(candidate) ? candidate : fallback
}

const normalizeRevision = (value, fallback) => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback
}

export const noticePublishTime = (notice) => {
  const parsed = Date.parse(String(notice?.publish_at || notice?.timestamp || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

export const normalizeNotice = (value) => {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : { content: String(value || '') }
  const content = plainNoticeText(source.content ?? source.text, { multiline: true })
  const status = normalizeChoice(source.status, noticeStatuses, 'published')
  const timestamp = plainNoticeText(source.timestamp)
  const publishAt = plainNoticeText(source.publish_at || timestamp)
  const fallbackRevision = status === 'draft' ? 0 : 1

  return {
    ...source,
    id: plainNoticeText(source.id),
    timestamp,
    title: (plainNoticeText(source.title) || firstContentLine(content)).slice(0, noticeLimits.title),
    summary: plainNoticeText(source.summary).slice(0, noticeLimits.summary),
    content,
    priority: normalizeChoice(source.priority, noticePriorities, 'normal'),
    status,
    publish_at: publishAt,
    reminder_revision: normalizeRevision(source.reminder_revision, fallbackRevision)
  }
}

export const ensureNoticeIds = (source, idFactory = createNoticeId) => {
  const input = Array.isArray(source) ? source : []
  const seen = new Set()
  let changed = !Array.isArray(source)
  const notices = input.map((value) => {
    const original = value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : { content: String(value || '') }
    const notice = normalizeNotice(original)
    const currentId = notice.id
    if (currentId && !seen.has(currentId)) {
      seen.add(currentId)
    } else {
      let nextId = String(idFactory() || '').trim()
      while (!nextId || seen.has(nextId)) nextId = createNoticeId()
      notice.id = nextId
      seen.add(nextId)
    }
    if (JSON.stringify(original) !== JSON.stringify(notice)) changed = true
    return notice
  })
  return { notices, changed }
}

export const readNotices = ({ ensureIds = false } = {}) => {
  const source = readJson(noticePath, [])
  if (!ensureIds) return Array.isArray(source) ? source : []
  const normalized = ensureNoticeIds(source)
  if (normalized.changed) writeJson(noticePath, normalized.notices)
  return normalized.notices
}

export const writeNotices = (notices) => {
  const normalized = ensureNoticeIds(Array.isArray(notices) ? notices : [])
  writeJson(noticePath, normalized.notices)
}

const toPublicNotice = (value) => {
  const notice = normalizeNotice(value)
  return {
    id: notice.id,
    timestamp: notice.timestamp,
    title: notice.title,
    summary: notice.summary,
    content: notice.content,
    priority: notice.priority,
    status: notice.status,
    publish_at: notice.publish_at,
    reminder_revision: notice.reminder_revision,
    ...(notice.updated_at ? { updated_at: plainNoticeText(notice.updated_at) } : {})
  }
}

export const publicNotices = (source, { now = Date.now() } = {}) => (Array.isArray(source) ? source : [])
  .map(toPublicNotice)
  .filter((notice) => notice.status === 'published' && noticePublishTime(notice) <= now)
  .sort((left, right) => noticePublishTime(right) - noticePublishTime(left)
    || String(right.timestamp || '').localeCompare(String(left.timestamp || '')))
