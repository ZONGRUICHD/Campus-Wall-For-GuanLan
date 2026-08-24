import fs from 'node:fs'
import express from 'express'
import { authenticatedAdmin, hasPermission } from '../services/auth.js'
import { safeBasename, tinyPath, uploadPath } from '../services/fileTools.js'
import { messageStore } from '../services/messageStore.js'

export const staticFileRouter = express.Router()

const adminMayRead = (req, filename) => {
  const admin = authenticatedAdmin(req)
  if (!admin) return false
  if (hasPermission(admin.permissions, 'manage_wall_message')) return messageStore.isFileReferenced(filename)
  return hasPermission(admin.permissions, 'review_posts') && messageStore.isFileReviewable(filename)
}

const requestedFilename = (req) => {
  const raw = String(req.params.filename || '')
  const safe = safeBasename(raw)
  return raw === safe ? safe : ''
}

const mayRead = (req, filename) => messageStore.isFilePubliclyReferenced(filename) || adminMayRead(req, filename)

const sendFile = (req, res, next, { tiny = false } = {}) => {
  const filename = requestedFilename(req)
  if (!filename || !mayRead(req, filename)) {
    next()
    return
  }
  const preferred = tiny ? tinyPath(filename) : uploadPath(filename)
  const fallback = uploadPath(filename)
  const filePath = fs.existsSync(preferred) ? preferred : (tiny && fs.existsSync(fallback) ? fallback : '')
  if (!filePath) {
    next()
    return
  }
  res.set('Cache-Control', messageStore.isFilePubliclyReferenced(filename)
    ? 'public, max-age=604800, immutable'
    : 'private, no-store')
  res.sendFile(filePath)
}

staticFileRouter.get('/uploads/:filename', (req, res, next) => sendFile(req, res, next))
staticFileRouter.get('/files/:filename', (req, res, next) => sendFile(req, res, next))
staticFileRouter.get('/tiny_files/:filename', (req, res, next) => sendFile(req, res, next, { tiny: true }))
