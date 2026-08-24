import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { config, resolveBackend, projectRoot } from '../config.js'

const execFileAsync = promisify(execFile)
const maxSafeBasenameLength = 180

export const ensureRuntimeDirs = () => {
  for (const dir of [config.uploadFolder, config.chunkFolder, config.avatarFolder, config.tinyFolder, path.join('static', 'apps', 'icons'), path.dirname(config.sqliteMessageDbPath), 'help', 'logs']) {
    fs.mkdirSync(resolveBackend(dir), { recursive: true })
  }
  const noticeFile = resolveBackend('static', 'notice.json')
  if (!fs.existsSync(noticeFile)) fs.writeFileSync(noticeFile, '[]\n', 'utf8')
}

export const getExtension = (filename = '') => path.extname(filename).slice(1).toLowerCase()

export const allowedFile = (filename = '') => {
  const ext = getExtension(filename)
  return Boolean(ext && config.allowedExtensions.has(ext))
}

export const isImageFile = (filename = '') => ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'].includes(getExtension(filename))

export const isVideoFile = (filename = '') => ['mp4', 'avi', 'mov', 'webm', 'ogg', 'flv', 'mkv'].includes(getExtension(filename))

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

const resolveInside = (baseDir, filename) => {
  const base = path.resolve(baseDir)
  const target = path.resolve(base, safeBasename(filename))
  if (target === base || !target.startsWith(`${base}${path.sep}`)) {
    throw new Error('Invalid file path')
  }
  return target
}

export const uniqueUploadName = (originalName) => `${randomUUID()}_${safeBasename(originalName)}`

export const uploadPath = (filename) => resolveInside(resolveBackend(config.uploadFolder), filename)

export const tinyPath = (filename) => resolveInside(resolveBackend(config.tinyFolder), filename)

export const chunkRoot = (fileKey) => resolveInside(resolveBackend(config.chunkFolder), fileKey)

export const convertImageToPng = async (filename) => {
  if (!isImageFile(filename) || getExtension(filename) === 'png') return filename
  const root = filename.slice(0, -path.extname(filename).length)
  const next = `${root}.png`
  await sharp(uploadPath(filename)).png({ quality: 95 }).toFile(uploadPath(next))
  return next
}

export const convertVideoToMp4 = async (filename) => {
  if (!isVideoFile(filename) || getExtension(filename) === 'mp4') return filename
  const root = filename.slice(0, -path.extname(filename).length)
  const next = `${root}.mp4`
  try {
    await execFileAsync('ffmpeg', ['-i', uploadPath(filename), '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', uploadPath(next)], { timeout: config.ffmpegTimeoutMs })
    return next
  } catch {
    return filename
  }
}

export const makeTinyFiles = async (filenames) => {
  const items = Array.isArray(filenames) ? filenames : [filenames]
  fs.mkdirSync(resolveBackend(config.tinyFolder), { recursive: true })
  for (const rawName of items) {
    const filename = safeBasename(rawName)
    const input = uploadPath(filename)
    if (!fs.existsSync(input)) continue
    if (isImageFile(filename)) {
      try {
        await sharp(input).resize({ height: 100 }).toFile(tinyPath(filename))
      } catch {}
      continue
    }
    if (isVideoFile(filename)) {
      try {
        await execFileAsync('ffmpeg', ['-i', input, '-vf', 'scale=-1:100', '-r', '24', '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-an', '-y', tinyPath(filename)], { timeout: config.ffmpegTimeoutMs })
      } catch {}
    }
  }
}

export const processUploadedFile = async (filename) => {
  let next = filename
  if (isImageFile(next)) next = await convertImageToPng(next)
  else if (isVideoFile(next)) next = await convertVideoToMp4(next)
  if (next !== filename) {
    try { fs.rmSync(uploadPath(filename), { force: true }) } catch {}
  }
  makeTinyFiles([next]).catch(() => {})
  return next
}

export const removeUploadedFiles = (filenames = []) => {
  const items = Array.isArray(filenames) ? filenames : [filenames]
  for (const rawName of new Set(items.filter(Boolean).map(safeBasename))) {
    for (const resolveFile of [uploadPath, tinyPath]) {
      try { fs.rmSync(resolveFile(rawName), { force: true }) } catch {}
    }
  }
}

