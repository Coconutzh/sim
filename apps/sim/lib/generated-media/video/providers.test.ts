/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = process.env

describe('generateVideoWithProvider', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    process.env = {
      ...originalEnv,
      DASHSCOPE_API_KEY: 'dashscope-test-key',
      NEXT_PUBLIC_APP_URL: 'https://app.example.com',
    }
  })

  it('creates a Wan 2.7 task, polls until success, and downloads the mp4 result', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: { task_id: 'task-123', task_status: 'PENDING' },
          request_id: 'req-create',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: { task_id: 'task-123', task_status: 'RUNNING' },
          request_id: 'req-poll-1',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: {
            task_id: 'task-123',
            task_status: 'SUCCEEDED',
            video_url: 'https://example.com/generated.mp4',
            orig_prompt: 'A black cat looks up and the camera rises overhead.',
          },
          request_id: 'req-poll-2',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'video/mp4' }),
        arrayBuffer: async () => Buffer.from('video-binary'),
      })

    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn()
      return 0 as unknown as ReturnType<typeof setTimeout>
    })

    const { generateVideoWithProvider } = await import('@/lib/generated-media/video/providers')
    const result = await generateVideoWithProvider({
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
          },
        },
        {
          type: 'last_frame',
          file: {
            id: 'frame-2',
            name: 'last.png',
            url: 'https://example.com/last.png',
            key: 'workspace/last.png',
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

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer dashscope-test-key',
          'X-DashScope-Async': 'enable',
        }),
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://dashscope-intl.aliyuncs.com/api/v1/tasks/task-123',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer dashscope-test-key',
        }),
      })
    )
    expect(result).toMatchObject({
      mimeType: 'video/mp4',
      provider: 'dashscope',
      providerModel: 'wan2.7-i2v',
      taskId: 'task-123',
    })
    expect(result.buffer.equals(Buffer.from('video-binary'))).toBe(true)
  })

  it('surfaces the provider failure message when polling ends in FAILED', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: { task_id: 'task-456', task_status: 'PENDING' },
          request_id: 'req-create',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: {
            task_id: 'task-456',
            task_status: 'FAILED',
            code: 'InvalidParameter',
            message: 'The size is not match xxxxxx',
          },
          request_id: 'req-poll-1',
        }),
      })

    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn()
      return 0 as unknown as ReturnType<typeof setTimeout>
    })

    const { generateVideoWithProvider } = await import('@/lib/generated-media/video/providers')

    await expect(
      generateVideoWithProvider({
        model: 'wan2.7-i2v',
        prompt: 'Prompt',
        media: [
          {
            type: 'first_frame',
            file: {
              id: 'frame-1',
              name: 'first.png',
              url: 'https://example.com/first.png',
              key: 'workspace/first.png',
            },
          },
          {
            type: 'last_frame',
            file: {
              id: 'frame-2',
              name: 'last.png',
              url: 'https://example.com/last.png',
              key: 'workspace/last.png',
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
    ).rejects.toThrow('The size is not match xxxxxx')
  })

  it('rejects local workspace frame URLs that are not publicly accessible to DashScope', async () => {
    process.env = {
      ...originalEnv,
      DASHSCOPE_API_KEY: 'dashscope-test-key',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    }

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { generateVideoWithProvider } = await import('@/lib/generated-media/video/providers')

    await expect(
      generateVideoWithProvider({
        model: 'wan2.7-i2v',
        prompt: 'Prompt',
        media: [
          {
            type: 'first_frame',
            file: {
              id: 'frame-1',
              name: 'first.png',
              url: '/api/files/serve/workspace/first.png?context=workspace',
              key: 'workspace/first.png',
            },
          },
          {
            type: 'last_frame',
            file: {
              id: 'frame-2',
              name: 'last.png',
              url: '/api/files/serve/workspace/last.png?context=workspace',
              key: 'workspace/last.png',
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
    ).rejects.toThrow(
      'DashScope needs publicly accessible image URLs for the first and last frames.'
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates a Wan 2.6 text-to-video task without media URLs', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: { task_id: 'task-26-t2v', task_status: 'SUCCEEDED', video_url: 'https://example.com/t2v.mp4' },
          request_id: 'req-create',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'video/mp4' }),
        arrayBuffer: async () => Buffer.from('video-binary'),
      })

    vi.stubGlobal('fetch', fetchMock)

    const { generateVideoWithProvider } = await import('@/lib/generated-media/video/providers')

    await generateVideoWithProvider({
      model: 'wan2.6-t2v',
      prompt: 'A paper boat sails through a glowing canal at night.',
      media: [],
      parameters: {
        aspectRatioPreset: '9:16',
        resolution: '1080P',
        duration: 8,
        promptExtend: true,
        watermark: false,
      },
    })

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(payload).toMatchObject({
      model: 'wan2.6-t2v',
      input: {
        prompt: 'A paper boat sails through a glowing canal at night.',
      },
      parameters: {
        size: '1080*1920',
        duration: 8,
        prompt_extend: true,
        shot_type: 'single',
        watermark: false,
      },
    })
    expect(payload.input).not.toHaveProperty('media')
    expect(payload.parameters).not.toHaveProperty('audio')
  })

  it('creates a Wan 2.6 image-to-video task with a single first-frame URL and audio enabled', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: { task_id: 'task-26-i2v', task_status: 'SUCCEEDED', video_url: 'https://example.com/i2v.mp4' },
          request_id: 'req-create',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'video/mp4' }),
        arrayBuffer: async () => Buffer.from('video-binary'),
      })

    vi.stubGlobal('fetch', fetchMock)

    const { generateVideoWithProvider } = await import('@/lib/generated-media/video/providers')

    await generateVideoWithProvider({
      model: 'wan2.6-i2v-flash',
      prompt: 'A cinematic drone rise over a frozen waterfall.',
      media: [
        {
          type: 'first_frame',
          file: {
            id: 'frame-1',
            name: 'first.png',
            url: 'https://example.com/first.png',
            key: 'workspace/first.png',
          },
        },
      ],
      parameters: {
        aspectRatioPreset: '16:9',
        resolution: '720P',
        duration: 6,
        promptExtend: true,
        watermark: false,
      },
    })

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(payload).toMatchObject({
      model: 'wan2.6-i2v-flash',
      input: {
        prompt: 'A cinematic drone rise over a frozen waterfall.',
        img_url: 'https://example.com/first.png',
      },
      parameters: {
        size: '1280*720',
        duration: 6,
        prompt_extend: true,
        shot_type: 'single',
        watermark: false,
        audio: true,
      },
    })
  })
})
