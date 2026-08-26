import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import express from 'express'
import multer from 'multer'
import { config } from '../config.js'
import { requireTrustedOrigin } from '../services/auth.js'
import { allowedFile, assertAllowedFileContents, chunkRoot, FileContentError, isImageFile, isVideoFile, normalisedImageName, processUploadedFile, removeUploadedFiles, reserveUploadCapacity, safeBasename, tinyPath, uniqueUploadName, uploadPath } from '../services/fileTools.js'
import { PostImageError } from '../services/postImageProcessor.js'
import { consumeUploadBytes, uploadConcurrencyLimit, uploadRateLimit } from '../services/rateLimit.js'

export const uploadRouter = express.Router()
const uploadFieldSize = 4096
const uploadPartSize = Math.min(config.maxChunkSize, config.maxContentLength)
const chunkForm = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: uploadPartSize, files: 1, fields: 4, fieldSize: uploadFieldSize }
})
const directForm = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: uploadPartSize, files: 1, fields: 3, fieldSize: uploadFieldSize }
})
const chunkCountAccountingSize = Math.min(config.maxChunkSize, 512 * 1024)
const maxChunkCount = Math.max(1, Math.min(1000, Math.ceil(config.maxContentLength / chunkCountAccountingSize)))
const uploadOwnerKey = (req) => createHash('sha256')
  .update(String(req.ip || req.socket?.remoteAddress || 'unknown'))
  .digest('hex')

const transformedCandidate = (filename) => {
  const extension = path.extname(filename).toLowerCase()
  const root = filename.slice(0, -extension.length)
  if (isImageFile(filename)) return normalisedImageName(filename)
  if (isVideoFile(filename) && extension !== '.mp4') return `${root}.mp4`
  return ''
}

const fileSize = (resolveFile, filename) => {
  if (!filename) return 0
  try { return fs.statSync(resolveFile(filename)).size } catch { return 0 }
}

const processUploadWithinCapacity = async (originalFilename, reservedOriginalBytes) => {
  const candidate = transformedCandidate(originalFilename)
  let finalFilename = originalFilename
  const cleanupNames = () => [...new Set([originalFilename, candidate, finalFilename].filter(Boolean))]

  try {
    finalFilename = await processUploadedFile(finalFilename)
    if (candidate && candidate !== finalFilename) removeUploadedFiles([candidate])
    if (!fs.existsSync(uploadPath(finalFilename))) throw new Error('Processed upload is missing')
    const finalMainBytes = fileSize(uploadPath, finalFilename)
    const finalTinyBytes = fileSize(tinyPath, finalFilename)
    if (finalMainBytes > config.maxContentLength) {
      removeUploadedFiles(cleanupNames())
      return { success: false, status: 413, error: 'File exceeds the maximum upload size after processing' }
    }

    const additionalBytes = Math.max(finalMainBytes + finalTinyBytes - reservedOriginalBytes, 0)
    const capacity = reserveUploadCapacity(additionalBytes)
    if (!capacity.success) {
      removeUploadedFiles(cleanupNames())
      return { ...capacity, status: 507 }
    }
    return { success: true, filename: finalFilename }
  } catch (error) {
    removeUploadedFiles(cleanupNames())
    if (error instanceof PostImageError) {
      return { success: false, status: error.status, error: error.message }
    }
    if (error instanceof FileContentError) {
      return { success: false, status: error.status, error: error.message }
    }
    return { success: false, status: 500, error: 'File processing failed' }
  }
}

