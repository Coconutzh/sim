import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { getRedisClient } from '@/lib/core/config/redis'
import { getStreamConfig } from './buffer'
import {
  FILE_PREVIEW_SESSION_SCHEMA_VERSION,
  type FilePreviewSession,
  type FilePreviewStatus,
  type FilePreviewTargetKind,
  isFilePreviewSession,
  sortFilePreviewSessions,
} from './file-preview-session-contract'

const logger = createLogger('FilePreviewSessionStore')

const STREAM_OUTBOX_PREFIX = 'mothership_stream:'
const DEFAULT_COMPLETED_TTL_SECONDS = 5 * 60
const RETRY_DELAYS_MS = [0, 50, 150] as const

type InMemoryPreviewSessionState = {
  sessions: Map<string, FilePreviewSession>
  expiresAt: number | null
}

const inMemoryPreviewSessions = new Map<string, InMemoryPreviewSessionState>()

export type {
  FilePreviewContentMode,
  FilePreviewSession,
  FilePreviewStatus,
  FilePreviewTargetKind,
} from './file-preview-session-contract'
export {
  FILE_PREVIEW_SESSION_SCHEMA_VERSION,
  isFilePreviewSession,
  sortFilePreviewSessions,
} from './file-preview-session-contract'

function getPreviewSessionsKey(streamId: string): string {
  return `${STREAM_OUTBOX_PREFIX}${streamId}:preview_sessions`
}

function getInMemoryPreviewState(streamId: string): InMemoryPreviewSessionState {
  const existing = inMemoryPreviewSessions.get(streamId)
  if (existing && (existing.expiresAt === null || existing.expiresAt > Date.now())) {
    return existing
  }

  if (existing) {
    inMemoryPreviewSessions.delete(streamId)
  }

  const created: InMemoryPreviewSessionState = {
    sessions: new Map<string, FilePreviewSession>(),
    expiresAt: null,
  }
  inMemoryPreviewSessions.set(streamId, created)
  return created
}

function setInMemoryPreviewExpiry(streamId: string, ttlSeconds: number): void {
  const state = getInMemoryPreviewState(streamId)
  state.expiresAt = Date.now() + ttlSeconds * 1000
}

type RedisOperationMetadata = {
  operation: string
  streamId: string
}

async function withRedisRetry<T>(
  metadata: RedisOperationMetadata,
  operation: (redis: NonNullable<ReturnType<typeof getRedisClient>>) => Promise<T>
): Promise<T> {
  const redis = getRedisClient()
  if (!redis) {
    throw new Error('Redis is required for mothership preview durability')
  }

  let lastError: unknown

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    const delay = RETRY_DELAYS_MS[attempt]
    if (delay > 0) {
      await sleep(delay)
    }

    try {
      return await operation(redis)
    } catch (error) {
      lastError = error
      logger.warn('Redis preview session operation failed', {
        operation: metadata.operation,
        streamId: metadata.streamId,
        attempt: attempt + 1,
        error: toError(error).message,
      })
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${metadata.operation} failed for stream ${metadata.streamId}`)
}

export function createFilePreviewSession(input: {
  streamId: string
  toolCallId: string
  fileName?: string
  fileId?: string
  targetKind?: FilePreviewTargetKind
  operation?: string
  edit?: Record<string, unknown>
  baseContent?: string
  previewText?: string
  previewVersion?: number
  status?: FilePreviewStatus
  updatedAt?: string
  completedAt?: string
}): FilePreviewSession {
  return {
    schemaVersion: FILE_PREVIEW_SESSION_SCHEMA_VERSION,
    id: input.toolCallId,
    streamId: input.streamId,
    toolCallId: input.toolCallId,
    status: input.status ?? 'pending',
    fileName: input.fileName ?? '',
    ...(input.fileId ? { fileId: input.fileId } : {}),
    ...(input.targetKind ? { targetKind: input.targetKind } : {}),
    ...(input.operation ? { operation: input.operation } : {}),
    ...(input.edit ? { edit: input.edit } : {}),
    ...(typeof input.baseContent === 'string' ? { baseContent: input.baseContent } : {}),
    previewText: input.previewText ?? '',
    previewVersion: input.previewVersion ?? 0,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    ...(input.completedAt ? { completedAt: input.completedAt } : {}),
  }
}

export async function upsertFilePreviewSession(
  session: FilePreviewSession
): Promise<FilePreviewSession> {
  const config = getStreamConfig()
  const redis = getRedisClient()
  if (!redis) {
    const state = getInMemoryPreviewState(session.streamId)
    state.sessions.set(session.id, session)
    setInMemoryPreviewExpiry(session.streamId, config.ttlSeconds)
    return session
  }

  await withRedisRetry(
    { operation: 'upsert_preview_session', streamId: session.streamId },
    async (redis) => {
      const key = getPreviewSessionsKey(session.streamId)
      const pipeline = redis.pipeline()
      pipeline.hset(key, session.id, JSON.stringify(session))
      pipeline.expire(key, config.ttlSeconds)
      await pipeline.exec()
    }
  )
  return session
}

export async function readFilePreviewSessions(streamId: string): Promise<FilePreviewSession[]> {
  const redis = getRedisClient()
  if (!redis) {
    const state = getInMemoryPreviewState(streamId)
    return sortFilePreviewSessions(Array.from(state.sessions.values()))
  }

  const raw = await withRedisRetry(
    { operation: 'read_preview_sessions', streamId },
    async (redis) => redis.hgetall(getPreviewSessionsKey(streamId))
  )

  const sessions: FilePreviewSession[] = []
  const values = Object.values(raw ?? {})
  for (const entry of values) {
    try {
      const parsed = JSON.parse(entry) as unknown
      if (!isFilePreviewSession(parsed)) {
        logger.warn('Skipping invalid file preview session entry', { streamId })
        continue
      }
      sessions.push(parsed)
    } catch (error) {
      logger.warn('Failed to parse file preview session entry', {
        streamId,
        error: toError(error).message,
      })
    }
  }

  return sortFilePreviewSessions(sessions)
}

export async function clearFilePreviewSessions(streamId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    inMemoryPreviewSessions.delete(streamId)
    return
  }

  await withRedisRetry({ operation: 'clear_preview_sessions', streamId }, async (redis) => {
    await redis.del(getPreviewSessionsKey(streamId))
  })
}

export async function scheduleFilePreviewSessionCleanup(
  streamId: string,
  ttlSeconds = DEFAULT_COMPLETED_TTL_SECONDS
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    if (inMemoryPreviewSessions.has(streamId)) {
      setInMemoryPreviewExpiry(streamId, ttlSeconds)
    }
    return
  }

  try {
    await withRedisRetry(
      { operation: 'schedule_preview_session_cleanup', streamId },
      async (redis) => {
        await redis.expire(getPreviewSessionsKey(streamId), ttlSeconds)
      }
    )
  } catch (error) {
    logger.warn('Failed to shorten preview session retention', {
      streamId,
      ttlSeconds,
      error: toError(error).message,
    })
  }
}
