import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import sharp from 'sharp'
import { config } from '../src/config.js'
import { avatarUpload } from '../src/routes/users.js'

const withUploadServer = async (handler) => {
  const app = express()
  app.post('/avatar', avatarUpload, (req, res) => {
    res.json({
      fieldname: req.file?.fieldname,
      mimetype: req.file?.mimetype,
      size: req.file?.size
    })
  })
  app.use((error, req, res, next) => {
    res.status(500).json({ error: error?.message || 'unexpected error' })
  })

  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  try {
    await handler(`http://127.0.0.1:${server.address().port}/avatar`)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

const tinyJpeg = () => sharp({
  create: {
    width: 8,
    height: 8,
    channels: 3,
    background: '#ffffff'
  }
}).jpeg().toBuffer()

test('accepts a browser-style multipart form containing one small avatar', async () => {
  await withUploadServer(async (url) => {
    const input = await tinyJpeg()
    const form = new FormData()
    form.append('avatar', new Blob([input], { type: 'image/jpeg' }), 'tiny.jpg')

    const response = await fetch(url, { method: 'POST', body: form })
    const payload = await response.json()

    assert.equal(response.status, 200)
    assert.equal(payload.fieldname, 'avatar')
    assert.equal(payload.mimetype, 'image/jpeg')
    assert.equal(payload.size, input.length)
  })
})

test('returns a specific error when an avatar exceeds the five MiB limit', async () => {
  await withUploadServer(async (url) => {
    const form = new FormData()
    form.append(
      'avatar',
      new Blob([Buffer.alloc(config.maxAvatarSize + 1)], { type: 'image/jpeg' }),
      'too-large.jpg'
    )

    const response = await fetch(url, { method: 'POST', body: form })
    const payload = await response.json()

    assert.equal(response.status, 413)
    assert.equal(payload.code, 'AVATAR_TOO_LARGE')
    assert.match(payload.error, /5MB/)
  })
})

test('rejects extra multipart fields without turning them into a generic server error', async () => {
  await withUploadServer(async (url) => {
    const input = await tinyJpeg()
    const form = new FormData()
    form.append('avatar', new Blob([input], { type: 'image/jpeg' }), 'tiny.jpg')
    form.append('unexpected', 'field')

    const response = await fetch(url, { method: 'POST', body: form })
    const payload = await response.json()

    assert.equal(response.status, 400)
    assert.equal(payload.code, 'INVALID_AVATAR_UPLOAD')
  })
})
