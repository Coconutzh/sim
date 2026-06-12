import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import ffmpeg from 'fluent-ffmpeg'
import { ensureFfmpegBinary } from '@/lib/media/ffmpeg'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { UserFile } from '@/executor/types'

const logger = createLogger('VideoTrimService')

const MIME_EXTENSION_MAP: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'video/avi': 'avi',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
  'video/mpeg': 'mpeg',
}

interface TrimWorkspaceVideoInput {
  workspaceId: string
  userId: string
  sourceFile: UserFile
  startSeconds: number
  endSeconds: number
}

interface TrimWorkspaceVideoResult {
  file: UserFile
}

interface GenerateWorkspaceVideoThumbnailsInput {
  workspaceId: string
  userId: string
  sourceFile: UserFile
  durationSeconds: number
  frameCount: number
}

interface GenerateWorkspaceVideoThumbnailsResult {
  thumbnails: string[]
}

function getVideoExtension(file: UserFile): string {
  const mimeExtension = MIME_EXTENSION_MAP[file.type.toLowerCase()]
  if (mimeExtension) return mimeExtension

  const fileNameExtension = file.name.split('.').pop()?.toLowerCase()
  if (fileNameExtension) return fileNameExtension

  return 'mp4'
}

function getTrimmedVideoFileName(file: UserFile): string {
  const baseName = (file.name || 'video').replace(/\.[^.]+$/, '')
  return `${baseName}-trim.mp4`
}

async function trimVideoBuffer(params: {
  inputBuffer: Buffer
  sourceFile: UserFile
  startSeconds: number
  endSeconds: number
}): Promise<Buffer> {
  ensureFfmpegBinary()

  const tempId = generateShortId()
  const inputExtension = getVideoExtension(params.sourceFile)
  const inputFile = path.join(os.tmpdir(), `sim-video-trim-input-${tempId}.${inputExtension}`)
  const outputFile = path.join(os.tmpdir(), `sim-video-trim-output-${tempId}.mp4`)
  const durationSeconds = params.endSeconds - params.startSeconds

  try {
    await fs.writeFile(inputFile, params.inputBuffer)

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputFile)
        .setStartTime(params.startSeconds)
        .setDuration(durationSeconds)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-map 0:v:0',
          '-map 0:a?',
          '-movflags +faststart',
          '-preset veryfast',
          '-crf 20',
          '-pix_fmt yuv420p',
        ])
        .on('end', () => resolve())
        .on('error', (error) => reject(new Error(`FFmpeg trim failed: ${error.message}`)))
        .save(outputFile)
    })

    return await fs.readFile(outputFile)
  } finally {
    await fs.unlink(inputFile).catch(() => {})
    await fs.unlink(outputFile).catch(() => {})
  }
}

async function generateThumbnailDataUrls(params: {
  inputBuffer: Buffer
  sourceFile: UserFile
  durationSeconds: number
  frameCount: number
}): Promise<string[]> {
  ensureFfmpegBinary()

  const extension = getVideoExtension(params.sourceFile)
  const tempId = generateShortId()
  const inputFile = path.join(os.tmpdir(), `sim-video-thumb-input-${tempId}.${extension}`)
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), `sim-video-thumbs-${tempId}-`))
  const outputPattern = path.join(outputDir, 'thumb-%03d.jpg')

  try {
    await fs.writeFile(inputFile, params.inputBuffer)

    const frameCount = Math.max(1, Math.min(24, params.frameCount))
    const framesPerSecond = Math.max(0.001, frameCount / params.durationSeconds)

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputFile)
        .noAudio()
        .videoFilters([
          `fps=${framesPerSecond}`,
          'scale=160:90:force_original_aspect_ratio=increase',
          'crop=160:90',
        ])
        .outputOptions([`-frames:v ${frameCount}`, '-q:v 4'])
        .on('end', () => resolve())
        .on('error', (error) =>
          reject(new Error(`FFmpeg thumbnail extraction failed: ${error.message}`))
        )
        .save(outputPattern)
    })

    const thumbnailFiles = (await fs.readdir(outputDir))
      .filter((fileName) => fileName.endsWith('.jpg'))
      .sort()

    if (thumbnailFiles.length === 0) {
      throw new Error('FFmpeg thumbnail extraction produced no frames.')
    }

    return await Promise.all(
      thumbnailFiles.map(async (fileName) => {
        const imageBuffer = await fs.readFile(path.join(outputDir, fileName))
        return `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
      })
    )
  } finally {
    await fs.unlink(inputFile).catch(() => {})
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function trimWorkspaceVideo({
  workspaceId,
  userId,
  sourceFile,
  startSeconds,
  endSeconds,
}: TrimWorkspaceVideoInput): Promise<TrimWorkspaceVideoResult> {
  if (!sourceFile.type.toLowerCase().startsWith('video/')) {
    throw new Error('Source file must be a video.')
  }
  if (endSeconds <= startSeconds) {
    throw new Error('Trim end must be greater than trim start.')
  }

  const requestId = `video-trim-${generateShortId()}`
  logger.info('Trimming workspace video', {
    workspaceId,
    userId,
    sourceFileId: sourceFile.id,
    startSeconds,
    endSeconds,
  })

  const inputBuffer = await downloadFileFromStorage(sourceFile, requestId, logger)
  const outputBuffer = await trimVideoBuffer({
    inputBuffer,
    sourceFile,
    startSeconds,
    endSeconds,
  })

  const file = await uploadWorkspaceFile(
    workspaceId,
    userId,
    outputBuffer,
    getTrimmedVideoFileName(sourceFile),
    'video/mp4'
  )

  return { file }
}

export async function generateWorkspaceVideoThumbnails({
  workspaceId,
  userId,
  sourceFile,
  durationSeconds,
  frameCount,
}: GenerateWorkspaceVideoThumbnailsInput): Promise<GenerateWorkspaceVideoThumbnailsResult> {
  if (!sourceFile.type.toLowerCase().startsWith('video/')) {
    throw new Error('Source file must be a video.')
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Video duration must be greater than zero.')
  }

  const requestId = `video-thumbnails-${generateShortId()}`
  logger.info('Generating workspace video thumbnails', {
    workspaceId,
    userId,
    sourceFileId: sourceFile.id,
    durationSeconds,
    frameCount,
  })

  const inputBuffer = await downloadFileFromStorage(sourceFile, requestId, logger)
  const thumbnails = await generateThumbnailDataUrls({
    inputBuffer,
    sourceFile,
    durationSeconds,
    frameCount,
  })

  return { thumbnails }
}
