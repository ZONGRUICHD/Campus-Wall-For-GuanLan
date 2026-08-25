import assert from 'node:assert/strict'
import test from 'node:test'
import { publicModuleManifest } from '../src/services/moduleRegistry.js'

test('public module manifest is static, unique, and free of executable locations', () => {
  const modules = publicModuleManifest()
  assert.ok(modules.length > 0)
  assert.equal(new Set(modules.map((module) => module.id)).size, modules.length)
  for (const module of modules) {
    assert.match(module.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    assert.match(module.route, /^\//)
    assert.match(module.api_prefix, /^\/api(?:\/|$)/)
    assert.equal(typeof module.enabled, 'boolean')
    assert.equal(Object.hasOwn(module, 'script'), false)
    assert.equal(Object.hasOwn(module, 'component'), false)
    assert.equal(Object.hasOwn(module, 'import'), false)
  }

  modules[0].enabled = false
  assert.equal(publicModuleManifest()[0].enabled, true)
})
