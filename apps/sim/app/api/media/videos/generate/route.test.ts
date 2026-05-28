/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  hybridAuthMock,
  hybridAuthMockFns,
  permissionsMock,
  permissionsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerateWorkspaceVideoFromPrompt } = vi.hoisted(() => ({
  mockGenerateWorkspaceVideoFromPrompt: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/generated-media/video/video-generation-service', () => ({
  generateWorkspaceVideoFromPrompt: (...args: unknown[]) =>
    mockGenerateWorkspaceVideoFromPrompt(...args),
}))

import { POST } from '@/app/api/media/videos/generate/route'

describe('POST /api/media/videos/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: hybridAuthMock.AuthType.SESSION,
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      canWrite: true,
      exists: true,
      workspace: { id: 'ws-1', name: 'Test Workspace', ownerId: 'user-1' },
    })
    mockGenerateWorkspaceVideoFromPrompt.mockResolvedValue({
      file: {
        id: 'wf_video_123',
        name: 'generated-video.mp4',
        size: 987,
        type: 'video/mp4',
        key: 'workspace/ws-1/generated-video.mp4',
        url: '/api/files/serve/workspace/ws-1/generated-video.mp4?context=workspace',
        context: 'workspace',
      },
      metadata: {
        provider: 'dashscope',
        providerModel: 'wan2.7-i2v',
        taskId: 'task-123',
      },
    })
  })

  it('allows authenticated users to generate and persist a Wan 2.7 workspace video', async () => {
    const request = createMockRequest(
      'POST',
      {
        workspaceId: 'ws-1',
        model: 'wan2.7-i2v',
        prompt: 'A black cat looks up and the camera rises overhead.',
        media: [
          {
            type: 'first_frame',
            file: {
              id: 'frame-1',
              name: 'first.png',
              url: 'https://example.com/first.png',
              key: 'workspace/first.png',
              size: 100,
              type: 'image/png',
            },
          },
          {
            type: 'last_frame',
            file: {
              id: 'frame-2',
              name: 'last.png',
              url: 'https://example.com/last.png',
              key: 'workspace/last.png',
              size: 200,
              type: 'image/png',
            },
          },
        ],
        parameters: {
          aspectRatioPreset: '16:9',
          resolution: '720P',
          duration: 5,
          promptExtend: true,
          watermark: false,
        },
      },
      {
        'content-type': 'application/json',
      },
      'http://localhost:3000/api/media/videos/generate'
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockGenerateWorkspaceVideoFromPrompt).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'user-1',
      model: 'wan2.7-i2v',
      prompt: 'A black cat looks up and the camera rises overhead.',
      media: expect.any(Array),
      parameters: {
        aspectRatioPreset: '16:9',
        resolution: '720P',
        duration: 5,
        promptExtend: true,
        watermark: false,
      },
    })
    expect(body).toMatchObject({
      success: true,
      file: {
        id: 'wf_video_123',
        name: 'generated-video.mp4',
      },
    })
  })

  it('returns the generation error message to the client when provider generation fails', async () => {
    mockGenerateWorkspaceVideoFromPrompt.mockRejectedValue(
      new Error(
        'DashScope needs publicly accessible image URLs for the first and last frames.'
      )
    )

    const request = createMockRequest(
      'POST',
      {
        workspaceId: 'ws-1',
        model: 'wan2.7-i2v',
        prompt: 'A black cat looks up and the camera rises overhead.',
        media: [
          {
            type: 'first_frame',
            file: {
              id: 'frame-1',
              name: 'first.png',
              url: 'https://example.com/first.png',
              key: 'workspace/first.png',
              size: 100,
              type: 'image/png',
            },
          },
          {
            type: 'last_frame',
            file: {
              id: 'frame-2',
              name: 'last.png',
              url: 'https://example.com/last.png',
              key: 'workspace/last.png',
              size: 200,
              type: 'image/png',
            },
          },
        ],
        parameters: {
          aspectRatioPreset: '16:9',
          resolution: '720P',
          duration: 5,
          promptExtend: true,
          watermark: false,
        },
      },
      {
        'content-type': 'application/json',
      },
      'http://localhost:3000/api/media/videos/generate'
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      error: 'DashScope needs publicly accessible image URLs for the first and last frames.',
    })
  })

  it('accepts a Wan 2.6 text-only generation request', async () => {
    const request = createMockRequest(
      'POST',
      {
        workspaceId: 'ws-1',
        model: 'wan2.6-t2v',
        prompt: 'A paper crane turns into a glowing bird in the rain.',
        media: [],
        parameters: {
          aspectRatioPreset: '1:1',
          resolution: '720P',
          duration: 4,
          promptExtend: true,
          watermark: false,
        },
      },
      {
        'content-type': 'application/json',
      },
      'http://localhost:3000/api/media/videos/generate'
    )

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mockGenerateWorkspaceVideoFromPrompt).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'user-1',
      model: 'wan2.6-t2v',
      prompt: 'A paper crane turns into a glowing bird in the rain.',
      media: [],
      parameters: {
        aspectRatioPreset: '1:1',
        resolution: '720P',
        duration: 4,
        promptExtend: true,
        watermark: false,
      },
    })
  })
})