uploadRouter.post('/chunked_upload', requireTrustedOrigin, uploadRateLimit, uploadConcurrencyLimit, chunkForm.single('chunk'), (req, res) => {
  try {
    const { chunkIndex, totalChunks, fileKey, originalName } = req.body
    const index = Number(chunkIndex)
    const total = Number(totalChunks)

    if (!req.file || req.file.size > config.maxChunkSize || !fileKey || !Number.isInteger(index) || !Number.isInteger(total) || index < 0 || total < 1 || index >= total || total > maxChunkCount) {
      res.json({ success: false, error: 'Invalid chunk upload metadata' })
      return
    }
    if (!allowedFile(originalName)) {
      res.json({ success: false, error: 'File type is not allowed' })
      return
    }

    const dir = chunkRoot(fileKey)
    const metadataPath = path.join(dir, 'metadata.json')
    if (fs.existsSync(metadataPath)) {
      const existing = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
      if (existing.owner_key !== uploadOwnerKey(req)) {
        res.status(403).json({ success: false, error: 'Upload session does not belong to this client' })
        return
      }
      if (existing.original_name !== originalName || Number(existing.total_chunks) !== total) {
        res.json({ success: false, error: 'Chunk metadata does not match' })
        return
      }
    }

    const indexPrefix = String(index).padStart(5, '0')
    const storedChunks = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => /^\d{5}_/.test(name)) : []
    const replacedChunks = storedChunks.filter((name) => name.startsWith(`${indexPrefix}_`))
    const storedBytes = storedChunks.reduce((sum, name) => sum + fs.statSync(path.join(dir, name)).size, 0)
    const replacedBytes = replacedChunks.reduce((sum, name) => sum + fs.statSync(path.join(dir, name)).size, 0)
    if (storedBytes - replacedBytes + req.file.size > config.maxContentLength) {
      res.status(413).json({ success: false, error: 'File exceeds the maximum upload size' })
      return
    }
    if (!consumeUploadBytes(req, res, req.file.size)) return
    const capacity = reserveUploadCapacity(Math.max(req.file.size - replacedBytes, 0))
    if (!capacity.success) {
      res.status(507).json(capacity)
      return
    }

    fs.mkdirSync(dir, { recursive: true })
    for (const previous of replacedChunks) fs.rmSync(path.join(dir, previous), { force: true })
    fs.writeFileSync(path.join(dir, `${indexPrefix}_${safeBasename(req.file.originalname || originalName)}`), req.file.buffer)
    if (!fs.existsSync(metadataPath)) fs.writeFileSync(metadataPath, JSON.stringify({ original_name: originalName, total_chunks: total, timestamp: Date.now() / 1000, owner_key: uploadOwnerKey(req) }, null, 2))
    const uploadedChunks = fs.readdirSync(dir).filter((name) => /^\d{5}_/.test(name)).length
    res.json({ success: true, uploadedChunks, totalChunks: total })
  } catch (error) {
    res.json({ success: false, error: 'Upload failed' })
  }
})

