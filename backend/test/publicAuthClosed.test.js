import assert from 'node:assert/strict'
import test from 'node:test'
import { publicRegistrationClosed } from '../src/services/publicAuth.js'

test('public registration is closed with 404', () => {
  let status = 0
  let body = null
  const res = {
    status(code) {
      status = code
      return this
    },
    json(payload) {
      body = payload
      return this
    }
  }
  publicRegistrationClosed({}, res)
  assert.equal(status, 404)
  assert.equal(body.success, false)
  assert.match(body.error, /飞书登录/)
})
