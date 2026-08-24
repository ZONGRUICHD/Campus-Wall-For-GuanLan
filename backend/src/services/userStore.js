import fs from 'node:fs'
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { createPostgresPool } from './postgres.js'
import { config, resolveBackend } from '../config.js'
import { safeBasename } from './fileTools.js'

const scrypt = promisify(scryptCallback)
export const userSessionCookieName = 'user_session'

const base64url = (value) => Buffer.from(value).toString('base64url')
const sign = (payload) => createHmac('sha256', config.secretKey).update(payload).digest('base64url')
const normalizeUsername = (value = '') => String(value || '').trim()
const cleanText = (value = '', max = 80) => String(value || '')
  .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]*>/g, '')
  .replace(/[<>\x00-\x1F\x7F]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max)
const statuses = new Set(['active', 'disabled'])
const parseId = (value) => {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

const isFuture = (value) => {
  if (!value) return false
  const time = new Date(value).getTime()
  return Number.isFinite(time) && time > Date.now()
}

const pickCell = (row, keys) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key]
  }
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [String(key).trim().toLowerCase(), value]))
  for (const key of keys) {
    const value = normalized[String(key).trim().toLowerCase()]
    if (value !== undefined && value !== null) return value
  }
  return ''
}

export const userCookieOptions = () => ({
  maxAge: config.sessionMaxAge * 1000,
  path: '/',
  httpOnly: true,
  sameSite: config.sessionCookieSameSite.toLowerCase(),
  secure: config.sessionCookieSecure
})

export class UserStore {
  constructor() {
    this.pool = createPostgresPool()
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        real_name TEXT NOT NULL DEFAULT '',
        nickname TEXT NOT NULL DEFAULT '',
        gender SMALLINT NOT NULL DEFAULT 0,
        bio TEXT NOT NULL DEFAULT '',
        avatar_file TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        muted_until TIMESTAMPTZ,
        mute_reason TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login_at TIMESTAMPTZ,
        session_version INTEGER NOT NULL DEFAULT 0
      );

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';

      CREATE INDEX IF NOT EXISTS users_username_idx ON users(username);
      CREATE INDEX IF NOT EXISTS users_status_idx ON users(status);
      CREATE INDEX IF NOT EXISTS users_muted_until_idx ON users(muted_until);

