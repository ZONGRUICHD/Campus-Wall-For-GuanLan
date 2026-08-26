import fs from 'node:fs'
import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { createPostgresPool } from './postgres.js'
import { config, resolveBackend } from '../config.js'
import { safeBasename } from './fileTools.js'
import {
  accountRoles,
  canPasswordLogin,
  legacyPermissionsForCapabilities,
  missingCapabilityDependencies,
  normalizeRole,
  overridesLockedForRole,
  resolvePermissionState,
  validatePermissionOverrideLists
} from './roles.js'

const scrypt = promisify(scryptCallback)
export const userSessionCookieName = 'user_session'

const base64url = (value) => Buffer.from(value).toString('base64url')
const sign = (payload) => createHmac('sha256', config.secretKey).update(payload).digest('base64url')
export const normalizeUsername = (value = '') => String(value || '').normalize('NFKC').trim()
const usernameKey = (value = '') => normalizeUsername(value).toLowerCase()
const usernamePattern = /^[\p{L}\p{N}_.-]+$/u
export const validateUsername = (value = '') => {
  const username = normalizeUsername(value)
  const length = Array.from(username).length
  if (length < 2 || length > 24 || !usernamePattern.test(username)) {
    return { success: false, error: '用户名需为 2-24 位中文、字母、数字、点、下划线或短横线' }
  }
  return { success: true, username, usernameKey: usernameKey(username) }
}
export const feishuUsernameForOpenId = (openId, hexLength = 16) => {
  const digest = createHash('sha256').update(String(openId || '')).digest('hex')
  const size = Math.max(16, Math.min(21, Number(hexLength) || 16))
  return `fs_${digest.slice(0, size)}`
}
const reservedFeishuUsername = (value = '') => /^fs_[a-f0-9]{16,21}$/i.test(String(value || '').trim())
const staffRoles = new Set(['reviewer', 'admin', 'super_admin'])
const cleanText = (value = '', max = 80) => String(value || '')
  .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]*>/g, '')
  .replace(/[<>\x00-\x1F\x7F]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max)
