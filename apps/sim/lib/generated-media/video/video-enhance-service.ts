import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import ffmpeg from 'fluent-ffmpeg'
import type { EnhanceWorkspaceVideoBody } from '@/lib/api/contracts/media-videos'
import { ensureFfmpegBinary } from '@/lib/media/ffmpeg'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { UserFile } from '@/executor/types'

const logger = createLogger('VideoEnhanceService')

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

const RESOLUTION_TARGETS = {
  '1080p': { width: 1920, height: 1080 },
  '2k': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
} as const

interface EnhanceWorkspaceVideoInput {
  workspaceId: string
  userId: string
  sourceFile: UserFile
  resolution: EnhanceWorkspaceVideoBody['resolution']
  frameRate: EnhanceWorkspaceVideoBody['frameRate']
  slowMotion: EnhanceWorkspaceVideoBody['slowMotion']
}

interface EnhanceWorkspaceVideoResult {
  file: UserFile
  metadata: {
    provider: 'ffmpeg'
    resolution: EnhanceWorkspaceVideoBody['resolution']
    frameRate: EnhanceWorkspaceVideoBody['frameRate']
    slowMotion: EnhanceWorkspaceVideoBody['slowMotion']
  }
}

function getVideoExtension(file: UserFile): string {
  const mimeExtension = MIME_EXTENSION_MAP[file.type.toLowerCase()]
  if (mimeExtension) return mimeExtension

  const fileNameExtension = file.name.split('.').pop()?.toLowerCase()
  if (fileNameExtension) return fileNameExtension

  return 'mp4'
}

function getEnhancedVideoFileName(file: UserFile): string {
  const baseName = (file.name || 'video').replace(/\.[^.]+$/, '')
  return `${baseName}-enhanced.mp4`
}

function getVideoFilters({
  resolution,
  frameRate,
  slowMotion,
}: Pick<EnhanceWorkspaceVideoInput, 'resolution' | 'frameRate' | 'slowMotion'>): string[] {
  const target = RESOLUTION_TARGETS[resolution]
  const targetWidthExpression = `if(gte(iw\\,ih)\\,${target.width}\\,${target.height})`
  const targetHeightExpression = `if(gte(iw\\,ih)\\,${target.height}\\,${target.width})`
  const filters = [
    `scale='${targetWidthExpression}':'${targetHeightExpression}':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`,
  ]

  if (frameRate !== 'source') {
    filters.push(`fps=${frameRate.replace('fps', '')}`)
  }

  if (slowMotion === '2x') {
    filters.push('setpts=2.0*PTS')
  }

  return filters
}

async function enhanceVideoBuffer(params: {
  inputBuffer: Buffer
  sourceFile: UserFile
  resolution: EnhanceWorkspaceVideoBody['resolution']
  frameRate: EnhanceWorkspaceVideoBody['frameRate']
  slowMotion: EnhanceWorkspaceVideoBody['slowMotion']
}): Promise<Buffer> {
  ensureFfmpegBinary()

  const tempId = generateShortId()
  const inputExtension = getVideoExtension(params.sourceFile)
  const inputFile = path.join(os.tmpdir(), `sim-video-enhance-input-${tempId}.${inputExtension}`)
  const outputFile = path.join(os.tmpdir(), `sim-video-enhance-output-${tempId}.mp4`)

  try {
    await fs.writeFile(inputFile, params.inputBuffer)

    await new Promise<void>((resolve, reject) => {
      const command = ffmpeg(inputFile)
        .videoCodec('libx264')
        .audioCodec('aac')
        .videoFilters(
          getVideoFilters({
            resolution: params.resolution,
            frameRate: params.frameRate,
            slowMotion: params.slowMotion,
          })
        )
        .outputOptions([
          '-map 0:v:0',
          '-map 0:a?',
          '-movflags +faststart',
          '-preset veryfast',
          '-crf 18',
          '-pix_fmt yuv420p',
        ])
        .on('end', () => resolve())
        .on('error', (error) => reject(new Error(`FFmpeg enhance failed: ${error.message}`)))

      if (params.slowMotion === '2x') {
        command.audioFilters(['atempo=0.5'])
      }

      command.save(outputFile)
    })

    return await fs.readFile(outputFile)
  } finally {
    await fs.unlink(inputFile).catch(() => {})
    await fs.unlink(outputFile).catch(() => {})
  }
}

export async function enhanceWorkspaceVideo({
  workspaceId,
  userId,
  sourceFile,
  resolution,
  frameRate,
  slowMotion,
}: EnhanceWorkspaceVideoInput): Promise<EnhanceWorkspaceVideoResult> {
  if (!sourceFile.type.toLowerCase().startsWith('video/')) {
    throw new Error('Source file must be a video.')
  }

  const requestId = `video-enhance-${generateShortId()}`
  logger.info('Enhancing workspace video', {
    workspaceId,
    userId,
    sourceFileId: sourceFile.id,
    resolution,
    frameRate,
    slowMotion,
    provider: 'ffmpeg',
  })

  const inputBuffer = await downloadFileFromStorage(sourceFile, requestId, logger)
  const outputBuffer = await enhanceVideoBuffer({
    inputBuffer,
    sourceFile,
    resolution,
    frameRate,
    slowMotion,
  })

  const file = await uploadWorkspaceFile(
    workspaceId,
    userId,
    outputBuffer,
    getEnhancedVideoFileName(sourceFile),
    'video/mp4'
  )

  return {
    file,
    metadata: {
      provider: 'ffmpeg',
      resolution,
      frameRate,
      slowMotion,
    },
  }
}