      CREATE TABLE IF NOT EXISTS user_favorites (
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, message_id)
      );

      CREATE INDEX IF NOT EXISTS user_favorites_user_created_idx
        ON user_favorites(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS user_notifications (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        message_id BIGINT REFERENCES messages(id) ON DELETE CASCADE,
        actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        content TEXT NOT NULL DEFAULT '',
        is_read BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx
        ON user_notifications(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS user_notifications_user_unread_idx
        ON user_notifications(user_id, is_read) WHERE is_read = false;
    `)
  }

  avatarUrl(user) {
    return `/api/user/${user.id}/avatar`
  }

  publicUser(row) {
    if (!row) return null
    const realName = cleanText(row.real_name || '', 80)
    const nickname = cleanText(row.nickname || realName || `用户${row.id}`, 40) || `用户${row.id}`
    return {
      id: Number(row.id),
      username: row.username,
      real_name: realName,
      nickname,
      gender: Number(row.gender || 0),
      bio: cleanText(row.bio || '', 200),
      avatar_url: this.avatarUrl(row),
      status: row.status || 'active',
      muted_until: row.muted_until,
      mute_reason: row.mute_reason || '',
      is_muted: isFuture(row.muted_until),
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_login_at: row.last_login_at
    }
  }

  publicProfile(row) {
    const user = this.publicUser(row)
    if (!user) return null
    return {
      id: user.id,
      nickname: user.nickname,
      gender: user.gender,
      bio: user.bio,
      avatar_url: user.avatar_url,
      status: user.status,
      created_at: user.created_at
    }
  }

  async hashPassword(password, salt = randomBytes(16).toString('hex')) {
    const hash = await scrypt(String(password || ''), salt, 64)
    return { salt, hash: hash.toString('hex') }
  }

  async verifyPassword(password, salt, expectedHash) {
    const { hash } = await this.hashPassword(password, salt)
    const actual = Buffer.from(hash, 'hex')
    const expected = Buffer.from(String(expectedHash || ''), 'hex')
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }

  createSession(user, sessionVersion = user?.session_version || 0) {
    const payload = base64url(JSON.stringify({
      user_id: Number(user.id),
      username: user.username,
      session_version: Number(sessionVersion) || 0,
      exp: Date.now() + config.sessionMaxAge * 1000
    }))
    return `${payload}.${sign(payload)}`
  }

  readSessionPayload(req) {
    const raw = req.cookies?.[userSessionCookieName]
    if (!raw || !raw.includes('.')) return null
    const [payload, signature] = raw.split('.')
    const expected = sign(payload)
    const actualBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expected)
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      if (!Number.isFinite(Number(data.exp)) || Number(data.exp) < Date.now()) return null
      return data
    } catch {
      return null
    }
  }

  async getSessionUser(req) {
    const data = this.readSessionPayload(req)
    if (!data?.user_id) return null
    const row = await this.getRawById(data.user_id)
    if (!row || row.status !== 'active') return null
    if (Number(data.session_version || 0) !== Number(row.session_version || 0)) return null
    return this.publicUser(row)
  }

  async getById(id) {
    const userId = parseId(id)
    if (!userId) return null
    const result = await this.pool.query('SELECT * FROM users WHERE id = $1', [userId])
    return this.publicUser(result.rows[0])
  }

  async getRawById(id) {
    const userId = parseId(id)
    if (!userId) return null
    const result = await this.pool.query('SELECT * FROM users WHERE id = $1', [userId])
    return result.rows[0] || null
  }

  async getRawByUsername(username) {
    const result = await this.pool.query('SELECT * FROM users WHERE username = $1', [normalizeUsername(username)])
    return result.rows[0] || null
  }

  async getPublicProfile(id) {
    const row = await this.getRawById(id)
    return this.publicProfile(row)
  }

  async login(username, password) {
    const user = await this.getRawByUsername(username)
    if (!user || user.status !== 'active') return null
    const ok = await this.verifyPassword(password, user.password_salt, user.password_hash)
    if (!ok) return null
    const updated = await this.pool.query('UPDATE users SET last_login_at = now() WHERE id = $1 RETURNING *', [user.id])
    return {
      user: this.publicUser(updated.rows[0]),
      sessionVersion: Number(updated.rows[0].session_version || 0)
    }
  }

  async updateProfile(userId, { nickname, gender, bio }) {
    const id = parseId(userId)
    if (!id) return null
    const nextGender = [0, 1, 2].includes(Number(gender)) ? Number(gender) : 0
    const nextNickname = cleanText(nickname, 40)
    const nextBio = cleanText(bio, 200)
    const result = await this.pool.query(
      `UPDATE users
       SET nickname = COALESCE(NULLIF($2, ''), nickname),
           gender = $3,
           bio = $4,
           updated_at = now()
       WHERE id = $1 AND status = 'active'
       RETURNING *`,
      [id, nextNickname, nextGender, nextBio]
    )
    return this.publicUser(result.rows[0])
  }

  async updateAvatar(userId, filename) {
    const id = parseId(userId)
    if (!id) return null
    const result = await this.pool.query(
      'UPDATE users SET avatar_file = $2, updated_at = now() WHERE id = $1 AND status = $3 RETURNING *',
      [id, safeBasename(filename), 'active']
    )
    return this.publicUser(result.rows[0])
  }

  async favoriteMessage(userId, messageId) {
    const id = parseId(userId)
    const targetId = parseId(messageId)
    if (!id || !targetId) return false
    await this.pool.query(
      `INSERT INTO user_favorites (user_id, message_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, message_id) DO NOTHING`,
      [id, targetId]
    )
    return true
  }

  async unfavoriteMessage(userId, messageId) {
    const id = parseId(userId)
    const targetId = parseId(messageId)
    if (!id || !targetId) return false
    const result = await this.pool.query(
      'DELETE FROM user_favorites WHERE user_id = $1 AND message_id = $2',
      [id, targetId]
    )
    return result.rowCount > 0
  }

  async favoriteIds(userId) {
    const id = parseId(userId)
    if (!id) return []
    const result = await this.pool.query(
      `SELECT f.message_id
       FROM user_favorites f
       JOIN messages m ON m.id = f.message_id
       WHERE f.user_id = $1
         AND COALESCE(m.data->>'moderation_status', 'visible') = 'visible'
         AND COALESCE(m.data->>'review_status', 'approved') = 'approved'
       ORDER BY f.created_at DESC`,
      [id]
    )
    return result.rows.map((row) => Number(row.message_id))
  }

  async listFavorites(userId, { page = 1, pageSize = 10 } = {}) {
    const id = parseId(userId)
    if (!id) return { messages: [], page: 1, page_size: 10, total: 0, total_pages: 0 }
    const safePage = Math.max(1, Number(page) || 1)
    const safePageSize = Math.max(1, Math.min(Number(pageSize) || 10, 50))
    const offset = (safePage - 1) * safePageSize
    const total = await this.pool.query(
      `SELECT count(*)::int AS count
       FROM user_favorites f
       JOIN messages m ON m.id = f.message_id
       WHERE f.user_id = $1
         AND COALESCE(m.data->>'moderation_status', 'visible') = 'visible'
         AND COALESCE(m.data->>'review_status', 'approved') = 'approved'`,
      [id]
    )
    const rows = await this.pool.query(
      `SELECT m.data, f.created_at AS favorited_at
       FROM user_favorites f
       JOIN messages m ON m.id = f.message_id
       WHERE f.user_id = $1
         AND COALESCE(m.data->>'moderation_status', 'visible') = 'visible'
         AND COALESCE(m.data->>'review_status', 'approved') = 'approved'
       ORDER BY f.created_at DESC
       LIMIT $2 OFFSET $3`,
      [id, safePageSize, offset]
    )
    const count = total.rows[0]?.count || 0
    return {
      messages: rows.rows.map((row) => ({
        ...(typeof row.data === 'string' ? JSON.parse(row.data) : JSON.parse(JSON.stringify(row.data))),
        favorited_at: row.favorited_at
      })),
      page: safePage,
      page_size: safePageSize,
      total: count,
      total_pages: Math.ceil(count / safePageSize)
    }
  }

  notification(row) {
    if (!row) return null
    return {
      id: Number(row.id),
      type: row.type,
      message_id: row.message_id === null ? null : Number(row.message_id),
      content: cleanText(row.content || '', 200),
      is_read: Boolean(row.is_read),
      created_at: row.created_at
    }
  }

  async createNotification({ userId, type = 'comment', messageId = null, actorUserId = null, content = '' }) {
    const ownerId = parseId(userId)
    const targetId = messageId === null ? null : parseId(messageId)
    const actorId = actorUserId === null ? null : parseId(actorUserId)
    if (!ownerId || (actorId && actorId === ownerId)) return null
    const result = await this.pool.query(
      `INSERT INTO user_notifications (user_id, type, message_id, actor_user_id, content)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [ownerId, cleanText(type, 40) || 'comment', targetId, actorId, cleanText(content, 200)]
    )
    return this.notification(result.rows[0])
  }

  async listNotifications(userId, { page = 1, pageSize = 20 } = {}) {
    const id = parseId(userId)
    if (!id) return { notifications: [], page: 1, page_size: 20, total: 0, total_pages: 0, unread: 0 }
    const safePage = Math.max(1, Number(page) || 1)
    const safePageSize = Math.max(1, Math.min(Number(pageSize) || 20, 50))
    const offset = (safePage - 1) * safePageSize
    const counts = await this.pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE is_read = false)::int AS unread
       FROM user_notifications
       WHERE user_id = $1`,
      [id]
    )
    const rows = await this.pool.query(
      `SELECT * FROM user_notifications
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [id, safePageSize, offset]
    )
    const total = counts.rows[0]?.total || 0
    return {
      notifications: rows.rows.map((row) => this.notification(row)),
      page: safePage,
      page_size: safePageSize,
      total,
      total_pages: Math.ceil(total / safePageSize),
      unread: counts.rows[0]?.unread || 0
    }
  }

  async unreadNotificationCount(userId) {
    const id = parseId(userId)
    if (!id) return 0
    const result = await this.pool.query(
      'SELECT count(*)::int AS count FROM user_notifications WHERE user_id = $1 AND is_read = false',
      [id]
    )
    return result.rows[0]?.count || 0
  }

  async markNotificationRead(userId, notificationId) {
    const id = parseId(userId)
    const targetId = parseId(notificationId)
    if (!id || !targetId) return false
    const result = await this.pool.query(
      `UPDATE user_notifications
       SET is_read = true
       WHERE id = $1 AND user_id = $2`,
      [targetId, id]
    )
    return result.rowCount > 0
  }

  async markAllNotificationsRead(userId) {
    const id = parseId(userId)
    if (!id) return 0
    const result = await this.pool.query(
      `UPDATE user_notifications
       SET is_read = true
       WHERE user_id = $1 AND is_read = false`,
      [id]
    )
    return result.rowCount
  }

  async deleteNotification(userId, notificationId) {
    const id = parseId(userId)
    const targetId = parseId(notificationId)
    if (!id || !targetId) return false
    const result = await this.pool.query(
      'DELETE FROM user_notifications WHERE id = $1 AND user_id = $2',
      [targetId, id]
    )
    return result.rowCount > 0
  }

  async clearNotifications(userId) {
    const id = parseId(userId)
    if (!id) return 0
    const result = await this.pool.query('DELETE FROM user_notifications WHERE user_id = $1', [id])
    return result.rowCount
  }

  async changePassword(userId, currentPassword, newPassword) {
    const id = parseId(userId)
    if (!id) return { success: false, error: '用户不存在' }
    const row = await this.getRawById(id)
    if (!row || row.status !== 'active') return { success: false, error: '用户不存在或已停用' }
    const matches = await this.verifyPassword(currentPassword, row.password_salt, row.password_hash)
    if (!matches) return { success: false, error: '当前密码错误' }
    const { salt, hash } = await this.hashPassword(newPassword)
    const updated = await this.pool.query(
      `UPDATE users
       SET password_hash = $2,
           password_salt = $3,
           session_version = session_version + 1,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, hash, salt]
    )
    return {
      success: true,
      user: this.publicUser(updated.rows[0]),
      sessionVersion: Number(updated.rows[0].session_version || 0)
    }
  }

  async adminUpdateUser(userId, data = {}) {
    const id = parseId(userId)
    if (!id) return null
    const status = statuses.has(data.status) ? data.status : 'active'
    const gender = [0, 1, 2].includes(Number(data.gender)) ? Number(data.gender) : 0
    const result = await this.pool.query(
      `UPDATE users
       SET real_name = $2,
           nickname = $3,
           gender = $4,
           bio = $5,
           status = $6,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, cleanText(data.real_name, 80), cleanText(data.nickname, 40), gender, cleanText(data.bio, 200), status]
    )
    return this.publicUser(result.rows[0])
  }

  async setMute(userId, mutedUntil, reason = '') {
    const id = parseId(userId)
    if (!id) return null
    const result = await this.pool.query(
      `UPDATE users
       SET muted_until = $2,
           mute_reason = $3,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, mutedUntil || null, cleanText(reason, 200)]
    )
    return this.publicUser(result.rows[0])
  }

  async unmute(userId) {
    return this.setMute(userId, null, '')
  }

  async disable(userId) {
    const id = parseId(userId)
    if (!id) return null
    const result = await this.pool.query(
      `UPDATE users
       SET status = 'disabled',
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id]
    )
    return this.publicUser(result.rows[0])
  }

  async resetPassword(userId, password) {
    const id = parseId(userId)
    if (!id) return null
    const { salt, hash } = await this.hashPassword(password)
    const result = await this.pool.query(
      `UPDATE users
       SET password_hash = $2,
           password_salt = $3,
           session_version = session_version + 1,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, hash, salt]
    )
    return this.publicUser(result.rows[0])
  }

  async listUsers({ page = 1, pageSize = 20, q = '', status = '', muted = '' } = {}) {
    const clauses = []
    const values = []
    const add = (value) => {
      values.push(value)
      return `$${values.length}`
    }

    const search = cleanText(q, 80)
    if (search) {
      const slot = add(`%${search}%`)
      clauses.push(`(username ILIKE ${slot} OR real_name ILIKE ${slot} OR nickname ILIKE ${slot})`)
    }
    if (statuses.has(status)) {
      clauses.push(`status = ${add(status)}`)
    }
    if (muted === 'true') {
      clauses.push('muted_until IS NOT NULL AND muted_until > now()')
    } else if (muted === 'false') {
      clauses.push('(muted_until IS NULL OR muted_until <= now())')
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const safePage = Math.max(1, Number(page) || 1)
    const safePageSize = Math.max(1, Math.min(Number(pageSize) || 20, 100))
    const offset = (safePage - 1) * safePageSize
    const total = await this.pool.query(`SELECT count(*)::int AS count FROM users ${where}`, values)
    const rows = await this.pool.query(
      `SELECT * FROM users ${where} ORDER BY created_at DESC, id DESC LIMIT ${add(safePageSize)} OFFSET ${add(offset)}`,
      values
    )
    const count = total.rows[0]?.count || 0
    return {
      users: rows.rows.map((row) => this.publicUser(row)),
      page: safePage,
      page_size: safePageSize,
      total: count,
      total_pages: Math.ceil(count / safePageSize)
    }
  }

  async stats() {
    const result = await this.pool.query(`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status = 'active')::int AS active,
        count(*) FILTER (WHERE status = 'disabled')::int AS disabled,
        count(*) FILTER (WHERE muted_until IS NOT NULL AND muted_until > now())::int AS muted
      FROM users
    `)
    return result.rows[0] || { total: 0, active: 0, disabled: 0, muted: 0 }
  }

  async importUsers(rows) {
    const result = { success: true, created: 0, updated: 0, skipped: 0, errors: [] }
    const items = rows.slice(0, config.maxUserImportRows)

    for (let index = 0; index < items.length; index += 1) {
      const row = items[index] || {}
      const username = normalizeUsername(pickCell(row, ['username', '学号']))
      const password = String(pickCell(row, ['password', '密码']) || '').trim()
      const realName = cleanText(pickCell(row, ['real_name', 'realName', '姓名']), 80)
      const rowNumber = index + 2

      if (!username) {
        result.skipped += 1
        result.errors.push({ row: rowNumber, reason: '学号为空' })
        continue
      }
      if (!realName) {
        result.skipped += 1
        result.errors.push({ row: rowNumber, reason: '姓名为空' })
        continue
      }

      const existing = await this.getRawByUsername(username)
      if (!existing && !password) {
        result.skipped += 1
        result.errors.push({ row: rowNumber, reason: '新账号缺少初始密码' })
        continue
      }

      try {
        if (existing) {
          if (password) {
            const { salt, hash } = await this.hashPassword(password)
            await this.pool.query(
              `UPDATE users
               SET real_name = $2,
                   nickname = COALESCE(NULLIF(nickname, ''), $2),
                   password_hash = $3,
                   password_salt = $4,
                   session_version = session_version + 1,
                   updated_at = now()
               WHERE id = $1`,
              [existing.id, realName, hash, salt]
            )
          } else {
            await this.pool.query(
              `UPDATE users
               SET real_name = $2,
                   nickname = COALESCE(NULLIF(nickname, ''), $2),
                   updated_at = now()
               WHERE id = $1`,
              [existing.id, realName]
            )
          }
          result.updated += 1
          continue
        }

        const { salt, hash } = await this.hashPassword(password)
        await this.pool.query(
          `INSERT INTO users (username, password_hash, password_salt, real_name, nickname)
           VALUES ($1, $2, $3, $4, $4)`,
          [username, hash, salt, realName]
        )
        result.created += 1
      } catch (error) {
        result.skipped += 1
        result.errors.push({ row: rowNumber, reason: error.message || '导入失败' })
      }
    }

    if (rows.length > config.maxUserImportRows) {
      result.errors.push({ row: config.maxUserImportRows + 2, reason: `单次最多导入 ${config.maxUserImportRows} 行` })
    }

    return result
  }

  async avatarFile(userId) {
    const row = await this.getRawById(userId)
    if (row?.avatar_file) {
      const filePath = resolveBackend(config.avatarFolder, safeBasename(row.avatar_file))
      if (fs.existsSync(filePath)) return filePath
    }
    return null
  }
}

export const userStore = new UserStore()
