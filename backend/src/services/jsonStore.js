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
    return
  } catch (error) {
    if (!['EEXIST', 'EPERM', 'EACCES', 'EXDEV'].includes(error?.code)) {
      try { fs.rmSync(from, { force: true }) } catch {}
      throw error
    }
  }
  try {
    fs.copyFileSync(from, to)
  } finally {
    try { fs.rmSync(from, { force: true }) } catch {}
  }
}

const writeAtomic = (filePath, payload) => {
  const tryWrite = (temporaryPath) => {
    fs.writeFileSync(temporaryPath, payload, 'utf8')
    replaceFile(temporaryPath, filePath)
  }
  const siblingPath = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    tryWrite(siblingPath)
    return
  } catch (error) {
    if (!['EACCES', 'EPERM'].includes(error?.code)) throw error
  }
  const fallbackDir = resolveBackend('logs')
  fs.mkdirSync(fallbackDir, { recursive: true })
  const fallbackPath = path.join(
    fallbackDir,
    `${path.basename(filePath)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  )
  tryWrite(fallbackPath)
}

export const writeJson = (relativePath, data) => {
  const filePath = resolveBackend(relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  writeAtomic(filePath, JSON.stringify(data, null, 4))
}

export const appendAdminLog = (message) => {
  try {
    const logs = readJson('admin_log.json', [])
    logs.push(message)
    writeJson('admin_log.json', logs)
  } catch (error) {
    console.error(`Failed to append admin log: ${error?.message || error}`)
  }
}

export const nowText = () => {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
