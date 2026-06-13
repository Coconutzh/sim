/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCheckSessionOrInternalAuth = vi.fn()
const mockCheckWorkspaceAccess = vi.fn()
const mockEnhanceWorkspaceVideo = vi.fn()
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
vi.mock('@/lib/generated-media/video/video-enhance-service', () => ({
  enhanceWorkspaceVideo: (...args: unknown[]) => mockEnhanceWorkspaceVideo(...args),
}))
vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: (...args: unknown[]) => mockVerifyFileAccess(...args),
}))

let postRoute: typeof import('@/app/api/media/videos/enhance/route').POST

beforeAll(async () => {
  ;({ POST: postRoute } = await import('@/app/api/media/videos/enhance/route'))
})

function createJsonRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/media/videos/enhance', {
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

function createBody() {
  return {
    workspaceId: 'ws-1',
    sourceFile,
    resolution: '1080p',
    frameRate: 'source',
    slowMotion: 'source',
  }
}

describe('POST /api/media/videos/enhance', () => {
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
    mockEnhanceWorkspaceVideo.mockResolvedValue({
      file: {
        id: 'wf_enhanced',
        name: 'source-enhanced.mp4',
        size: 456,
        type: 'video/mp4',
        key: 'workspace/ws-1/source-enhanced.mp4',
        url: '/api/files/serve/workspace/ws-1/source-enhanced.mp4?context=workspace',
        context: 'workspace',
      },
      metadata: {
        provider: 'ffmpeg',
        resolution: '1080p',
        frameRate: 'source',
        slowMotion: 'source',
      },
    })
  })

  it('returns 401 when the caller is not authenticated', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      userId: null,
      authType: 'session',
    })

    const response = await postRoute(createJsonRequest(createBody()))

    expect(response.status).toBe(401)
    expect(mockEnhanceWorkspaceVideo).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller cannot write to the workspace', async () => {
    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      hasAccess: true,
      canWrite: false,
      exists: true,
      workspace: { id: 'ws-1', name: 'Test Workspace', ownerId: 'user-1' },
    })

    const response = await postRoute(createJsonRequest(createBody()))

    expect(response.status).toBe(403)
    expect(mockEnhanceWorkspaceVideo).not.toHaveBeenCalled()
  })

  it('enhances a workspace video and returns the persisted file', async () => {
    const response = await postRoute(
      createJsonRequest({
        ...createBody(),
        resolution: '4k',
        frameRate: '60fps',
        slowMotion: '2x',
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
    expect(mockEnhanceWorkspaceVideo).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'user-1',
      sourceFile,
      resolution: '4k',
      frameRate: '60fps',
      slowMotion: '2x',
    })
    expect(body).toEqual({
      success: true,
      file: {
        id: 'wf_enhanced',
        name: 'source-enhanced.mp4',
        size: 456,
        type: 'video/mp4',
        key: 'workspace/ws-1/source-enhanced.mp4',
        url: '/api/files/serve/workspace/ws-1/source-enhanced.mp4?context=workspace',
        context: 'workspace',
      },
      metadata: {
        provider: 'ffmpeg',
        resolution: '1080p',
        frameRate: 'source',
        slowMotion: 'source',
      },
    })
  })

  it('returns the service error message when video enhancement fails', async () => {
    mockEnhanceWorkspaceVideo.mockRejectedValueOnce(new Error('FFmpeg enhance failed: bad input'))

    const response = await postRoute(createJsonRequest(createBody()))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'FFmpeg enhance failed: bad input' })
  })
})
