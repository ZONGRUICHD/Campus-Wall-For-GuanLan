#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const roots = ['src', 'scripts', 'migrations']
const extensions = new Set(['.js', '.mjs', '.cjs'])

const collect = (directory) => {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collect(target))
    else if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(target)
  }
  return files
}

const files = roots.flatMap((root) => collect(path.join(backendDirectory, root))).sort()
for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' })
}
console.log(`Checked ${files.length} backend JavaScript file(s).`)
