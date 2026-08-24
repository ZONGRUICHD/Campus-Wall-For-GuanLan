import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { promisify, TextDecoder } from 'node:util'
import sharp from 'sharp'
import { config, resolveBackend, projectRoot } from '../config.js'

const execFileAsync = promisify(execFile)
const maxSafeBasenameLength = 180
const maxSignatureProbeSize = 64
const pendingUploadDirectoryName = '.pending-uploads'
const noFollowFlag = fs.constants.O_NOFOLLOW || 0
const uploadCredentialVersion = 1
export const uploadVisitorCookieName = 'pending_upload_visitor'

const lstatIfExists = (target) => {
  try {
    return fs.lstatSync(target)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

const assertSecureDirectory = (target) => {
  const resolved = path.resolve(target)
  const canonical = path.resolve(fs.realpathSync(resolved))
  if (!fs.statSync(canonical).isDirectory()) throw new Error('Unsafe storage directory')
  return canonical
}

const ensureSecureDirectory = (target) => {
  fs.mkdirSync(target, { recursive: true, mode: 0o700 })
  return assertSecureDirectory(target)
}

export const ensureRuntimeDirs = () => {
  for (const dir of [config.uploadFolder, config.chunkFolder, config.avatarFolder, config.tinyFolder, path.join('static', 'apps', 'icons'), 'help', 'logs']) {
    ensureSecureDirectory(resolveBackend(dir))
  }
  ensureSecureDirectory(resolveBackend(config.chunkFolder, pendingUploadDirectoryName))
  const noticeFile = resolveBackend('static', 'notice.json')
  if (!fs.existsSync(noticeFile)) fs.writeFileSync(noticeFile, '[]\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 })
}

export const getExtension = (filename = '') => path.extname(String(filename || '')).slice(1).toLowerCase()

export const allowedFile = (filename = '') => {
  const ext = getExtension(filename)
  return Boolean(ext && config.allowedExtensions.has(ext))
}

export const isImageFile = (filename = '') => ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'].includes(getExtension(filename))

export const isVideoFile = (filename = '') => ['mp4', 'avi', 'mov', 'webm', 'ogg', 'flv', 'mkv'].includes(getExtension(filename))

export const safeBasename = (filename = 'file') => {
  const cleaned = path.basename(String(filename || 'file')).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'file'
  if (cleaned.length <= maxSafeBasenameLength) return cleaned
  const ext = path.extname(cleaned).slice(0, 24)
  const stem = cleaned.slice(0, cleaned.length - ext.length)
  const digest = createHash('sha256').update(cleaned).digest('hex').slice(0, 16)
  const maxStemLength = Math.max(1, maxSafeBasenameLength - ext.length - digest.length - 1)
  return `${stem.slice(0, maxStemLength)}_${digest}${ext}`
}

export const isSafeStorageName = (filename) => {
  if (typeof filename !== 'string' || !filename || filename.length > maxSafeBasenameLength) return false
  if (filename === '.' || filename === '..' || filename.includes('/') || filename.includes('\\') || filename.includes('\0')) return false
  return path.basename(filename) === filename && safeBasename(filename) === filename
}

const assertSafeStorageName = (filename) => {
  if (!isSafeStorageName(filename)) throw new Error('Invalid file path')
  return filename
}

const resolveInside = (baseDir, filename) => {
  const base = assertSecureDirectory(baseDir)
  const storageName = assertSafeStorageName(filename)
  const target = path.resolve(base, storageName)
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error('Invalid file path')
  const stat = lstatIfExists(target)
  if (stat?.isSymbolicLink()) throw new Error('Symbolic links are not allowed')
  return target
}

const assertRegularFile = (target) => {
  const stat = lstatIfExists(target)
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error('Expected a regular file')
  return stat
}

export const uniqueUploadName = (originalName) => safeBasename(`${randomUUID()}_${safeBasename(originalName)}`)

export const uploadPath = (filename) => resolveInside(resolveBackend(config.uploadFolder), filename)

export const tinyPath = (filename) => resolveInside(resolveBackend(config.tinyFolder), filename)

const validateClientFileKey = (fileKey) => {
  const value = String(fileKey || '')
  if (!value.trim() || value.length > 4096 || value.includes('/') || value.includes('\\') || /[\x00-\x1F\x7F]/.test(value)) {
    throw new Error('Invalid file key')
  }
  return value
}

export const chunkRoot = (fileKey, owner = '') => {
  const key = validateClientFileKey(fileKey)
  const ownerKey = String(owner || '')
  if (ownerKey.length > 512 || /[\x00-\x1F\x7F]/.test(ownerKey)) throw new Error('Invalid upload owner')
  const digest = createHash('sha256').update(ownerKey).update('\0').update(key).digest('hex')
  return resolveInside(resolveBackend(config.chunkFolder), `chunk_${digest}`)
}

export const writeFileSecure = (target, data, { replace = false } = {}) => {
  assertSecureDirectory(path.dirname(target))
  const existing = lstatIfExists(target)
  if (existing?.isSymbolicLink() || existing?.isDirectory()) throw new Error('Unsafe output path')
  if (!replace) {
    fs.writeFileSync(target, data, { flag: 'wx', mode: 0o600 })
    return
  }
  const temporary = path.join(path.dirname(target), `.write-${randomUUID()}.tmp`)
  try {
    fs.writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 })
    fs.renameSync(temporary, target)
  } finally {
    try { fs.rmSync(temporary, { force: true }) } catch {}
  }
}

const startsWithBytes = (buffer, bytes, offset = 0) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < offset + bytes.length) return false
  return bytes.every((value, index) => buffer[offset + index] === value)
}

