import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import multer from 'multer'
import { config } from '../config.js'
import { requireTrustedOrigin } from '../services/auth.js'
import { allowedFile, chunkRoot, processUploadedFile, safeBasename, uniqueUploadName, uploadPath } from '../services/fileTools.js'
import { uploadRateLimit } from '../services/rateLimit.js'

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
const maxChunkCount = Math.max(1, Math.ceil(config.maxContentLength / config.maxChunkSize))

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
    fs.mkdirSync(dir, { recursive: true })
    const metadataPath = path.join(dir, 'metadata.json')
    if (fs.existsSync(metadataPath)) {
      const existing = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
      if (existing.original_name !== originalName || Number(existing.total_chunks) !== total) {
        res.json({ success: false, error: 'Chunk metadata does not match' })
        return
      }
    }
    fs.writeFileSync(path.join(dir, `${String(index).padStart(5, '0')}_${safeBasename(req.file.originalname || originalName)}`), req.file.buffer)
    if (!fs.existsSync(metadataPath)) fs.writeFileSync(metadataPath, JSON.stringify({ original_name: originalName, total_chunks: total, timestamp: Date.now() / 1000 }, null, 2))
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
    const total = Number(metadata.total_chunks)
    const chunks = fs.readdirSync(dir).filter((name) => /^\d{5}_/.test(name)).sort()
    if (!Number.isInteger(total) || total < 1 || total > maxChunkCount || chunks.length !== total) {
      res.json({ success: false, error: `Incomplete chunks, missing ${Math.max(total - chunks.length, 0)} chunks` })
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
    let filename = uniqueUploadName(originalName)
    fs.writeFileSync(uploadPath(filename), req.file.buffer)
    filename = await processUploadedFile(filename)
    res.json({ success: true, filenames: [filename] })
  } catch (error) {
    res.json({ success: false, error: error.message })
  }
})
