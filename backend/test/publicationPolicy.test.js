import assert from 'node:assert/strict'
import test from 'node:test'
import { MessageStore } from '../src/services/messageStore.js'
import { editedPublicationStateFor, isConfessionPost, publicationStateFor } from '../src/services/publicationPolicy.js'

const visible = (reason) => ({
  moderation_status: 'visible',
  review_status: 'approved',
  review_bypass_reason: reason
})

const pending = {
  moderation_status: 'pending',
  review_status: 'pending',
  review_bypass_reason: ''
}

test('ordinary guest and user posts still require review', () => {
  assert.deepEqual(publicationStateFor({ tags: ['日常'] }), pending)
  assert.deepEqual(publicationStateFor({ tags: ['学习'], user: { role: 'user' } }), pending)
})

test('every privileged role publishes ordinary posts immediately', () => {
  for (const role of ['reviewer', 'admin', 'super_admin']) {
    assert.deepEqual(
      publicationStateFor({ tags: ['日常'], user: { role } }),
      visible('privileged_author'),
      role
    )
  }
  assert.deepEqual(publicationStateFor({ admin: { username: 'shenhe1' } }), visible('privileged_author'))
})

test('confessions publish immediately for guests and ordinary users', () => {
  for (const tag of ['表白', '表白墙', '#表白', '## 表白墙']) {
    assert.equal(isConfessionPost([tag]), true, tag)
    assert.deepEqual(publicationStateFor({ tags: [tag] }), visible('confession'), tag)
  }
  assert.deepEqual(
    publicationStateFor({ tags: ['表白'], user: { role: 'user' } }),
    visible('confession')
  )
})

test('lost-and-found posts publish immediately while authentication remains a route concern', () => {
  assert.deepEqual(
    publicationStateFor({ user: { role: 'user' }, lostFound: { kind: 'lost' } }),
    visible('lost_found')
  )
  assert.deepEqual(
    publicationStateFor({ user: { role: 'user' }, lostFound: { kind: 'found' } }),
    visible('lost_found')
  )
})

test('an explicit moderator return remains pending after an owner edit', () => {
  const heldMessage = { review_hold: true }
  assert.deepEqual(
    editedPublicationStateFor({ message: heldMessage, tags: ['表白'], user: { role: 'user' } }),
    pending
  )
  assert.deepEqual(
    editedPublicationStateFor({ message: heldMessage, tags: ['日常'], user: { role: 'reviewer' } }),
    pending
  )
})

test('returning a published post records a moderator hold', async () => {
  const store = new MessageStore()
  store.mutateStoredMessage = async (_id, mutator) => {
    const mutation = await mutator({
      id: 91,
      moderation_status: 'visible',
      review_status: 'approved',
      review_revision: 1
    }, {})
    return mutation.result
  }
  store.enqueueModerationNotification = async () => 0
  store.refreshHotMessages = () => []
  try {
    const result = await store.setReviewState(91, { approved: false, reviewer: 'shenhe1' })
    assert.equal(result.message.review_hold, true)
    assert.equal(result.message.review_hold_by, 'shenhe1')
    assert.equal(result.message.moderation_status, 'pending')
    assert.equal(result.message.review_status, 'pending')
  } finally {
    await store.pool.end()
  }
})

test('message creation stores the policy state and only enqueues actual review work', async () => {
  const store = new MessageStore()
  await store.pool.end()

  let nextId = 100
  let notificationCount = 0
  const client = {
    query: async () => ({ rowCount: 1, rows: [] }),
    release: () => {}
  }
  store.pool = { connect: async () => client }
  store.createId = () => nextId++
  store.findPartition = () => null
  store.insertMessage = async () => ({ rowCount: 1 })
  store.enqueueModerationNotification = async () => { notificationCount += 1 }
  store.refreshHotMessages = () => []

  const ordinaryId = await store.postMessage({ text: '普通动态', tags: ['日常'], user: { id: 1, role: 'user' } })
  const reviewerId = await store.postMessage({ text: '审核员动态', tags: ['日常'], user: { id: 2, role: 'reviewer' } })
  const confessionId = await store.postMessage({ text: '一张便签', tags: ['表白'] })
  const lostFoundId = await store.postMessage({
    text: '失物招领',
    tags: ['失物招领'],
    user: { id: 3, role: 'user' },
    lostFound: { kind: 'lost' }
  })

  assert.equal(store.getMessage(ordinaryId).moderation_status, 'pending')
  assert.equal(store.getMessage(ordinaryId).review_status, 'pending')
  assert.ok(store.getMessage(ordinaryId).pending_since)
  for (const id of [reviewerId, confessionId, lostFoundId]) {
    assert.equal(store.getMessage(id).moderation_status, 'visible', id)
    assert.equal(store.getMessage(id).review_status, 'approved', id)
    assert.equal(Object.hasOwn(store.getMessage(id), 'pending_since'), false, id)
  }
  assert.equal(notificationCount, 1)
})
