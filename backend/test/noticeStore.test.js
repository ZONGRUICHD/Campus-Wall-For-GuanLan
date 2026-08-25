import test from 'node:test'
import assert from 'node:assert/strict'
import { ensureNoticeIds, normalizeNotice, plainNoticeText, publicNotices } from '../src/services/noticeStore.js'

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
  assert.deepEqual(normalized.notices.map((notice) => notice.status), ['published', 'published', 'published'])
  assert.deepEqual(normalized.notices.map((notice) => notice.priority), ['normal', 'normal', 'normal'])
  assert.deepEqual(normalized.notices.map((notice) => notice.reminder_revision), [1, 1, 1])
  assert.equal(normalized.notices[0].publish_at, source[0].timestamp)
  assert.equal(normalized.notices[0].title, '旧公告')
  assert.equal(ensureNoticeIds(normalized.notices).changed, false)
})

test('public notices expose only due published entries ordered by publish time', () => {
  const source = [
    {
      id: 'older-edited',
      timestamp: '2026-08-24 08:00:00',
      publish_at: '2026-08-25T09:00:00.000Z',
      updated_at: '2026-08-28 20:00:00',
      user: '审核员 reviewer',
      author_role: 'reviewer',
      updated_by: '管理员 admin',
      updated_by_role: 'admin',
      archived_by: '不应公开',
      internal_note: '不应公开的内部备注',
      content: '较早发布但刚刚编辑'
    },
    { id: 'legacy', timestamp: '2026-08-24 08:00:00', user: '超级管理员 root', content: '旧格式公告' },
    { id: 'newest-due', timestamp: '2026-08-25 10:00:00', publish_at: '2026-08-26T09:00:00.000Z', content: '最新到期公告' },
    { id: 'future', status: 'published', publish_at: '2026-08-27T09:00:00.000Z', content: '尚未到期' },
    { id: 'draft', status: 'draft', publish_at: '2026-08-20T09:00:00.000Z', content: '草稿' },
    { id: 'archived', status: 'archived', publish_at: '2026-08-20T09:00:00.000Z', content: '已归档' }
  ]

  const content = publicNotices(source, { now: Date.parse('2026-08-26T12:00:00.000Z') })

  assert.deepEqual(content.map((notice) => notice.id), ['newest-due', 'older-edited', 'legacy'])
  for (const notice of content) {
    assert.equal('user' in notice, false)
    assert.equal('author_role' in notice, false)
    assert.equal('updated_by' in notice, false)
    assert.equal('updated_by_role' in notice, false)
    assert.equal('archived_by' in notice, false)
    assert.equal('internal_note' in notice, false)
  }
})

test('normalization keeps announcement fields plain and bounded', () => {
  const normalized = normalizeNotice({
    title: `  标题\u0000${'甲'.repeat(100)}  `,
    summary: `摘要\n${'乙'.repeat(220)}`,
    content: '第一段\r\n\u0000第二段<script>alert(1)</script>',
    priority: 'URGENT',
    status: 'DRAFT'
  })

  assert.equal(normalized.title.length, 80)
  assert.equal(normalized.summary.length, 200)
  assert.equal(normalized.priority, 'urgent')
  assert.equal(normalized.status, 'draft')
  assert.equal(normalized.reminder_revision, 0)
  assert.equal(normalized.content, '第一段\n第二段<script>alert(1)</script>')
  assert.equal(plainNoticeText('一\n二'), '一 二')
})
