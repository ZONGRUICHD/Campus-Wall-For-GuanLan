import assert from 'node:assert/strict'
import test from 'node:test'
import { redactPublicMessage } from '../src/services/publicMessageView.js'

const namedMessage = () => ({
  id: 12,
  text: '今天天气不错',
  anonymous: false,
  user_id: 7,
  username: 'zongrui',
  display_name_snapshot: 'ZongRui',
  submitted_by_user_id: 7,
  reviewed_by: 'admin1',
  comments: [
    {
      id: 'c1',
      text: '同在',
      user_id: 7,
      username: 'zongrui',
      moderation_status: 'visible',
      review_status: 'approved'
    }
  ]
})

test('named public posts keep user_id and nickname, but drop login username', () => {
  const view = redactPublicMessage(namedMessage(), 7)
  assert.equal(view.user_id, 7)
  assert.equal(view.display_name_snapshot, 'ZongRui')
  assert.equal(view.anonymous, false)
  assert.equal(view.username, undefined)
  assert.equal(view.submitted_by_user_id, undefined)
  assert.equal(view.reviewed_by, undefined)
  assert.equal(view.comments[0].owned, true)
  assert.equal(view.comments[0].user_id, undefined)
  assert.equal(view.comments[0].username, undefined)
})

test('anonymous public posts never leak user_id and always show the anonymous snapshot', () => {
  const view = redactPublicMessage({
    ...namedMessage(),
    anonymous: true,
    display_name_snapshot: 'ZongRui'
  })
  assert.equal(view.user_id, undefined)
  assert.equal(view.username, undefined)
  assert.equal(view.display_name_snapshot, '匿名用户')
  assert.equal(view.submitted_by_user_id, undefined)
})

test('legacy posts without anonymous=false stay anonymous in the public view', () => {
  const view = redactPublicMessage({
    id: 3,
    text: '旧帖',
    user_id: 9,
    username: 'old',
    display_name_snapshot: '旧昵称'
  })
  assert.equal(view.user_id, undefined)
  assert.equal(view.display_name_snapshot, '匿名用户')
})