const asciiAt = (buffer, start, length) => buffer.subarray(start, start + length).toString('ascii')

const isUtf8Text = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    for (const character of text) {
      const code = character.codePointAt(0)
      if ((code < 0x20 && ![0x09, 0x0a, 0x0c, 0x0d].includes(code)) || code === 0x7f) return false
    }
    return true
  } catch {
    return false
  }
}

export const detectFileType = (value) => {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || [])
  if (startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWithBytes(buffer, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(asciiAt(buffer, 0, 6))) return 'gif'
  if (buffer.length >= 12 && asciiAt(buffer, 0, 4) === 'RIFF') {
    const kind = asciiAt(buffer, 8, 4)
    if (kind === 'WEBP') return 'webp'
    if (kind === 'WAVE') return 'wav'
    if (kind === 'AVI ') return 'avi'
  }
  if (buffer.length >= 5 && asciiAt(buffer, 0, 5) === '%PDF-') return 'pdf'
  if (buffer.length >= 12 && buffer.readUInt32BE(0) >= 12 && asciiAt(buffer, 4, 4) === 'ftyp') {
    const brand = asciiAt(buffer, 8, 4)
    if (brand === 'qt  ') return 'mov'
    if (['M4A ', 'M4B ', 'M4P '].includes(brand)) return 'm4a'
    return 'mp4'
  }
  if (buffer.length >= 8 && ['moov', 'mdat', 'wide', 'pnot'].includes(asciiAt(buffer, 4, 4))) return 'mov'
  if (buffer.length >= 4 && startsWithBytes(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm'
  if (buffer.length >= 4 && asciiAt(buffer, 0, 4) === 'fLaC') return 'flac'
  if (buffer.length >= 4 && asciiAt(buffer, 0, 4) === 'MThd') return 'midi'
  if (buffer.length >= 4 && ['ADIF'].includes(asciiAt(buffer, 0, 4))) return 'aac'
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) return 'aac'
  if (buffer.length >= 3 && asciiAt(buffer, 0, 3) === 'ID3') return 'mp3'
  if (buffer.length >= 4 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    const layer = (buffer[1] >> 1) & 0x03
    const bitrate = (buffer[2] >> 4) & 0x0f
    const sampleRate = (buffer[2] >> 2) & 0x03
    if (layer !== 0 && bitrate !== 0 && bitrate !== 0x0f && sampleRate !== 0x03) return 'mp3'
  }
  if (buffer.length >= 4 && startsWithBytes(buffer, [0x50, 0x4b]) && [[0x03, 0x04], [0x05, 0x06], [0x07, 0x08]].some(([a, b]) => buffer[2] === a && buffer[3] === b)) return 'zip'
  if (isUtf8Text(buffer)) return 'text'
  return null
}

const compatibleMagicTypes = {
  txt: new Set(['text']),
  pdf: new Set(['pdf']),
  png: new Set(['png']),
  jpg: new Set(['jpeg']),
  jpeg: new Set(['jpeg']),
  gif: new Set(['gif']),
  webp: new Set(['webp']),
  mp3: new Set(['mp3']),
  wav: new Set(['wav']),
  avi: new Set(['avi']),
  mp4: new Set(['mp4']),
  mov: new Set(['mov']),
  m4a: new Set(['mp4', 'm4a']),
  webm: new Set(['webm']),
  aac: new Set(['aac']),
  flac: new Set(['flac']),
  mid: new Set(['midi']),
  apk: new Set(['zip'])
}

export const inspectFileSignature = (filename, value) => {
  const extension = getExtension(filename)
  const detectedType = detectFileType(value)
  const valid = Boolean(config.allowedExtensions.has(extension) && compatibleMagicTypes[extension]?.has(detectedType))
  return { valid, extension, detectedType }
}

export const fileSignatureMatches = (filename, value) => inspectFileSignature(filename, value).valid

export const assertFileSignature = (filename, value) => {
  const result = inspectFileSignature(filename, value)
  if (!result.valid) {
    const error = new Error('File content does not match its extension')
    error.code = 'INVALID_FILE_SIGNATURE'
    throw error
  }
  return result
}

const validateDecodedText = (text) => {
  for (const character of text) {
    const code = character.codePointAt(0)
    if ((code < 0x20 && ![0x09, 0x0a, 0x0c, 0x0d].includes(code)) || code === 0x7f) return false
  }
  return true
}

export const assertFileMatchesExtension = async (filePath, declaredName, { maxBytes = config.maxContentLength } = {}) => {
  const handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | noFollowFlag)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) throw new Error('Invalid file size')
    if (getExtension(declaredName) === 'txt') {
      const decoder = new TextDecoder('utf-8', { fatal: true })
      const stream = handle.createReadStream({ autoClose: false })
      try {
        for await (const chunk of stream) {
          if (!validateDecodedText(decoder.decode(chunk, { stream: true }))) throw new Error('File content does not match its extension')
        }
        if (!validateDecodedText(decoder.decode())) throw new Error('File content does not match its extension')
      } catch (error) {
        if (error?.code === 'INVALID_FILE_SIGNATURE') throw error
        const invalid = new Error('File content does not match its extension')
        invalid.code = 'INVALID_FILE_SIGNATURE'
        throw invalid
      }
      return { valid: true, extension: 'txt', detectedType: 'text', size: stat.size }
    }
    const probe = Buffer.alloc(Math.min(maxSignatureProbeSize, stat.size))
    const { bytesRead } = await handle.read(probe, 0, probe.length, 0)
    const result = assertFileSignature(declaredName, probe.subarray(0, bytesRead))
    return { ...result, size: stat.size }
  } finally {
    await handle.close()
  }
}

