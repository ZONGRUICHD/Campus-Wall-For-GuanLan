import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const currentFile = fileURLToPath(import.meta.url)

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
  appName: process.env.APP_NAME || '校园墙 API',
  debug: boolEnv('DEBUG', false),
  secretKey: process.env.SECRET_KEY || 'your-secret-key-change-in-production',
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
  pgPassword: process.env.PGPASSWORD || 'campus_wall_dev',
  pgSsl: boolEnv('PGSSL', false),
  maxBodySize: intEnv('MAX_BODY_SIZE', 1024 * 1024),
  maxContentLength: intEnv('MAX_CONTENT_LENGTH', 500 * 1024 * 1024),
  maxChunkSize: intEnv('MAX_CHUNK_SIZE', 10 * 1024 * 1024),
  maxChunkCount: intEnv('MAX_CHUNK_COUNT', 100, { min: 1, max: 10000 }),
  uploadBindingTtlMs: intEnv('UPLOAD_BINDING_TTL_MS', 30 * 60 * 1000, { min: 60 * 1000, max: 24 * 60 * 60 * 1000 }),
  chunkUploadTtlMs: intEnv('CHUNK_UPLOAD_TTL_MS', 24 * 60 * 60 * 1000, { min: 5 * 60 * 1000, max: 7 * 24 * 60 * 60 * 1000 }),
  uploadCleanupIntervalMs: intEnv('UPLOAD_CLEANUP_INTERVAL_MS', 5 * 60 * 1000, { min: 10 * 1000, max: 24 * 60 * 60 * 1000 }),
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
  maxAppIconSize: intEnv('MAX_APP_ICON_SIZE', 5 * 1024 * 1024),
  maxUserImportSize: intEnv('MAX_USER_IMPORT_SIZE', 10 * 1024 * 1024),
  maxUserImportRows: intEnv('MAX_USER_IMPORT_ROWS', 5000, { min: 1, max: 50000 }),
  messagePageSize: intEnv('MESSAGE_PAGE_SIZE', 15),
  maxPublicQuerySize: intEnv('MAX_PUBLIC_QUERY_SIZE', 10000),
  rateLimitLogin: intEnv('RATE_LIMIT_LOGIN', 30, { min: 3, max: 1000 }),
  rateLimitWrite: intEnv('RATE_LIMIT_WRITE', 40, { min: 5, max: 10000 }),
  rateLimitInteraction: intEnv('RATE_LIMIT_INTERACTION', 240, { min: 20, max: 50000 }),
  rateLimitUpload: intEnv('RATE_LIMIT_UPLOAD', 600, { min: 20, max: 50000 }),
  rateLimitFeedback: intEnv('RATE_LIMIT_FEEDBACK', 20, { min: 3, max: 1000 }),
  captchaProvider: String(process.env.CAPTCHA_PROVIDER || 'none').toLowerCase(),
  captchaEnabled: boolEnv('CAPTCHA_ENABLED', String(process.env.CAPTCHA_PROVIDER || 'none').toLowerCase() !== 'none'),
  captchaSiteKey: process.env.CAPTCHA_SITE_KEY || '',
  captchaSecretKey: process.env.CAPTCHA_SECRET_KEY || '',
  captchaTimeoutMs: intEnv('CAPTCHA_TIMEOUT_MS', 8000, { min: 1000, max: 30000 }),
  sessionCookieSameSite: process.env.SESSION_COOKIE_SAMESITE || 'Lax',
  sessionCookieSecure: boolEnv('SESSION_COOKIE_SECURE', false),
  sessionMaxAge: intEnv('SESSION_MAX_AGE', 7 * 24 * 60 * 60),
  allowedOrigins: listEnv('ALLOWED_ORIGINS', [
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
    'webp',
    'mp3',
    'wav',
    'avi',
    'mp4',
    'mov',
    'm4a',
    'webm',
    'aac',
    'flac',
    'mid',
    'apk'
  ])
}

const isInsideBackend = (target) => target === backendDir || target.startsWith(`${backendDir}${path.sep}`)

export const resolveBackend = (...segments) => {
  const target = path.resolve(backendDir, ...segments)
  if (!isInsideBackend(target)) {
    throw new Error(`Path escapes backend directory: ${target}`)
  }
  return target
}
