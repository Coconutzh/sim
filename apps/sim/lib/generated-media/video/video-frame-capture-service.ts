import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import ffmpeg from 'fluent-ffmpeg'
import type { CaptureWorkspaceVideoFrameBody } from '@/lib/api/contracts/media-videos'
import { getVideoFrameCaptureFileName } from '@/lib/generated-media/video/video-frame-capture-utils'
import { ensureFfmpegBinary } from '@/lib/media/ffmpeg'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { UserFile } from '@/executor/types'

const logger = createLogger('VideoFrameCaptureService')

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

interface CaptureWorkspaceVideoFrameInput {
  workspaceId: string
  userId: string
  sourceFile: UserFile
  timeSeconds: number
  mode: CaptureWorkspaceVideoFrameBody['mode']
}

interface CaptureWorkspaceVideoFrameResult {
  file: UserFile
}

function getVideoExtension(file: UserFile): string {
  const mimeExtension = MIME_EXTENSION_MAP[file.type.toLowerCase()]
  if (mimeExtension) return mimeExtension

  const fileNameExtension = file.name.split('.').pop()?.toLowerCase()
  if (fileNameExtension) return fileNameExtension

  return 'mp4'
}

async function captureVideoFrameBuffer(params: {
  inputBuffer: Buffer
  sourceFile: UserFile
  timeSeconds: number
}): Promise<Buffer> {
  ensureFfmpegBinary()

  const tempId = generateShortId()
  const inputExtension = getVideoExtension(params.sourceFile)
  const inputFile = path.join(os.tmpdir(), `sim-video-frame-input-${tempId}.${inputExtension}`)
  const outputFile = path.join(os.tmpdir(), `sim-video-frame-output-${tempId}.jpg`)

  try {
    await fs.writeFile(inputFile, params.inputBuffer)

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputFile)
        .seekInput(params.timeSeconds)
        .noAudio()
        .outputOptions(['-frames:v 1', '-q:v 2'])
        .on('end', () => resolve())
        .on('error', (error) => reject(new Error(`FFmpeg frame capture failed: ${error.message}`)))
        .save(outputFile)
    })

    return await fs.readFile(outputFile)
  } finally {
    await fs.unlink(inputFile).catch(() => {})
    await fs.unlink(outputFile).catch(() => {})
  }
}

export async function captureWorkspaceVideoFrame({
  workspaceId,
  userId,
  sourceFile,
  timeSeconds,
  mode,
}: CaptureWorkspaceVideoFrameInput): Promise<CaptureWorkspaceVideoFrameResult> {
  if (!sourceFile.type.toLowerCase().startsWith('video/')) {
    throw new Error('Source file must be a video.')
  }
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
    throw new Error('Capture time must be greater than or equal to zero.')
  }

  const requestId = `video-frame-${generateShortId()}`
  logger.info('Capturing workspace video frame', {
    workspaceId,
    userId,
    sourceFileId: sourceFile.id,
    timeSeconds,
    mode,
  })

  const inputBuffer = await downloadFileFromStorage(sourceFile, requestId, logger)
  const outputBuffer = await captureVideoFrameBuffer({
    inputBuffer,
    sourceFile,
    timeSeconds,
  })

  const file = await uploadWorkspaceFile(
    workspaceId,
    userId,
    outputBuffer,
    getVideoFrameCaptureFileName(sourceFile.name, mode),
    'image/jpeg'
  )

  return { file }
}
