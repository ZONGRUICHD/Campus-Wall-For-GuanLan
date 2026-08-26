import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

export class FileContentError extends Error {
  constructor(message = '文件类型无效或不被支持', { status = 400 } = {}) {
    super(message)
    this.name = 'FileContentError'
    this.status = status
  }
}

const fileExtension = (filename = '') => path.extname(filename).slice(1).toLowerCase()

const bufferStartsWith = (buffer, bytes, offset = 0) => bytes.every((byte, index) => buffer[offset + index] === byte)

export const matchesAllowedFileContents = (filename = '', header = Buffer.alloc(0)) => {
  const ext = fileExtension(filename)
  if (!ext || !config.allowedExtensions.has(ext)) return false
  if (ext === 'txt') {
    return header.length === 0
      || (!bufferStartsWith(header, [0x4d, 0x5a]) && !bufferStartsWith(header, [0x7f, 0x45, 0x4c, 0x46]))
  }
  if (header.length < 4) return false
  if (ext === 'png') return bufferStartsWith(header, [0x89, 0x50, 0x4e, 0x47])
  if (ext === 'jpg' || ext === 'jpeg') return bufferStartsWith(header, [0xff, 0xd8, 0xff])
  if (ext === 'gif') return bufferStartsWith(header, [0x47, 0x49, 0x46, 0x38])
  if (ext === 'webp') return bufferStartsWith(header, [0x52, 0x49, 0x46, 0x46]) && header.subarray(8, 12).toString('ascii') === 'WEBP'
  if (ext === 'pdf') return bufferStartsWith(header, [0x25, 0x50, 0x44, 0x46])
  if (ext === 'wav') return bufferStartsWith(header, [0x52, 0x49, 0x46, 0x46]) && header.subarray(8, 12).toString('ascii') === 'WAVE'
  if (ext === 'avi') return bufferStartsWith(header, [0x52, 0x49, 0x46, 0x46]) && header.subarray(8, 12).toString('ascii') === 'AVI '
  if (ext === 'mp3') return bufferStartsWith(header, [0x49, 0x44, 0x33]) || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)
  if (ext === 'flac') return header.subarray(0, 4).toString('ascii') === 'fLaC'
  if (ext === 'mid') return header.subarray(0, 4).toString('ascii') === 'MThd'
  if (ext === 'webm') return bufferStartsWith(header, [0x1a, 0x45, 0xdf, 0xa3])
  if (ext === 'mp4' || ext === 'mov' || ext === 'm4a') return header.subarray(4, 8).toString('ascii') === 'ftyp'
  if (ext === 'aac') return header[0] === 0xff && (header[1] & 0xf0) === 0xf0
  return false
}

export const assertAllowedFileContents = (filename, source) => {
  let header
  if (Buffer.isBuffer(source)) {
    header = source.subarray(0, 16)
  } else {
    const fd = fs.openSync(source, 'r')
    try {
      header = Buffer.alloc(16)
      const bytesRead = fs.readSync(fd, header, 0, 16, 0)
      header = header.subarray(0, bytesRead)
    } finally {
      fs.closeSync(fd)
    }
  }
  if (!matchesAllowedFileContents(filename, header)) {
    throw new FileContentError('文件内容与扩展名不符，或该类型不被支持')
  }
}
