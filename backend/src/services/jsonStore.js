import fs from 'node:fs'
import path from 'node:path'
import { resolveBackend } from '../config.js'

export const readJson = (relativePath, fallback) => {
  const filePath = resolveBackend(relativePath)
  if (!fs.existsSync(filePath)) return structuredClone(fallback)
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return structuredClone(fallback)
  }
}

export const writeJson = (relativePath, data) => {
  const filePath = resolveBackend(relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf8')
}

export const appendAdminLog = (message) => {
  const logs = readJson('admin_log.json', [])
  logs.push(message)
  writeJson('admin_log.json', logs)
}

export const nowText = () => {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
