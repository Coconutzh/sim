import { generateShortId } from '@sim/utils/id'
import sharp from 'sharp'
import type { UserFileLike } from '@/lib/core/utils/user-file'
import type {
  ImageAspectRatioValue,
  ImageGenerationModelId,
  ImageResolutionValue,
} from '@/lib/generated-media/image/image-generation-utils'
import {
  DEFAULT_IMAGE_CUTOUT_MODEL,
  DEFAULT_IMAGE_REPAINT_MODEL,
  DEFAULT_IMAGE_REPAINT_RESOLUTION,
  getNearestSupportedImageAspectRatio,
} from '@/lib/generated-media/image/image-generation-utils'
import { resolveMediaEditWorkspaceFile } from '@/lib/generated-media/image/media-edit-files'
import { generateImageWithProvider } from '@/lib/generated-media/image/providers'
import {
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import type { UserFile } from '@/executor/types'

interface GenerateWorkspaceImageFromPromptInput {
  workspaceId: string
  userId: string
  model: ImageGenerationModelId
  prompt: string
  aspectRatio: ImageAspectRatioValue
  referenceContext?: {
    text: string[]
    images: UserFileLike[]
  }
  abortSignal?: AbortSignal
}

interface RepaintWorkspaceImageInput {
  workspaceId: string
  userId: string
  prompt: string
  resolution: ImageResolutionValue
  sourceImage: UserFileLike
  maskImage: UserFileLike
  referenceImages: UserFileLike[]
  abortSignal?: AbortSignal
}

interface EraseWorkspaceImageInput {
  workspaceId: string
  userId: string
  resolution: ImageResolutionValue
  sourceImage: UserFileLike
  maskImage: UserFileLike
  abortSignal?: AbortSignal
}

interface CutoutWorkspaceImageInput {
  workspaceId: string
  userId: string
  sourceImage: UserFileLike
  abortSignal?: AbortSignal
}

interface OutpaintWorkspaceImageInput {
  workspaceId: string
  userId: string
  resolution: ImageResolutionValue
  sourceImage: UserFileLike
  targetAspectRatio: 'original' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | '21:9' | 'custom'
  customAspectRatio?: {
    width: number
    height: number
  }
  placement: {
    x: number
    y: number
    width: number
    height: number
    canvasWidth: number
    canvasHeight: number
  }
  prompt?: string
  abortSignal?: AbortSignal
}

interface GenerateWorkspaceImageFromPromptResult {
  file: UserFile
  metadata: {
    provider: string
    providerModel: string
    revisedPrompt?: string
  }
}

interface CutoutWorkspaceImageResult {
  file: UserFile
  metadata: {
    provider: string
    providerModel: string
    revisedPrompt?: string
    hasAlpha: boolean
    postProcessed: boolean
  }
}

type RepaintWorkspaceImageResult = GenerateWorkspaceImageFromPromptResult
type EraseWorkspaceImageResult = GenerateWorkspaceImageFromPromptResult
type OutpaintWorkspaceImageResult = GenerateWorkspaceImageFromPromptResult

const CUTOUT_PROMPT =
  'Cut out the main foreground subject from the provided image. Preserve the subject exactly, including fine edges such as hair, fabric, transparent materials, and shadows where appropriate. Remove the background completely. Return a clean PNG asset suitable for compositing. Do not add a checkerboard, white background, border, text, watermark, or extra objects.'
const CUTOUT_BACKGROUND_COLOR_DISTANCE_THRESHOLD = 34

const OUTPAINT_GUIDE_LONG_EDGE_BY_RESOLUTION: Record<ImageResolutionValue, number> = {
  '1K': 1024,
  '2K': 2048,
  '4K': 4096,
}
const OUTPAINT_FIXED_ASPECT_RATIOS = new Set<ImageAspectRatioValue>([
  '1:1',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '21:9',
])

function getGeneratedFileName(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'generated-image.jpg'
  if (mimeType.includes('webp')) return 'generated-image.webp'
  return 'generated-image.png'
}

function getColorDistanceSquared(
  redA: number,
  greenA: number,
  blueA: number,
  redB: number,
  greenB: number,
  blueB: number
): number {
  return (redA - redB) ** 2 + (greenA - greenB) ** 2 + (blueA - blueB) ** 2
}

async function hasRealAlphaChannel(buffer: Buffer): Promise<boolean> {
  const { data, info } = await sharp(buffer).rotate().ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  })

  for (let index = 3; index < data.length; index += info.channels) {
    if (data[index] < 255) return true
  }

  return false
}

