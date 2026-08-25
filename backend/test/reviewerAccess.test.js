import assert from 'node:assert/strict'
import test from 'node:test'
import { MessageStore } from '../src/services/messageStore.js'
import { permissionsForRole } from '../src/services/roles.js'

const approveAsSubmittingReviewer = async (message) => {
  const store = new MessageStore()
  store.mutateStoredMessage = async (_id, mutator) => {
    const mutation = await mutator(structuredClone(message), {})
    return mutation.result
  }
  store.refreshHotMessages = () => []
  try {
    return await store.setReviewState(message.id, {
      approved: true,
      reviewer: 'shenhe1',
      reviewerId: 7
    })
  } finally {
    await store.pool.end()
  }
}

test('reviewer permissions are role-based and identical for every reviewer account', () => {
  const first = permissionsForRole('reviewer')
  const second = permissionsForRole('reviewer')
  assert.deepEqual(first, second)
  assert.deepEqual(first.map((permission) => permission.name), ['review_posts'])
})

test('a reviewer can approve every pending content category, including their own submission', async () => {
  const categories = [
    { id: 1, text: '普通动态', tags: ['日常'] },
    { id: 2, text: '表白便签', tags: ['表白'] },
    { id: 3, text: '失物招领', tags: ['失物招领'], lost_found: { kind: 'lost' } },
    { id: 4, text: '审核员发布的官方内容', tags: [], author_type: 'admin', admin_username: 'shenhe1' }
  ]

  for (const category of categories) {
    const result = await approveAsSubmittingReviewer({
      ...category,
      user_id: 7,
      submitted_by_user_id: 7,
      moderation_status: 'pending',
      review_status: 'pending'
    })
    assert.equal(result.success, true, category.text)
    assert.equal(result.message.review_status, 'approved', category.text)
    assert.equal(result.message.moderation_status, 'visible', category.text)
    assert.equal(result.message.reviewed_by, 'shenhe1', category.text)
  }
})
