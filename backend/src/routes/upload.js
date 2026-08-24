import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import express from 'express'
import multer from 'multer'
import { config } from '../config.js'
import { requireTrustedOrigin } from '../services/auth.js'
import {
  allowedFile,
  assertFileMatchesExtension,
  assertFileSignature,
  chunkRoot,
  cleanupExpiredUploads,
  createUploadVisitorCredential,
  getExtension,
  mergeFilesSequentially,
  processUploadedFile,
  registerPendingUpload,
  removeUploadedFiles,
  uniqueUploadName,
  uploadOwnerKey,
  uploadPath,
  uploadVisitorCookieName,
  verifyUploadVisitorCredential,
  writeFileSecure
} from '../services/fileTools.js'
import { messageStore } from '../services/messageStore.js'
import { uploadRateLimit } from '../services/rateLimit.js'
import { userStore } from '../services/userStore.js'

export const uploadRouter = express.Router()
const uploadFieldSize = 4096
const chunkForm = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxChunkSize, files: 1, fields: 4, fieldSize: uploadFieldSize }
})
const directForm = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxChunkSize, files: 1, fields: 3, fieldSize: uploadFieldSize }
})
const maxChunkCount = config.maxChunkCount
const bootstrapVisitors = new Map()
let lastCleanupAt = 0
let cleanupTimer = null

const uploadCookieOptions = () => ({
  maxAge: config.uploadBindingTtlMs,
  path: '/',
  httpOnly: true,
  sameSite: String(config.sessionCookieSameSite || 'Lax').toLowerCase(),
  secure: config.sessionCookieSecure
})

const bootstrapVisitorId = (req, now) => {
  for (const [key, value] of bootstrapVisitors) {
    if (value.expiresAt <= now) bootstrapVisitors.delete(key)
  }
  if (bootstrapVisitors.size > 10_000) bootstrapVisitors.clear()
  const fingerprint = createHash('sha256')
    .update(String(req.ip || req.socket?.remoteAddress || ''))
    .update('\0')
    .update(String(req.headers['user-agent'] || ''))
    .update('\0')
    .update(String(req.headers['accept-language'] || ''))
    .update('\0')
    .update(String(req.headers['sec-ch-ua'] || ''))
    .update('\0')
    .update(String(req.cookies?.poll_voter || ''))
    .update('\0')
    .update(String(req.cookies?.user_session || ''))
    .digest('hex')
  const existing = bootstrapVisitors.get(fingerprint)
  if (existing?.expiresAt > now) return existing.visitorId
  const visitorId = randomUUID()
  bootstrapVisitors.set(fingerprint, { visitorId, expiresAt: now + 30_000 })
  return visitorId
}

const requestUploadIdentity = async (req, res) => {
  const now = Date.now()
  const existing = verifyUploadVisitorCredential(req.cookies?.[uploadVisitorCookieName], { now })
  const visitorId = existing?.visitorId || bootstrapVisitorId(req, now)
  res.cookie(
    uploadVisitorCookieName,
    createUploadVisitorCredential({ visitorId, now }),
    uploadCookieOptions()
  )
  const user = await userStore.getSessionUser(req)
  return { user, visitorId, owner: uploadOwnerKey(visitorId, user?.id) }
}

const maybeCleanupExpiredUploads = () => {
  const now = Date.now()
  if (now - lastCleanupAt < config.uploadCleanupIntervalMs) return
  lastCleanupAt = now
  try {
    cleanupExpiredUploads({ now, isReferenced: (filename) => messageStore.isFileReferenced(filename) })
  } catch {}
}

const ensureChunkDirectory = (dir) => {
  try {
    fs.mkdirSync(dir, { mode: 0o700 })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }
  const stat = fs.lstatSync(dir)
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(fs.realpathSync(dir)) !== path.resolve(dir)) {
    throw new Error('Unsafe chunk directory')
  }
}

