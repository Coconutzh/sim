/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerateVideoWithProvider, mockUploadWorkspaceFile } = vi.hoisted(() => ({
  mockGenerateVideoWithProvider: vi.fn(),
  mockUploadWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/generated-media/video/providers', () => ({
  generateVideoWithProvider: (...args: unknown[]) => mockGenerateVideoWithProvider(...args),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  uploadWorkspaceFile: (...args: unknown[]) => mockUploadWorkspaceFile(...args),
}))

import { generateWorkspaceVideoFromPrompt } from '@/lib/generated-media/video/video-generation-service'

describe('generateWorkspaceVideoFromPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates a Wan 2.7 video, saves it as a workspace file, and returns metadata', async () => {
    mockGenerateVideoWithProvider.mockResolvedValue({
      buffer: Buffer.from('video-binary'),
      mimeType: 'video/mp4',
      provider: 'dashscope',
      providerModel: 'wan2.7-i2v',
      taskId: 'task-123',
      revisedPrompt: 'refined prompt',
    })

    mockUploadWorkspaceFile.mockResolvedValue({
      id: 'wf_video_123',
      name: 'generated-video.mp4',
      size: 987,
      type: 'video/mp4',
      key: 'workspace/ws-1/generated-video.mp4',
      url: '/api/files/serve/workspace/ws-1/generated-video.mp4?context=workspace',
      context: 'workspace',
    })

    const result = await generateWorkspaceVideoFromPrompt({
      workspaceId: 'ws-1',
      userId: 'user-1',
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
    })

    expect(mockGenerateVideoWithProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'wan2.7-i2v',
        parameters: expect.objectContaining({
          aspectRatioPreset: '16:9',
          resolution: '720P',
          duration: 5,
          promptExtend: true,
          watermark: false,
        }),
      })
    )
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'ws-1',
      'user-1',
      expect.any(Buffer),
      'generated-video.mp4',
      'video/mp4'
    )
    expect(result.metadata).toMatchObject({
      provider: 'dashscope',
      providerModel: 'wan2.7-i2v',
      taskId: 'task-123',
    })
  })

  it('passes through the Wan 2.6 text-to-video model with empty media', async () => {
    mockGenerateVideoWithProvider.mockResolvedValue({
      buffer: Buffer.from('video-binary'),
      mimeType: 'video/mp4',
      provider: 'dashscope',
      providerModel: 'wan2.6-t2v',
      taskId: 'task-456',
    })

    mockUploadWorkspaceFile.mockResolvedValue({
      id: 'wf_video_456',
      name: 'generated-video.mp4',
      size: 654,
      type: 'video/mp4',
      key: 'workspace/ws-1/generated-video.mp4',
      url: '/api/files/serve/workspace/ws-1/generated-video.mp4?context=workspace',
      context: 'workspace',
    })

    await generateWorkspaceVideoFromPrompt({
      workspaceId: 'ws-1',
      userId: 'user-1',
      model: 'wan2.6-t2v',
      prompt: 'A glowing kite drifts through storm clouds.',
      media: [],
      parameters: {
        aspectRatioPreset: '9:16',
        resolution: '1080P',
        duration: 7,
        promptExtend: true,
        watermark: false,
      },
    })

    expect(mockGenerateVideoWithProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'wan2.6-t2v',
        media: [],
        parameters: expect.objectContaining({
          aspectRatioPreset: '9:16',
          resolution: '1080P',
          duration: 7,
        }),
      })
    )
  })
})
