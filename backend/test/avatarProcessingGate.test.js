import assert from 'node:assert/strict'
import test from 'node:test'
import { createConcurrencyGate } from '../src/services/avatarProcessingGate.js'

test('avatar processing gate releases slots exactly once', () => {
  const gate = createConcurrencyGate(2)
  const releaseFirst = gate.tryAcquire()
  const releaseSecond = gate.tryAcquire()
  assert.equal(typeof releaseFirst, 'function')
  assert.equal(typeof releaseSecond, 'function')
  assert.equal(gate.active, 2)
  assert.equal(gate.tryAcquire(), null)

  releaseFirst()
  releaseFirst()
  assert.equal(gate.active, 1)
  const releaseThird = gate.tryAcquire()
  assert.equal(typeof releaseThird, 'function')
  assert.equal(gate.active, 2)
  releaseSecond()
  releaseThird()
  assert.equal(gate.active, 0)
})
