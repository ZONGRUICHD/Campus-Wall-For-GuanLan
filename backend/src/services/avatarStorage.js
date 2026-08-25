import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config, resolveBackend } from '../config.js'
import { safeBasename } from './fileTools.js'

const removeFile = async (filePath) => fs.promises.rm(filePath, { force: true }).catch(() => {})

export const storeAvatarReplacement = async ({
  userId,
  buffer,
  swapAvatar,
  isAvatarReferenced,
  avatarDir = resolveBackend(config.avatarFolder)
}) => {
  const id = Number(userId)
  if (!Number.isSafeInteger(id) || id <= 0 || !Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('Invalid avatar replacement input')
  }
  if (typeof swapAvatar !== 'function' || typeof isAvatarReferenced !== 'function') {
    throw new Error('Avatar storage callbacks are required')
  }

  await fs.promises.mkdir(avatarDir, { recursive: true })
  const filename = safeBasename(`user_${id}_${randomUUID()}.webp`)
  const finalPath = path.resolve(avatarDir, filename)
  const temporaryPath = path.resolve(avatarDir, `.${filename}.${randomUUID()}.tmp`)
  const resolvedAvatarDir = path.resolve(avatarDir)
  if (!finalPath.startsWith(`${resolvedAvatarDir}${path.sep}`) || !temporaryPath.startsWith(`${resolvedAvatarDir}${path.sep}`)) {
    throw new Error('Invalid avatar storage path')
  }

  try {
    await fs.promises.writeFile(temporaryPath, buffer, { flag: 'wx', mode: 0o640 })
    await fs.promises.rename(temporaryPath, finalPath)
  } catch (error) {
    await Promise.all([removeFile(temporaryPath), removeFile(finalPath)])
    throw error
  }

  let replacement
  try {
    replacement = await swapAvatar(filename)
    if (!replacement?.user) throw new Error('Avatar account is unavailable')
  } catch (error) {
    await removeFile(finalPath)
    throw error
  }

  const previousAvatarFile = String(replacement.previousAvatarFile || '').trim()
  if (previousAvatarFile && previousAvatarFile !== filename) {
    try {
      const previousFilename = safeBasename(previousAvatarFile)
      if (!await isAvatarReferenced(previousFilename)) {
        await removeFile(path.resolve(resolvedAvatarDir, previousFilename))
      }
    } catch {
      // Keeping an old file is safer than breaking an avatar when cleanup cannot be verified.
    }
  }

  return { ...replacement, filename }
}
