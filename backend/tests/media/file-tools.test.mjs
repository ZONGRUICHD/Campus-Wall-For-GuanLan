import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { backendDir, config } from '../../src/config.js'
import {
  claimPendingUploads,
  cleanupExpiredUploads,
  createUploadBindingCredential,
  createUploadVisitorCredential,
  detectFileType,
  fileSignatureMatches,
  inspectFileSignature,
  isSafeStorageName,
  mergeFilesSequentially,
  registerPendingUpload,
  safeBasename,
  uniqueUploadName,
  uploadOwnerKey,
  verifyUploadBindingCredential,
  verifyUploadVisitorCredential,
  writeFileSecure
} from '../../src/services/fileTools.js'

const signatures = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  gif: Buffer.from('GIF89a', 'ascii'),
  webp: Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii')]),
  pdf: Buffer.from('%PDF-1.7\n', 'ascii'),
  mp4: Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypisom', 'ascii'), Buffer.alloc(8)]),
  m4a: Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypM4A ', 'ascii'), Buffer.alloc(8)]),
  mov: Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypqt  ', 'ascii'), Buffer.alloc(8)]),
  mp3: Buffer.from('ID3\u0004\u0000\u0000', 'binary'),
  wav: Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WAVE', 'ascii')]),
  avi: Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('AVI ', 'ascii')]),
  webm: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  aac: Buffer.from([0xff, 0xf1, 0x50, 0x80]),
  flac: Buffer.from('fLaC', 'ascii'),
  midi: Buffer.from('MThd\u0000\u0000\u0000\u0006', 'binary'),
  zip: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  text: Buffer.from('plain UTF-8 text\n你好\n', 'utf8')
}

test('detects supported media and document magic bytes', () => {
  for (const [type, signature] of Object.entries(signatures)) {
    assert.equal(detectFileType(signature), type)
  }
})

test('matches declared extensions to compatible signatures', () => {
  const samples = [
    ['image.png', signatures.png],
    ['image.jpg', signatures.jpeg],
    ['image.jpeg', signatures.jpeg],
    ['animation.gif', signatures.gif],
    ['image.webp', signatures.webp],
    ['document.pdf', signatures.pdf],
    ['video.mp4', signatures.mp4],
    ['audio.m4a', signatures.m4a],
    ['clip.mov', signatures.mov],
    ['song.mp3', signatures.mp3],
    ['sound.wav', signatures.wav],
    ['legacy.avi', signatures.avi],
    ['video.webm', signatures.webm],
    ['sound.aac', signatures.aac],
    ['sound.flac', signatures.flac],
    ['song.mid', signatures.midi],
    ['application.apk', signatures.zip],
    ['notes.txt', signatures.text]
  ]
  for (const [filename, signature] of samples) {
    assert.equal(fileSignatureMatches(filename, signature), true, filename)
  }
})

test('rejects extension spoofing and binary data presented as text', () => {
  assert.deepEqual(inspectFileSignature('fake.png', signatures.jpeg), {
    valid: false,
    extension: 'png',
    detectedType: 'jpeg'
  })
  assert.equal(fileSignatureMatches('fake.pdf', Buffer.from('<html>not a PDF</html>')), false)
  assert.equal(fileSignatureMatches('fake.txt', Buffer.from([0x00, 0x01, 0x02, 0xff])), false)
})

test('storage names reject traversal while display names are sanitized', () => {
  assert.equal(isSafeStorageName('safe_file.png'), true)
  assert.equal(isSafeStorageName('../safe_file.png'), false)
  assert.equal(isSafeStorageName('folder\\safe_file.png'), false)
  assert.equal(isSafeStorageName('linked/name.png'), false)
  assert.equal(safeBasename('../../bad?.png'), 'bad_.png')
  assert.ok(uniqueUploadName(`${'a'.repeat(400)}.png`).length <= 180)
})

