import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { nowText, readJson, writeJson } from './jsonStore.js'

const managersPath = 'managers.json'
const usernamePattern = /^[A-Za-z0-9_.-]{3,40}$/
const hashPattern = /^[a-f0-9]{128}$/i

export const adminPermissionDefinitions = [
  { name: 'manage_wall_message', description: '管理校园墙留言', url: '/admin/wall', max_delete_message: 10000 },
  { name: 'manage_users', description: '管理学生账号', url: '/admin/users' },
  { name: 'manage_apps', description: '管理应用广场', url: '/admin/apps' },
  { name: 'notice', description: '管理公告', url: '/admin/notice' },
  { name: 'view_user_log', description: '处理反馈工单', url: '/admin/feedback' },
  { name: 'view_report', description: '处理内容举报', url: '/admin/report' },
  { name: 'view_log', description: '查看错误日志', url: '/admin/error_log' },
  { name: 'view_admin_log', description: '查看管理员日志', url: '/admin/log' },
  { name: 'manage_settings', description: '管理平台设置', url: '/admin/settings' },
  { name: 'manage_admins', description: '管理管理员账号与权限', url: '/admin/managers' }
]

const permissionMap = new Map(adminPermissionDefinitions.map((permission) => [permission.name, permission]))

const fail = (message, statusCode = 400) => {
  const error = new Error(message)
  error.statusCode = statusCode
  throw error
}

const hashPassword = (password, salt = randomBytes(16).toString('hex')) => ({
  salt,
  hash: scryptSync(String(password || ''), salt, 64).toString('hex')
})

const safeString = (value) => String(value || '').trim()
const normalizeStatus = (value) => value === 'disabled' ? 'disabled' : 'active'
const normalizeSessionVersion = (value) => Math.max(0, Math.floor(Number(value) || 0))

const permissionNames = (permissions) => {
  const source = Array.isArray(permissions) ? permissions : []
  return [...new Set(source.map((item) => safeString(typeof item === 'string' ? item : item?.name)).filter((name) => permissionMap.has(name)))]
}

const normalizePermissions = (permissions) => permissionNames(permissions).map((name) => ({ ...permissionMap.get(name) }))

const normalizeManager = (key, value = {}) => {
  const username = safeString(value.username || key)
  const hasStoredHash = hashPattern.test(String(value.password_hash || '')) && safeString(value.password_salt)
  const migratedPassword = hasStoredHash ? null : String(value.password || '')
  const credentials = hasStoredHash
    ? { hash: String(value.password_hash).toLowerCase(), salt: safeString(value.password_salt) }
    : hashPassword(migratedPassword || randomUUID())
  return {
    username,
    password_hash: credentials.hash,
    password_salt: credentials.salt,
    status: migratedPassword || hasStoredHash ? normalizeStatus(value.status) : 'disabled',
    session_version: normalizeSessionVersion(value.session_version),
    permissions: normalizePermissions(value.permissions),
    created_at: safeString(value.created_at || nowText()),
    updated_at: safeString(value.updated_at || ''),
    last_login_at: safeString(value.last_login_at || '')
  }
}

const publicManager = (manager) => manager ? ({
  username: manager.username,
  status: manager.status,
  session_version: manager.session_version,
  permissions: normalizePermissions(manager.permissions),
  created_at: manager.created_at,
  updated_at: manager.updated_at,
  last_login_at: manager.last_login_at
}) : null

const findKey = (managers, username) => {
  const target = safeString(username).toLowerCase()
  return Object.keys(managers).find((key) => key.toLowerCase() === target) || ''
}

const activeSuperAdmins = (managers) => Object.values(managers).filter((manager) => (
  manager.status === 'active' && permissionNames(manager.permissions).includes('manage_admins')
))

const activeManagers = (managers) => Object.values(managers).filter((manager) => manager.status === 'active')

export class ManagerStore {
  init() {
    this.load()
  }

