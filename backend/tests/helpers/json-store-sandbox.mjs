import { randomUUID } from 'node:crypto'
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const loadJsonStoreModule = async (sourcePath, {
  files = {},
  config = {}
} = {}) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'campuswall-test-'))
  const servicesDirectory = path.join(root, 'services')
  await mkdir(servicesDirectory, { recursive: true })

  const stateKey = `__campuswall_test_${randomUUID().replaceAll('-', '')}`
  const state = {
    config: {
      maxTitleLength: 200,
      maxEmailLength: 320,
      maxTextLength: 10000,
      ...config
    },
    files: new Map(Object.entries(structuredClone(files)))
  }
  globalThis[stateKey] = state

  const destination = path.join(servicesDirectory, path.basename(sourcePath))
  await copyFile(sourcePath, destination)
  await writeFile(
    path.join(root, 'config.js'),
    `export const config = globalThis[${JSON.stringify(stateKey)}].config\n`,
    'utf8'
  )
  await writeFile(
    path.join(servicesDirectory, 'jsonStore.js'),
    [
      `const state = globalThis[${JSON.stringify(stateKey)}]`,
      'const clone = (value) => structuredClone(value)',
      "export const nowText = () => '2026-08-24T07:19:00.000Z'",
      'export const readJson = (name, fallback) => state.files.has(name) ? clone(state.files.get(name)) : clone(fallback)',
      'export const writeJson = (name, value) => { state.files.set(name, clone(value)) }',
      ''
    ].join('\n'),
    'utf8'
  )

  const module = await import(`${pathToFileURL(destination).href}?test=${randomUUID()}`)
  return {
    module,
    state,
    async cleanup() {
      delete globalThis[stateKey]
      await rm(root, { recursive: true, force: true })
    }
  }
}