const statuses = new Set(['active', 'disabled'])
const userWithOverridesSelect = `
  SELECT u.*,
         COALESCE((
           SELECT jsonb_object_agg(o.permission_key, o.effect)
           FROM user_permission_overrides o
           WHERE o.user_id = u.id
         ), '{}'::jsonb) AS permission_overrides
  FROM users u
`
const legacyManagerRole = (manager = {}) => {
  const permissions = Array.isArray(manager.permissions)
    ? manager.permissions.map((permission) => typeof permission === 'string' ? permission : permission?.name)
    : []
  if (permissions.includes('manage_admins')) return 'super_admin'
  if (permissions.includes('review_posts')) return 'reviewer'
  return 'admin'
}
const parseId = (value) => {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

const isFuture = (value) => {
  if (!value) return false
  const time = new Date(value).getTime()
  return Number.isFinite(time) && time > Date.now()
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
        username_key TEXT,
        password_hash TEXT,
        password_salt TEXT,
        feishu_open_id TEXT,
        feishu_user_id TEXT,
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
        session_version INTEGER NOT NULL DEFAULT 0,
        permission_version BIGINT NOT NULL DEFAULT 0,
        role TEXT NOT NULL DEFAULT 'user'
      );

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS username_key TEXT;

      UPDATE users
      SET username_key = lower(trim(username))
      WHERE username_key IS NULL OR username_key = '';

      ALTER TABLE users
        ALTER COLUMN username_key SET NOT NULL;

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

      UPDATE users
      SET role = 'user'
      WHERE role NOT IN ('user', 'reviewer', 'admin', 'super_admin');

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'users_role_check'
            AND conrelid = 'users'::regclass
        ) THEN
          ALTER TABLE users
            ADD CONSTRAINT users_role_check
            CHECK (role IN ('user', 'reviewer', 'admin', 'super_admin'));
        END IF;
      END $$;

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS permission_version BIGINT NOT NULL DEFAULT 0;

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';

      ALTER TABLE users
        ALTER COLUMN password_hash DROP NOT NULL;

      ALTER TABLE users
        ALTER COLUMN password_salt DROP NOT NULL;

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS feishu_open_id TEXT;

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS feishu_user_id TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS users_feishu_open_id_uidx
        ON users(feishu_open_id)
        WHERE feishu_open_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS users_username_idx ON users(username);
      CREATE UNIQUE INDEX IF NOT EXISTS users_username_key_uidx ON users(username_key);
      CREATE INDEX IF NOT EXISTS users_status_idx ON users(status);
      CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);
      CREATE INDEX IF NOT EXISTS users_muted_until_idx ON users(muted_until);
      CREATE INDEX IF NOT EXISTS users_created_id_idx
        ON users(created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS users_role_status_created_idx
        ON users(role, status, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS users_last_login_id_idx
        ON users(last_login_at DESC NULLS LAST, id DESC);
      CREATE INDEX IF NOT EXISTS users_username_key_pattern_idx
        ON users(username_key text_pattern_ops);
      CREATE INDEX IF NOT EXISTS users_nickname_lower_pattern_idx
        ON users(lower(nickname) text_pattern_ops);
      CREATE INDEX IF NOT EXISTS users_real_name_lower_pattern_idx
        ON users(lower(real_name) text_pattern_ops);

      CREATE TABLE IF NOT EXISTS user_permission_overrides (
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permission_key TEXT NOT NULL,
        effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
        created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
        updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, permission_key)
      );

      CREATE INDEX IF NOT EXISTS user_permission_overrides_user_idx
        ON user_permission_overrides(user_id);

      DELETE FROM user_permission_overrides overrides
      USING users
      WHERE overrides.user_id = users.id
        AND users.role IN ('reviewer', 'super_admin');

      CREATE TABLE IF NOT EXISTS legacy_manager_migrations (
        username_key TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        migrated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

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
    const existingUsers = await this.pool.query('SELECT id, username, username_key FROM users ORDER BY id')
    for (const row of existingUsers.rows) {
      const canonicalKey = usernameKey(row.username)
      if (canonicalKey === row.username_key) continue
      try {
        await this.pool.query('UPDATE users SET username_key = $2 WHERE id = $1', [row.id, canonicalKey])
      } catch (error) {
        if (error?.code === '23505') {
          throw new Error(`Username normalization conflict must be resolved before startup: ${row.username}`)
        }
        throw error
      }
    }
  }

  avatarUrl(user) {
    return `/api/user/${user.id}/avatar`
  }

  publicUser(row) {
    if (!row) return null
    const realName = cleanText(row.real_name || '', 80)
    const nickname = cleanText(row.nickname || realName || `用户${row.id}`, 40) || `用户${row.id}`
    const permissionState = resolvePermissionState({
      role: row.role,
      overrides: row.permission_overrides
    })
    return {
      id: Number(row.id),
      username: row.username,
      role: normalizeRole(row.role),
      permissions: legacyPermissionsForCapabilities(permissionState.effective),
      capabilities: permissionState.effective,
      permission_version: Number(row.permission_version || 0),
      permission_customized: permissionState.customized,
      permission_allow_count: permissionState.allow.length,
      permission_deny_count: permissionState.deny.length,
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
      last_login_at: row.last_login_at,
      has_password: Boolean(row.password_hash && row.password_salt),
      feishu_login: Boolean(row.feishu_open_id)
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
      created_at: user.created_at
    }
  }

  async hashPassword(password, salt = randomBytes(16).toString('hex')) {
    const hash = await scrypt(String(password || ''), salt, 64)
    return { salt, hash: hash.toString('hex') }
  }

  async verifyPassword(password, salt, expectedHash) {
    if (!salt || !expectedHash) return false
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

  readSessionPayload(req, cookieName = userSessionCookieName) {
    const raw = req.cookies?.[cookieName]
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

  async getSessionUser(req, { cookieNames = [userSessionCookieName] } = {}) {
    for (const cookieName of cookieNames) {
      const data = this.readSessionPayload(req, cookieName)
      if (!data?.user_id) continue
      const row = await this.getRawById(data.user_id)
      if (!row || row.status !== 'active') continue
      if (Number(data.session_version || 0) !== Number(row.session_version || 0)) continue
      if (usernameKey(data.username) !== row.username_key) continue
      return this.publicUser(row)
    }
    return null
  }

  async getById(id) {
    return this.publicUser(await this.getRawById(id))
  }

  async getRawById(id) {
    const userId = parseId(id)
    if (!userId) return null
    const result = await this.pool.query(`${userWithOverridesSelect} WHERE u.id = $1`, [userId])
    return result.rows[0] || null
  }

  async getRawByUsername(username) {
    const result = await this.pool.query(`${userWithOverridesSelect} WHERE u.username_key = $1`, [usernameKey(username)])
    return result.rows[0] || null
  }

  async getRawByFeishuOpenId(openId) {
    const value = String(openId || '').trim()
    if (!value) return null
    const result = await this.pool.query(`${userWithOverridesSelect} WHERE u.feishu_open_id = $1`, [value])
    return result.rows[0] || null
  }

  async getPublicProfile(id) {
    const row = await this.getRawById(id)
    if (!row || row.status !== 'active') return null
    return this.publicProfile(row)
  }

  async register(usernameInput, passwordInput) {
    const usernameResult = validateUsername(usernameInput)
    if (!usernameResult.success) return usernameResult
    const password = String(passwordInput || '')
    if (password.length < 8 || password.length > 128) {
      return { success: false, error: '密码长度需要在 8 到 128 个字符之间' }
    }
    const { salt, hash } = await this.hashPassword(password)
    try {
      const result = await this.pool.query(
        `INSERT INTO users (username, username_key, password_hash, password_salt, nickname, role)
         VALUES ($1, $2, $3, $4, $1, 'user')
         RETURNING *`,
        [usernameResult.username, usernameResult.usernameKey, hash, salt]
      )
      const row = result.rows[0]
      return {
        success: true,
        user: this.publicUser(row),
        sessionVersion: Number(row.session_version || 0)
      }
    } catch (error) {
      if (error?.code === '23505') return { success: false, error: '注册失败，请检查用户名与密码' }
      throw error
    }
  }

  async login(username, password) {
    const user = await this.getRawByUsername(username)
    if (!canPasswordLogin(user)) return null
    const ok = await this.verifyPassword(password, user.password_salt, user.password_hash)
    if (!ok) return null
    const updated = await this.pool.query('UPDATE users SET last_login_at = now() WHERE id = $1 RETURNING last_login_at, updated_at, session_version', [user.id])
    const nextUser = {
      ...user,
      last_login_at: updated.rows[0]?.last_login_at,
      updated_at: updated.rows[0]?.updated_at,
      session_version: updated.rows[0]?.session_version
    }
    return {
      user: this.publicUser(nextUser),
      sessionVersion: Number(updated.rows[0]?.session_version || 0)
    }
  }

  async upsertFeishuUser({ openId, userId = '', name = '' } = {}) {
    const feishuOpenId = String(openId || '').trim()
    if (!feishuOpenId || feishuOpenId.length > 128) return { success: false, error: '飞书账号无效' }
    const feishuUserId = cleanText(userId, 64)
    const nickname = cleanText(name, 40) || '飞书用户'
    const existing = await this.getRawByFeishuOpenId(feishuOpenId)
    if (existing) {
      if (existing.status !== 'active') return { success: false, code: 'disabled', error: '账号已停用' }
      const updated = await this.pool.query(
        `UPDATE users
         SET nickname = COALESCE(NULLIF($2, ''), nickname),
             feishu_user_id = COALESCE(NULLIF($3, ''), feishu_user_id),
             last_login_at = now(),
             updated_at = now()
         WHERE id = $1
         RETURNING last_login_at, updated_at, session_version`,
        [existing.id, nickname, feishuUserId]
      )
      const nextUser = {
        ...existing,
        nickname: nickname || existing.nickname,
        feishu_user_id: feishuUserId || existing.feishu_user_id,
        last_login_at: updated.rows[0]?.last_login_at,
        updated_at: updated.rows[0]?.updated_at,
        session_version: updated.rows[0]?.session_version
      }
      return {
        success: true,
        user: this.publicUser(nextUser),
        sessionVersion: Number(updated.rows[0]?.session_version || 0)
      }
    }

    const lengths = [16, 18, 20, 21]
    for (const length of lengths) {
      const username = feishuUsernameForOpenId(feishuOpenId, length)
      const usernameResult = validateUsername(username)
      if (!usernameResult.success) continue
      try {
        const result = await this.pool.query(
          `INSERT INTO users (
             username, username_key, password_hash, password_salt, nickname, role,
             feishu_open_id, feishu_user_id, last_login_at
           ) VALUES ($1, $2, NULL, NULL, $3, 'user', $4, $5, now())
           RETURNING *`,
          [usernameResult.username, usernameResult.usernameKey, nickname, feishuOpenId, feishuUserId]
        )
        const row = result.rows[0]
        return {
          success: true,
          user: this.publicUser(row),
          sessionVersion: Number(row.session_version || 0)
        }
      } catch (error) {
        if (error?.code !== '23505') throw error
        const raced = await this.getRawByFeishuOpenId(feishuOpenId)
        if (raced) {
          if (raced.status !== 'active') return { success: false, code: 'disabled', error: '账号已停用' }
          return {
            success: true,
            user: this.publicUser(raced),
            sessionVersion: Number(raced.session_version || 0)
          }
        }
      }
    }
    return { success: false, error: '无法创建飞书账号' }
  }

  async createStaffUser({ username, password, role, nickname = '' } = {}, { actorId } = {}) {
    const nextRole = normalizeRole(role)
    if (!staffRoles.has(nextRole)) {
      return { success: false, statusCode: 400, error: '只能创建审核员、管理员或超级管理员' }
    }
    const usernameResult = validateUsername(username)
    if (!usernameResult.success) {
      return { success: false, statusCode: 400, error: usernameResult.error }
    }
    if (reservedFeishuUsername(usernameResult.username)) {
      return { success: false, statusCode: 400, error: '该用户名由飞书登录保留' }
    }
    const passwordValue = String(password || '')
    if (passwordValue.length < 8 || passwordValue.length > 128) {
      return { success: false, statusCode: 400, error: '密码长度需要在 8 到 128 个字符之间' }
    }
    const actorUserId = parseId(actorId)
    if (!actorUserId) return { success: false, statusCode: 403, error: '只有超级管理员可以创建管理员账号' }
    const displayName = cleanText(nickname, 40) || usernameResult.username
    const { salt, hash } = await this.hashPassword(passwordValue)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')
      const actorResult = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [actorUserId])
      const actor = actorResult.rows[0]
      if (!actor || actor.status !== 'active' || normalizeRole(actor.role) !== 'super_admin') {
        await client.query('ROLLBACK')
        return { success: false, statusCode: 403, error: '只有超级管理员可以创建管理员账号' }
      }
      if (Number(actor.id) === Number(actorUserId) && usernameKey(actor.username) === usernameResult.usernameKey) {
        await client.query('ROLLBACK')
        return { success: false, statusCode: 400, error: '不能为自己创建重复账号' }
      }
      try {
        const inserted = await client.query(
          `INSERT INTO users (username, username_key, password_hash, password_salt, nickname, role)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [usernameResult.username, usernameResult.usernameKey, hash, salt, displayName, nextRole]
        )
        await client.query('COMMIT')
        const row = inserted.rows[0]
        return { success: true, user: this.publicUser(row) }
      } catch (error) {
        await client.query('ROLLBACK')
        if (error?.code === '23505') {
          return { success: false, statusCode: 400, error: '创建失败，请检查用户名' }
        }
        throw error
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async migrateLegacyManagers(managers = {}) {
    const items = Object.values(managers && typeof managers === 'object' ? managers : {})
    const result = { migrated: 0, skipped: 0 }
    for (const manager of items) {
      const usernameResult = validateUsername(manager?.username || '')
      const passwordHash = String(manager?.password_hash || '').toLowerCase()
      const passwordSalt = String(manager?.password_salt || '')
      if (!usernameResult.success || !/^[a-f0-9]{128}$/.test(passwordHash) || !passwordSalt) {
        throw new Error(`Legacy manager account cannot be migrated safely: ${manager?.username || 'unknown'}`)
      }
      const client = await this.pool.connect()
      try {
        await client.query('BEGIN')
        const migrated = await client.query(
          'SELECT user_id FROM legacy_manager_migrations WHERE username_key = $1 FOR UPDATE',
          [usernameResult.usernameKey]
        )
        if (migrated.rows[0]) {
          const linked = await client.query('SELECT id FROM users WHERE id = $1', [migrated.rows[0].user_id])
          if (!linked.rows[0]) throw new Error(`Legacy manager migration link is broken: ${usernameResult.username}`)
          await client.query('COMMIT')
          result.skipped += 1
          continue
        }

        const collision = await client.query('SELECT id FROM users WHERE username_key = $1 FOR UPDATE', [usernameResult.usernameKey])
        if (collision.rows[0]) {
          throw new Error(`Legacy manager username conflicts with an existing user: ${usernameResult.username}`)
        }
        const inserted = await client.query(
          `INSERT INTO users (
             username, username_key, password_hash, password_salt, nickname, status, role,
             created_at, updated_at, last_login_at, session_version
           ) VALUES ($1, $2, $3, $4, $1, $5, $6, now(), now(), NULL, $7)
           RETURNING id`,
          [
            usernameResult.username,
            usernameResult.usernameKey,
            passwordHash,
            passwordSalt,
            manager.status === 'disabled' ? 'disabled' : 'active',
            legacyManagerRole(manager),
            Math.max(0, Number(manager.session_version) || 0)
          ]
        )
        await client.query(
          'INSERT INTO legacy_manager_migrations (username_key, user_id) VALUES ($1, $2)',
          [usernameResult.usernameKey, inserted.rows[0].id]
        )
        await client.query('COMMIT')
        result.migrated += 1
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally {
        client.release()
      }
    }
    return result
  }

  async listPrivilegedUsers() {
    const result = await this.pool.query(
      `${userWithOverridesSelect}
       WHERE u.role IN ('reviewer', 'admin', 'super_admin')
       ORDER BY u.role DESC, u.username_key ASC`
    )
    return result.rows.map((row) => this.publicUser(row))
  }

  async roleStats() {
    const result = await this.pool.query(`
      SELECT role, status, count(*)::int AS count
      FROM users
      GROUP BY role, status
    `)
    const counts = Object.fromEntries(accountRoles.map((role) => [role, 0]))
    let active = 0
    let disabled = 0
    for (const row of result.rows) {
      const role = normalizeRole(row.role)
      const count = Number(row.count || 0)
      counts[role] += count
      if (!['reviewer', 'admin', 'super_admin'].includes(role)) continue
      if (row.status === 'disabled') disabled += count
      else active += count
    }
    return {
      ...counts,
      total: counts.reviewer + counts.admin + counts.super_admin,
      active,
      disabled,
      super_admins: counts.super_admin
    }
  }

  async setRole({ actorId, targetId, role }) {
    const actorUserId = parseId(actorId)
    const targetUserId = parseId(targetId)
    const nextRole = String(role || '').trim()
    if (!actorUserId || !targetUserId) return { success: false, statusCode: 404, error: '用户不存在' }
    if (!accountRoles.includes(nextRole)) return { success: false, statusCode: 400, error: '角色无效' }
    if (actorUserId === targetUserId) return { success: false, statusCode: 400, error: '不能修改自己的角色' }

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')
      const actorResult = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [actorUserId])
      const targetResult = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [targetUserId])
      const actor = actorResult.rows[0]
      const target = targetResult.rows[0]
      if (!actor || actor.status !== 'active' || normalizeRole(actor.role) !== 'super_admin') {
        await client.query('ROLLBACK')
        return { success: false, statusCode: 403, error: '只有超级管理员可以分配角色' }
      }
      if (!target) {
        await client.query('ROLLBACK')
        return { success: false, statusCode: 404, error: '用户不存在' }
      }
      const previousRole = normalizeRole(target.role)
      if (previousRole === nextRole) {
        await client.query('COMMIT')
        return { success: true, user: await this.getById(targetUserId), previousRole, changed: false, overridesCleared: false }
      }
      if (previousRole === 'super_admin' && nextRole !== 'super_admin' && target.status === 'active') {
        const count = await client.query(
          "SELECT count(*)::int AS count FROM users WHERE role = 'super_admin' AND status = 'active'"
        )
        if (Number(count.rows[0]?.count || 0) <= 1) {
          await client.query('ROLLBACK')
          return { success: false, statusCode: 409, error: '至少需要保留一位启用的超级管理员' }
        }
      }
      const cleared = await client.query(
        'DELETE FROM user_permission_overrides WHERE user_id = $1',
        [targetUserId]
      )
      const updated = await client.query(
        `UPDATE users
         SET role = $2,
             session_version = session_version + 1,
             permission_version = permission_version + 1,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [targetUserId, nextRole]
      )
      await client.query('COMMIT')
      return {
        success: true,
        user: this.publicUser(updated.rows[0]),
        previousRole,
        changed: true,
        overridesCleared: cleared.rowCount > 0
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  permissionStateForRow(row) {
    if (!row) return null
    const state = resolvePermissionState({ role: row.role, overrides: row.permission_overrides })
    return {
      user_id: Number(row.id),
      username: row.username,
      role: state.role,
      defaults: state.defaults,
      overrides: { allow: state.allow, deny: state.deny },
      effective: state.effective,
      overrides_locked: state.overrides_locked,
      customized: state.customized,
      permission_version: Number(row.permission_version || 0)
    }
  }

  async getPermissionState(userId) {
    return this.permissionStateForRow(await this.getRawById(userId))
  }

  async replacePermissionOverrides({ actorId, targetId, allow = [], deny = [], permissionVersion, reason = '' }) {
    const actorUserId = parseId(actorId)
    const targetUserId = parseId(targetId)
    if (!actorUserId || !targetUserId) return { success: false, statusCode: 404, error: '用户不存在', code: 'USER_NOT_FOUND' }
    if (actorUserId === targetUserId) {
      return { success: false, statusCode: 403, error: '不能修改自己的个人权限', code: 'SELF_PERMISSION_CHANGE_FORBIDDEN' }
    }
    const version = Number(permissionVersion)
    if (!Number.isSafeInteger(version) || version < 0) {
      return { success: false, statusCode: 400, error: '缺少有效的权限版本，请刷新后重试', code: 'INVALID_PERMISSION_VERSION' }
    }
    const safeReason = cleanText(reason, 300)
    if (!safeReason) {
      return { success: false, statusCode: 400, error: '请填写权限调整原因', code: 'PERMISSION_REASON_REQUIRED' }
    }
    const validation = validatePermissionOverrideLists({ allow, deny })
    if (!validation.success) return { ...validation, statusCode: 422 }

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const actorResult = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [actorUserId])
      const targetResult = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [targetUserId])
      const actor = actorResult.rows[0]
      const target = targetResult.rows[0]
      if (!actor || actor.status !== 'active' || normalizeRole(actor.role) !== 'super_admin') {
        await client.query('ROLLBACK')
        return { success: false, statusCode: 403, error: '只有超级管理员可以分配个人权限', code: 'PERMISSION_ASSIGN_FORBIDDEN' }
      }
      if (!target) {
        await client.query('ROLLBACK')
        return { success: false, statusCode: 404, error: '用户不存在', code: 'USER_NOT_FOUND' }
      }
      if (overridesLockedForRole(target.role)) {
        await client.query('ROLLBACK')
        return {
          success: false,
          statusCode: 409,
          error: normalizeRole(target.role) === 'reviewer' ? '所有审核员必须使用统一权限，不能设置个人覆盖' : '超级管理员始终拥有全部权限，不能设置个人覆盖',
          code: 'PERMISSION_OVERRIDES_LOCKED'
        }
      }
      if (Number(target.permission_version || 0) !== version) {
        await client.query('ROLLBACK')
        return { success: false, statusCode: 409, error: '权限已被其他管理员修改，请刷新后重试', code: 'PERMISSION_VERSION_CONFLICT' }
      }

      const currentOverrides = await client.query(
        'SELECT permission_key, effect FROM user_permission_overrides WHERE user_id = $1 ORDER BY permission_key',
        [targetUserId]
      )
      const beforeState = this.permissionStateForRow({ ...target, permission_overrides: currentOverrides.rows })
      const candidateOverrides = Object.fromEntries([
        ...validation.allow.map((key) => [key, 'allow']),
        ...validation.deny.map((key) => [key, 'deny'])
      ])
      const candidateState = resolvePermissionState({ role: target.role, overrides: candidateOverrides })
      const missingDependencies = missingCapabilityDependencies(candidateState.effective)
      if (missingDependencies.length) {
        await client.query('ROLLBACK')
        const first = missingDependencies[0]
        return {
          success: false,
          statusCode: 422,
          error: `权限 ${first.key} 依赖 ${first.dependency}，请一并允许或取消相关权限`,
          code: 'PERMISSION_DEPENDENCY_MISSING',
          missing_dependencies: missingDependencies
        }
      }

      const unchanged = JSON.stringify(beforeState.overrides.allow) === JSON.stringify(validation.allow)
        && JSON.stringify(beforeState.overrides.deny) === JSON.stringify(validation.deny)
      if (unchanged) {
        await client.query('COMMIT')
        return {
          success: true,
          changed: false,
          sessionRevoked: false,
          reason: safeReason,
          state: beforeState,
          previousState: beforeState,
          user: this.publicUser({ ...target, permission_overrides: currentOverrides.rows })
        }
      }

      await client.query('DELETE FROM user_permission_overrides WHERE user_id = $1', [targetUserId])
      const overrideEntries = Object.entries(candidateOverrides)
      if (overrideEntries.length) {
        await client.query(
          `INSERT INTO user_permission_overrides
             (user_id, permission_key, effect, created_by, updated_by)
           SELECT $1, input.permission_key, input.effect, $4, $4
           FROM unnest($2::text[], $3::text[]) AS input(permission_key, effect)`,
          [
            targetUserId,
            overrideEntries.map(([permissionKey]) => permissionKey),
            overrideEntries.map(([, effect]) => effect),
            actorUserId
          ]
        )
      }
      await client.query(
        `UPDATE users
         SET permission_version = permission_version + 1,
             session_version = session_version + 1,
             updated_at = now()
         WHERE id = $1`,
        [targetUserId]
      )
      const updatedResult = await client.query(`${userWithOverridesSelect} WHERE u.id = $1`, [targetUserId])
      const nextState = this.permissionStateForRow(updatedResult.rows[0])
      await client.query('COMMIT')
      return {
        success: true,
        changed: true,
        sessionRevoked: true,
        reason: safeReason,
        state: nextState,
        previousState: beforeState,
        user: this.publicUser(updatedResult.rows[0])
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async bootstrapSuperAdmin(usernameInput, passwordInput) {
    const usernameResult = validateUsername(usernameInput)
    if (!usernameResult.success) return usernameResult
    const password = String(passwordInput || '')
    if (password.length < 8 || password.length > 128) {
      return { success: false, error: '密码长度需要在 8 到 128 个字符之间' }
    }
    const { salt, hash } = await this.hashPassword(password)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')
      const existing = await client.query('SELECT * FROM users WHERE username_key = $1 FOR UPDATE', [usernameResult.usernameKey])
      let row
      if (existing.rows[0]) {
        const updated = await client.query(
          `UPDATE users
           SET password_hash = $2,
               password_salt = $3,
               status = 'active',
               role = 'super_admin',
               session_version = session_version + 1,
               permission_version = permission_version + 1,
               updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [existing.rows[0].id, hash, salt]
        )
        row = updated.rows[0]
        await client.query('DELETE FROM user_permission_overrides WHERE user_id = $1', [row.id])
      } else {
        const inserted = await client.query(
          `INSERT INTO users (username, username_key, password_hash, password_salt, nickname, role)
           VALUES ($1, $2, $3, $4, $1, 'super_admin')
           RETURNING *`,
          [usernameResult.username, usernameResult.usernameKey, hash, salt]
        )
        row = inserted.rows[0]
      }
      await client.query('COMMIT')
      return { success: true, created: !existing.rows[0], user: this.publicUser(row) }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
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
    return result.rows[0] ? this.getById(id) : null
  }

  async updateAvatar(userId, filename) {
    const id = parseId(userId)
    if (!id) return { user: null, previousAvatarFile: '' }
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const current = await client.query(
        'SELECT avatar_file FROM users WHERE id = $1 AND status = $2 FOR UPDATE',
        [id, 'active']
      )
      if (!current.rows[0]) {
        await client.query('ROLLBACK')
        return { user: null, previousAvatarFile: '' }
      }
      const result = await client.query(
        `UPDATE users AS u
         SET avatar_file = $2, updated_at = now()
         WHERE u.id = $1 AND u.status = $3
         RETURNING u.*,
           COALESCE((
             SELECT jsonb_object_agg(o.permission_key, o.effect)
             FROM user_permission_overrides o
             WHERE o.user_id = u.id
           ), '{}'::jsonb) AS permission_overrides`,
        [id, safeBasename(filename), 'active']
      )
      await client.query('COMMIT')
      return {
        user: this.publicUser(result.rows[0]),
        previousAvatarFile: current.rows[0].avatar_file ? safeBasename(current.rows[0].avatar_file) : ''
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async isAvatarReferenced(filename) {
    const cleanFilename = String(filename || '').trim()
    if (!cleanFilename) return false
    const result = await this.pool.query(
      'SELECT 1 FROM users WHERE avatar_file = $1 LIMIT 1',
      [safeBasename(cleanFilename)]
    )
    return result.rowCount > 0
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
    if (!row.password_hash || !row.password_salt) {
      return { success: false, error: '此账号使用飞书登录，不能通过密码修改' }
    }
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
      user: await this.getById(id),
      sessionVersion: Number(updated.rows[0].session_version || 0)
    }
  }

  async adminUpdateUser(userId, data = {}, { requireUserRole = false } = {}) {
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
           session_version = session_version + CASE WHEN status <> $6 THEN 1 ELSE 0 END,
           updated_at = now()
       WHERE id = $1
         AND ($7::boolean = false OR role = 'user')
       RETURNING *`,
      [id, cleanText(data.real_name, 80), cleanText(data.nickname, 40), gender, cleanText(data.bio, 200), status, requireUserRole]
    )
    return result.rows[0] ? this.getById(id) : null
  }

  async setMute(userId, mutedUntil, reason = '', { requireUserRole = false } = {}) {
    const id = parseId(userId)
    if (!id) return null
    const result = await this.pool.query(
      `UPDATE users
       SET muted_until = $2,
           mute_reason = $3,
           updated_at = now()
       WHERE id = $1
         AND ($4::boolean = false OR role = 'user')
       RETURNING *`,
      [id, mutedUntil || null, cleanText(reason, 200), requireUserRole]
    )
    return result.rows[0] ? this.getById(id) : null
  }

  async unmute(userId, options = {}) {
    return this.setMute(userId, null, '', options)
  }

  async disable(userId, { requireUserRole = false } = {}) {
    const id = parseId(userId)
    if (!id) return null
    const result = await this.pool.query(
      `UPDATE users
       SET status = 'disabled',
           session_version = session_version + 1,
           updated_at = now()
       WHERE id = $1
         AND ($2::boolean = false OR role = 'user')
       RETURNING *`,
      [id, requireUserRole]
    )
    return result.rows[0] ? this.getById(id) : null
  }

  async resetPassword(userId, password, { requireUserRole = false } = {}) {
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
         AND ($4::boolean = false OR role = 'user')
       RETURNING *`,
      [id, hash, salt, requireUserRole]
    )
    return result.rows[0] ? this.getById(id) : null
  }

  async listUsers({
    page = 1,
    pageSize = 25,
    q = '',
    status = '',
    muted = '',
    role = '',
    sortBy = 'created_at',
    sortOrder = 'desc'
  } = {}) {
    const clauses = []
    const values = []
    const add = (value) => {
      values.push(value)
      return `$${values.length}`
    }

    const search = cleanText(q, 64).toLowerCase()
    if (search) {
      const escapedPrefix = search.replace(/[\\%_]/g, '\\$&')
      const slot = add(`${escapedPrefix}%`)
      const id = parseId(search)
      clauses.push(`(
        username_key LIKE ${slot} ESCAPE E'\\\\'
        OR lower(nickname) LIKE ${slot} ESCAPE E'\\\\'
        OR lower(real_name) LIKE ${slot} ESCAPE E'\\\\'
        ${id ? `OR id = ${add(id)}` : ''}
      )`)
    }
    if (statuses.has(status)) {
      clauses.push(`status = ${add(status)}`)
    }
    if (accountRoles.includes(role)) {
      clauses.push(`role = ${add(role)}`)
    }
    if (muted === 'true') {
      clauses.push('muted_until IS NOT NULL AND muted_until > now()')
    } else if (muted === 'false') {
      clauses.push('(muted_until IS NULL OR muted_until <= now())')
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const safePage = Math.max(1, Math.trunc(Number(page)) || 1)
    const safePageSize = Math.max(10, Math.min(Math.trunc(Number(pageSize)) || 25, 100))
    const allowedSorts = {
      created_at: {
        asc: 'created_at ASC, id ASC',
        desc: 'created_at DESC, id DESC'
      },
      username: {
        asc: 'username_key ASC, id ASC',
        desc: 'username_key DESC, id DESC'
      },
      last_login_at: {
        asc: 'last_login_at ASC NULLS LAST, id ASC',
        desc: 'last_login_at DESC NULLS LAST, id DESC'
      },
      role: {
        asc: 'role ASC, username_key ASC, id ASC',
        desc: 'role DESC, username_key ASC, id ASC'
      },
      status: {
        asc: 'status ASC, username_key ASC, id ASC',
        desc: 'status DESC, username_key ASC, id ASC'
      }
    }
    const safeSortBy = Object.hasOwn(allowedSorts, sortBy) ? sortBy : 'created_at'
    const safeSortOrder = String(sortOrder).toLowerCase() === 'asc' ? 'asc' : 'desc'
    const orderBy = allowedSorts[safeSortBy][safeSortOrder]

    const counts = await this.pool.query(
      `WITH filtered AS (
         SELECT id FROM users ${where}
       )
       SELECT
         (SELECT count(*)::int FROM filtered) AS filtered_total,
         count(*)::int AS total,
         count(*) FILTER (WHERE status = 'active')::int AS active,
         count(*) FILTER (WHERE status = 'disabled')::int AS disabled,
         count(*) FILTER (WHERE muted_until IS NOT NULL AND muted_until > now())::int AS muted,
         count(*) FILTER (WHERE role = 'user')::int AS role_user,
         count(*) FILTER (WHERE role = 'reviewer')::int AS role_reviewer,
         count(*) FILTER (WHERE role = 'admin')::int AS role_admin,
         count(*) FILTER (WHERE role = 'super_admin')::int AS role_super_admin
       FROM users`,
      values
    )
    const aggregate = counts.rows[0] || {}
    const count = Number(aggregate.filtered_total) || 0
    const totalPages = Math.ceil(count / safePageSize)
    const resolvedPage = Math.min(safePage, Math.max(1, totalPages))
    const offset = (resolvedPage - 1) * safePageSize
    const rowValues = [...values]
    const addRowValue = (value) => {
      rowValues.push(value)
      return `$${rowValues.length}`
    }
    const rows = await this.pool.query(
      `SELECT users.*,
              COALESCE((
                SELECT jsonb_object_agg(o.permission_key, o.effect)
                FROM user_permission_overrides o
                WHERE o.user_id = users.id
              ), '{}'::jsonb) AS permission_overrides
       FROM users ${where}
       ORDER BY ${orderBy}
       LIMIT ${addRowValue(safePageSize)} OFFSET ${addRowValue(offset)}`,
      rowValues
    )
    return {
      users: rows.rows.map((row) => this.publicUser(row)),
      page: resolvedPage,
      page_size: safePageSize,
      total: count,
      total_pages: totalPages,
      sort_by: safeSortBy,
      sort_order: safeSortOrder,
      stats: {
        total: Number(aggregate.total) || 0,
        active: Number(aggregate.active) || 0,
        disabled: Number(aggregate.disabled) || 0,
        muted: Number(aggregate.muted) || 0,
        by_role: {
          user: Number(aggregate.role_user) || 0,
          reviewer: Number(aggregate.role_reviewer) || 0,
          admin: Number(aggregate.role_admin) || 0,
          super_admin: Number(aggregate.role_super_admin) || 0
        }
      }
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

  async avatarFile(userId) {
    const row = await this.getRawById(userId)
    if (row?.status && row.status !== 'active') return null
    if (row?.avatar_file) {
      const filePath = resolveBackend(config.avatarFolder, safeBasename(row.avatar_file))
      if (fs.existsSync(filePath)) return filePath
    }
    return null
  }
}

export const userStore = new UserStore()