  load() {
    const source = readJson(managersPath, {})
    const raw = source && typeof source === 'object' && !Array.isArray(source) ? source : {}
    const managers = {}
    for (const [key, value] of Object.entries(raw)) {
      const manager = normalizeManager(key, value)
      if (!usernamePattern.test(manager.username)) continue
      if (findKey(managers, manager.username)) continue
      managers[manager.username] = manager
    }

    if (Object.keys(managers).length && activeSuperAdmins(managers).length === 0) {
      const bootstrapKey = findKey(managers, 'admin') || Object.keys(managers).find((key) => managers[key].status === 'active') || Object.keys(managers)[0]
      const bootstrap = managers[bootstrapKey]
      bootstrap.status = 'active'
      bootstrap.permissions = normalizePermissions([...permissionNames(bootstrap.permissions), 'manage_admins'])
      bootstrap.updated_at ||= nowText()
    }

    if (JSON.stringify(source) !== JSON.stringify(managers)) writeJson(managersPath, managers)
    return managers
  }

  save(managers) {
    writeJson(managersPath, managers)
  }

  getRaw(username) {
    const managers = this.load()
    const key = findKey(managers, username)
    return key ? managers[key] : null
  }

  get(username) {
    return publicManager(this.getRaw(username))
  }

  list() {
    return Object.values(this.load()).map(publicManager).sort((a, b) => a.username.localeCompare(b.username))
  }

  stats() {
    const managers = Object.values(this.load())
    return {
      total: managers.length,
      active: managers.filter((manager) => manager.status === 'active').length,
      disabled: managers.filter((manager) => manager.status === 'disabled').length,
      super_admins: managers.filter((manager) => permissionNames(manager.permissions).includes('manage_admins')).length
    }
  }

  verifyPassword(username, password) {
    const manager = this.getRaw(username)
    const salt = manager?.password_salt || '00000000000000000000000000000000'
    const actual = Buffer.from(hashPassword(password, salt).hash, 'hex')
    const expected = Buffer.from(manager?.password_hash || '00'.repeat(64), 'hex')
    const matches = actual.length === expected.length && timingSafeEqual(actual, expected)
    return Boolean(manager && manager.status === 'active' && matches)
  }

  verifySession(username, sessionVersion) {
    const manager = this.getRaw(username)
    return Boolean(
      manager
      && manager.status === 'active'
      && manager.session_version === normalizeSessionVersion(sessionVersion)
    )
  }

  recordLogin(username) {
    const managers = this.load()
    const key = findKey(managers, username)
    if (!key) return null
    managers[key].last_login_at = nowText()
    this.save(managers)
    return publicManager(managers[key])
  }

  create(input = {}) {
    const managers = this.load()
    const username = safeString(input.username)
    const password = String(input.password || '')
    if (!usernamePattern.test(username)) fail('管理员用户名需为 3-40 位字母、数字、点、下划线或短横线')
    if (findKey(managers, username)) fail('管理员用户名已存在', 409)
    if (password.length < 8 || password.length > 128) fail('密码长度需要在 8 到 128 个字符之间')
    const credentials = hashPassword(password)
    const timestamp = nowText()
    managers[username] = normalizeManager(username, {
      username,
      password_hash: credentials.hash,
      password_salt: credentials.salt,
      status: 'active',
      session_version: 0,
      permissions: input.permissions,
      created_at: timestamp,
      updated_at: timestamp
    })
    this.save(managers)
    return publicManager(managers[username])
  }

