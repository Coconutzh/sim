/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetRedisClient } = vi.hoisted(() => ({
  mockGetRedisClient: vi.fn(),
}))

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: mockGetRedisClient,
}))

import {
  clearFilePreviewSessions,
  createFilePreviewSession,
  readFilePreviewSessions,
  sortFilePreviewSessions,
  upsertFilePreviewSession,
} from '@/lib/copilot/request/session/file-preview-session'

describe('file preview session helpers', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetRedisClient.mockReturnValue(null)
    await clearFilePreviewSessions('stream-1')
  })

  it('preserves baseContent when creating a preview session', () => {
    const session = createFilePreviewSession({
      streamId: 'stream-1',
      toolCallId: 'preview-1',
      fileName: 'draft.md',
      baseContent: 'existing content',
    })

    expect(session.baseContent).toBe('existing content')
  })

  it('sorts preview sessions by updatedAt across tool call ids', () => {
    const sessions = sortFilePreviewSessions([
      createFilePreviewSession({
        streamId: 'stream-1',
        toolCallId: 'preview-2',
        fileName: 'b.md',
        previewVersion: 10,
        updatedAt: '2026-04-10T00:00:02.000Z',
      }),
      createFilePreviewSession({
        streamId: 'stream-1',
        toolCallId: 'preview-1',
        fileName: 'a.md',
        previewVersion: 1,
        updatedAt: '2026-04-10T00:00:01.000Z',
      }),
    ])

    expect(sessions.map((session) => session.id)).toEqual(['preview-1', 'preview-2'])
  })

  it('falls back to in-memory preview sessions when Redis is unavailable', async () => {
    const newerSession = createFilePreviewSession({
      streamId: 'stream-1',
      toolCallId: 'preview-2',
      fileName: 'b.md',
      updatedAt: '2026-04-10T00:00:02.000Z',
    })
    const olderSession = createFilePreviewSession({
      streamId: 'stream-1',
      toolCallId: 'preview-1',
      fileName: 'a.md',
      updatedAt: '2026-04-10T00:00:01.000Z',
    })

    await upsertFilePreviewSession(newerSession)
    await upsertFilePreviewSession(olderSession)

    await expect(readFilePreviewSessions('stream-1')).resolves.toEqual([olderSession, newerSession])
  })
})
