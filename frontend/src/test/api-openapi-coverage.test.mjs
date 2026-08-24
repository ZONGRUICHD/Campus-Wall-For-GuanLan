import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { parseOpenApiOperations } from '../../../tests/helpers/openapi.mjs'
import { frontendApiCases } from './fixtures/api-cases.mjs'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(testDirectory, '../../..')
const apiSource = (await readFile(path.join(root, 'frontend/src/services/api.js'), 'utf8'))
  .replace(/\r\n?/g, '\n')
const openapiSource = await readFile(path.join(root, 'contracts/openapi.yaml'), 'utf8')

const viteEnvironmentExpression = /import\.meta\.env\??\.VITE_API_BASE_URL \|\| ''/
assert.equal(apiSource.match(viteEnvironmentExpression)?.length, 1, 'the test loader expects one Vite API base expression')
const executableApiSource = apiSource.replace(
  viteEnvironmentExpression,
  "globalThis.__CAMPUSWALL_TEST_API_BASE_URL__ || ''"
)
globalThis.__CAMPUSWALL_TEST_API_BASE_URL__ = 'https://api.example.test'
const apiModuleUrl = `data:text/javascript;base64,${Buffer.from(executableApiSource).toString('base64')}`
const { default: api } = await import(apiModuleUrl)
delete globalThis.__CAMPUSWALL_TEST_API_BASE_URL__

const apiObjectStart = apiSource.indexOf('const api = {')
const apiObjectEnd = apiSource.lastIndexOf('\n}\n\nexport default api')
assert.ok(apiObjectStart >= 0 && apiObjectEnd > apiObjectStart)
const implementedMethodNames = [...apiSource
  .slice(apiObjectStart, apiObjectEnd)
  .matchAll(/^  ([A-Za-z][A-Za-z0-9_]*)\(/gm)]
  .map((match) => match[1])

const operationKeys = new Set(parseOpenApiOperations(openapiSource)
  .map((operation) => `${operation.method} ${operation.path}`))

test('the API invocation fixture covers every frontend API method exactly once', () => {
  const coveredMethodNames = frontendApiCases.map((entry) => entry.name)
  assert.equal(new Set(coveredMethodNames).size, coveredMethodNames.length, 'fixture method names must be unique')
  assert.deepEqual([...coveredMethodNames].sort(), [...implementedMethodNames].sort())
  assert.equal(frontendApiCases.filter((entry) => entry.method).length, 107)
  assert.deepEqual(
    frontendApiCases.filter((entry) => !entry.method).map((entry) => entry.name),
    ['adminGetCachedAdmin']
  )
})

test('every frontend API method invokes its declared OpenAPI operation or covered local accessor', async (t) => {
  const originalFetch = globalThis.fetch
  const hadWindow = Object.hasOwn(globalThis, 'window')
  const originalWindow = globalThis.window
  globalThis.window = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis)
  }

  t.after(() => {
    globalThis.fetch = originalFetch
    if (hadWindow) globalThis.window = originalWindow
    else delete globalThis.window
  })

  for (const entry of frontendApiCases) {
    await t.test(entry.name, async () => {
      const requests = []
      globalThis.fetch = async (input, init = {}) => {
        requests.push({ input: String(input), init })
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }

      await api[entry.name](...entry.args())
      if (!entry.method) {
        assert.equal(requests.length, 0, `${entry.name} is a local accessor and must not issue a request`)
        return
      }

      assert.ok(
        operationKeys.has(`${entry.method} ${entry.openapiPath}`),
        `${entry.name} targets missing OpenAPI operation ${entry.method} ${entry.openapiPath}`
      )
      assert.equal(requests.length, 1, `${entry.name} must issue exactly one request`)

      const request = requests[0]
      const url = new URL(request.input)
      assert.equal(url.origin, 'https://api.example.test')
      assert.equal(url.pathname, entry.requestPath)
      assert.equal(request.init.method, entry.method)
      assert.equal(request.init.credentials, 'include')
      assert.ok(request.init.signal instanceof AbortSignal)

      if (entry.query) {
        assert.deepEqual(Object.fromEntries(url.searchParams.entries()), entry.query)
      } else {
        assert.equal(url.search, '')
      }

      if (entry.method === 'GET') assert.equal(request.init.body, undefined)
      if (entry.name === 'adminPurgeTrashMessage' || entry.name === 'adminPurgeTrashComment') {
        assert.deepEqual(JSON.parse(request.init.body), { confirm: 'PURGE' })
      }
    })
  }
})
