import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadJsonStoreModule } from './helpers/json-store-sandbox.mjs'
import {
  feedbackTrackingId,
  pendingReportTrackingId,
  processedReportTrackingId,
  trackingFiles
} from './fixtures/tracking-records.mjs'

const feedbackStoreSource = fileURLToPath(new URL('../src/services/feedbackStore.js', import.meta.url))
const reportStoreSource = fileURLToPath(new URL('../src/services/reportStore.js', import.meta.url))
const withDashes = (code) => code.match(/.{1,8}/g).join('-')

const assertNoPrivateTrackingData = (value) => {
  const serialized = JSON.stringify(value)
  for (const secret of [
    'student-private@example.test',
    'reporter-private@example.test',
    'processed-reporter@example.test',
    'Private ticket body',
    'Private report reason',
    'Private processed report reason',
    'Private target excerpt',
    'Private processed target excerpt',
    'private-admin-name',
    'private-comment-id',
    'protected cohort'
  ]) {
    assert.equal(serialized.includes(secret), false, `public tracking output leaked: ${secret}`)
  }
}

test('feedback tracking codes normalize input and expose only the public ticket view', async (t) => {
  const sandbox = await loadJsonStoreModule(feedbackStoreSource, { files: trackingFiles })
  t.after(() => sandbox.cleanup())
  const { feedbackStore } = sandbox.module

  const ticket = feedbackStore.publicStatus(` ${withDashes(feedbackTrackingId).toUpperCase()} `)
  assert.deepEqual(Object.keys(ticket).sort(), [
    'category',
    'category_label',
    'id',
    'public_reply',
    'status',
    'status_label',
    'timestamp',
    'title',
    'updated_at'
  ])
  assert.equal(ticket.id, feedbackTrackingId)
  assert.equal(ticket.status, 'in_progress')
  assertNoPrivateTrackingData(ticket)
  assert.equal(feedbackStore.publicStatus('not-a-tracking-code'), null)

  const created = feedbackStore.create({
    category: 'bug',
    title: 'New issue',
    email: 'new-private@example.test',
    text: 'New private body'
  })
  assert.match(created.id, /^[a-f0-9]{32}$/)
  const publicCreated = feedbackStore.publicStatus(created.id)
  assert.equal(publicCreated.status, 'pending')
  assert.equal(Object.hasOwn(publicCreated, 'email'), false)
  assert.equal(Object.hasOwn(publicCreated, 'text'), false)
})

test('report tracking codes hide reporter and moderation internals in all states', async (t) => {
  const sandbox = await loadJsonStoreModule(reportStoreSource, { files: trackingFiles })
  t.after(() => sandbox.cleanup())
  const { reportStore } = sandbox.module

  const pending = reportStore.publicStatus(withDashes(pendingReportTrackingId))
  const processed = reportStore.publicStatus(withDashes(processedReportTrackingId).toUpperCase())
  const expectedKeys = [
    'category',
    'id',
    'message_id',
    'processed_at',
    'public_reply',
    'resolution',
    'resolution_label',
    'status',
    'status_label',
    'target_type',
    'target_type_label',
    'timestamp'
  ]
  assert.deepEqual(Object.keys(pending).sort(), expectedKeys)
  assert.deepEqual(Object.keys(processed).sort(), expectedKeys)
  assert.equal(pending.status, 'pending')
  assert.equal(pending.resolution, '')
  assert.equal(processed.status, 'processed')
  assert.equal(processed.resolution, 'dismiss')
  assert.equal(processed.public_reply, 'No violation was found.')
  assertNoPrivateTrackingData({ pending, processed })
  assert.equal(reportStore.publicStatus('f'.repeat(31)), null)

  const created = reportStore.create(7000003, {
    text: 'Another private reason',
    email: 'another-private@example.test',
    category: '其他',
    target_type: 'message',
    target_excerpt: 'another target excerpt'
  })
  assert.match(created.id, /^[a-f0-9]{32}$/)
  const publicCreated = reportStore.publicStatus(created.id)
  assert.equal(publicCreated.status, 'pending')
  assert.equal(Object.hasOwn(publicCreated, 'email'), false)
  assert.equal(Object.hasOwn(publicCreated, 'text'), false)
  assert.equal(Object.hasOwn(publicCreated, 'target_excerpt'), false)
})
