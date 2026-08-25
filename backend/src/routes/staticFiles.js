import fs from 'node:fs'
import express from 'express'
import { authenticatedAccount, authenticatedAdmin, hasPermission } from '../services/auth.js'
import { safeBasename, tinyPath, uploadPath } from '../services/fileTools.js'
import { messageStore } from '../services/messageStore.js'

export const staticFileRouter = express.Router()

const adminMayRead = async (req, filename) => {
  const admin = await authenticatedAdmin(req)
  if (!admin) return false
  if (hasPermission(admin.permissions, 'manage_wall_message')) return messageStore.isFileReferenced(filename)
  return hasPermission(admin.permissions, 'review_posts') && messageStore.isFileReviewable(filename)
}

const requestedFilename = (req) => {
  const raw = String(req.params.filename || '')
  const safe = safeBasename(raw)
  return raw === safe ? safe : ''
}

const mayRead = async (req, filename) => {
  if (messageStore.isFileGuestAccessible(filename)) return true
  if (messageStore.isFilePubliclyReferenced(filename) && await authenticatedAccount(req)) return true
  return adminMayRead(req, filename)
}

const sendFile = async (req, res, next, { tiny = false } = {}) => {
  const filename = requestedFilename(req)
  if (!filename || !await mayRead(req, filename)) {
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
  res.set('Cache-Control', messageStore.isFileGuestAccessible(filename)
    ? 'public, max-age=60, must-revalidate'
    : 'private, no-store')
  if (String(req.query.download || '') === '1') {
    const requestedName = safeBasename(String(req.query.name || ''))
    const fallbackName = filename
      .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_/i, '')
      .replace(/^\d{10,}_/, '')
    res.download(filePath, requestedName === 'file' ? (fallbackName || filename) : requestedName)
    return
  }
  res.sendFile(filePath)
}

const asyncFile = (options = {}) => (req, res, next) => sendFile(req, res, next, options).catch(next)

staticFileRouter.get('/uploads/:filename', asyncFile())
staticFileRouter.get('/files/:filename', asyncFile())
staticFileRouter.get('/tiny_files/:filename', asyncFile({ tiny: true }))
