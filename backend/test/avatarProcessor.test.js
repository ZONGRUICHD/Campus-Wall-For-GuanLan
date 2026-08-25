import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { AvatarImageError, processAvatarImage } from '../src/services/avatarProcessor.js'

const pixel = (data, width, channels, x, y) => {
  const offset = (y * width + x) * channels
  return [...data.subarray(offset, offset + channels)]
}

const rawBands = (width, height, bands) => {
  const data = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const colour = bands.find((band) => x < band.until)?.colour || bands.at(-1).colour
      const offset = (y * width + x) * 3
      data[offset] = colour[0]
      data[offset + 1] = colour[1]
      data[offset + 2] = colour[2]
    }
  }
  return data
}

test('centre-crops a wide image to a square WebP', async () => {
  const width = 1200
  const height = 600
  const raw = rawBands(width, height, [
    { until: 300, colour: [255, 0, 0] },
    { until: 900, colour: [0, 255, 0] },
    { until: width, colour: [0, 0, 255] }
  ])
  const input = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer()
  const output = await processAvatarImage(input, { maxEdge: 256 })
  const decoded = await sharp(output.buffer).raw().toBuffer({ resolveWithObject: true })

  assert.equal(output.info.format, 'webp')
  assert.equal(decoded.info.width, 256)
  assert.equal(decoded.info.height, 256)
  for (const [x, y] of [[32, 32], [223, 32], [32, 223], [223, 223]]) {
    const [red, green, blue] = pixel(decoded.data, decoded.info.width, decoded.info.channels, x, y)
    assert.ok(green > 210 && red < 45 && blue < 45, `expected green centre crop, got ${red},${green},${blue}`)
  }
})

test('auto-orients EXIF photos before the centre crop and removes metadata', async () => {
  const width = 800
  const height = 400
  const raw = rawBands(width, height, [
    { until: width / 2, colour: [255, 0, 0] },
    { until: width, colour: [0, 0, 255] }
  ])
  const input = await sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .withMetadata({ orientation: 6 })
    .toBuffer()
  const output = await processAvatarImage(input, { maxEdge: 200 })
  const metadata = await sharp(output.buffer).metadata()
  const decoded = await sharp(output.buffer).raw().toBuffer({ resolveWithObject: true })
  const top = pixel(decoded.data, decoded.info.width, decoded.info.channels, 100, 25)
  const bottom = pixel(decoded.data, decoded.info.width, decoded.info.channels, 100, 175)

  assert.ok(top[0] > 200 && top[2] < 50, `expected red at top, got ${top}`)
  assert.ok(bottom[2] > 200 && bottom[0] < 50, `expected blue at bottom, got ${bottom}`)
  assert.equal(metadata.orientation, undefined)
  assert.equal(metadata.exif, undefined)
})

test('shrinks a large image and compresses it to WebP', async () => {
  const width = 1000
  const height = 600
  const raw = Buffer.alloc(width * height * 3)
  let state = 123456789
  for (let index = 0; index < raw.length; index += 1) {
    state = (1103515245 * state + 12345) & 0x7fffffff
    raw[index] = state & 0xff
  }
  const input = await sharp(raw, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer()
  const output = await processAvatarImage(input)

  assert.equal(output.info.width, 512)
  assert.equal(output.info.height, 512)
  assert.ok(output.buffer.length < input.length)
  assert.ok(output.buffer.length < 500 * 1024)
})

test('keeps transparency while producing a square avatar', async () => {
  const width = 600
  const height = 400
  const raw = Buffer.alloc(width * height * 4)
  for (let y = 100; y < 300; y += 1) {
    for (let x = 200; x < 400; x += 1) {
      const offset = (y * width + x) * 4
      raw[offset] = 255
      raw[offset + 1] = 80
      raw[offset + 2] = 160
      raw[offset + 3] = 255
    }
  }
  const input = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer()
  const output = await processAvatarImage(input, { maxEdge: 200 })
  const decoded = await sharp(output.buffer).raw().toBuffer({ resolveWithObject: true })

  assert.equal(decoded.info.width, decoded.info.height)
  assert.equal(decoded.info.channels, 4)
  assert.ok(pixel(decoded.data, decoded.info.width, decoded.info.channels, 5, 5)[3] < 10)
  assert.ok(pixel(decoded.data, decoded.info.width, decoded.info.channels, 100, 100)[3] > 245)
})

test('rejects corrupt data and unsupported SVG content', async () => {
  await assert.rejects(
    processAvatarImage(Buffer.from('not an image')),
    (error) => error instanceof AvatarImageError && error.code === 'INVALID_AVATAR_IMAGE'
  )
  await assert.rejects(
    processAvatarImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')),
    (error) => error instanceof AvatarImageError && error.code === 'INVALID_AVATAR_IMAGE'
  )
})
