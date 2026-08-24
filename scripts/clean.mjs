#!/usr/bin/env node

import { access, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheTargets = [
  '.nyc_output',
  'coverage',
  'backend/coverage',
  'frontend/coverage',
  'frontend/dist',
  'frontend/playwright-report',
  'frontend/test-results',
  'node_modules/.cache',
  'node_modules/.vite',
  'node_modules/.vite-temp',
  'frontend/node_modules/.cache',
  'frontend/node_modules/.vite',
  'frontend/node_modules/.vite-temp'
]

const removed = []
for (const relativePath of cacheTargets) {
  const target = path.resolve(root, relativePath)
  try {
    await access(target)
  } catch {
    continue
  }
  await rm(target, { recursive: true, force: true })
  removed.push(relativePath)
}

console.log(removed.length
  ? `Removed ${removed.length} generated cache/output path(s): ${removed.join(', ')}`
  : 'No generated caches or build outputs found.')