async function applyConnectedBackgroundAlpha(buffer: Buffer): Promise<Buffer | null> {
  const { data, info } = await sharp(buffer).rotate().ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  })
  const { width, height, channels } = info
  if (width <= 1 || height <= 1 || channels < 4) return null

  const pixelCount = width * height
  const transparentPixels = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  const cornerIndexes = [0, width - 1, (height - 1) * width, height * width - 1]
  const backgroundSamples = cornerIndexes.map((pixelIndex) => {
    const offset = pixelIndex * channels
    return {
      red: data[offset],
      green: data[offset + 1],
      blue: data[offset + 2],
    }
  })
  const thresholdSquared = CUTOUT_BACKGROUND_COLOR_DISTANCE_THRESHOLD ** 2

  const isBackgroundLike = (pixelIndex: number): boolean => {
    const offset = pixelIndex * channels
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    return backgroundSamples.some(
      (sample) =>
        getColorDistanceSquared(red, green, blue, sample.red, sample.green, sample.blue) <=
        thresholdSquared
    )
  }

  let head = 0
  let tail = 0
  const enqueue = (pixelIndex: number) => {
    if (transparentPixels[pixelIndex] || !isBackgroundLike(pixelIndex)) return
    transparentPixels[pixelIndex] = 1
    queue[tail] = pixelIndex
    tail += 1
  }

  for (let x = 0; x < width; x++) {
    enqueue(x)
    enqueue((height - 1) * width + x)
  }
  for (let y = 1; y < height - 1; y++) {
    enqueue(y * width)
    enqueue(y * width + width - 1)
  }

  while (head < tail) {
    const pixelIndex = queue[head]
    head += 1
    const x = pixelIndex % width
    const y = Math.floor(pixelIndex / width)

    if (x > 0) enqueue(pixelIndex - 1)
    if (x + 1 < width) enqueue(pixelIndex + 1)
    if (y > 0) enqueue(pixelIndex - width)
    if (y + 1 < height) enqueue(pixelIndex + width)
  }

  if (tail === 0 || tail === pixelCount) return null

  const output = Buffer.from(data)
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
    if (transparentPixels[pixelIndex]) {
      output[pixelIndex * channels + 3] = 0
    }
  }

  return sharp(output, {
    raw: {
      width,
      height,
      channels,
    },
  })
    .png()
    .toBuffer()
}

async function ensureTransparentPng(buffer: Buffer): Promise<{
  buffer: Buffer
  hasAlpha: boolean
  postProcessed: boolean
}> {
  if (await hasRealAlphaChannel(buffer)) {
    return {
      buffer: await sharp(buffer).png().toBuffer(),
      hasAlpha: true,
      postProcessed: false,
    }
  }

  const postProcessedBuffer = await applyConnectedBackgroundAlpha(buffer)
  if (postProcessedBuffer && (await hasRealAlphaChannel(postProcessedBuffer))) {
    return {
      buffer: postProcessedBuffer,
      hasAlpha: true,
      postProcessed: true,
    }
  }

  throw new Error(
    'Unable to generate a real transparent PNG. The model returned an opaque image and server post-processing could not derive an alpha mask.'
  )
}

