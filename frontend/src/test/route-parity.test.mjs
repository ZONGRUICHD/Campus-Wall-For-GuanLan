import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const appSource = (await readFile(path.resolve(testDirectory, '../App.jsx'), 'utf8'))
  .replace(/\r\n?/g, '\n')

const expectedPaths = [
  '/wall',
  '/wall/message/:id',
  '/p',
  '/p/:tag',
  '/login',
  '/me',
  '/me/favorites',
  '/me/posts',
  '/me/comments',
  '/me/notifications',
  '/user/:id',
  '/help',
  '/help/form',
  '/help/report/:id/comment/:commentId',
  '/help/report/:id',
  '/help/success',
  '/help/status',
  '/rules',
  '/apps',
  '/admin/login',
  '/admin',
  '/admin/wall',
  '/admin/comments',
  '/admin/trash',
  '/admin/users',
  '/admin/managers',
  '/admin/apps',
  '/admin/settings',
  '/admin/notice',
  '/admin/feedback',
  '/admin/report',
  '/admin/log',
  '/admin/audit',
  '/admin/error_log'
]

test('the SPA exposes exactly the 35 frozen business routes', () => {
  const indexRoutes = [...appSource.matchAll(/<Route\s+index\s+/g)]
  const pathRoutes = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)]
    .map((match) => match[1])
  const businessPaths = pathRoutes.filter((routePath) => routePath !== '*')

  assert.equal(indexRoutes.length, 1)
  assert.equal(businessPaths.length + indexRoutes.length, 35)
  assert.deepEqual(businessPaths, expectedPaths)
  assert.equal(pathRoutes.filter((routePath) => routePath === '*').length, 1)
})
