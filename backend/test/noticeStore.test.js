import test from 'node:test'
import assert from 'node:assert/strict'
import { ensureNoticeIds, publicNotices } from '../src/services/noticeStore.js'

test('legacy notices receive stable unique IDs without changing their content', () => {
  const ids = ['generated-a', 'generated-b']
  const source = [
    { timestamp: '2026-08-24 08:00:00', content: '旧公告' },
    { id: 'kept-id', timestamp: '2026-08-25 08:00:00', content: '新公告' },
    { id: 'kept-id', timestamp: '2026-08-25 09:00:00', content: '重复 ID 公告' }
  ]
  const normalized = ensureNoticeIds(source, () => ids.shift())

  assert.equal(normalized.changed, true)
  assert.deepEqual(normalized.notices.map((notice) => notice.id), ['generated-a', 'kept-id', 'generated-b'])
  assert.deepEqual(normalized.notices.map((notice) => notice.content), source.map((notice) => notice.content))
  assert.equal(ensureNoticeIds(normalized.notices).changed, false)
})

test('public GET order follows the latest publish or edit while legacy order stays unchanged', () => {
  const source = [
    {
      id: 'older-edited',
      timestamp: '2026-08-24 08:00:00',
      updated_at: '2026-08-25 20:00:00',
      user: '审核员 reviewer',
      author_role: 'reviewer',
      updated_by: '管理员 admin',
      updated_by_role: 'admin',
      content: '较早发布但刚刚编辑'
    },
    { id: 'newer-created', timestamp: '2026-08-25 09:00:00', user: '超级管理员 root', content: '较晚发布' },
    { id: 'newest-created', timestamp: '2026-08-25 10:00:00', user: '管理员 admin', content: '最新发布' }
  ]

  const modern = publicNotices(source, { newestFirst: true })
  const legacy = publicNotices(source)

  assert.deepEqual(modern.map((notice) => notice.id), ['older-edited', 'newest-created', 'newer-created'])
  assert.deepEqual(legacy.map((notice) => notice.id), ['older-edited', 'newer-created', 'newest-created'])
  for (const notice of modern) {
    assert.equal('user' in notice, false)
    assert.equal('author_role' in notice, false)
    assert.equal('updated_by' in notice, false)
    assert.equal('updated_by_role' in notice, false)
  }
})