async function hydrateImageReferenceContext(
  workspaceId: string,
  referenceContext: GenerateWorkspaceImageFromPromptInput['referenceContext']
): Promise<GenerateWorkspaceImageFromPromptInput['referenceContext']> {
  if (!referenceContext?.images?.length) {
    return referenceContext
  }

  const hydratedImages = await Promise.all(
    referenceContext.images.map(async (image) => {
      const normalizedImage = {
        id: image.id ?? '',
        name: image.name ?? image.key,
        url: image.url ?? '',
        key: image.key,
        size: image.size ?? 0,
        type: image.type,
        context: image.context,
        base64: image.base64,
      }

      if (image.base64 || !image.id) {
        return normalizedImage
      }

      try {
        const fileRecord = await getWorkspaceFile(workspaceId, image.id)
        if (!fileRecord) {
          return normalizedImage
        }
        const buffer = await fetchWorkspaceFileBuffer(fileRecord)
        return {
          ...normalizedImage,
          name: image.name || fileRecord.name,
          url: image.url || fileRecord.url || '',
          key: image.key || fileRecord.key,
          size: image.size ?? fileRecord.size,
          type: image.type || fileRecord.type,
          base64: buffer.toString('base64'),
        } satisfies UserFileLike
      } catch {
        return normalizedImage
      }
    })
  )

  return {
    ...referenceContext,
    images: hydratedImages,
  }
}

function getHydratedImageBuffer(image: UserFileLike): Buffer | null {
  if (!image.base64) return null
  return Buffer.from(image.base64, 'base64')
}

function getNearestOutpaintAspectRatio(width: number, height: number): ImageAspectRatioValue {
  return getNearestSupportedImageAspectRatio(width, height) ?? '1:1'
}

async function resolveCutoutAspectRatio(sourceImage: UserFileLike): Promise<ImageAspectRatioValue> {
  const sourceBuffer = getHydratedImageBuffer(sourceImage)
  if (!sourceBuffer) return '1:1'

  try {
    const metadata = await sharp(sourceBuffer).metadata()
    return getNearestSupportedImageAspectRatio(metadata.width ?? 0, metadata.height ?? 0) ?? '1:1'
  } catch {
    return '1:1'
  }
}

export function resolveOutpaintAspectRatio({
  targetAspectRatio,
  customAspectRatio,
  placement,
}: Pick<
  OutpaintWorkspaceImageInput,
  'targetAspectRatio' | 'customAspectRatio' | 'placement'
>): ImageAspectRatioValue {
  if (OUTPAINT_FIXED_ASPECT_RATIOS.has(targetAspectRatio as ImageAspectRatioValue)) {
    return targetAspectRatio as ImageAspectRatioValue
  }

  if (targetAspectRatio === 'custom' && customAspectRatio) {
    return getNearestOutpaintAspectRatio(customAspectRatio.width, customAspectRatio.height)
  }

  return getNearestOutpaintAspectRatio(placement.canvasWidth, placement.canvasHeight)
}

