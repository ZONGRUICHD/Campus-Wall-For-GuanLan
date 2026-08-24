import assert from 'node:assert/strict'
import express from 'express'
import test from 'node:test'

import { publicRouter } from '../src/routes/public.js'
import { MessageStore, messageStore } from '../src/services/messageStore.js'
import { UserStore, userStore } from '../src/services/userStore.js'
import { publicMessageFixtures } from './fixtures/public-messages.mjs'

const clone = (value) => structuredClone(value)

const assertNoAnonymousIdentity = (value) => {
  if (Array.isArray(value)) {
    value.forEach(assertNoAnonymousIdentity)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const key of ['user_id', 'username', 'real_name', 'password_hash', 'password_salt', 'mute_reason']) {
    assert.equal(Object.hasOwn(value, key), false, `anonymous public output contains ${key}`)
  }
  if (value.anonymous === true) {
    assert.equal(Object.hasOwn(value, 'user'), false, 'anonymous public output contains a linked user object')
  }
  Object.values(value).forEach(assertNoAnonymousIdentity)
}

const startPublicServer = async (t) => {
  const app = express()
  app.use(express.json())
  app.use('/api', publicRouter)
  app.use((error, req, res, next) => {
    res.status(500).json({ success: false, error: error.message })
  })
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))
  return `http://127.0.0.1:${server.address().port}`
}

const installMessageFixtures = (t) => {
  const originalMessages = messageStore.messages
  const originalPartitions = messageStore.partitions
  const originalGetSessionUser = userStore.getSessionUser

  messageStore.messages = new Map()
  for (const item of publicMessageFixtures) {
    const message = clone(item)
    messageStore.normalizeMessage(message, message.id)
    messageStore.messages.set(message.id, message)
  }
  messageStore.partitions = new Map([
    ['campus', publicMessageFixtures.map((message) => message.id)],
    ['private-only', [7000002, 7000003, 7000004]]
  ])
  userStore.getSessionUser = async () => null

  t.after(() => {
    messageStore.messages = originalMessages
    messageStore.partitions = originalPartitions
    userStore.getSessionUser = originalGetSessionUser
  })
}

test('public message surfaces exclude non-visible states and redact anonymous identities', async (t) => {
  installMessageFixtures(t)
  const baseUrl = await startPublicServer(t)

  const listResponse = await fetch(`${baseUrl}/api/get_messages?start=0&end=20`)
  assert.equal(listResponse.status, 200)
  const list = await listResponse.json()
  assert.equal(list.total, 1)
  assert.deepEqual(list.data.map((message) => message.id), [7000001])

  for (const hiddenId of [7000002, 7000003, 7000004]) {
    const response = await fetch(`${baseUrl}/api/get_message_details/${hiddenId}`, { method: 'POST' })
    assert.equal(response.status, 404, `message ${hiddenId} must not be publicly addressable`)
  }

  const tags = await (await fetch(`${baseUrl}/api/get_tags`, { method: 'POST' })).json()
  assert.deepEqual(tags, ['campus'])
  const partition = await (await fetch(`${baseUrl}/api/get_partition_messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ partition: 'campus' })
  })).json()
  assert.deepEqual(partition.data, [7000001])

  const visible = list.data[0]
  assert.equal(visible.display_name_snapshot, '匿名用户')
  assert.deepEqual(visible.comments.map((comment) => comment.id), ['visible-comment', 'reply-to-hidden'])
  assert.equal(visible.comments[1].refer, '该评论已被管理员隐藏')
  assert.equal(visible.comments[1].refer_hidden, true)
  assertNoAnonymousIdentity(list.data)
})

test('public profiles use an explicit allow-list of non-sensitive fields', async () => {
  const store = new UserStore()
  await store.pool.end()
  const profile = store.publicProfile({
    id: 42,
    username: 'private-student-number',
    real_name: 'Private Real Name',
    nickname: 'Public Nickname',
    gender: 1,
    bio: 'Public bio',
    avatar_file: 'private-file.png',
    status: 'active',
    muted_until: '2030-01-01T00:00:00.000Z',
    mute_reason: 'Private moderation reason',
    session_version: 99,
    created_at: '2026-08-24T00:00:00.000Z'
  })

  assert.deepEqual(Object.keys(profile).sort(), [
    'avatar_url',
    'bio',
    'created_at',
    'gender',
    'id',
    'nickname',
    'status'
  ])
  assert.equal(JSON.stringify(profile).includes('private-student-number'), false)
  assert.equal(JSON.stringify(profile).includes('Private Real Name'), false)
  assert.equal(JSON.stringify(profile).includes('Private moderation reason'), false)
})

test('hot-message helpers exist and retain the public visibility boundary', async () => {
  const store = new MessageStore()
  await store.pool.end()
  for (const item of publicMessageFixtures) {
    const message = clone(item)
    store.normalizeMessage(message, message.id)
    store.messages.set(message.id, message)
  }

  assert.equal(typeof store.refreshHotMessages, 'function')
  assert.equal(typeof store.getHotMessages, 'function')
  store.refreshHotMessages()
  assert.deepEqual(store.getHotMessages().map((message) => message.id), [7000001])
})