export const mergeFilesSequentially = async (sourcePaths, outputPath, { maxBytes = config.maxContentLength } = {}) => {
  if (!Array.isArray(sourcePaths) || sourcePaths.length < 1) throw new Error('No chunks to merge')
  assertSecureDirectory(path.dirname(outputPath))
  if (lstatIfExists(outputPath)) throw new Error('Output file already exists')
  let output = null
  let totalBytes = 0
  try {
    output = await fs.promises.open(
      outputPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollowFlag,
      0o600
    )
    for (const sourcePath of sourcePaths) {
      const sourceStat = assertRegularFile(sourcePath)
      if (sourceStat.size < 1 || totalBytes + sourceStat.size > maxBytes) throw new Error('Merged file exceeds the size limit')
      const input = fs.createReadStream(sourcePath, { flags: fs.constants.O_RDONLY | noFollowFlag })
      let sourceBytes = 0
      for await (const chunk of input) {
        sourceBytes += chunk.length
        totalBytes += chunk.length
        if (totalBytes > maxBytes) throw new Error('Merged file exceeds the size limit')
        let offset = 0
        while (offset < chunk.length) {
          const { bytesWritten } = await output.write(chunk, offset, chunk.length - offset, null)
          if (bytesWritten < 1) throw new Error('Failed to write merged file')
          offset += bytesWritten
        }
      }
      if (sourceBytes !== sourceStat.size) throw new Error('Chunk changed while it was being merged')
    }
    await output.close()
    output = null
    return totalBytes
  } catch (error) {
    if (output) try { await output.close() } catch {}
    try { fs.rmSync(outputPath, { force: true }) } catch {}
    throw error
  }
}