export const cleanupStaleUploads = ({ isReferenced = () => false, now = Date.now() } = {}) => {
  const olderThan = now - config.unreferencedUploadRetentionMs
  let uploads = 0
  let chunks = 0
  const uploadDir = resolveBackend(config.uploadFolder)
  const tinyDir = resolveBackend(config.tinyFolder)
  const chunkDir = resolveBackend(config.chunkFolder)

  if (fs.existsSync(uploadDir)) {
    for (const entry of fs.readdirSync(uploadDir, { withFileTypes: true })) {
      if (!entry.isFile() || isReferenced(entry.name)) continue
      const filePath = uploadPath(entry.name)
      if (fs.statSync(filePath).mtimeMs > olderThan) continue
      removeUploadedFiles([entry.name])
      uploads += 1
    }
  }

  if (fs.existsSync(tinyDir)) {
    for (const entry of fs.readdirSync(tinyDir, { withFileTypes: true })) {
      if (!entry.isFile() || isReferenced(entry.name)) continue
      const filePath = tinyPath(entry.name)
      if (fs.statSync(filePath).mtimeMs <= olderThan) fs.rmSync(filePath, { force: true })
    }
  }

  if (fs.existsSync(chunkDir)) {
    for (const entry of fs.readdirSync(chunkDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dirPath = chunkRoot(entry.name)
      const metadataPath = path.join(dirPath, 'metadata.json')
      let touchedAt = fs.statSync(dirPath).mtimeMs
      if (fs.existsSync(metadataPath)) {
        try {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
          const timestamp = Number(metadata.timestamp) * 1000
          if (Number.isFinite(timestamp)) touchedAt = Math.max(touchedAt, timestamp)
        } catch {}
      }
      if (touchedAt > olderThan) continue
      fs.rmSync(dirPath, { recursive: true, force: true })
      chunks += 1
    }
  }

  return { uploads, chunks }
}

const directorySize = (root) => {
  if (!fs.existsSync(root)) return 0
  let total = 0
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) total += directorySize(entryPath)
    else if (entry.isFile()) total += fs.statSync(entryPath).size
  }
  return total
}

let uploadUsageCache = { checkedAt: 0, bytes: 0 }

export const reserveUploadCapacity = (additionalBytes = 0) => {
  const bytes = Math.max(0, Number(additionalBytes) || 0)
  const uploadRoot = resolveBackend(config.uploadFolder)
  const stats = fs.statfsSync(uploadRoot)
  const freeBytes = Number(stats.bavail) * Number(stats.bsize)
  if (freeBytes - bytes < config.minFreeDiskBytes) {
    return { success: false, error: '服务器存储空间不足，暂时无法上传' }
  }

  const now = Date.now()
  if (now - uploadUsageCache.checkedAt > 15000) {
    uploadUsageCache = {
      checkedAt: now,
      bytes: directorySize(uploadRoot) + directorySize(resolveBackend(config.chunkFolder)) + directorySize(resolveBackend(config.tinyFolder))
    }
  }
  if (uploadUsageCache.bytes + bytes > config.maxUploadStorageBytes) {
    return { success: false, error: '校园墙附件存储已达到安全上限，请稍后再试' }
  }
  uploadUsageCache.bytes += bytes
  return { success: true }
}

export const findAppConfigs = () => {
  const dirs = [
    resolveBackend('static', 'apps'),
    path.resolve(projectRoot, 'frontend', 'public', 'static', 'apps')
  ]
  const apps = []
  const seen = new Set()
  for (const appsDir of dirs) {
    if (!fs.existsSync(appsDir)) continue
    for (const appDirName of fs.readdirSync(appsDir)) {
      const configPath = path.join(appsDir, appDirName, 'config.json')
      if (!fs.existsSync(configPath)) continue
      try {
        const appConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        const key = appConfig.name || appDirName
        if (seen.has(key)) continue
        seen.add(key)
        apps.push(appConfig)
      } catch {}
    }
  }
  return apps
}
