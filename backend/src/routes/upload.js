import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import express from 'express'
import multer from 'multer'
import { config } from '../config.js'
import { requireTrustedOrigin } from '../services/auth.js'
import { allowedFile, chunkRoot, processUploadedFile, safeBasename, uniqueUploadName, uploadPath } from '../services/fileTools.js'
import { consumeUploadBytes, uploadRateLimit } from '../services/rateLimit.js'

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

uploadRouter.post('/chunked_upload', requireTrustedOrigin, uploadRateLimit, chunkForm.single('chunk'), (req, res) => {
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

    fs.mkdirSync(dir, { recursive: true })
    for (const previous of replacedChunks) fs.rmSync(path.join(dir, previous), { force: true })
    fs.writeFileSync(path.join(dir, `${indexPrefix}_${safeBasename(req.file.originalname || originalName)}`), req.file.buffer)
    if (!fs.existsSync(metadataPath)) fs.writeFileSync(metadataPath, JSON.stringify({ original_name: originalName, total_chunks: total, timestamp: Date.now() / 1000, owner_key: uploadOwnerKey(req) }, null, 2))
    const uploadedChunks = fs.readdirSync(dir).filter((name) => /^\d{5}_/.test(name)).length
    res.json({ success: true, uploadedChunks, totalChunks: total })
  } catch (error) {
    res.json({ success: false, error: error.message })
  }
})

uploadRouter.post('/merge_chunks', requireTrustedOrigin, uploadRateLimit, async (req, res) => {
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

    let filename = uniqueUploadName(metadata.original_name)
    const output = fs.createWriteStream(uploadPath(filename))
    for (const chunk of chunks) {
      output.write(fs.readFileSync(path.join(dir, chunk)))
      fs.unlinkSync(path.join(dir, chunk))
    }
    output.end()
    await new Promise((resolve) => output.on('finish', resolve))
    filename = await processUploadedFile(filename)
    fs.unlinkSync(metadataPath)
    fs.rmSync(dir, { recursive: true, force: true })
    res.json({ success: true, filenames: [filename] })
  } catch (error) {
    res.json({ success: false, error: error.message })
  }
})

uploadRouter.post('/direct_upload', requireTrustedOrigin, uploadRateLimit, directForm.single('file'), async (req, res) => {
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
    let filename = uniqueUploadName(originalName)
    fs.writeFileSync(uploadPath(filename), req.file.buffer)
    filename = await processUploadedFile(filename)
    res.json({ success: true, filenames: [filename] })
  } catch (error) {
    res.json({ success: false, error: error.message })
  }
})
