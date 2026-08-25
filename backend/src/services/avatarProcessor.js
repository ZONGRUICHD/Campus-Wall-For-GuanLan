import sharp from 'sharp'
import { config } from '../config.js'

const supportedInputFormats = new Set(['jpeg', 'png', 'webp', 'gif'])

export class AvatarImageError extends Error {
  constructor(message = '头像图片无效或已损坏') {
    super(message)
    this.name = 'AvatarImageError'
    this.code = 'INVALID_AVATAR_IMAGE'
  }
}
const positiveInteger = (value, fallback) => {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : fallback
}

export const processAvatarImage = async (input, {
  maxEdge = config.avatarOutputSize,
  quality = config.avatarWebpQuality,
  maxInputPixels = config.maxAvatarInputPixels
} = {}) => {
  if (!Buffer.isBuffer(input) || input.length === 0) throw new AvatarImageError()

  const safeMaxEdge = positiveInteger(maxEdge, 512)
  const safeQuality = Math.min(Math.max(positiveInteger(quality, 82), 1), 100)
  const safeMaxInputPixels = positiveInteger(maxInputPixels, 40_000_000)
  let image
  let metadata

  try {
    image = sharp(input, {
      failOn: 'error',
      limitInputPixels: safeMaxInputPixels,
      animated: false,
      page: 0,
      pages: 1
    })
    metadata = await image.metadata()
  } catch {
    throw new AvatarImageError()
  }

  if (!supportedInputFormats.has(metadata.format)) {
    throw new AvatarImageError('头像仅支持 PNG、JPEG、GIF 或 WebP 图片')
  }

  const orientedWidth = positiveInteger(metadata.autoOrient?.width, positiveInteger(metadata.width, 0))
  const orientedHeight = positiveInteger(metadata.autoOrient?.height, positiveInteger(metadata.height, 0))
  if (!orientedWidth || !orientedHeight) throw new AvatarImageError()
  const edge = Math.min(safeMaxEdge, orientedWidth, orientedHeight)

  try {
    const { data, info } = await image
      .autoOrient()
      .resize(edge, edge, { fit: 'cover', position: 'centre' })
      .webp({
        quality: safeQuality,
        alphaQuality: 90,
        effort: 4,
        smartSubsample: true
      })
      .toBuffer({ resolveWithObject: true })

    if (info.format !== 'webp' || info.width !== edge || info.height !== edge) {
      throw new AvatarImageError()
    }

    return {
      buffer: data,
      info: {
        format: info.format,
        width: info.width,
        height: info.height,
        size: info.size,
        inputFormat: metadata.format,
        inputSize: input.length
      }
    }
  } catch (error) {
    if (error instanceof AvatarImageError) throw error
    throw new AvatarImageError()
  }
}
