import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterModerationScope,
  isConfessionMessage,
  matchesModerationScope,
  moderationScopeForMessage,
  normalizeModerationScope
} from '../src/services/contentCategories.js'
import { MessageStore } from '../src/services/messageStore.js'

test('classifies confession notes independently from ordinary posts', () => {
  for (const tags of [['表白'], [{ tag: '表白' }]]) {
    const message = { tags }
    assert.equal(isConfessionMessage(message), true, JSON.stringify(tags))
    assert.equal(moderationScopeForMessage(message), 'confessions')
    assert.equal(matchesModerationScope(message, 'confessions'), true)
    assert.equal(matchesModerationScope(message, 'posts'), false)
  }

  for (const message of [
    { tags: ['日常'] },
    { tags: ['表白墙'] },
    { tags: ['#表白'] },
    { tags: ['失物招领'], lost_found: { kind: 'lost' } },
    { tags: ['失物招领', '表白'], lost_found: { kind: 'found' } },
    { tags: [] }
  ]) {
    assert.equal(isConfessionMessage(message), false, JSON.stringify(message))
    assert.equal(moderationScopeForMessage(message), 'posts')
    assert.equal(matchesModerationScope(message, 'posts'), true)
    assert.equal(matchesModerationScope(message, 'confessions'), false)
  }
})

test('filters a scope before pagination so interleaved queues keep correct totals', () => {
  const messages = Array.from({ length: 45 }, (_, index) => ({
    id: index + 1,
    tags: index % 2 === 0 ? ['表白'] : ['日常']
  }))
  const confessions = filterModerationScope(messages, 'confessions')
  const posts = filterModerationScope(messages, 'posts')

  assert.equal(confessions.length, 23)
  assert.equal(posts.length, 22)
  assert.deepEqual(confessions.slice(20, 40).map((message) => message.id), [41, 43, 45])
  assert.deepEqual(posts.slice(20, 40).map((message) => message.id), [42, 44])
})

test('normalizes unknown moderation scopes to the backward-compatible all view', () => {
  assert.equal(normalizeModerationScope('posts'), 'posts')
  assert.equal(normalizeModerationScope('confessions'), 'confessions')
  assert.equal(normalizeModerationScope('unknown'), 'all')
  assert.equal(matchesModerationScope({ tags: ['表白'] }, 'all'), true)
  assert.equal(matchesModerationScope({ tags: ['日常'] }, 'all'), true)
})

test('scoped management counts preserve deleted items for the recycle-bin total', () => {
  const store = new MessageStore()
  store.messages.set(1, { id: 1, tags: ['日常'], moderation_status: 'visible', review_status: 'approved' })
  store.messages.set(2, { id: 2, tags: ['表白'], moderation_status: 'deleted', review_status: 'approved' })

  const source = store.getMessages({ includeHidden: true, includeDeleted: true })
  const confessionCounts = store.reviewStatusCounts(filterModerationScope(source, 'confessions'))
  const allCounts = store.reviewStatusCounts(source)

  assert.equal(confessionCounts.all, 0)
  assert.equal(confessionCounts.deleted, 1)
  assert.equal(allCounts.all, 1)
  assert.equal(allCounts.deleted, 1)
})
