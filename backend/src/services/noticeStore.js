import { randomUUID } from 'node:crypto'
import { readJson, writeJson } from './jsonStore.js'

const noticePath = 'static/notice.json'

export const createNoticeId = () => randomUUID().replaceAll('-', '')

export const ensureNoticeIds = (source, idFactory = createNoticeId) => {
  const input = Array.isArray(source) ? source : []
  const seen = new Set()
  let changed = !Array.isArray(source)
  const notices = input.map((value) => {
    const notice = value && typeof value === 'object' && !Array.isArray(value)
      ? { ...value }
      : { content: String(value || '') }
    const currentId = String(notice.id || '').trim()
    if (currentId && !seen.has(currentId)) {
      seen.add(currentId)
      if (notice.id !== currentId) changed = true
      notice.id = currentId
      return notice
    }
    let nextId = idFactory()
    while (!nextId || seen.has(nextId)) nextId = idFactory()
    notice.id = nextId
    seen.add(nextId)
    changed = true
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

export const writeNotices = (notices) => writeJson(noticePath, Array.isArray(notices) ? notices : [])

const toPublicNotice = (value) => {
  const copy = value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : { content: String(value || '') }
  delete copy.user
  delete copy.author_role
  delete copy.updated_by
  delete copy.updated_by_role
  return copy
}

const activityTime = (notice) => String(notice.updated_at || notice.timestamp || '')

export const publicNotices = (source, { newestFirst = false } = {}) => {
  const content = (Array.isArray(source) ? source : []).map(toPublicNotice)
  if (!newestFirst) return content
  return content
    .slice()
    .reverse()
    .sort((a, b) => activityTime(b).localeCompare(activityTime(a)))
}
