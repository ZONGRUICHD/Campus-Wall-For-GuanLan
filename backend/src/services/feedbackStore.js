import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { config } from '../config.js'
import { nowText, readJson, writeJson } from './jsonStore.js'

const feedbackPath = path.join('help', 'help.json')

export const feedbackCategories = {
  bug: '网站故障',
  feature: '功能建议',
  account: '账号问题',
  content: '内容与社区',
  other: '其他反馈'
}

export const feedbackStatuses = {
  pending: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  closed: '已关闭'
}

const normalizeCode = (value, allowed, fallback) => {
  const code = String(value || '').trim().toLowerCase()
  return Object.hasOwn(allowed, code) ? code : fallback
}

export const normalizeTicketId = (value) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '')

const safeTicketId = (value) => {
  const ticketId = normalizeTicketId(value)
  return /^[a-f0-9]{32}$/.test(ticketId) ? ticketId : randomUUID().replaceAll('-', '')
}

const normalizeHistory = (history) => (Array.isArray(history) ? history : []).map((entry) => ({
  status: normalizeCode(entry?.status, feedbackStatuses, 'pending'),
  previous_status: normalizeCode(entry?.previous_status, feedbackStatuses, 'pending'),
  reply_updated: Boolean(entry?.reply_updated),
  note_updated: Boolean(entry?.note_updated),
  by: String(entry?.by || ''),
  timestamp: String(entry?.timestamp || '')
}))

const normalizeTicket = (ticket = {}) => ({
  id: safeTicketId(ticket.id),
  category: normalizeCode(ticket.category, feedbackCategories, 'other'),
  title: String(ticket.title || '').trim(),
  email: String(ticket.email || '').trim(),
  text: String(ticket.text || '').trim(),
  status: normalizeCode(ticket.status, feedbackStatuses, 'pending'),
  public_reply: String(ticket.public_reply || '').trim(),
  internal_note: String(ticket.internal_note || '').trim(),
  timestamp: String(ticket.timestamp || nowText()),
  updated_at: String(ticket.updated_at || ''),
  updated_by: String(ticket.updated_by || ''),
  history: normalizeHistory(ticket.history)
})

const loadTickets = () => {
  const raw = readJson(feedbackPath, [])
  const source = Array.isArray(raw) ? raw : []
  const tickets = source.map(normalizeTicket)
  if (JSON.stringify(source) !== JSON.stringify(tickets)) writeJson(feedbackPath, tickets)
  return tickets
}

const fail = (message, statusCode = 400) => {
  const error = new Error(message)
  error.statusCode = statusCode
  throw error
}

const sortTime = (value) => {
  const parsed = Date.parse(String(value || '').replace(' ', 'T'))
  return Number.isFinite(parsed) ? parsed : 0
}

export class FeedbackStore {
  create(input = {}) {
    const title = String(input.title || '').trim()
    const email = String(input.email || '').trim()
    const text = String(input.text || '').trim()
    if (!text) fail('请填写详细反馈内容')
    if (title.length > config.maxTitleLength || email.length > config.maxEmailLength || text.length > config.maxTextLength) {
      fail('反馈内容或邮箱过长')
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('请输入有效的联系邮箱')
    const ticket = normalizeTicket({
      id: randomUUID().replaceAll('-', ''),
      category: normalizeCode(input.category, feedbackCategories, 'other'),
      title,
      email,
      text,
      status: 'pending',
      timestamp: nowText()
    })
    const tickets = loadTickets()
    if (tickets.length >= config.maxFeedbackRecords) fail('反馈数量已达上限，请稍后再试', 503)
    tickets.push(ticket)
    writeJson(feedbackPath, tickets)
    return ticket
  }

  publicStatus(ticketId) {
    const normalizedId = normalizeTicketId(ticketId)
    if (!/^[a-f0-9]{32}$/.test(normalizedId)) return null
    const ticket = loadTickets().find((item) => item.id === normalizedId)
    if (!ticket) return null
    return {
      id: ticket.id,
      category: ticket.category,
      category_label: feedbackCategories[ticket.category],
      title: ticket.title,
      status: ticket.status,
      status_label: feedbackStatuses[ticket.status],
      timestamp: ticket.timestamp,
      updated_at: ticket.updated_at,
      public_reply: ticket.public_reply
    }
  }

  list({ page = 1, pageSize = 20, q = '', status = '', category = '' } = {}) {
    const safePage = Math.max(1, Math.floor(Number(page) || 1))
    const safePageSize = Math.max(1, Math.min(50, Math.floor(Number(pageSize) || 20)))
    const query = String(q || '').trim().toLowerCase().slice(0, 100)
    const statusFilter = Object.hasOwn(feedbackStatuses, status) ? status : ''
    const categoryFilter = Object.hasOwn(feedbackCategories, category) ? category : ''
    let tickets = loadTickets()
    if (statusFilter) tickets = tickets.filter((ticket) => ticket.status === statusFilter)
    if (categoryFilter) tickets = tickets.filter((ticket) => ticket.category === categoryFilter)
    if (query) {
      tickets = tickets.filter((ticket) => [
        ticket.id,
        ticket.title,
        ticket.email,
        ticket.text,
        ticket.public_reply,
        ticket.internal_note,
        ticket.updated_by
      ].some((value) => String(value || '').toLowerCase().includes(query)))
    }
    tickets.sort((a, b) => sortTime(b.updated_at || b.timestamp) - sortTime(a.updated_at || a.timestamp))
    const total = tickets.length
    const offset = (safePage - 1) * safePageSize
    return {
      tickets: tickets.slice(offset, offset + safePageSize),
      page: safePage,
      page_size: safePageSize,
      total,
      total_pages: Math.ceil(total / safePageSize),
      stats: this.stats()
    }
  }

  update(ticketId, input = {}, adminUser = '') {
    const tickets = loadTickets()
    const index = tickets.findIndex((ticket) => ticket.id === normalizeTicketId(ticketId))
    if (index < 0) fail('反馈工单不存在', 404)
    const current = tickets[index]
    const status = normalizeCode(input.status, feedbackStatuses, current.status)
    const publicReply = String(input.public_reply ?? current.public_reply).trim()
    const internalNote = String(input.internal_note ?? current.internal_note).trim()
    if (publicReply.length > config.maxTextLength || internalNote.length > config.maxTextLength) fail('回复或内部备注过长')
    const statusChanged = status !== current.status
    const replyChanged = publicReply !== current.public_reply
    const noteChanged = internalNote !== current.internal_note
    if (!statusChanged && !replyChanged && !noteChanged) return current

    const timestamp = nowText()
    const updated = {
      ...current,
      status,
      public_reply: publicReply,
      internal_note: internalNote,
      updated_at: timestamp,
      updated_by: String(adminUser || ''),
      history: [
        ...(current.history || []),
        {
          previous_status: current.status,
          status,
          reply_updated: replyChanged,
          note_updated: noteChanged,
          by: String(adminUser || ''),
          timestamp
        }
      ]
    }
    tickets[index] = updated
    writeJson(feedbackPath, tickets)
    return updated
  }

  stats() {
    const tickets = loadTickets()
    return {
      total: tickets.length,
      pending: tickets.filter((ticket) => ticket.status === 'pending').length,
      in_progress: tickets.filter((ticket) => ticket.status === 'in_progress').length,
      resolved: tickets.filter((ticket) => ticket.status === 'resolved').length,
      closed: tickets.filter((ticket) => ticket.status === 'closed').length
    }
  }
}

export const feedbackStore = new FeedbackStore()