const encodeSignedPayload = (payload, secret = config.secretKey) => {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

const decodeSignedPayload = (credential, secret = config.secretKey) => {
  if (typeof credential !== 'string') return null
  const parts = credential.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const expected = createHmac('sha256', secret).update(parts[0]).digest()
  let actual
  try {
    actual = Buffer.from(parts[1], 'base64url')
  } catch {
    return null
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

export const createUploadVisitorCredential = ({
  visitorId = randomUUID(),
  now = Date.now(),
  ttlMs = config.uploadBindingTtlMs,
  secret = config.secretKey
} = {}) => encodeSignedPayload({
  v: uploadCredentialVersion,
  purpose: 'upload-visitor',
  visitorId,
  exp: now + ttlMs
}, secret)

export const verifyUploadVisitorCredential = (credential, { now = Date.now(), secret = config.secretKey } = {}) => {
  const payload = decodeSignedPayload(credential, secret)
  if (payload?.v !== uploadCredentialVersion || payload?.purpose !== 'upload-visitor') return null
  if (!/^[a-f0-9-]{36}$/i.test(String(payload.visitorId || '')) || !Number.isFinite(payload.exp) || payload.exp <= now) return null
  return payload
}

export const uploadOwnerKey = (visitorId, userId = null) => {
  if (!/^[a-f0-9-]{36}$/i.test(String(visitorId || ''))) throw new Error('Invalid upload visitor')
  if (userId === null || userId === undefined) return `visitor:${visitorId}`
  const id = Number(userId)
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid upload user')
  return `user:${id}:visitor:${visitorId}`
}

export const createUploadBindingCredential = (filename, owner, {
  now = Date.now(),
  ttlMs = config.uploadBindingTtlMs,
  nonce = randomUUID(),
  secret = config.secretKey
} = {}) => {
  assertSafeStorageName(filename)
  if (!owner || String(owner).length > 512) throw new Error('Invalid upload owner')
  return encodeSignedPayload({
    v: uploadCredentialVersion,
    purpose: 'pending-upload',
    filename,
    owner: String(owner),
    nonce,
    createdAt: now,
    exp: now + ttlMs
  }, secret)
}

export const verifyUploadBindingCredential = (credential, {
  filename,
  owner,
  now = Date.now(),
  secret = config.secretKey
} = {}) => {
  const payload = decodeSignedPayload(credential, secret)
  if (payload?.v !== uploadCredentialVersion || payload?.purpose !== 'pending-upload') return null
  if (!isSafeStorageName(payload.filename) || payload.filename !== filename || payload.owner !== owner) return null
  if (!Number.isFinite(payload.createdAt) || !Number.isFinite(payload.exp) || payload.exp <= now || payload.createdAt > now + 60_000) return null
  return payload
}

const pendingUploadRoot = () => ensureSecureDirectory(resolveBackend(config.chunkFolder, pendingUploadDirectoryName))

const pendingManifestName = (filename) => `${createHash('sha256').update(assertSafeStorageName(filename)).digest('hex')}.json`

const pendingManifestPath = (filename) => resolveInside(pendingUploadRoot(), pendingManifestName(filename))

export const registerPendingUpload = (filename, owner, options = {}) => {
  assertRegularFile(uploadPath(filename))
  const credential = createUploadBindingCredential(filename, owner, options)
  const manifest = {
    filename,
    credential,
    createdAt: options.now ?? Date.now()
  }
  writeFileSecure(pendingManifestPath(filename), `${JSON.stringify(manifest)}\n`)
  return credential
}

const readPendingManifest = (manifestPath) => {
  assertRegularFile(manifestPath)
  const fd = fs.openSync(manifestPath, fs.constants.O_RDONLY | noFollowFlag)
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.size < 2 || stat.size > 16 * 1024) throw new Error('Invalid upload manifest')
    const value = JSON.parse(fs.readFileSync(fd, 'utf8'))
    if (!value || typeof value !== 'object' || !isSafeStorageName(value.filename) || typeof value.credential !== 'string') {
      throw new Error('Invalid upload manifest')
    }
    return value
  } finally {
    fs.closeSync(fd)
  }
}

const uploadBindingError = () => {
  const error = new Error('Upload is missing, expired, or belongs to another visitor')
  error.code = 'INVALID_UPLOAD_BINDING'
  return error
}

export const claimPendingUploads = (filenames, owner, { now = Date.now() } = {}) => {
  const uniqueNames = [...new Set((Array.isArray(filenames) ? filenames : [filenames]).map((value) => String(value || '')))]
  if (uniqueNames.length !== (Array.isArray(filenames) ? filenames.length : 1) || uniqueNames.some((filename) => !isSafeStorageName(filename))) {
    throw uploadBindingError()
  }
  const claims = []
  let settled = false
  const rollback = () => {
    if (settled) return
    for (const claim of claims.reverse()) {
      try {
        if (!lstatIfExists(claim.source)) fs.renameSync(claim.claimed, claim.source)
      } catch {}
    }
    settled = true
  }
  try {
    for (const filename of uniqueNames) {
      const source = pendingManifestPath(filename)
      const claimed = resolveInside(pendingUploadRoot(), `${pendingManifestName(filename)}.${randomUUID()}.claim`)
      try {
        fs.renameSync(source, claimed)
      } catch {
        throw uploadBindingError()
      }
      const claim = { filename, source, claimed, credential: '' }
      claims.push(claim)
      let manifest
      try {
        manifest = readPendingManifest(claimed)
      } catch {
        throw uploadBindingError()
      }
      if (manifest.filename !== filename || !verifyUploadBindingCredential(manifest.credential, { filename, owner, now })) {
        throw uploadBindingError()
      }
      assertRegularFile(uploadPath(filename))
      claim.credential = manifest.credential
    }
  } catch (error) {
    rollback()
    throw error
  }
  return {
    filenames: uniqueNames,
    credentials: claims.map((claim) => claim.credential),
    commit() {
      if (settled) return
      for (const claim of claims) {
        try { fs.rmSync(claim.claimed, { force: true }) } catch {}
      }
      settled = true
    },
    rollback
  }
}

export const cleanupExpiredUploads = ({ now = Date.now(), isReferenced = null } = {}) => {
  const result = { uploads: 0, manifests: 0, chunks: 0, staging: 0 }
  const manifestsRoot = pendingUploadRoot()
  const activeUploads = new Set()
  for (const entry of fs.readdirSync(manifestsRoot)) {
    const manifestPath = path.join(manifestsRoot, entry)
    const stat = lstatIfExists(manifestPath)
    if (!stat) continue
    if (stat.isSymbolicLink()) {
      fs.rmSync(manifestPath, { force: true })
      result.manifests += 1
      continue
    }
    if (!stat.isFile()) continue
    try {
      const manifest = readPendingManifest(manifestPath)
      const payload = decodeSignedPayload(manifest.credential)
      const valid = payload?.v === uploadCredentialVersion &&
        payload?.purpose === 'pending-upload' &&
        payload.filename === manifest.filename &&
        isSafeStorageName(payload.filename) &&
        Number.isFinite(payload.exp)
      const claimGrace = entry.endsWith('.claim') ? config.uploadCleanupIntervalMs : 0
      if (valid && payload.exp + claimGrace <= now) {
        if (typeof isReferenced !== 'function' || !isReferenced(payload.filename)) {
          removeUploadedFiles([payload.filename])
          result.uploads += 1
        }
        fs.rmSync(manifestPath, { force: true })
        result.manifests += 1
      } else if (valid) {
        activeUploads.add(payload.filename)
      } else if (!valid && stat.mtimeMs + config.uploadBindingTtlMs <= now) {
        fs.rmSync(manifestPath, { force: true })
        result.manifests += 1
      }
    } catch {
      if (stat.mtimeMs + config.uploadBindingTtlMs <= now) {
        fs.rmSync(manifestPath, { force: true })
        result.manifests += 1
      }
    }
  }

  const uploadsRoot = assertSecureDirectory(resolveBackend(config.uploadFolder))
  for (const entry of fs.readdirSync(uploadsRoot)) {
    const target = path.join(uploadsRoot, entry)
    const stat = lstatIfExists(target)
    if (!stat) continue
    if ((entry.startsWith('.upload-') || entry.startsWith('.write-')) && stat.mtimeMs + config.uploadBindingTtlMs <= now) {
      fs.rmSync(target, { force: true })
      result.staging += 1
      continue
    }
    if (typeof isReferenced !== 'function' || activeUploads.has(entry) || stat.mtimeMs + config.uploadBindingTtlMs > now) continue
    if (stat.isSymbolicLink()) {
      fs.rmSync(target, { force: true })
      result.uploads += 1
      continue
    }
    if (!stat.isFile() || !isSafeStorageName(entry)) continue
    try {
      if (!isReferenced(entry)) {
        removeUploadedFiles([entry])
        result.uploads += 1
      }
    } catch {
      // A reference lookup failure must never delete user data.
    }
  }

  const chunksRoot = assertSecureDirectory(resolveBackend(config.chunkFolder))
  for (const entry of fs.readdirSync(chunksRoot)) {
    if (entry === pendingUploadDirectoryName || !entry.startsWith('chunk_')) continue
    const target = path.join(chunksRoot, entry)
    const stat = lstatIfExists(target)
    if (!stat) continue
    if (stat.isSymbolicLink()) {
      fs.rmSync(target, { force: true })
      result.chunks += 1
    } else if (stat.isDirectory() && stat.mtimeMs + config.chunkUploadTtlMs <= now) {
      fs.rmSync(target, { recursive: true, force: true })
      result.chunks += 1
    }
  }
  return result
}

export const convertImageToPng = async (filename) => {
  if (!isImageFile(filename) || getExtension(filename) === 'png') return filename
  const root = filename.slice(0, -path.extname(filename).length)
  const next = `${root}.png`
  try {
    await sharp(uploadPath(filename)).png({ quality: 95 }).toFile(uploadPath(next))
    await assertFileMatchesExtension(uploadPath(next), next)
    return next
  } catch (error) {
    try { fs.rmSync(uploadPath(next), { force: true }) } catch {}
    throw error
  }
}

export const convertVideoToMp4 = async (filename) => {
  if (!isVideoFile(filename) || getExtension(filename) === 'mp4') return filename
  const root = filename.slice(0, -path.extname(filename).length)
  const next = `${root}.mp4`
  try {
    await execFileAsync('ffmpeg', ['-i', uploadPath(filename), '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', uploadPath(next)], { timeout: config.ffmpegTimeoutMs })
    await assertFileMatchesExtension(uploadPath(next), next)
    return next
  } catch {
    try { fs.rmSync(uploadPath(next), { force: true }) } catch {}
    return filename
  }
}

export const makeTinyFiles = async (filenames) => {
  const items = Array.isArray(filenames) ? filenames : [filenames]
  ensureSecureDirectory(resolveBackend(config.tinyFolder))
  for (const rawName of items) {
    if (!isSafeStorageName(rawName)) continue
    const filename = rawName
    const input = uploadPath(filename)
    try {
      assertRegularFile(input)
    } catch {
      continue
    }
    if (isImageFile(filename)) {
      try {
        await sharp(input).resize({ height: 100 }).toFile(tinyPath(filename))
      } catch {}
      continue
    }
    if (isVideoFile(filename)) {
      try {
        await execFileAsync('ffmpeg', ['-i', input, '-vf', 'scale=-1:100', '-r', '24', '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-an', '-y', tinyPath(filename)], { timeout: config.ffmpegTimeoutMs })
      } catch {}
    }
  }
}

export const processUploadedFile = async (filename) => {
  assertSafeStorageName(filename)
  await assertFileMatchesExtension(uploadPath(filename), filename)
  let next = filename
  if (isImageFile(next)) next = await convertImageToPng(next)
  else if (isVideoFile(next)) next = await convertVideoToMp4(next)
  if (next !== filename) {
    try { fs.rmSync(uploadPath(filename), { force: true }) } catch {}
  }
  makeTinyFiles([next]).catch(() => {})
  return next
}

export const removeUploadedFiles = (filenames = []) => {
  const items = Array.isArray(filenames) ? filenames : [filenames]
  for (const rawName of new Set(items.filter(isSafeStorageName))) {
    for (const resolveFile of [uploadPath, tinyPath]) {
      try { fs.rmSync(resolveFile(rawName), { force: true }) } catch {}
    }
  }
}

export const findAppConfigs = () => {
  const dirs = [
    resolveBackend('static', 'apps'),
    path.resolve(projectRoot, 'frontend', 'public', 'static', 'apps')
  ]
  const apps = []
  const seen = new Set()
  for (const appsDir of dirs) {
    if (!fs.existsSync(appsDir)) continue
    for (const appDirName of fs.readdirSync(appsDir)) {
      const configPath = path.join(appsDir, appDirName, 'config.json')
      if (!fs.existsSync(configPath)) continue
      try {
        const appConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        const key = appConfig.name || appDirName
        if (seen.has(key)) continue
        seen.add(key)
        apps.push(appConfig)
      } catch {}
    }
  }
  return apps
}