function getOutpaintGuideSize({
  canvasWidth,
  canvasHeight,
  resolution,
}: {
  canvasWidth: number
  canvasHeight: number
  resolution: ImageResolutionValue
}): { width: number; height: number; scale: number } {
  const longestEdge = OUTPAINT_GUIDE_LONG_EDGE_BY_RESOLUTION[resolution]
  const scale = longestEdge / Math.max(canvasWidth, canvasHeight)
  return {
    width: Math.max(1, Math.round(canvasWidth * scale)),
    height: Math.max(1, Math.round(canvasHeight * scale)),
    scale,
  }
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function getOutpaintGuideGeometry({
  placement,
  resolution,
}: Pick<OutpaintWorkspaceImageInput, 'placement' | 'resolution'>): {
  guideSize: { width: number; height: number; scale: number }
  sourceRegion: { left: number; top: number; width: number; height: number }
} {
  const guideSize = getOutpaintGuideSize({
    canvasWidth: placement.canvasWidth,
    canvasHeight: placement.canvasHeight,
    resolution,
  })
  const left = clampInteger(Math.round(placement.x * guideSize.scale), 0, guideSize.width - 1)
  const top = clampInteger(Math.round(placement.y * guideSize.scale), 0, guideSize.height - 1)
  const width = Math.max(
    1,
    Math.min(guideSize.width - left, Math.round(placement.width * guideSize.scale))
  )
  const height = Math.max(
    1,
    Math.min(guideSize.height - top, Math.round(placement.height * guideSize.scale))
  )

  return {
    guideSize,
    sourceRegion: {
      left,
      top,
      width,
      height,
    },
  }
}

async function buildOutpaintGuideImages({
  sourceImage,
  placement,
  resolution,
}: Pick<OutpaintWorkspaceImageInput, 'placement' | 'resolution'> & {
  sourceImage: UserFileLike
}): Promise<{ layoutGuide: UserFileLike; maskGuide: UserFileLike }> {
  const sourceBuffer = getHydratedImageBuffer(sourceImage)
  if (!sourceBuffer) {
    throw new Error('Source image could not be loaded for outpainting.')
  }

  const { guideSize, sourceRegion } = getOutpaintGuideGeometry({ placement, resolution })
  const resizedSource = await sharp(sourceBuffer)
    .resize(sourceRegion.width, sourceRegion.height, { fit: 'fill' })
    .png()
    .toBuffer()
  const layoutBuffer = await sharp({
    create: {
      width: guideSize.width,
      height: guideSize.height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    },
  })
    .composite([
      {
        input: resizedSource,
        left: sourceRegion.left,
        top: sourceRegion.top,
      },
    ])
    .png()
    .toBuffer()
  const maskSvg = Buffer.from(
    `<svg width="${guideSize.width}" height="${guideSize.height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><rect x="${sourceRegion.left}" y="${sourceRegion.top}" width="${sourceRegion.width}" height="${sourceRegion.height}" fill="black"/></svg>`
  )
  const maskBuffer = await sharp(maskSvg).png().toBuffer()
  const requestId = generateShortId()
  const layoutGuideName = `outpaint-layout-guide-${requestId}.png`
  const maskGuideName = `outpaint-mask-guide-${requestId}.png`

  return {
    layoutGuide: {
      id: '',
      name: layoutGuideName,
      url: '',
      key: layoutGuideName,
      size: layoutBuffer.byteLength,
      type: 'image/png',
      base64: layoutBuffer.toString('base64'),
    },
    maskGuide: {
      id: '',
      name: maskGuideName,
      url: '',
      key: maskGuideName,
      size: maskBuffer.byteLength,
      type: 'image/png',
      base64: maskBuffer.toString('base64'),
    },
  }
}

export async function generateWorkspaceImageFromPrompt({
  workspaceId,
  userId,
  model,
  prompt,
  aspectRatio,
  referenceContext,
  abortSignal,
}: GenerateWorkspaceImageFromPromptInput): Promise<GenerateWorkspaceImageFromPromptResult> {
  const hydratedReferenceContext = await hydrateImageReferenceContext(workspaceId, referenceContext)

  const generatedImage = await generateImageWithProvider({
    model,
    prompt,
    aspectRatio,
    referenceContext: hydratedReferenceContext,
    abortSignal,
  })

  const file = await uploadWorkspaceFile(
    workspaceId,
    userId,
    generatedImage.buffer,
    getGeneratedFileName(generatedImage.mimeType),
    generatedImage.mimeType
  )

  return {
    file,
    metadata: {
      provider: generatedImage.provider,
      providerModel: generatedImage.providerModel,
      revisedPrompt: generatedImage.revisedPrompt,
    },
  }
}

export function buildWorkspaceImageRepaintPrompt({
  prompt,
  resolution,
}: {
  prompt: string
  resolution: ImageResolutionValue
}): string {
  return [
    'Edit the provided source image using the mask image.',
    'The mask image marks the areas to repaint: white/visible painted areas are editable, black/transparent areas must remain unchanged.',
    'Preserve the original image outside the mask exactly as much as possible.',
    `User request: ${prompt}.`,
    'Use the additional reference images only for visual guidance.',
    `Output at ${resolution} resolution.`,
    'Do not add watermark, UI, text, border, or unrelated objects.',
  ].join(' ')
}

export function buildWorkspaceImageOutpaintPrompt({
  prompt,
  resolution,
  placement,
}: {
  prompt?: string
  resolution: ImageResolutionValue
  placement: OutpaintWorkspaceImageInput['placement']
}): string {
  const userPrompt = prompt?.trim()
  const percent = (value: number, total: number) => `${((value / total) * 100).toFixed(2)}%`
  const placementDescription = [
    `left ${percent(placement.x, placement.canvasWidth)}`,
    `top ${percent(placement.y, placement.canvasHeight)}`,
    `width ${percent(placement.width, placement.canvasWidth)}`,
    `height ${percent(placement.height, placement.canvasHeight)}`,
  ].join(', ')
  return [
    'Outpaint the provided source image into the target canvas shown by the layout guide.',
    'The layout guide contains the original image region and transparent surrounding expansion area.',
    'The mask guide marks the original image region in black and the surrounding expanded areas in white.',
    `The original image region is exactly positioned at ${placementDescription} of the target canvas.`,
    'Preserve the original image at that exact normalized region; do not recenter, scale, or move it.',
    'The original image region must remain unchanged as much as possible.',
    'Fill only the surrounding expanded areas so the result looks like a natural continuation of the same scene, style, lighting, perspective, colors, and texture.',
    userPrompt ? `User request: ${userPrompt}.` : null,
    'Do not add watermark, UI, text, borders, frames, or unrelated objects.',
    `Output at ${resolution} resolution.`,
  ]
    .filter(Boolean)
    .join(' ')
}

export function buildWorkspaceImageErasePrompt({
  resolution,
}: {
  resolution: ImageResolutionValue
}): string {
  return [
    'Edit the provided source image using the mask image.',
    'The mask marks the exact areas to erase: white/visible painted areas should be removed and naturally filled in; black/transparent areas must remain unchanged as much as possible.',
    'Reconstruct the erased region using surrounding background, texture, lighting, perspective, and style.',
    'Do not add watermark, UI, text, border, frame, or unrelated objects.',
    `Output at ${resolution} resolution.`,
  ].join(' ')
}

export function buildWorkspaceImageCutoutPrompt(): string {
  return CUTOUT_PROMPT
}

export async function repaintWorkspaceImage({
  workspaceId,
  userId,
  prompt,
  resolution,
  sourceImage,
  maskImage,
  referenceImages,
  abortSignal,
}: RepaintWorkspaceImageInput): Promise<RepaintWorkspaceImageResult> {
  const referenceContext = await hydrateImageReferenceContext(workspaceId, {
    text: [],
    images: [sourceImage, maskImage, ...referenceImages],
  })

  const generatedImage = await generateImageWithProvider({
    model: DEFAULT_IMAGE_REPAINT_MODEL,
    prompt: buildWorkspaceImageRepaintPrompt({ prompt, resolution }),
    aspectRatio: 'auto',
    resolution,
    referenceContext,
    abortSignal,
  })

  const file = await uploadWorkspaceFile(
    workspaceId,
    userId,
    generatedImage.buffer,
    getGeneratedFileName(generatedImage.mimeType),
    generatedImage.mimeType
  )

  return {
    file,
    metadata: {
      provider: generatedImage.provider,
      providerModel: generatedImage.providerModel,
      revisedPrompt: generatedImage.revisedPrompt,
    },
  }
}

export async function eraseWorkspaceImage({
  workspaceId,
  userId,
  resolution,
  sourceImage,
  maskImage,
  abortSignal,
}: EraseWorkspaceImageInput): Promise<EraseWorkspaceImageResult> {
  const referenceContext = await hydrateImageReferenceContext(workspaceId, {
    text: [],
    images: [sourceImage, maskImage],
  })

  const generatedImage = await generateImageWithProvider({
    model: DEFAULT_IMAGE_REPAINT_MODEL,
    prompt: buildWorkspaceImageErasePrompt({ resolution }),
    aspectRatio: 'auto',
    resolution,
    referenceContext,
    abortSignal,
  })

  const file = await uploadWorkspaceFile(
    workspaceId,
    userId,
    generatedImage.buffer,
    getGeneratedFileName(generatedImage.mimeType),
    generatedImage.mimeType
  )

  return {
    file,
    metadata: {
      provider: generatedImage.provider,
      providerModel: generatedImage.providerModel,
      revisedPrompt: generatedImage.revisedPrompt,
    },
  }
}

export async function cutoutWorkspaceImage({
  workspaceId,
  userId,
  sourceImage,
  abortSignal,
}: CutoutWorkspaceImageInput): Promise<CutoutWorkspaceImageResult> {
  const hydratedSourceImage = await resolveMediaEditWorkspaceFile({
    workspaceId,
    file: sourceImage,
  })
  if (!hydratedSourceImage) {
    throw new Error('Source image could not be loaded for cutout.')
  }
  const aspectRatio = await resolveCutoutAspectRatio(hydratedSourceImage)

  const generatedImage = await generateImageWithProvider({
    model: DEFAULT_IMAGE_CUTOUT_MODEL,
    prompt: buildWorkspaceImageCutoutPrompt(),
    aspectRatio,
    resolution: DEFAULT_IMAGE_REPAINT_RESOLUTION,
    referenceContext: {
      text: [],
      images: [hydratedSourceImage],
    },
    abortSignal,
  })
  const transparentPng = await ensureTransparentPng(generatedImage.buffer)

  const file = await uploadWorkspaceFile(
    workspaceId,
    userId,
    transparentPng.buffer,
    'generated-cutout.png',
    'image/png'
  )

  return {
    file,
    metadata: {
      provider: generatedImage.provider,
      providerModel: generatedImage.providerModel,
      revisedPrompt: generatedImage.revisedPrompt,
      hasAlpha: transparentPng.hasAlpha,
      postProcessed: transparentPng.postProcessed,
    },
  }
}

export async function outpaintWorkspaceImage({
  workspaceId,
  userId,
  resolution,
  sourceImage,
  targetAspectRatio,
  customAspectRatio,
  placement,
  prompt,
  abortSignal,
}: OutpaintWorkspaceImageInput): Promise<OutpaintWorkspaceImageResult> {
  const hydratedSourceImage = await resolveMediaEditWorkspaceFile({
    workspaceId,
    file: sourceImage,
  })
  if (!hydratedSourceImage) {
    throw new Error('Source image could not be loaded for outpainting.')
  }
  const aspectRatio = resolveOutpaintAspectRatio({
    targetAspectRatio,
    customAspectRatio,
    placement,
  })

  const { layoutGuide, maskGuide } = await buildOutpaintGuideImages({
    sourceImage: hydratedSourceImage,
    placement,
    resolution,
  })

  const generatedImage = await generateImageWithProvider({
    model: DEFAULT_IMAGE_REPAINT_MODEL,
    prompt: buildWorkspaceImageOutpaintPrompt({ prompt, resolution, placement }),
    aspectRatio,
    resolution,
    referenceContext: {
      text: [],
      images: [hydratedSourceImage, layoutGuide, maskGuide],
    },
    abortSignal,
  })

  const file = await uploadWorkspaceFile(
    workspaceId,
    userId,
    generatedImage.buffer,
    getGeneratedFileName(generatedImage.mimeType),
    generatedImage.mimeType
  )

  return {
    file,
    metadata: {
      provider: generatedImage.provider,
      providerModel: generatedImage.providerModel,
      revisedPrompt: generatedImage.revisedPrompt,
    },
  }
}
