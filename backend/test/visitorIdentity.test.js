import assert from 'node:assert/strict'
import test from 'node:test'
import { createVisitorToken, parseVisitorToken, visitorKeyFromRequest } from '../src/services/visitorIdentity.js'

test('visitor tokens require a matching HMAC and reject unsigned or tampered values', () => {
  const issued = createVisitorToken()
  assert.equal(parseVisitorToken(issued.token), issued.id)
  assert.equal(parseVisitorToken(issued.id), '')
  assert.equal(parseVisitorToken(`${issued.id}.tampered`), '')
  assert.equal(parseVisitorToken(''), '')
})

test('read-only visitor lookup does not mint a cookie, interaction paths do', () => {
  const cookies = {}
  const req = { cookies: {} }
  const res = {
    cookie(name, value) {
      cookies[name] = value
    }
  }

  assert.equal(visitorKeyFromRequest(req), '')
  assert.equal(Object.keys(cookies).length, 0)

  const issuedKey = visitorKeyFromRequest(req, res, { issue: true, cookieOptions: { httpOnly: true } })
  assert.match(issuedKey, /^guest:[a-f0-9-]{36}$/i)
  assert.ok(cookies.poll_voter)
  assert.equal(parseVisitorToken(cookies.poll_voter), issuedKey.slice('guest:'.length))

  req.cookies.poll_voter = cookies.poll_voter
  assert.equal(visitorKeyFromRequest(req), issuedKey)
})
