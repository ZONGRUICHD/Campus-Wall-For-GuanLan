import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadJsonStoreModule } from './helpers/json-store-sandbox.mjs'

const managerStoreSource = fileURLToPath(new URL('../src/services/managerStore.js', import.meta.url))

const managerFixture = () => ({
  root: {
    username: 'root',
    password: 'root-password',
    status: 'active',
    session_version: 4,
    permissions: ['manage_admins', 'manage_settings']
  },
  operator: {
    username: 'operator',
    password: 'operator-password',
    status: 'active',
    session_version: 2,
    permissions: ['manage_wall_message']
  }
})

const loadManagers = () => loadJsonStoreModule(managerStoreSource, {
  files: { 'managers.json': managerFixture() }
})

test('manager responses expose permissions but never password material', async (t) => {
  const sandbox = await loadManagers()
  t.after(() => sandbox.cleanup())
  const { managerStore, adminPermissionDefinitions } = sandbox.module

  const manager = managerStore.get('root')
  assert.equal(manager.username, 'root')
  assert.equal(Object.hasOwn(manager, 'password'), false)
  assert.equal(Object.hasOwn(manager, 'password_hash'), false)
  assert.equal(Object.hasOwn(manager, 'password_salt'), false)
  assert.equal(JSON.stringify(managerStore.list()).includes('root-password'), false)
  assert.equal(new Set(adminPermissionDefinitions.map((permission) => permission.name)).size, 10)
})

test('an administrator cannot disable self or remove own manage-admins permission', async (t) => {
  const sandbox = await loadManagers()
  t.after(() => sandbox.cleanup())
  const { managerStore } = sandbox.module

  assert.throws(
    () => managerStore.update('root', { status: 'disabled' }, 'root'),
    /不能停用当前登录的管理员账号/
  )
  assert.throws(
    () => managerStore.update('root', { permissions: ['manage_settings'] }, 'root'),
    /不能移除自己的管理员账号管理权限/
  )
})

test('manager updates retain an active account and an active manage-admins holder', async (t) => {
  const sandbox = await loadManagers()
  t.after(() => sandbox.cleanup())
  const { managerStore } = sandbox.module

  assert.throws(
    () => managerStore.update('root', { permissions: ['manage_settings'] }, 'operator'),
    /至少需要保留一个启用的管理员账号管理者/
  )

  const disabled = managerStore.update('operator', { status: 'disabled' }, 'root')
  assert.equal(disabled.status, 'disabled')
  assert.equal(disabled.session_version, 3)

  assert.throws(
    () => managerStore.update('root', { status: 'disabled' }, 'operator'),
    /至少需要保留一个启用的管理员账号/
  )
})

test('security-sensitive manager changes increment session versions', async (t) => {
  const sandbox = await loadManagers()
  t.after(() => sandbox.cleanup())
  const { managerStore } = sandbox.module

  assert.equal(managerStore.verifySession('operator', 2), true)
  const reset = managerStore.resetPassword('operator', 'new-operator-password', 'root')
  assert.equal(reset.session_version, 3)
  assert.equal(managerStore.verifySession('operator', 2), false)
  assert.equal(managerStore.verifySession('operator', 3), true)

  const changed = managerStore.changePassword('root', 'root-password', 'new-root-password')
  assert.equal(changed.session_version, 5)
  assert.equal(managerStore.verifySession('root', 4), false)
  assert.equal(managerStore.verifySession('root', 5), true)
})