uploadRouter.post('/merge_chunks', requireTrustedOrigin, uploadRateLimit, uploadConcurrencyLimit, async (req, res) => {
  let outputFilename = ''
  let completedChunkDir = ''
  let mergeLockPath = ''
  try {
    if (!req.body?.fileKey) {
      res.json({ success: false, error: 'Invalid file key' })
      return
    }

    const dir = chunkRoot(req.body.fileKey)
    const metadataPath = path.join(dir, 'metadata.json')
    if (!fs.existsSync(metadataPath)) {
      res.json({ success: false, error: 'Chunk directory does not exist' })
      return
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    if (metadata.owner_key !== uploadOwnerKey(req)) {
      res.status(403).json({ success: false, error: 'Upload session does not belong to this client' })
      return
    }
    const lockPath = path.join(dir, '.merge.lock')
    try {
      fs.writeFileSync(lockPath, String(Date.now()), { flag: 'wx' })
      mergeLockPath = lockPath
    } catch (error) {
      if (error?.code === 'EEXIST') {
        res.status(409).json({ success: false, error: '文件正在合并，请稍后重试' })
        return
      }
      throw error
    }
    const total = Number(metadata.total_chunks)
    const storedChunks = fs.readdirSync(dir).filter((name) => /^\d{5}_/.test(name)).sort()
    if (!Number.isInteger(total) || total < 1 || total > maxChunkCount) {
      res.json({ success: false, error: 'Invalid chunk metadata' })
      return
    }

    const chunks = []
    for (let index = 0; index < total; index += 1) {
      const prefix = `${String(index).padStart(5, '0')}_`
      const matches = storedChunks.filter((name) => name.startsWith(prefix))
      if (matches.length !== 1) {
        res.json({ success: false, error: `Incomplete chunks, missing or duplicate chunk ${index}` })
        return
      }
      chunks.push(matches[0])
    }
    if (storedChunks.length !== total) {
      res.json({ success: false, error: 'Chunk directory contains unexpected data' })
      return
    }

    const chunkSizes = chunks.map((chunk) => fs.statSync(path.join(dir, chunk)).size)
    const totalSize = chunkSizes.reduce((sum, size) => sum + size, 0)
    if (chunkSizes.some((size) => size > config.maxChunkSize) || totalSize > config.maxContentLength) {
      res.status(413).json({ success: false, error: 'File exceeds the maximum upload size' })
      return
    }

    completedChunkDir = dir
    outputFilename = uniqueUploadName(metadata.original_name)
    const output = fs.createWriteStream(uploadPath(outputFilename))
    for (const chunk of chunks) {
      output.write(fs.readFileSync(path.join(dir, chunk)))
    }
    output.end()
    await new Promise((resolve, reject) => {
      output.on('finish', resolve)
      output.on('error', reject)
    })
    assertAllowedFileContents(outputFilename, uploadPath(outputFilename))
    const processed = await processUploadWithinCapacity(outputFilename, totalSize)
    if (!processed.success) {
      res.status(processed.status).json({ success: false, error: processed.error })
      return
    }
    res.json({ success: true, filenames: [processed.filename] })
  } catch (error) {
    if (outputFilename) removeUploadedFiles([outputFilename, transformedCandidate(outputFilename)])
    if (error instanceof FileContentError) {
      res.status(error.status).json({ success: false, error: error.message })
      return
    }
    res.json({ success: false, error: 'Upload failed' })
  } finally {
    if (completedChunkDir) fs.rmSync(completedChunkDir, { recursive: true, force: true })
    else if (mergeLockPath) {
      try { fs.rmSync(mergeLockPath, { force: true }) } catch {}
    }
  }
})

uploadRouter.post('/direct_upload', requireTrustedOrigin, uploadRateLimit, uploadConcurrencyLimit, directForm.single('file'), async (req, res) => {
  let outputFilename = ''
  try {
    const originalName = req.body.originalName || req.file?.originalname
    if (!req.file || !allowedFile(originalName)) {
      res.json({ success: false, error: 'File type is not supported' })
      return
    }
    if (req.file.size > config.maxContentLength) {
      res.status(413).json({ success: false, error: 'File exceeds the maximum upload size' })
      return
    }
    if (!consumeUploadBytes(req, res, req.file.size)) return
    const capacity = reserveUploadCapacity(req.file.size)
    if (!capacity.success) {
      res.status(507).json(capacity)
      return
    }
    outputFilename = uniqueUploadName(originalName)
    fs.writeFileSync(uploadPath(outputFilename), req.file.buffer)
    assertAllowedFileContents(outputFilename, req.file.buffer)
    const processed = await processUploadWithinCapacity(outputFilename, req.file.size)
    if (!processed.success) {
      res.status(processed.status).json({ success: false, error: processed.error })
      return
    }
    res.json({ success: true, filenames: [processed.filename] })
  } catch (error) {
    if (outputFilename) removeUploadedFiles([outputFilename, transformedCandidate(outputFilename)])
    if (error instanceof FileContentError) {
      res.status(error.status).json({ success: false, error: error.message })
      return
    }
    res.json({ success: false, error: 'Upload failed' })
  }
})