const readChunkMetadata = (metadataPath) => {
  const stat = fs.lstatSync(metadataPath)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 16 * 1024) {
    throw new Error('Invalid chunk metadata')
  }
  const fd = fs.openSync(metadataPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
  try {
    return JSON.parse(fs.readFileSync(fd, 'utf8'))
  } finally {
    fs.closeSync(fd)
  }
}

const existingChunkFiles = (dir) => {
  const chunks = []
  for (const entry of fs.readdirSync(dir)) {
    const target = path.join(dir, entry)
    const stat = fs.lstatSync(target)
    if (stat.isSymbolicLink()) throw new Error('Symbolic links are not allowed in chunk storage')
    if (/^\d{5}\.chunk$/.test(entry)) {
      if (!stat.isFile()) throw new Error('Invalid chunk file')
      chunks.push({ name: entry, path: target, size: stat.size })
    }
  }
  return chunks.sort((left, right) => left.name.localeCompare(right.name))
}

const chunkName = (index) => `${String(index).padStart(5, '0')}.chunk`

const removeChunkDirectory = (dir) => {
  if (!dir) return
  try {
    const stat = fs.lstatSync(dir)
    if (stat.isSymbolicLink()) fs.rmSync(dir, { force: true })
    else if (stat.isDirectory()) fs.rmSync(dir, { recursive: true, force: true })
  } catch {}
}

uploadRouter.use((req, res, next) => {
  if (!cleanupTimer) {
    cleanupTimer = setInterval(maybeCleanupExpiredUploads, config.uploadCleanupIntervalMs)
    cleanupTimer.unref()
  }
  maybeCleanupExpiredUploads()
  next()
})

uploadRouter.post('/chunked_upload', requireTrustedOrigin, uploadRateLimit, chunkForm.single('chunk'), async (req, res) => {
  try {
    const { chunkIndex, totalChunks, fileKey, originalName } = req.body
    const index = Number(chunkIndex)
    const total = Number(totalChunks)

    if (!req.file || req.file.size < 1 || req.file.size > config.maxChunkSize || !fileKey || !Number.isInteger(index) || !Number.isInteger(total) || index < 0 || total < 1 || index >= total || total > maxChunkCount) {
      res.json({ success: false, error: 'Invalid chunk upload metadata' })
      return
    }
    if (!allowedFile(originalName)) {
      res.json({ success: false, error: 'File type is not allowed' })
      return
    }
    if (index === 0 && getExtension(originalName) !== 'txt') {
      assertFileSignature(originalName, req.file.buffer.subarray(0, 64))
    }

    const identity = await requestUploadIdentity(req, res)
    const dir = chunkRoot(fileKey, identity.owner)
    ensureChunkDirectory(dir)
    const metadataPath = path.join(dir, 'metadata.json')
    if (fs.existsSync(metadataPath)) {
      const existing = readChunkMetadata(metadataPath)
      if (existing.original_name !== originalName || Number(existing.total_chunks) !== total || existing.owner !== identity.owner) {
        res.json({ success: false, error: 'Chunk metadata does not match' })
        return
      }
    } else {
      try {
        writeFileSecure(metadataPath, `${JSON.stringify({
          original_name: String(originalName),
          total_chunks: total,
          owner: identity.owner,
          created_at: Date.now()
        })}\n`)
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        const existing = readChunkMetadata(metadataPath)
        if (existing.original_name !== originalName || Number(existing.total_chunks) !== total || existing.owner !== identity.owner) {
          res.json({ success: false, error: 'Chunk metadata does not match' })
          return
        }
      }
    }

    const chunks = existingChunkFiles(dir)
    const targetName = chunkName(index)
    const replacedSize = chunks.find((chunk) => chunk.name === targetName)?.size || 0
    const currentSize = chunks.reduce((sum, chunk) => sum + chunk.size, 0)
    if (currentSize - replacedSize + req.file.size > config.maxContentLength) {
      res.json({ success: false, error: 'Chunked upload exceeds the total size limit' })
      return
    }
    writeFileSecure(path.join(dir, targetName), req.file.buffer, { replace: true })
    const uploadedChunks = existingChunkFiles(dir).length
    res.json({ success: true, uploadedChunks, totalChunks: total })
  } catch (error) {
    res.json({ success: false, error: error.message })
  }
})

