/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCheckSessionOrInternalAuth = vi.fn()
const mockCheckWorkspaceAccess = vi.fn()
const mockGenerateWorkspaceVideoThumbnails = vi.fn()
const mockVerifyFileAccess = vi.fn()

process.env.DATABASE_URL ??= 'postgres://sim:sim@localhost:5432/sim_test'

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: (...args: unknown[]) => mockCheckSessionOrInternalAuth(...args),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: (...args: unknown[]) => mockCheckWorkspaceAccess(...args),
}))
vi.mock('@sim/db', () => ({ db: {} }))
vi.mock('@sim/db/schema', () => ({
  document: {},
  knowledgeBase: {},
  workspaceFile: {},
}))
vi.mock('@/lib/generated-media/video/video-trim-service', () => ({
  generateWorkspaceVideoThumbnails: (...args: unknown[]) =>
    mockGenerateWorkspaceVideoThumbnails(...args),
  trimWorkspaceVideo: vi.fn(),
}))
vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: (...args: unknown[]) => mockVerifyFileAccess(...args),
}))

let postRoute: typeof import('@/app/api/media/videos/thumbnails/route').POST

beforeAll(async () => {
  ;({ POST: postRoute } = await import('@/app/api/media/videos/thumbnails/route'))
})

function createJsonRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/media/videos/thumbnails', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const sourceFile = {
  id: 'wf_source',
  name: 'source.mp4',
  url: '/api/files/serve/workspace/ws-1/source.mp4?context=workspace',
  key: 'workspace/ws-1/source.mp4',
  size: 1000,
  type: 'video/mp4',
  context: 'workspace',
}

describe('POST /api/media/videos/thumbnails', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      canWrite: true,
      exists: true,
      workspace: { id: 'ws-1', name: 'Test Workspace', ownerId: 'user-1' },
    })
    mockVerifyFileAccess.mockResolvedValue(true)
    mockGenerateWorkspaceVideoThumbnails.mockResolvedValue({
      thumbnails: ['data:image/jpeg;base64,abc'],
    })
  })

  it('returns 401 when the caller is not authenticated', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      userId: null,
      authType: 'session',
    })

    const response = await postRoute(
      createJsonRequest({
        workspaceId: 'ws-1',
        sourceFile,
        durationSeconds: 9.5,
        frameCount: 12,
      })
    )

    expect(response.status).toBe(401)
    expect(mockGenerateWorkspaceVideoThumbnails).not.toHaveBeenCalled()
  })

  it('rejects invalid video durations before workspace access checks', async () => {
    const response = await postRoute(
      createJsonRequest({
        workspaceId: 'ws-1',
        sourceFile,
        durationSeconds: 0,
        frameCount: 12,
      })
    )

    expect(response.status).toBe(400)
    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockGenerateWorkspaceVideoThumbnails).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller cannot write to the workspace', async () => {
    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      hasAccess: true,
      canWrite: false,
      exists: true,
      workspace: { id: 'ws-1', name: 'Test Workspace', ownerId: 'user-1' },
    })

    const response = await postRoute(
      createJsonRequest({
        workspaceId: 'ws-1',
        sourceFile,
        durationSeconds: 9.5,
        frameCount: 12,
      })
    )

    expect(response.status).toBe(403)
    expect(mockGenerateWorkspaceVideoThumbnails).not.toHaveBeenCalled()
  })

  it('returns generated thumbnail data urls', async () => {
    const response = await postRoute(
      createJsonRequest({
        workspaceId: 'ws-1',
        sourceFile,
        durationSeconds: 9.5,
        frameCount: 12,
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockVerifyFileAccess).toHaveBeenCalledWith(
      sourceFile.key,
      'user-1',
      undefined,
      'workspace',
      false
    )
    expect(mockGenerateWorkspaceVideoThumbnails).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'user-1',
      sourceFile,
      durationSeconds: 9.5,
      frameCount: 12,
    })
    expect(body).toEqual({
      success: true,
      thumbnails: ['data:image/jpeg;base64,abc'],
    })
  })
})
