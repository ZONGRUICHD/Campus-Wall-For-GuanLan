import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const currentFile = fileURLToPath(import.meta.url)
const defaultSecretKey = 'your-secret-key-change-in-production'
const defaultPostgresPassword = 'campus_wall_dev'

export const backendDir = path.resolve(path.dirname(currentFile), '..')
export const projectRoot = path.resolve(backendDir, '..')

dotenv.config({ path: path.join(backendDir, '.env') })

const boolEnv = (name, fallback) => {
  const value = process.env[name]
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

const listEnv = (name, fallback) => {
  const value = process.env[name]
  const items = value ? value.split(',') : fallback
  return items.map((item) => String(item).trim().replace(/\/+$/, '')).filter(Boolean)
}

const intEnv = (name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value < min || value > max) return fallback
  return value
}

export const config = {
  environment: String(process.env.NODE_ENV || 'development').toLowerCase(),
  schoolName: process.env.SCHOOL_NAME || '龙华区观澜中学',
  siteName: process.env.SITE_NAME || '龙华区观澜中学校园墙',
  appName: process.env.APP_NAME || '龙华区观澜中学校园墙 API',
  debug: boolEnv('DEBUG', false),
  secretKey: process.env.SECRET_KEY || defaultSecretKey,
  host: process.env.HOST || '0.0.0.0',
  port: intEnv('PORT', 5412, { min: 1, max: 65535 }),
  uploadFolder: process.env.UPLOAD_FOLDER || path.join('static', 'uploads'),
  chunkFolder: process.env.CHUNK_FOLDER || path.join('static', 'chunks'),
  avatarFolder: process.env.AVATAR_FOLDER || path.join('static', 'avatars'),
  tinyFolder: process.env.TINY_FOLDER || path.join('static', 'tiny_files'),
  sqliteMessageDbPath: process.env.SQLITE_MESSAGE_DB_PATH || process.env.MESSAGE_DB_PATH || path.join('static', 'messages', 'messages.db'),
  databaseUrl: process.env.DATABASE_URL || '',
  pgHost: process.env.PGHOST || 'localhost',
  pgPort: intEnv('PGPORT', 5432, { min: 1, max: 65535 }),
  pgDatabase: process.env.PGDATABASE || 'campus_wall',
  pgUser: process.env.PGUSER || 'campus_wall',
  pgPassword: process.env.PGPASSWORD || (process.env.DATABASE_URL ? '' : defaultPostgresPassword),
  pgSsl: boolEnv('PGSSL', false),
  maxBodySize: intEnv('MAX_BODY_SIZE', 1024 * 1024),
  maxContentLength: intEnv('MAX_CONTENT_LENGTH', 100 * 1024 * 1024),
  maxChunkSize: intEnv('MAX_CHUNK_SIZE', 10 * 1024 * 1024),
  unreferencedUploadRetentionMs: intEnv('UNREFERENCED_UPLOAD_RETENTION_MS', 2 * 60 * 60 * 1000, { min: 15 * 60 * 1000, max: 7 * 24 * 60 * 60 * 1000 }),
  pendingAttachmentRetentionMs: intEnv('PENDING_ATTACHMENT_RETENTION_MS', 48 * 60 * 60 * 1000, { min: 60 * 60 * 1000, max: 30 * 24 * 60 * 60 * 1000 }),
  maxUploadStorageBytes: intEnv('MAX_UPLOAD_STORAGE_BYTES', 8 * 1024 * 1024 * 1024, { min: 512 * 1024 * 1024, max: 1024 * 1024 * 1024 * 1024 }),
  minFreeDiskBytes: intEnv('MIN_FREE_DISK_BYTES', 8 * 1024 * 1024 * 1024, { min: 512 * 1024 * 1024, max: 1024 * 1024 * 1024 * 1024 }),
  ffmpegTimeoutMs: intEnv('FFMPEG_TIMEOUT_MS', 120000),
  maxTextLength: intEnv('MAX_TEXT_LENGTH', 10000),
  maxTitleLength: intEnv('MAX_TITLE_LENGTH', 200),
  maxEmailLength: intEnv('MAX_EMAIL_LENGTH', 320),
  maxTags: intEnv('MAX_TAGS', 10),
  maxTagLength: intEnv('MAX_TAG_LENGTH', 50),
  maxMessageFiles: intEnv('MAX_MESSAGE_FILES', 20),
  maxCommentFiles: intEnv('MAX_COMMENT_FILES', 10),
  maxPollOptions: intEnv('MAX_POLL_OPTIONS', 6, { min: 2, max: 12 }),
  maxPollQuestionLength: intEnv('MAX_POLL_QUESTION_LENGTH', 200, { min: 20, max: 1000 }),
  maxPollOptionLength: intEnv('MAX_POLL_OPTION_LENGTH', 80, { min: 10, max: 500 }),
  maxPollDurationDays: intEnv('MAX_POLL_DURATION_DAYS', 30, { min: 1, max: 365 }),
  maxAvatarSize: intEnv('MAX_AVATAR_SIZE', 5 * 1024 * 1024),
  messagePageSize: intEnv('MESSAGE_PAGE_SIZE', 15),
  maxPublicQuerySize: intEnv('MAX_PUBLIC_QUERY_SIZE', 10000),
  rateLimitLogin: intEnv('RATE_LIMIT_LOGIN', 30, { min: 3, max: 1000 }),
  rateLimitRegister: intEnv('RATE_LIMIT_REGISTER', 10, { min: 2, max: 500 }),
  rateLimitWrite: intEnv('RATE_LIMIT_WRITE', 40, { min: 5, max: 10000 }),
  rateLimitInteraction: intEnv('RATE_LIMIT_INTERACTION', 240, { min: 20, max: 50000 }),
  rateLimitUpload: intEnv('RATE_LIMIT_UPLOAD', 240, { min: 20, max: 50000 }),
  rateLimitUploadBytes: intEnv('RATE_LIMIT_UPLOAD_BYTES', 256 * 1024 * 1024, { min: 1024 * 1024, max: 10 * 1024 * 1024 * 1024 }),
  maxConcurrentUploadsPerIp: intEnv('MAX_CONCURRENT_UPLOADS_PER_IP', 3, { min: 1, max: 100 }),
  maxConcurrentUploadsGlobal: intEnv('MAX_CONCURRENT_UPLOADS_GLOBAL', 24, { min: 1, max: 1000 }),
  rateLimitFeedback: intEnv('RATE_LIMIT_FEEDBACK', 20, { min: 3, max: 1000 }),
  captchaProvider: String(process.env.CAPTCHA_PROVIDER || 'none').toLowerCase(),
  captchaEnabled: boolEnv('CAPTCHA_ENABLED', String(process.env.CAPTCHA_PROVIDER || 'none').toLowerCase() !== 'none'),
  captchaSiteKey: process.env.CAPTCHA_SITE_KEY || '',
  captchaSecretKey: process.env.CAPTCHA_SECRET_KEY || '',
  captchaTimeoutMs: intEnv('CAPTCHA_TIMEOUT_MS', 8000, { min: 1000, max: 30000 }),
  sessionCookieSameSite: process.env.SESSION_COOKIE_SAMESITE || 'Lax',
  sessionCookieSecure: boolEnv('SESSION_COOKIE_SECURE', false),
  sessionMaxAge: intEnv('SESSION_MAX_AGE', 7 * 24 * 60 * 60),
  publicSiteUrl: String(process.env.PUBLIC_SITE_URL || '').trim().replace(/\/+$/, ''),
  moderationNotifyEnabled: boolEnv('MODERATION_NOTIFY_ENABLED', false),
  moderationNotifyFeishuWebhook: String(process.env.MODERATION_NOTIFY_FEISHU_WEBHOOK || '').trim(),
  moderationNotifyFeishuSecret: String(process.env.MODERATION_NOTIFY_FEISHU_SECRET || '').trim(),
  moderationNotifyWecomWebhook: String(process.env.MODERATION_NOTIFY_WECOM_WEBHOOK || '').trim(),
  moderationNotifyTimeoutMs: intEnv('MODERATION_NOTIFY_TIMEOUT_MS', 5000, { min: 1000, max: 30000 }),
  moderationNotifyMaxAttempts: intEnv('MODERATION_NOTIFY_MAX_ATTEMPTS', 6, { min: 1, max: 12 }),
  moderationNotifyPollMs: intEnv('MODERATION_NOTIFY_POLL_MS', 2000, { min: 500, max: 60000 }),
  moderationNotifyCoalesceMs: intEnv('MODERATION_NOTIFY_COALESCE_MS', 5000, { min: 500, max: 30000 }),
  moderationNotifyMinIntervalMs: intEnv('MODERATION_NOTIFY_MIN_INTERVAL_MS', 30000, { min: 5000, max: 10 * 60 * 1000 }),
  moderationNotifyBatchSize: intEnv('MODERATION_NOTIFY_BATCH_SIZE', 50, { min: 2, max: 200 }),
  moderationNotifyRetentionDays: intEnv('MODERATION_NOTIFY_RETENTION_DAYS', 30, { min: 1, max: 365 }),
  allowedOrigins: listEnv('ALLOWED_ORIGINS', [
    'http://localhost:1145',
    'http://127.0.0.1:1145',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173'
  ]),
  allowedExtensions: new Set([
    'txt',
    'pdf',
    'png',
    'jpg',
    'jpeg',
    'gif',
    'mp3',
    'wav',
    'avi',
    'mp4',
    'mov',
    'm4a',
    'webm',
    'aac',
    'flac',
    'mid'
  ])
}

if (config.environment === 'production') {
  const placeholderSecrets = new Set([defaultSecretKey, 'change-this-secret-in-production'])
  if (placeholderSecrets.has(String(config.secretKey).trim())) {
    throw new Error('Refusing to start in production with the default SECRET_KEY placeholder')
  }
  if (config.pgPassword === defaultPostgresPassword) {
    throw new Error('Refusing to start in production with the default PostgreSQL development password')
  }
}

const isInsideBackend = (target) => target === backendDir || target.startsWith(`${backendDir}${path.sep}`)

export const resolveBackend = (...segments) => {
  const target = path.resolve(backendDir, ...segments)
  if (!isInsideBackend(target)) {
    throw new Error(`Path escapes backend directory: ${target}`)
  }
  return target
}