  update(username, input = {}, actor = '') {
    const managers = this.load()
    const key = findKey(managers, username)
    if (!key) fail('管理员账号不存在', 404)
    const current = managers[key]
    const nextStatus = input.status === undefined ? current.status : normalizeStatus(input.status)
    const nextPermissions = input.permissions === undefined ? current.permissions : normalizePermissions(input.permissions)
    const currentNames = permissionNames(current.permissions)
    const nextNames = permissionNames(nextPermissions)

    if (key.toLowerCase() === safeString(actor).toLowerCase()) {
      if (nextStatus !== 'active') fail('不能停用当前登录的管理员账号')
      if (currentNames.includes('manage_admins') && !nextNames.includes('manage_admins')) fail('不能移除自己的管理员账号管理权限')
    }

    const candidate = structuredClone(managers)
    candidate[key] = {
      ...candidate[key],
      status: nextStatus,
      permissions: nextPermissions,
      session_version: nextStatus !== current.status ? current.session_version + 1 : current.session_version,
      updated_at: nowText()
    }
    if (activeManagers(candidate).length === 0) fail('至少需要保留一个启用的管理员账号')
    if (activeSuperAdmins(candidate).length === 0) fail('至少需要保留一个启用的管理员账号管理者')
    this.save(candidate)
    return publicManager(candidate[key])
  }

  resetPassword(username, password, actor = '') {
    const managers = this.load()
    const key = findKey(managers, username)
    if (!key) fail('管理员账号不存在', 404)
    if (key.toLowerCase() === safeString(actor).toLowerCase()) fail('请使用“修改我的密码”更新当前账号密码')
    if (String(password || '').length < 8 || String(password || '').length > 128) fail('密码长度需要在 8 到 128 个字符之间')
    const credentials = hashPassword(password)
    managers[key] = {
      ...managers[key],
      password_hash: credentials.hash,
      password_salt: credentials.salt,
      session_version: managers[key].session_version + 1,
      updated_at: nowText()
    }
    this.save(managers)
    return publicManager(managers[key])
  }

  changePassword(username, currentPassword, newPassword) {
    if (!this.verifyPassword(username, currentPassword)) fail('当前密码错误', 400)
    if (String(newPassword || '').length < 8 || String(newPassword || '').length > 128) fail('新密码长度需要在 8 到 128 个字符之间')
    if (String(currentPassword) === String(newPassword)) fail('新密码不能与当前密码相同')
    const managers = this.load()
    const key = findKey(managers, username)
    const credentials = hashPassword(newPassword)
    managers[key] = {
      ...managers[key],
      password_hash: credentials.hash,
      password_salt: credentials.salt,
      session_version: managers[key].session_version + 1,
      updated_at: nowText()
    }
    this.save(managers)
    return publicManager(managers[key])
  }

  recover(username, password) {
    const normalizedUsername = safeString(username)
    const nextPassword = String(password || '')
    if (!usernamePattern.test(normalizedUsername)) fail('管理员用户名需为 3-40 位字母、数字、点、下划线或短横线')
    if (nextPassword.length < 8 || nextPassword.length > 128) fail('密码长度需要在 8 到 128 个字符之间')
    const managers = this.load()
    const key = findKey(managers, normalizedUsername)
    const credentials = hashPassword(nextPassword)
    const timestamp = nowText()

    if (!key) {
      managers[normalizedUsername] = normalizeManager(normalizedUsername, {
        username: normalizedUsername,
        password_hash: credentials.hash,
        password_salt: credentials.salt,
        status: 'active',
        session_version: 0,
        permissions: adminPermissionDefinitions.map((permission) => permission.name),
        created_at: timestamp,
        updated_at: timestamp
      })
      this.save(managers)
      return { created: true, manager: publicManager(managers[normalizedUsername]) }
    }

    managers[key] = {
      ...managers[key],
      password_hash: credentials.hash,
      password_salt: credentials.salt,
      status: 'active',
      session_version: managers[key].session_version + 1,
      permissions: normalizePermissions([...permissionNames(managers[key].permissions), 'manage_admins']),
      updated_at: timestamp
    }
    this.save(managers)
    return { created: false, manager: publicManager(managers[key]) }
  }
}

export const managerStore = new ManagerStore()
