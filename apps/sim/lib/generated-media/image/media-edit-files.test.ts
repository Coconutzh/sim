/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  loggerMock,
  mockFetchWorkspaceFileBuffer,
  mockGetWorkspaceFile,
  mockGetWorkspaceFileByKey,
} = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  mockFetchWorkspaceFileBuffer: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
  mockGetWorkspaceFileByKey: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => loggerMock),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: (...args: unknown[]) => mockFetchWorkspaceFileBuffer(...args),
  getWorkspaceFile: (...args: unknown[]) => mockGetWorkspaceFile(...args),
  getWorkspaceFileByKey: (...args: unknown[]) => mockGetWorkspaceFileByKey(...args),
}))

import { resolveMediaEditWorkspaceFile } from '@/lib/generated-media/image/media-edit-files'

function createWorkspaceFileRecord(overrides: {
  id: string
  key: string
  name?: string
  size?: number
  type?: string
}) {
  return {
    id: overrides.id,
    workspaceId: 'ws-1',
    name: overrides.name ?? `${overrides.id}.png`,
    key: overrides.key,
    path: `/api/files/serve/${encodeURIComponent(overrides.key)}?context=workspace`,
    size: overrides.size ?? 100,
    type: overrides.type ?? 'image/png',
    uploadedBy: 'user-1',
    uploadedAt: new Date('2026-06-16T00:00:00.000Z'),
    updatedAt: new Date('2026-06-16T00:00:00.000Z'),
    deletedAt: null,
  }
}

describe('resolveMediaEditWorkspaceFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefers the displayed key over a mismatched legacy id and logs a warning', async () => {
    const displayedRecord = createWorkspaceFileRecord({
      id: 'file-a',
      key: 'workspace/ws-1/a.png',
      name: 'a.png',
    })
    const idRecord = createWorkspaceFileRecord({
      id: 'file-b',
      key: 'workspace/ws-1/b.png',
      name: 'b.png',
    })
    mockGetWorkspaceFileByKey.mockResolvedValue(displayedRecord)
    mockGetWorkspaceFile.mockResolvedValue(idRecord)
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from('image-a'))

    const result = await resolveMediaEditWorkspaceFile({
      workspaceId: 'ws-1',
      file: {
        id: 'file-b',
        name: 'dirty.png',
        url: '/api/files/serve/workspace%2Fws-1%2Fa.png?context=workspace',
        key: 'workspace/ws-1/a.png',
      },
    })

    expect(mockGetWorkspaceFileByKey).toHaveBeenCalledWith('ws-1', 'workspace/ws-1/a.png')
    expect(mockFetchWorkspaceFileBuffer).toHaveBeenCalledWith(displayedRecord)
    expect(result).toMatchObject({
      id: 'file-a',
      name: 'a.png',
      key: 'workspace/ws-1/a.png',
      base64: Buffer.from('image-a').toString('base64'),
    })
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Media edit file id does not match displayed storage key; using key record',
      expect.objectContaining({
        workspaceId: 'ws-1',
        fileId: 'file-b',
        displayedFileId: 'file-a',
      })
    )
  })

  it('falls back to id-only lookup for legacy file values', async () => {
    const legacyRecord = createWorkspaceFileRecord({
      id: 'file-legacy',
      key: 'workspace/ws-1/legacy.png',
    })
    mockGetWorkspaceFile.mockResolvedValue(legacyRecord)
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from('legacy-image'))

    const result = await resolveMediaEditWorkspaceFile({
      workspaceId: 'ws-1',
      file: {
        id: 'file-legacy',
        name: 'legacy.png',
        url: '',
        key: '',
      },
    })

    expect(mockGetWorkspaceFileByKey).not.toHaveBeenCalled()
    expect(mockGetWorkspaceFile).toHaveBeenCalledWith('ws-1', 'file-legacy')
    expect(result).toMatchObject({
      id: 'file-legacy',
      key: 'workspace/ws-1/legacy.png',
      base64: Buffer.from('legacy-image').toString('base64'),
    })
    expect(loggerMock.warn).not.toHaveBeenCalled()
  })
})
