/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCaptureWorkspaceVideoFrame = vi.fn()
const mockCheckSessionOrInternalAuth = vi.fn()
const mockCheckWorkspaceAccess = vi.fn()
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
vi.mock('@/lib/generated-media/video/video-frame-capture-service', () => ({
  captureWorkspaceVideoFrame: (...args: unknown[]) => mockCaptureWorkspaceVideoFrame(...args),
}))
vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: (...args: unknown[]) => mockVerifyFileAccess(...args),
}))

let postRoute: typeof import('@/app/api/media/videos/capture-frame/route').POST

beforeAll(async () => {
  ;({ POST: postRoute } = await import('@/app/api/media/videos/capture-frame/route'))
})

function createJsonRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/media/videos/capture-frame', {
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
    timeSeconds: 1.25,
    mode: 'current',
  }
}

describe('POST /api/media/videos/capture-frame', () => {
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
    mockCaptureWorkspaceVideoFrame.mockResolvedValue({
      file: {
        id: 'wf_frame',
        name: 'source-frame-current.jpg',
        size: 456,
        type: 'image/jpeg',
        key: 'workspace/ws-1/source-frame-current.jpg',
        url: '/api/files/serve/workspace/ws-1/source-frame-current.jpg?context=workspace',
        context: 'workspace',
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
    expect(mockCaptureWorkspaceVideoFrame).not.toHaveBeenCalled()
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
    expect(mockCaptureWorkspaceVideoFrame).not.toHaveBeenCalled()
  })

  it('captures a workspace video frame and returns the persisted image file', async () => {
    const response = await postRoute(
      createJsonRequest({
        ...createBody(),
        timeSeconds: 4.95,
        mode: 'last',
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
    expect(mockCaptureWorkspaceVideoFrame).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'user-1',
      sourceFile,
      timeSeconds: 4.95,
      mode: 'last',
    })
    expect(body).toEqual({
      success: true,
      file: {
        id: 'wf_frame',
        name: 'source-frame-current.jpg',
        size: 456,
        type: 'image/jpeg',
        key: 'workspace/ws-1/source-frame-current.jpg',
        url: '/api/files/serve/workspace/ws-1/source-frame-current.jpg?context=workspace',
        context: 'workspace',
      },
    })
  })

  it('returns the service error message when frame capture fails', async () => {
    mockCaptureWorkspaceVideoFrame.mockRejectedValueOnce(
      new Error('FFmpeg frame capture failed: bad input')
    )

    const response = await postRoute(createJsonRequest(createBody()))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'FFmpeg frame capture failed: bad input' })
  })
})
