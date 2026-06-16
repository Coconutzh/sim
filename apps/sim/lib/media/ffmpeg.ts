import { execSync } from 'node:child_process'
import fsSync from 'node:fs'
import { createLogger } from '@sim/logger'
import ffmpegStatic from 'ffmpeg-static'
import ffmpeg from 'fluent-ffmpeg'

const logger = createLogger('FFmpeg')

let ffmpegInitialized = false
let ffmpegPath: string | null = null

const FFMPEG_NOT_FOUND_MESSAGE =
  'FFmpeg not found. Install FFmpeg or set FFMPEG_PATH to the ffmpeg executable path.'

function isExistingFile(filePath: string | undefined | null): filePath is string {
  if (!filePath) return false
  try {
    return fsSync.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function useFfmpegPath(filePath: string, source: string): void {
  ffmpegPath = filePath
  ffmpeg.setFfmpegPath(filePath)
  logger.info('Using FFmpeg binary', { source, path: filePath })
}

function findSystemFfmpeg(): string | null {
  const command = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg'
  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return (
      result
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(isExistingFile) ?? null
    )
  } catch {
    return null
  }
}

/**
 * Configures fluent-ffmpeg with ffmpeg-static when available, then falls back to a system ffmpeg.
 */
export function ensureFfmpegBinary(): void {
  if (ffmpegInitialized) {
    if (!ffmpegPath) {
      throw new Error(FFMPEG_NOT_FOUND_MESSAGE)
    }
    return
  }

  ffmpegInitialized = true

  if (isExistingFile(process.env.FFMPEG_PATH)) {
    useFfmpegPath(process.env.FFMPEG_PATH, 'FFMPEG_PATH')
    return
  }

  if (isExistingFile(ffmpegStatic)) {
    useFfmpegPath(ffmpegStatic, 'ffmpeg-static')
    return
  }

  const systemFfmpegPath = findSystemFfmpeg()
  if (systemFfmpegPath) {
    useFfmpegPath(systemFfmpegPath, 'system')
    return
  }

  logger.warn('No FFmpeg binary found', {
    ffmpegStaticPath: typeof ffmpegStatic === 'string' ? ffmpegStatic : null,
    ffmpegStaticExists: isExistingFile(ffmpegStatic),
    envPath: process.env.FFMPEG_PATH ?? null,
  })
  throw new Error(FFMPEG_NOT_FOUND_MESSAGE)
}