uploadRouter.post('/merge_chunks', requireTrustedOrigin, uploadRateLimit, async (req, res) => {
  let dir = ''
  let stagingPath = ''
  let originalFilename = ''
  let finalFilename = ''
  try {
    if (!req.body?.fileKey) {
      res.json({ success: false, error: 'Invalid file key' })
      return
    }

    const identity = await requestUploadIdentity(req, res)
    dir = chunkRoot(req.body.fileKey, identity.owner)
    const metadataPath = path.join(dir, 'metadata.json')
    if (!fs.existsSync(metadataPath)) {
      res.json({ success: false, error: 'Chunk directory does not exist' })
      return
    }

    const metadata = readChunkMetadata(metadataPath)
    const total = Number(metadata.total_chunks)
    if (metadata.owner !== identity.owner || !allowedFile(metadata.original_name)) {
      throw new Error('Chunk metadata does not match')
    }
    const chunks = existingChunkFiles(dir)
    const validTotal = Number.isInteger(total) &&
      total >= 1 &&
      total <= maxChunkCount
    const expectedNames = validTotal ? Array.from({ length: total }, (_, index) => chunkName(index)) : []
    const complete = validTotal &&
      chunks.length === total &&
      chunks.every((chunk, index) => chunk.name === expectedNames[index])
    if (!complete) {
      res.json({ success: false, error: `Incomplete chunks, missing ${Math.max(total - chunks.length, 0)} chunks` })
      return
    }
    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.size, 0)
    if (totalSize < 1 || totalSize > config.maxContentLength) throw new Error('Merged file exceeds the size limit')

    stagingPath = uploadPath(`.upload-${randomUUID()}.part`)
    await mergeFilesSequentially(chunks.map((chunk) => chunk.path), stagingPath, { maxBytes: config.maxContentLength })
    await assertFileMatchesExtension(stagingPath, metadata.original_name)

    originalFilename = uniqueUploadName(metadata.original_name)
    fs.renameSync(stagingPath, uploadPath(originalFilename))
    stagingPath = ''
    finalFilename = await processUploadedFile(originalFilename)
    const credential = registerPendingUpload(finalFilename, identity.owner)
    removeChunkDirectory(dir)
    dir = ''
    res.json({ success: true, filenames: [finalFilename], uploadTokens: [credential] })
  } catch (error) {
    if (stagingPath) {
      try { fs.rmSync(stagingPath, { force: true }) } catch {}
    }
    removeUploadedFiles([originalFilename, finalFilename])
    removeChunkDirectory(dir)
    res.json({ success: false, error: error.message })
  }
})

uploadRouter.post('/direct_upload', requireTrustedOrigin, uploadRateLimit, directForm.single('file'), async (req, res) => {
  let originalFilename = ''
  let finalFilename = ''
  try {
    const originalName = req.body.originalName || req.file?.originalname
    if (!req.file || req.file.size < 1 || req.file.size > config.maxChunkSize || !allowedFile(originalName)) {
      res.json({ success: false, error: 'File type is not supported' })
      return
    }
    assertFileSignature(originalName, req.file.buffer)
    const identity = await requestUploadIdentity(req, res)
    originalFilename = uniqueUploadName(originalName)
    writeFileSecure(uploadPath(originalFilename), req.file.buffer)
    finalFilename = await processUploadedFile(originalFilename)
    const credential = registerPendingUpload(finalFilename, identity.owner)
    res.json({ success: true, filenames: [finalFilename], uploadTokens: [credential] })
  } catch (error) {
    removeUploadedFiles([originalFilename, finalFilename])
    res.json({ success: false, error: error.message })
  }
})
