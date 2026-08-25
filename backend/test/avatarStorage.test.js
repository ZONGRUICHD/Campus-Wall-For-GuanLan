import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { storeAvatarReplacement } from '../src/services/avatarStorage.js'

const makeDirectory = () => fs.promises.mkdtemp(path.join(os.tmpdir(), 'campuswall-avatar-'))
const listVisibleFiles = async (directory) => (await fs.promises.readdir(directory)).filter((name) => !name.startsWith('.')).sort()

test('atomically stores a replacement and removes the unreferenced old avatar', async (t) => {
  const avatarDir = await makeDirectory()
  t.after(() => fs.promises.rm(avatarDir, { recursive: true, force: true }))
  await fs.promises.writeFile(path.join(avatarDir, 'old.webp'), 'old')
  await fs.promises.writeFile(path.join(avatarDir, 'unrelated.webp'), 'keep')
  let current = 'old.webp'

  const result = await storeAvatarReplacement({
    userId: 7,
    buffer: Buffer.from('processed-avatar'),
    avatarDir,
    swapAvatar: async (filename) => {
      const previousAvatarFile = current
      current = filename
      return { user: { id: 7 }, previousAvatarFile }
    },
    isAvatarReferenced: async (filename) => filename === current
  })

  assert.equal(result.filename, current)
  assert.deepEqual(await listVisibleFiles(avatarDir), [current, 'unrelated.webp'].sort())
  assert.equal(await fs.promises.readFile(path.join(avatarDir, current), 'utf8'), 'processed-avatar')
})

test('removes the candidate and keeps the old avatar when the database swap fails', async (t) => {
  const avatarDir = await makeDirectory()
  t.after(() => fs.promises.rm(avatarDir, { recursive: true, force: true }))
  await fs.promises.writeFile(path.join(avatarDir, 'old.webp'), 'old')

  await assert.rejects(storeAvatarReplacement({
    userId: 8,
    buffer: Buffer.from('processed-avatar'),
    avatarDir,
    swapAvatar: async () => { throw new Error('database unavailable') },
    isAvatarReferenced: async () => true
  }), /database unavailable/)

  assert.deepEqual(await fs.promises.readdir(avatarDir), ['old.webp'])
})

test('concurrent replacements leave only the avatar referenced by the final swap', async (t) => {
  const avatarDir = await makeDirectory()
  t.after(() => fs.promises.rm(avatarDir, { recursive: true, force: true }))
  await fs.promises.writeFile(path.join(avatarDir, 'old.webp'), 'old')
  let current = 'old.webp'
  let lock = Promise.resolve()

  const swapAvatar = async (filename) => {
    const previousLock = lock
    let release
    lock = new Promise((resolve) => { release = resolve })
    await previousLock
    const previousAvatarFile = current
    await new Promise((resolve) => setImmediate(resolve))
    current = filename
    release()
    return { user: { id: 9 }, previousAvatarFile }
  }

  await Promise.all([
    storeAvatarReplacement({
      userId: 9,
      buffer: Buffer.from('first'),
      avatarDir,
      swapAvatar,
      isAvatarReferenced: async (filename) => filename === current
    }),
    storeAvatarReplacement({
      userId: 9,
      buffer: Buffer.from('second'),
      avatarDir,
      swapAvatar,
      isAvatarReferenced: async (filename) => filename === current
    })
  ])

  assert.deepEqual(await listVisibleFiles(avatarDir), [current])
  assert.ok(['first', 'second'].includes(await fs.promises.readFile(path.join(avatarDir, current), 'utf8')))
})
