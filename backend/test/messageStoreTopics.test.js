import assert from 'node:assert/strict'
import test from 'node:test'
import { MessageStore } from '../src/services/messageStore.js'

const message = (id, tags, timestamp = '2026-08-26 08:00:00', state = 'visible') => ({
  id,
  tags,
  timestamp,
  moderation_status: state,
  review_status: state === 'visible' ? 'approved' : 'pending',
  comments: [],
  files: []
})

test('topic lookup keeps similar labels strictly separated', async () => {
  const store = new MessageStore()
  try {
    store.messages.set(1, message(1, ['表白']))
    store.messages.set(2, message(2, ['表白墙']))
    store.messages.set(3, message(3, ['#表白']))
    store.messages.set(5, message(5, ['AI']))
    store.messages.set(6, message(6, ['ai']))
    store.partitions.set('表白', [1, 2, 3])
    store.partitions.set('表白墙', [2])
    store.partitions.set('#表白', [3])
    store.partitions.set('AI', [5])
    store.partitions.set('ai', [6])
    store.partitions.set('错组标签', [1])

    assert.equal(store.findPartition(' 表白 '), '表白')
    assert.deepEqual(store.getTagMessageIds('表白'), [1])
    assert.deepEqual(store.getTagMessageIds('表白墙'), [2])
    assert.deepEqual(store.getTagMessageIds('#表白'), [3])
    assert.deepEqual(store.getTagMessageIds('AI'), [5])
    assert.deepEqual(store.getTagMessageIds('ai'), [6])
    assert.deepEqual(store.getTagMessageIds('Ai'), [])
    assert.deepEqual(store.getMessages({ tag: '表白' }).map((item) => item.id), [1])
    assert.deepEqual(store.getMessages({ tag: '表白墙' }).map((item) => item.id), [2])
    assert.equal(store.getTags().includes('错组标签'), false)
  } finally {
    await store.pool.end()
  }
})

test('topic directory counts only public exact tags and can hide lost-and-found', async () => {
  const store = new MessageStore()
  try {
    store.messages.set(1, message(1, ['日常'], '2026-08-25 08:00:00'))
    store.messages.set(2, message(2, ['日常', '学习'], '2026-08-26 09:00:00'))
    store.messages.set(3, message(3, ['日常'], '2026-08-26 10:00:00', 'pending'))
    store.messages.set(4, { ...message(4, ['失物招领', '校园卡']), lost_found: { kind: 'lost' } })
    store.messages.set(5, message(5, ['学习', '学习'], '2026-08-26 10:00:00'))
    store.messages.set(6, message(6, ['日常'], '2026-08-26 11:00:00', 'deleted'))

    assert.deepEqual(store.getTopics({ includeLostFound: false }), [
      { tag: '日常', count: 2, latest_at: '2026-08-26 09:00:00' },
      { tag: '学习', count: 2, latest_at: '2026-08-26 10:00:00' }
    ])
    assert.equal(store.getTopics().some((topic) => topic.tag === '校园卡'), true)
  } finally {
    await store.pool.end()
  }
})
