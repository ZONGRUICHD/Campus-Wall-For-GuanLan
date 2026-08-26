import path from 'node:path'
import { createHash } from 'node:crypto'

const maxSafeBasenameLength = 180

export const safeBasename = (filename = 'file') => {
  const cleaned = path.basename(String(filename || 'file')).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'file'
  if (cleaned.length <= maxSafeBasenameLength) return cleaned
  const ext = path.extname(cleaned).slice(0, 24)
  const stem = cleaned.slice(0, cleaned.length - ext.length)
  const digest = createHash('sha256').update(cleaned).digest('hex').slice(0, 16)
  const maxStemLength = Math.max(1, maxSafeBasenameLength - ext.length - digest.length - 1)
  return `${stem.slice(0, maxStemLength)}_${digest}${ext}`
}