test('short-lived upload credentials bind filename, visitor, and user', () => {
  const now = 1_800_000_000_000
  const secret = 'test-only-secret'
  const visitorId = '11111111-2222-4333-8444-555555555555'
  const visitorCredential = createUploadVisitorCredential({ visitorId, now, ttlMs: 1_000, secret })
  assert.equal(verifyUploadVisitorCredential(visitorCredential, { now, secret })?.visitorId, visitorId)
  assert.equal(verifyUploadVisitorCredential(visitorCredential, { now: now + 1_000, secret }), null)
  assert.equal(verifyUploadVisitorCredential(`${visitorCredential}x`, { now, secret }), null)

  const owner = uploadOwnerKey(visitorId, 42)
  const credential = createUploadBindingCredential('fresh.png', owner, {
    now,
    ttlMs: 1_000,
    nonce: 'fixed-test-nonce',
    secret
  })
  assert.equal(verifyUploadBindingCredential(credential, {
    filename: 'fresh.png',
    owner,
    now,
    secret
  })?.filename, 'fresh.png')
  assert.equal(verifyUploadBindingCredential(credential, {
    filename: 'fresh.png',
    owner: uploadOwnerKey(visitorId, 43),
    now,
    secret
  }), null)
  assert.equal(verifyUploadBindingCredential(credential, {
    filename: 'other.png',
    owner,
    now,
    secret
  }), null)
  assert.equal(verifyUploadBindingCredential(credential, {
    filename: 'fresh.png',
    owner,
    now: now + 1_000,
    secret
  }), null)
})

test('merges chunks in order with bounded streaming and removes failed output', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-wall-media-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const first = path.join(root, 'first.chunk')
  const second = path.join(root, 'second.chunk')
  const output = path.join(root, 'merged.bin')
  fs.writeFileSync(first, 'first-')
  fs.writeFileSync(second, 'second')

  const bytes = await mergeFilesSequentially([first, second], output, { maxBytes: 64 })
  assert.equal(bytes, 12)
  assert.equal(fs.readFileSync(output, 'utf8'), 'first-second')

  const rejectedOutput = path.join(root, 'too-large.bin')
  await assert.rejects(
    mergeFilesSequentially([first, second], rejectedOutput, { maxBytes: 4 }),
    /size limit/
  )
  assert.equal(fs.existsSync(rejectedOutput), false)
})

test('secure writes refuse symbolic-link destinations', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-wall-symlink-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const actual = path.join(root, 'actual.txt')
  const linked = path.join(root, 'linked.txt')
  fs.writeFileSync(actual, 'unchanged')
  fs.symlinkSync(actual, linked)

  assert.throws(() => writeFileSecure(linked, 'replaced', { replace: true }), /Unsafe output path/)
  assert.equal(fs.readFileSync(actual, 'utf8'), 'unchanged')
})

test('expired unbound uploads are removed without deleting referenced files', (t) => {
  const root = fs.mkdtempSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '.cleanup-'))
  const originalFolders = {
    uploadFolder: config.uploadFolder,
    chunkFolder: config.chunkFolder,
    tinyFolder: config.tinyFolder
  }
  t.after(() => {
    Object.assign(config, originalFolders)
    fs.rmSync(root, { recursive: true, force: true })
  })
  const relativeRoot = path.relative(backendDir, root)
  config.uploadFolder = path.join(relativeRoot, 'uploads')
  config.chunkFolder = path.join(relativeRoot, 'chunks')
  config.tinyFolder = path.join(relativeRoot, 'tiny')
  fs.mkdirSync(path.join(root, 'uploads'), { recursive: true })
  fs.mkdirSync(path.join(root, 'chunks'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tiny'), { recursive: true })

  const visitorId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const owner = uploadOwnerKey(visitorId)
  const expiredAt = Date.now() - 2_000
  writeFileSecure(path.join(root, 'uploads', 'unbound.pdf'), signatures.pdf)
  registerPendingUpload('unbound.pdf', owner, { now: expiredAt, ttlMs: 1_000 })
  writeFileSecure(path.join(root, 'uploads', 'referenced.pdf'), signatures.pdf)
  registerPendingUpload('referenced.pdf', owner, { now: expiredAt, ttlMs: 1_000 })
  writeFileSecure(path.join(root, 'uploads', 'fresh.pdf'), signatures.pdf)
  registerPendingUpload('fresh.pdf', owner)

  assert.throws(
    () => claimPendingUploads(['fresh.pdf'], uploadOwnerKey('ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb')),
    (error) => error?.code === 'INVALID_UPLOAD_BINDING'
  )
  const claim = claimPendingUploads(['fresh.pdf'], owner)
  claim.commit()
  assert.throws(
    () => claimPendingUploads(['fresh.pdf'], owner),
    (error) => error?.code === 'INVALID_UPLOAD_BINDING'
  )

  const result = cleanupExpiredUploads({
    now: Date.now(),
    isReferenced: (filename) => filename === 'referenced.pdf'
  })
  assert.equal(result.manifests, 2)
  assert.equal(fs.existsSync(path.join(root, 'uploads', 'unbound.pdf')), false)
  assert.equal(fs.existsSync(path.join(root, 'uploads', 'referenced.pdf')), true)
})
