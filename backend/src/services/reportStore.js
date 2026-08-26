import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { config } from '../config.js'
import { nowText, readJson, writeJson } from './jsonStore.js'

const pendingPath = path.join('help', 'report.json')
const processedPath = path.join('help', 'processed_report.json')
const reportIdPattern = /^[a-f0-9]{32}$/
const resolutionCodes = new Set(['dismiss', 'delete_comment', 'delete_message'])

export const reportResolutions = {
  dismiss: '内容未发现违规，予以保留',
  delete_comment: '违规评论已删除',
  delete_message: '违规留言已删除'
}

export const normalizeReportId = (value) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '')

const validReportId = (value) => {
  const id = normalizeReportId(value)
  return reportIdPattern.test(id) ? id : randomUUID().replaceAll('-', '')
}

const normalizeReport = (item = {}, processed = false) => ({
  ...item,
  id: validReportId(item.id),
  text: String(item.text || '').trim(),
  email: String(item.email || '').trim(),
  category: String(item.category || '其他').trim() || '其他',
  timestamp: String(item.timestamp || nowText()),
  target_type: item.target_type === 'comment' ? 'comment' : 'message',
  ...(item.comment_id ? { comment_id: String(item.comment_id) } : {}),
  target_excerpt: String(item.target_excerpt || '').trim(),
  ...(processed ? {
    resolution: resolutionCodes.has(item.resolution) ? item.resolution : 'dismiss',
    public_reply: String(item.public_reply || '').trim(),
    processed_by: String(item.processed_by || '历史记录'),
    processed_at: String(item.processed_at || item.timestamp || nowText())
  } : {})
})

const normalizeCollection = (source, processed = false) => {
  const raw = source && typeof source === 'object' && !Array.isArray(source) ? source : {}
  const result = {}
  for (const [messageId, items] of Object.entries(raw)) {
    if (!Array.isArray(items) || items.length === 0) continue
    result[String(messageId)] = items.map((item) => normalizeReport(item, processed))
  }
  return result
}

const loadCollection = (filePath, processed = false) => {
  const source = readJson(filePath, {})
  const normalized = normalizeCollection(source, processed)
  if (JSON.stringify(source) !== JSON.stringify(normalized)) writeJson(filePath, normalized)
  return normalized
}

const publicReport = (report, messageId, processed) => ({
  id: report.id,
  message_id: String(messageId),
  target_type: report.target_type,
  target_type_label: report.target_type === 'comment' ? '评论' : '留言',
  category: report.category,
  timestamp: report.timestamp,
  status: processed ? 'processed' : 'pending',
  status_label: processed ? '已处理' : '待处理',
  resolution: processed ? report.resolution : '',
  resolution_label: processed ? reportResolutions[report.resolution] : '',
  processed_at: processed ? report.processed_at : '',
  public_reply: processed ? report.public_reply : ''
})

const countReports = (collection = {}) => Object.values(collection).reduce(
  (sum, items) => sum + (Array.isArray(items) ? items.length : 0),
  0
)

const fail = (message, statusCode = 400) => {
  const error = new Error(message)
  error.statusCode = statusCode
  throw error
}

export class ReportStore {
  pending() {
    return loadCollection(pendingPath)
  }

  processed() {
    return loadCollection(processedPath, true)
  }

  processedItems() {
    return Object.entries(this.processed()).flatMap(([messageId, items]) => (
      items.map((item) => ({ ...item, message_id: String(messageId) }))
    ))
  }

  create(messageId, input = {}) {
    const report = normalizeReport({
      ...input,
      id: randomUUID().replaceAll('-', ''),
      timestamp: nowText()
    })
    const reports = this.pending()
    if (countReports(reports) + countReports(this.processed()) >= config.maxReportRecords) {
      fail('举报数量已达上限，请稍后再试', 503)
    }
    const key = String(messageId)
    reports[key] ??= []
    reports[key].push(report)
    writeJson(pendingPath, reports)
    return report
  }

  publicStatus(reportId) {
    const id = normalizeReportId(reportId)
    if (!reportIdPattern.test(id)) return null

    for (const [messageId, items] of Object.entries(this.processed())) {
      const report = items.find((item) => item.id === id)
      if (report) return publicReport(report, messageId, true)
    }
    for (const [messageId, items] of Object.entries(this.pending())) {
      const report = items.find((item) => item.id === id)
      if (report) return publicReport(report, messageId, false)
    }
    return null
  }

  archive(messageId, reportsToArchive, { resolution = 'dismiss', processedBy = '', publicReply = '' } = {}) {
    const action = resolutionCodes.has(resolution) ? resolution : 'dismiss'
    const key = String(messageId)
    const selected = Array.isArray(reportsToArchive) ? reportsToArchive : []
    const selectedIds = new Set(selected.map((item) => normalizeReportId(item?.id)).filter((id) => reportIdPattern.test(id)))
    if (selectedIds.size === 0) return { processedAt: '', archived: [] }

    const pending = this.pending()
    const current = Array.isArray(pending[key]) ? pending[key] : []
    const archived = current.filter((item) => selectedIds.has(item.id))
    if (archived.length === 0) return { processedAt: '', archived: [] }

    const remaining = current.filter((item) => !selectedIds.has(item.id))
    if (remaining.length) pending[key] = remaining
    else delete pending[key]
    writeJson(pendingPath, pending)

    const processedAt = nowText()
    const processed = this.processed()
    processed[key] ??= []
    const records = archived.map((item) => normalizeReport({
      ...item,
      resolution: action,
      public_reply: String(publicReply || '').trim(),
      processed_by: String(processedBy || ''),
      processed_at: processedAt
    }, true))
    processed[key].push(...records)
    writeJson(processedPath, processed)
    return { processedAt, archived: records }
  }
}

export const reportStore = new ReportStore()
