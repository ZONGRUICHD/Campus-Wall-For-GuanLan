import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createPostgresPool } from './postgres.js'
import { config, projectRoot, resolveBackend } from '../config.js'
import { safeBasename } from './fileTools.js'

const statuses = new Set(['published', 'hidden'])
const iconExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg', 'ico'])

const cleanText = (value = '', max = 200) => String(value || '')
  .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]*>/g, '')
  .replace(/[<>\x00-\x1F\x7F]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max)

const normalizeSlug = (value = '') => String(value || '')
  .normalize('NFKD')
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .replace(/-{2,}/g, '-')
  .slice(0, 80)

const safeBackgroundImage = (value = '') => {
  const image = String(value || '').trim().replace(/;$/, '')
  return /^(linear-gradient|radial-gradient)\(/i.test(image) ? image.slice(0, 500) : ''
}

const normalizeUrl = (value = '') => {
  try {
    const url = new URL(String(value || '').trim())
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

const normalizeIconUrl = (value = '') => {
  const raw = String(value || '').trim()
  if (raw.startsWith('/static/apps/')) return raw
  return normalizeUrl(raw)
}

const normalizeUuid = (value = '') => {
  const raw = String(value || '').trim().toLowerCase()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(raw) ? raw : ''
}

const extractImageSrc = (html = '') => {
  const match = String(html || '').match(/<img[^>]+src=["']([^"']+)["']/i)
  return match?.[1] || ''
}

const appIconDirectory = () => resolveBackend('static', 'apps', 'icons')

const resolveInsideIconDirectory = (filename) => {
  const base = path.resolve(appIconDirectory())
  const target = path.resolve(base, safeBasename(filename))
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error('Invalid icon path')
  return target
}

export class AppStore {
  constructor() {
    this.pool = createPostgresPool()
  }

  async init() {
    fs.mkdirSync(appIconDirectory(), { recursive: true })
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS apps (
        id UUID PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        partition TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL,
        icon_file TEXT,
        icon_url TEXT NOT NULL DEFAULT '',
        icon_background TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS apps_status_sort_idx ON apps(status, sort_order, created_at);
      CREATE INDEX IF NOT EXISTS apps_slug_idx ON apps(slug);
    `)
    await this.seedFromStaticConfigs()
  }

  async seedFromStaticConfigs() {
    const total = await this.pool.query('SELECT count(*)::int AS count FROM apps')
    if ((total.rows[0]?.count || 0) > 0) return

    const dirs = [
      resolveBackend('static', 'apps'),
      path.resolve(projectRoot, 'frontend', 'public', 'static', 'apps')
    ]
    let sortOrder = 0
    for (const appsDir of dirs) {
      if (!fs.existsSync(appsDir)) continue
      for (const appDirName of fs.readdirSync(appsDir)) {
        const configPath = path.join(appsDir, appDirName, 'config.json')
        if (!fs.existsSync(configPath)) continue
        try {
          const appConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
          const localIcon = this.copySeedIcon(path.dirname(configPath))
          await this.createApp({
            slug: normalizeSlug(appDirName) || `app-${sortOrder + 1}`,
            name: appConfig.name || appDirName,
            author: appConfig.author || '',
            description: appConfig.appDescription || appConfig.description || '',
            partition: appConfig.partition || '',
            url: appConfig.url || '',
            icon_url: localIcon ? '' : normalizeIconUrl(extractImageSrc(appConfig.appIconElement)),
            icon_background: appConfig.iconBackground || '',
            status: 'published',
            sort_order: sortOrder
          }, localIcon ? { savedFilename: localIcon } : null)
          sortOrder += 1
        } catch {}
      }
    }
  }

  copySeedIcon(appDir) {
    for (const name of ['icon.png', 'icon.jpg', 'icon.jpeg', 'icon.webp', 'icon.svg', 'icon.ico']) {
      const source = path.join(appDir, name)
      if (!fs.existsSync(source)) continue
      const ext = path.extname(name).slice(1).toLowerCase()
      if (!iconExtensions.has(ext)) continue
      const filename = `${randomUUID()}.${ext}`
      fs.copyFileSync(source, resolveInsideIconDirectory(filename))
      return filename
    }
    return ''
  }

  publicApp(row) {
    if (!row) return null
    const iconUrl = row.icon_file ? `/static/apps/icons/${safeBasename(row.icon_file)}` : row.icon_url
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      author: row.author || '',
      description: row.description || '',
      appDescription: row.description || '',
      partition: row.partition || '',
      url: row.url,
      iconUrl: iconUrl || '',
      iconBackground: row.icon_background || '',
      status: row.status || 'published',
      sortOrder: Number(row.sort_order || 0),
      created_at: row.created_at,
      updated_at: row.updated_at
    }
  }

  normalizeInput(data = {}, existing = null) {
    const name = cleanText(data.name ?? existing?.name, 80)
    const slug = normalizeSlug(data.slug || name || existing?.slug)
    const url = normalizeUrl(data.url ?? existing?.url)
    const status = statuses.has(data.status) ? data.status : (existing?.status || 'published')
    const sortOrder = Number.isInteger(Number(data.sort_order)) ? Number(data.sort_order) : Number(existing?.sort_order || 0)
    return {
      slug,
      name,
      author: cleanText(data.author ?? existing?.author, 80),
      description: cleanText(data.description ?? data.appDescription ?? existing?.description, 1000),
      partition: cleanText(data.partition ?? existing?.partition, 80),
      url,
      icon_url: normalizeIconUrl(data.icon_url ?? data.iconUrl ?? existing?.icon_url),
      icon_background: safeBackgroundImage(data.icon_background ?? data.iconBackground ?? existing?.icon_background),
      status,
      sort_order: sortOrder
    }
  }

  validateInput(input) {
    if (!input.name) return '应用名称不能为空'
    if (!input.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) return '应用标识只能包含小写字母、数字和短横线'
    if (!input.url) return '应用链接必须是 http 或 https 地址'
    return ''
  }

  async saveIcon(file) {
    if (!file?.buffer && !file?.savedFilename) return ''
    if (file.savedFilename) return safeBasename(file.savedFilename)
    const ext = path.extname(file.originalname || '').slice(1).toLowerCase()
    if (!iconExtensions.has(ext)) {
      const error = new Error('图标仅支持 png、jpg、jpeg、webp、svg、ico')
      error.statusCode = 400
      throw error
    }
    const filename = `${randomUUID()}.${ext}`
    fs.writeFileSync(resolveInsideIconDirectory(filename), file.buffer)
    return filename
  }

  deleteIconFile(filename) {
    if (!filename) return
    const target = resolveInsideIconDirectory(filename)
    if (fs.existsSync(target)) fs.unlinkSync(target)
  }

  async getById(id) {
    const appId = normalizeUuid(id)
    if (!appId) return null
    const result = await this.pool.query('SELECT * FROM apps WHERE id = $1', [appId])
    return result.rows[0] || null
  }

  async getPublishedApps() {
    const result = await this.pool.query(
      `SELECT * FROM apps
       WHERE status = 'published'
       ORDER BY sort_order ASC, created_at ASC`
    )
    return result.rows.map((row) => this.publicApp(row))
  }

  async listAdmin({ q = '' } = {}) {
    const values = []
    let where = ''
    const search = cleanText(q, 80)
    if (search) {
      values.push(`%${search}%`)
      where = 'WHERE name ILIKE $1 OR slug ILIKE $1 OR author ILIKE $1 OR description ILIKE $1'
    }
    const result = await this.pool.query(
      `SELECT * FROM apps ${where}
       ORDER BY status ASC, sort_order ASC, created_at ASC`,
      values
    )
    return result.rows.map((row) => this.publicApp(row))
  }

  async stats() {
    const result = await this.pool.query(`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status = 'published')::int AS published,
        count(*) FILTER (WHERE status = 'hidden')::int AS hidden
      FROM apps
    `)
    return result.rows[0] || { total: 0, published: 0, hidden: 0 }
  }

  async createApp(data, file = null) {
    const input = this.normalizeInput(data)
    if (!input.slug) input.slug = `app-${Date.now().toString(36)}`
    const error = this.validateInput(input)
    if (error) {
      const validationError = new Error(error)
      validationError.statusCode = 400
      throw validationError
    }
    const iconFile = await this.saveIcon(file)
    try {
      const result = await this.pool.query(
        `INSERT INTO apps (id, slug, name, author, description, partition, url, icon_file, icon_url, icon_background, status, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [randomUUID(), input.slug, input.name, input.author, input.description, input.partition, input.url, iconFile || null, input.icon_url, input.icon_background, input.status, input.sort_order]
      )
      return this.publicApp(result.rows[0])
    } catch (error) {
      if (iconFile) this.deleteIconFile(iconFile)
      if (error?.code === '23505') {
        const duplicate = new Error('应用标识已存在')
        duplicate.statusCode = 400
        throw duplicate
      }
      throw error
    }
  }

  async updateApp(id, data, file = null) {
    const existing = await this.getById(id)
    if (!existing) return null
    const input = this.normalizeInput(data, existing)
    const error = this.validateInput(input)
    if (error) {
      const validationError = new Error(error)
      validationError.statusCode = 400
      throw validationError
    }
    const iconFile = await this.saveIcon(file)
    try {
      const result = await this.pool.query(
        `UPDATE apps
         SET slug = $2,
             name = $3,
             author = $4,
             description = $5,
             partition = $6,
             url = $7,
             icon_file = COALESCE($8, icon_file),
             icon_url = $9,
             icon_background = $10,
             status = $11,
             sort_order = $12,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [id, input.slug, input.name, input.author, input.description, input.partition, input.url, iconFile || null, input.icon_url, input.icon_background, input.status, input.sort_order]
      )
      if (iconFile && existing.icon_file) this.deleteIconFile(existing.icon_file)
      return this.publicApp(result.rows[0])
    } catch (error) {
      if (iconFile) this.deleteIconFile(iconFile)
      if (error?.code === '23505') {
        const duplicate = new Error('应用标识已存在')
        duplicate.statusCode = 400
        throw duplicate
      }
      throw error
    }
  }

  async setStatus(id, status) {
    const appId = normalizeUuid(id)
    if (!appId || !statuses.has(status)) return null
    const result = await this.pool.query(
      'UPDATE apps SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [appId, status]
    )
    return this.publicApp(result.rows[0])
  }

  async deleteApp(id) {
    const appId = normalizeUuid(id)
    if (!appId) return null
    const result = await this.pool.query('DELETE FROM apps WHERE id = $1 RETURNING *', [appId])
    const row = result.rows[0]
    if (!row) return null
    if (row.icon_file) this.deleteIconFile(row.icon_file)
    return this.publicApp(row)
  }
}

export const appStore = new AppStore()
