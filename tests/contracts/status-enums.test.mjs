import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  getSchemaEnum,
  getSchemaPropertyEnum,
  parseOpenApiOperations
} from '../helpers/openapi.mjs'
import { MessageStore } from '../../backend/src/services/messageStore.js'
import {
  feedbackCategories,
  feedbackStatuses
} from '../../backend/src/services/feedbackStore.js'
import { reportResolutions } from '../../backend/src/services/reportStore.js'
import { adminPermissionDefinitions } from '../../backend/src/services/managerStore.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const openapi = await readFile(path.join(root, 'contracts/openapi.yaml'), 'utf8')
const parityContract = await readFile(path.join(root, 'contracts/feature-parity.md'), 'utf8')

test('OpenAPI operation IDs are present and unique', () => {
  const operations = parseOpenApiOperations(openapi)
  assert.ok(operations.length >= 100, `expected the full API surface, found ${operations.length} operations`)
  assert.ok(operations.every((operation) => operation.operationId), 'every operation must have an operationId')
  assert.equal(new Set(operations.map((operation) => operation.operationId)).size, operations.length)
})

test('important state enums remain pinned to the parity contract', () => {
  assert.deepEqual(getSchemaEnum(openapi, 'MessageModerationStatus'), ['pending', 'visible', 'hidden', 'deleted'])
  assert.deepEqual(getSchemaEnum(openapi, 'CommentModerationStatus'), ['visible', 'hidden', 'deleted'])
  assert.deepEqual(getSchemaEnum(openapi, 'ReviewStatus'), ['pending', 'approved'])
  assert.deepEqual(getSchemaEnum(openapi, 'FeedbackCategory'), ['bug', 'feature', 'account', 'content', 'other'])
  assert.deepEqual(getSchemaEnum(openapi, 'FeedbackStatus'), ['pending', 'in_progress', 'resolved', 'closed'])
  assert.deepEqual(getSchemaEnum(openapi, 'ReportTargetType'), ['message', 'comment'])
  assert.deepEqual(getSchemaEnum(openapi, 'ReportResolution'), ['dismiss', 'delete_comment', 'delete_message'])
  assert.deepEqual(getSchemaEnum(openapi, 'CaptchaProvider'), ['none', 'turnstile', 'recaptcha'])
  assert.deepEqual(getSchemaPropertyEnum(openapi, 'User', 'status'), ['active', 'disabled'])
  assert.deepEqual(getSchemaPropertyEnum(openapi, 'CatalogApp', 'status'), ['published', 'hidden'])
  assert.deepEqual(getSchemaPropertyEnum(openapi, 'Notification', 'type'), [
    'comment',
    'reply',
    'moderation',
    'comment_moderation',
    'featured'
  ])
  assert.deepEqual(getSchemaPropertyEnum(openapi, 'PublicReport', 'status'), ['pending', 'processed'])

  assert.match(parityContract, /`moderation_status`: `pending \| visible \| hidden \| deleted`/)
  assert.match(parityContract, /`review_status`: `pending \| approved`/)
  assert.match(parityContract, /pending\/in_progress\/resolved\/closed/)
})

test('runtime stores recognize the same moderation, feedback, report, and permission values', async () => {
  const store = new MessageStore()
  await store.pool.end()

  for (const status of getSchemaEnum(openapi, 'MessageModerationStatus')) {
    const message = store.normalizeMessage({ id: 1, moderation_status: status }, 1)
    assert.equal(message.moderation_status, status)
  }
  for (const status of getSchemaEnum(openapi, 'CommentModerationStatus')) {
    const message = store.normalizeMessage({
      id: 1,
      comments: [{ id: 'c1', moderation_status: status }]
    }, 1)
    assert.equal(message.comments[0].moderation_status, status)
  }

  assert.deepEqual(Object.keys(feedbackCategories), getSchemaEnum(openapi, 'FeedbackCategory'))
  assert.deepEqual(Object.keys(feedbackStatuses), getSchemaEnum(openapi, 'FeedbackStatus'))
  assert.deepEqual(Object.keys(reportResolutions), getSchemaEnum(openapi, 'ReportResolution'))
  assert.deepEqual(
    adminPermissionDefinitions.map((permission) => permission.name),
    [
      'manage_wall_message',
      'manage_users',
      'manage_apps',
      'notice',
      'view_user_log',
      'view_report',
      'view_log',
      'view_admin_log',
      'manage_settings',
      'manage_admins'
    ]
  )
})
