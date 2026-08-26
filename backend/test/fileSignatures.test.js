import assert from 'node:assert/strict'
import test from 'node:test'
import { FileContentError, assertAllowedFileContents, matchesAllowedFileContents } from '../src/services/fileSignatures.js'

const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0])
const pdfHeader = Buffer.from('%PDF-1.7 leftover')
const mzHeader = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
const mp4Header = Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0])

test('allowed attachments must match magic bytes, not just the extension', () => {
  assert.equal(matchesAllowedFileContents('photo.png', pngHeader), true)
  assert.equal(matchesAllowedFileContents('photo.png', pdfHeader), false)
  assert.equal(matchesAllowedFileContents('doc.pdf', pdfHeader), true)
  assert.equal(matchesAllowedFileContents('doc.pdf', mzHeader), false)
  assert.equal(matchesAllowedFileContents('clip.mp4', mp4Header), true)
  assert.equal(matchesAllowedFileContents('notes.txt', Buffer.from('hello')), true)
  assert.equal(matchesAllowedFileContents('notes.txt', Buffer.alloc(0)), true)
  assert.equal(matchesAllowedFileContents('notes.txt', mzHeader), false)
})

test('assertAllowedFileContents rejects disguised binaries', () => {
  assert.doesNotThrow(() => assertAllowedFileContents('doc.pdf', pdfHeader))
  assert.throws(
    () => assertAllowedFileContents('doc.pdf', mzHeader),
    (error) => error instanceof FileContentError && error.status === 400
  )
})
