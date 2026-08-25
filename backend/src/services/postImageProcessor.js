import sharp from 'sharp'
import { config } from '../config.js'

const supportedInputFormats = new Set(['jpeg', 'png', 'webp', 'gif'])
const maxGifFrames = 200
const minimumOutputEdge = 320

const positiveInteger = (value, fallback) => {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : fallback
}

export class PostImageError extends Error {
  constructor(message = '图片无效、已损坏或尺寸超出限制', { code = 'INVALID_POST_IMAGE', status = 400 } = {}) {
    super(message)
    this.name = 'PostImageError'
    this.code = code
    this.status = status
  }
}

const createInput = (input, maxInputPixels) => sharp(input, {
  failOn: 'error',
  limitInputPixels: maxInputPixels,
  animated: false,
  page: 0,
  pages: 1,
  sequentialRead: true
})

const nextAttempt = ({ edge, quality }, attempt) => {
  if (attempt < 2 && quality > 55) return { edge, quality: Math.max(55, quality - 10) }
  return {
    edge: Math.min(edge, Math.max(minimumOutputEdge, Math.floor(edge * 0.82))),
    quality: Math.max(55, quality - 4)
  }
}

export const processPostImage = async (input, {
  maxEdge = config.postImageMaxEdge,
  quality = config.postImageWebpQuality,
  maxOutputBytes = config.postImageMaxOutputBytes,
  maxInputPixels = config.maxPostImageInputPixels
} = {}) => {
  if ((!Buffer.isBuffer(input) && typeof input !== 'string') || (Buffer.isBuffer(input) && input.length === 0)) {
    throw new PostImageError()
  }

  const safeMaxEdge = positiveInteger(maxEdge, 2048)
  const safeQuality = Math.min(Math.max(positiveInteger(quality, 80), 1), 100)
  const safeMaxOutputBytes = positiveInteger(maxOutputBytes, 1572864)
  const safeMaxInputPixels = positiveInteger(maxInputPixels, 50_000_000)
  let metadata

  try {
    metadata = await createInput(input, safeMaxInputPixels).metadata()
  } catch {
    throw new PostImageError()
  }

  if (!supportedInputFormats.has(metadata.format)) {
    throw new PostImageError('帖子图片仅支持 JPEG、PNG、GIF 或 WebP')
  }
  if (positiveInteger(metadata.pages, 1) > maxGifFrames) {
    throw new PostImageError('动画图片帧数过多，无法安全处理')
  }

  const orientedWidth = positiveInteger(metadata.autoOrient?.width, positiveInteger(metadata.width, 0))
  const orientedHeight = positiveInteger(metadata.autoOrient?.height, positiveInteger(metadata.height, 0))
  if (!orientedWidth || !orientedHeight) throw new PostImageError()

  let attemptOptions = {
    edge: Math.min(safeMaxEdge, Math.max(orientedWidth, orientedHeight)),
    quality: safeQuality
  }
  let lastResult

  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { data, info } = await createInput(input, safeMaxInputPixels)
        .autoOrient()
        .resize({
          width: attemptOptions.edge,
          height: attemptOptions.edge,
          fit: 'inside',
          withoutEnlargement: true,
          fastShrinkOnLoad: true
        })
        .webp({
          quality: attemptOptions.quality,
          alphaQuality: 88,
          effort: 4,
          smartSubsample: true
        })
        .toBuffer({ resolveWithObject: true })

      lastResult = { data, info, edge: attemptOptions.edge, quality: attemptOptions.quality }
      if (data.length <= safeMaxOutputBytes) break
      if (attemptOptions.edge <= minimumOutputEdge && attemptOptions.quality <= 55) break
      attemptOptions = nextAttempt(attemptOptions, attempt)
    }
  } catch {
    throw new PostImageError()
  }

  if (!lastResult || lastResult.data.length > safeMaxOutputBytes) {
    throw new PostImageError('压缩后的图片仍超过大小限制', {
      code: 'POST_IMAGE_OUTPUT_TOO_LARGE',
      status: 413
    })
  }

  return {
    buffer: lastResult.data,
    info: {
      format: lastResult.info.format,
      width: lastResult.info.width,
      height: lastResult.info.height,
      size: lastResult.data.length,
      quality: lastResult.quality,
      inputFormat: metadata.format,
      inputWidth: orientedWidth,
      inputHeight: orientedHeight,
      inputPages: positiveInteger(metadata.pages, 1),
      flattenedAnimation: metadata.format === 'gif' || positiveInteger(metadata.pages, 1) > 1
    }
  }
}
