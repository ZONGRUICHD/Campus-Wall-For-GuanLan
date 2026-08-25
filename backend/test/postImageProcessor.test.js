import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import sharp from 'sharp'
import { ensureRuntimeDirs, processUploadedFile, removeUploadedFiles, tinyPath, uploadPath } from '../src/services/fileTools.js'
import { PostImageError, processPostImage } from '../src/services/postImageProcessor.js'

test('auto-orients, bounds and strips metadata from post photos', async () => {
  const input = await sharp({
    create: { width: 1200, height: 600, channels: 3, background: '#4267b2' }
  })
    .jpeg({ quality: 95 })
    .withMetadata({ orientation: 6 })
    .toBuffer()
  const output = await processPostImage(input, { maxEdge: 500 })
  const metadata = await sharp(output.buffer).metadata()

  assert.equal(output.info.format, 'webp')
  assert.equal(output.info.width, 250)
  assert.equal(output.info.height, 500)
  assert.equal(metadata.orientation, undefined)
  assert.equal(metadata.exif, undefined)
})

test('preserves PNG transparency in the compressed WebP', async () => {
  const input = await sharp({
    create: { width: 800, height: 500, channels: 4, background: { r: 255, g: 64, b: 128, alpha: 0.35 } }
  }).png().toBuffer()
  const output = await processPostImage(input, { maxEdge: 400 })
  const metadata = await sharp(output.buffer).metadata()
  const pixel = await sharp(output.buffer).raw().toBuffer()

  assert.equal(metadata.hasAlpha, true)
  assert.ok(pixel[3] > 70 && pixel[3] < 110, `expected retained alpha, got ${pixel[3]}`)
})

test('flattens GIF uploads to a static WebP first frame', async () => {
  const width = 320
  const height = 240
  const frameBytes = width * height * 4
  const frames = Buffer.alloc(frameBytes * 2)
  for (let offset = 0; offset < frameBytes; offset += 4) {
    frames[offset] = 255
    frames[offset + 3] = 255
  }
  for (let offset = frameBytes; offset < frames.length; offset += 4) {
    frames[offset + 2] = 255
    frames[offset + 3] = 255
  }
  const input = await sharp(frames, {
    raw: { width, height: height * 2, channels: 4, pageHeight: height }
  }).gif({ delay: [100, 100], loop: 0 }).toBuffer()
  const output = await processPostImage(input)
  const metadata = await sharp(output.buffer).metadata()
  const firstPixel = await sharp(output.buffer).raw().toBuffer()

  assert.equal(output.info.inputFormat, 'gif')
  assert.equal(output.info.inputPages, 2)
  assert.equal(output.info.flattenedAnimation, true)
  assert.equal(metadata.format, 'webp')
  assert.equal(metadata.pages ?? 1, 1)
  assert.ok(firstPixel[0] > 200 && firstPixel[2] < 50, `expected the red first frame, got ${firstPixel.subarray(0, 3)}`)
})

test('reduces noisy photos until they fit the configured byte budget', async () => {
  const width = 1200
  const height = 900
  const raw = Buffer.allocUnsafe(width * height * 3)
  let state = 0x12345678
  for (let index = 0; index < raw.length; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    raw[index] = state & 0xff
  }
  const input = await sharp(raw, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer()
  const output = await processPostImage(input, { maxEdge: 1000, maxOutputBytes: 100 * 1024 })

  assert.ok(output.buffer.length <= 100 * 1024)
  assert.ok(output.info.width < 1000)
})

test('rejects corrupt content and images above the decoded pixel ceiling', async () => {
  await assert.rejects(
    processPostImage(Buffer.from('not an image')),
    (error) => error instanceof PostImageError && error.code === 'INVALID_POST_IMAGE'
  )

  const input = await sharp({
    create: { width: 200, height: 200, channels: 3, background: '#ffffff' }
  }).png().toBuffer()
  await assert.rejects(
    processPostImage(input, { maxInputPixels: 10_000 }),
    (error) => error instanceof PostImageError && error.code === 'INVALID_POST_IMAGE'
  )
})

test('the shared upload pipeline keeps only display WebP plus its matching tiny file', async () => {
  ensureRuntimeDirs()
  const inputName = `${randomUUID()}_camera.jpg`
  let outputName = ''
  try {
    const input = await sharp({
      create: { width: 2600, height: 1800, channels: 3, background: '#6d5dfc' }
    }).jpeg({ quality: 96 }).toBuffer()
    fs.writeFileSync(uploadPath(inputName), input)

    outputName = await processUploadedFile(inputName)
    assert.match(outputName, /\.webp$/)
    assert.equal(fs.existsSync(uploadPath(inputName)), false)
    assert.equal(fs.existsSync(uploadPath(outputName)), true)
    assert.equal(fs.existsSync(tinyPath(outputName)), true)

    const main = await sharp(uploadPath(outputName)).metadata()
    const tiny = await sharp(tinyPath(outputName)).metadata()
    assert.equal(main.format, 'webp')
    assert.ok(Math.max(main.width, main.height) <= 2048)
    assert.equal(tiny.format, 'webp')
    assert.ok(Math.max(tiny.width, tiny.height) <= 320)
  } finally {
    removeUploadedFiles([inputName, outputName])
  }
})
