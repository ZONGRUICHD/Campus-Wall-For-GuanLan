import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
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

const replaceFile = (from, to) => {
  try {
    fs.renameSync(from, to)
  } catch (error) {
    if (!['EEXIST', 'EPERM', 'EACCES'].includes(error?.code)) {
      try { fs.rmSync(from, { force: true }) } catch {}
      throw error
    }
    fs.copyFileSync(from, to)
    fs.rmSync(from, { force: true })
  }
}

export const writeJson = (relativePath, data) => {
  const filePath = resolveBackend(relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 4), 'utf8')
  replaceFile(temporaryPath, filePath)
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
