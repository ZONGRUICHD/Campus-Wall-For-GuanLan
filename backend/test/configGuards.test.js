import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isProductionLikeEnvironment,
  passwordFromDatabaseUrl,
  usesDisallowedDatabasePassword
} from '../src/config.js'

test('production-like environments exclude development, dev and test', () => {
  assert.equal(isProductionLikeEnvironment('development'), false)
  assert.equal(isProductionLikeEnvironment('dev'), false)
  assert.equal(isProductionLikeEnvironment('test'), false)
  assert.equal(isProductionLikeEnvironment('production'), true)
  assert.equal(isProductionLikeEnvironment('staging'), true)
  assert.equal(isProductionLikeEnvironment(''), false)
})

test('database URL password parsing covers encoded and malformed values', () => {
  assert.equal(
    passwordFromDatabaseUrl('postgresql://campus_wall:campus_wall_dev@127.0.0.1:5432/campus_wall'),
    'campus_wall_dev'
  )
  assert.equal(
    passwordFromDatabaseUrl('postgresql://campus_wall:p%40ss@127.0.0.1/campus_wall'),
    'p@ss'
  )
  assert.equal(passwordFromDatabaseUrl('not a url'), '')
  assert.equal(passwordFromDatabaseUrl(''), '')
})

test('default development database password is rejected from PG* and DATABASE_URL', () => {
  assert.equal(usesDisallowedDatabasePassword({ pgPassword: 'campus_wall_dev' }), true)
  assert.equal(usesDisallowedDatabasePassword({
    databaseUrl: 'postgresql://campus_wall:campus_wall_dev@127.0.0.1:5432/campus_wall'
  }), true)
  assert.equal(usesDisallowedDatabasePassword({ pgPassword: 'strong-password' }), false)
})
