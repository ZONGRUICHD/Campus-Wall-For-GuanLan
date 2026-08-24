import fs from 'node:fs'
import express from 'express'
import cors from 'cors'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import { config, resolveBackend } from './config.js'
import { ensureRuntimeDirs } from './services/fileTools.js'
import { publicRouter } from './routes/public.js'
import { wallRouter } from './routes/wall.js'
import { uploadRouter } from './routes/upload.js'
import { adminRouter } from './routes/admin.js'
import { usersRouter } from './routes/users.js'
import { messageStore } from './services/messageStore.js'
import { userStore } from './services/userStore.js'
import { appStore } from './services/appStore.js'
import { settingsStore } from './services/settingsStore.js'
import { managerStore } from './services/managerStore.js'
import { auditStore } from './services/auditStore.js'
import { readJson, writeJson } from './services/jsonStore.js'

ensureRuntimeDirs()
managerStore.init()
try {
  await messageStore.init()
  await userStore.init()
  await appStore.init()
  await settingsStore.init()
  await auditStore.init()
  const legacyReviewData = readJson('manage_message.json', { approved: {} })
  if (!legacyReviewData?.migrations?.review_state_v1) {
    const legacyItems = Array.isArray(legacyReviewData?.approved?.lg) ? legacyReviewData.approved.lg : []
    const migrated = await messageStore.migrateLegacyReviews(legacyItems)
    legacyReviewData.migrations = {
      ...(legacyReviewData.migrations || {}),
      review_state_v1: { migrated_at: new Date().toISOString(), migrated }
    }
    legacyReviewData.legacy_approved = legacyReviewData.legacy_approved || legacyItems
    legacyReviewData.approved = { ...(legacyReviewData.approved || {}), lg: [] }
    writeJson('manage_message.json', legacyReviewData)
  }
} catch (error) {
  const details = error?.errors?.map((item) => item.message || item.code || String(item)).join('; ') || error?.message || error?.code || String(error)
  console.error(`Failed to initialize PostgreSQL stores: ${details}`)
  console.error('Start PostgreSQL with `npm run db:up` or configure DATABASE_URL/PG* environment variables.')
  process.exit(1)
}

const app = express()
app.set('trust proxy', true)

const immutableStaticOptions = {
  fallthrough: true,
  immutable: true,
  maxAge: '7d'
}

const appStaticOptions = {
  fallthrough: true,
  maxAge: '1h'
}

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('Referrer-Policy', 'same-origin')
  res.set('X-Frame-Options', 'SAMEORIGIN')
  next()
})

app.use(compression({ threshold: 1024 }))

app.use(cors({
  origin(origin, callback) {
    if (!origin || config.allowedOrigins.includes(origin)) callback(null, true)
    else callback(null, false)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Content-Disposition', 'Accept', 'Origin', 'X-Requested-With'],
  exposedHeaders: ['Set-Cookie', 'Content-Type', 'Access-Control-Allow-Origin', 'Access-Control-Allow-Credentials'],
  maxAge: 3600
}))

app.use(cookieParser())
app.use(express.json({ limit: config.maxBodySize }))
app.use(express.urlencoded({ extended: true, limit: config.maxBodySize }))

app.get('/static/notice.json', (req, res) => {
  res.set('Cache-Control', 'no-cache')
  res.sendFile(resolveBackend('static', 'notice.json'))
})
app.use('/static/uploads', express.static(resolveBackend(config.uploadFolder), immutableStaticOptions))
app.use('/static/tiny_files', express.static(resolveBackend(config.tinyFolder), immutableStaticOptions))
app.use('/static/apps', express.static(resolveBackend('static', 'apps'), appStaticOptions))

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api', uploadRouter)
app.use('/api', publicRouter)
app.use('/api/wall', wallRouter)
app.use('/api/admin', adminRouter)
app.use('/api/user', usersRouter)
app.use('/user', usersRouter)

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found' })
})

app.use((error, req, res, next) => {
  if (error?.name === 'MulterError' || error?.type === 'entity.too.large') {
    res.status(400).json({ success: false, error: '请求体无效或文件过大' })
    return
  }
  fs.mkdirSync(resolveBackend('logs'), { recursive: true })
  fs.appendFileSync(resolveBackend('logs', 'info.log'), `[${new Date().toISOString()}] ERROR: ${error.stack || error.message}\n`, 'utf8')
  res.status(500).json({ success: false, error: '服务器内部错误' })
})

app.listen(config.port, config.host, () => {
  console.log(`${config.appName} listening on http://${config.host}:${config.port}`)
})
