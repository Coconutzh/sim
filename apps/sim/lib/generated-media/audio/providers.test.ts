/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = process.env

describe('generateAudioWithProvider', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    process.env = {
      ...originalEnv,
      CONTENT_AUDIO_API_KEY: 'evolink-test-key',
      EVOLINK_API_KEY: 'evolink-test-key',
    }
  })

  it('creates a simple Suno task, polls until success, and downloads the first audio result', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task-audio-1',
          status: 'PENDING',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task-audio-1',
          status: 'RUNNING',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task-audio-1',
          status: 'SUCCEEDED',
          results: ['https://example.com/song-1.mp3', 'https://example.com/song-2.mp3'],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'audio/mpeg' }),
        arrayBuffer: async () => Buffer.from('audio-binary'),
      })

    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn()
      return 0 as unknown as ReturnType<typeof setTimeout>
    })

    const { generateAudioWithProvider } = await import('@/lib/generated-media/audio/providers')
    const result = await generateAudioWithProvider({
      model: 'suno-v5-beta',
      prompt: 'A dreamy indie pop song about late-night trains.',
      parameters: {
        customMode: false,
        instrumental: false,
        style: '',
        title: '',
        negativeTags: '',
        vocalGender: '',
      },
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.evolink.ai/v1/audios/generations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer evolink-test-key',
          'Content-Type': 'application/json',
        }),
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.evolink.ai/v1/tasks/task-audio-1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer evolink-test-key',
        }),
      })
    )

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(payload).toMatchObject({
      model: 'suno-v5-beta',
      custom_mode: false,
      instrumental: false,
      prompt: 'A dreamy indie pop song about late-night trains.',
    })
    expect(payload).not.toHaveProperty('style')
    expect(result).toMatchObject({
      mimeType: 'audio/mpeg',
      provider: 'evolink',
      providerModel: 'suno-v5-beta',
      taskId: 'task-audio-1',
    })
    expect(result.buffer.equals(Buffer.from('audio-binary'))).toBe(true)
  })

  it('bounds appended reference context for simple Suno prompts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task-audio-context',
          status: 'SUCCEEDED',
          results: ['https://example.com/song-context.mp3'],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'audio/mpeg' }),
        arrayBuffer: async () => Buffer.from('audio-binary'),
      })

    vi.stubGlobal('fetch', fetchMock)

    const { generateAudioWithProvider } = await import('@/lib/generated-media/audio/providers')
    await generateAudioWithProvider({
      model: 'suno-v5-beta',
      prompt: 'Relaxing acoustic guitar and soft piano.',
      parameters: {
        customMode: false,
        instrumental: false,
        style: '',
        title: '',
        negativeTags: '',
        vocalGender: '',
      },
      referenceContext: {
        text: ['Reference script: '.concat('forest afternoon tea '.repeat(80))],
      },
    })

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(String(payload.prompt).length).toBeLessThanOrEqual(500)
    expect(payload.prompt).toContain('Relaxing acoustic guitar and soft piano.')
  })

  it('maps custom mode fields and fails when polling returns FAILED', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task-audio-2',
          status: 'PENDING',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task-audio-2',
          status: 'FAILED',
          error: 'Generation failed',
        }),
      })

    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn()
      return 0 as unknown as ReturnType<typeof setTimeout>
    })

    const { generateAudioWithProvider } = await import('@/lib/generated-media/audio/providers')

    await expect(
      generateAudioWithProvider({
        model: 'suno-v4.5-beta',
        prompt: 'We were fire in the rain',
        parameters: {
          customMode: true,
          instrumental: false,
          style: 'cinematic pop, female vocal, wide chorus',
          title: 'Fire In The Rain',
          negativeTags: 'metal, scream',
          vocalGender: 'female',
        },
      })
    ).rejects.toThrow('Generation failed')

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(payload).toMatchObject({
      model: 'suno-v4.5-beta',
      custom_mode: true,
      instrumental: false,
      prompt: 'We were fire in the rain',
      style: 'cinematic pop, female vocal, wide chorus',
      title: 'Fire In The Rain',
      negative_tags: 'metal, scream',
      vocal_gender: 'female',
    })
  })

  it('supports the current EvoLink task response shape with id and error.message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'task-unified-1766319089-oqs9cue4',
          status: 'pending',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'task-unified-1766319089-oqs9cue4',
          status: 'completed',
          results: ['https://example.com/song-3.mp3'],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'audio/mpeg' }),
        arrayBuffer: async () => Buffer.from('audio-binary-3'),
      })

    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn()
      return 0 as unknown as ReturnType<typeof setTimeout>
    })

    const { generateAudioWithProvider } = await import('@/lib/generated-media/audio/providers')

    const result = await generateAudioWithProvider({
      model: 'suno-v5-beta',
      prompt: 'A retro synthwave anthem about neon skylines.',
      parameters: {
        customMode: false,
        instrumental: false,
        style: '',
        title: '',
        negativeTags: '',
        vocalGender: '',
      },
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.evolink.ai/v1/tasks/task-unified-1766319089-oqs9cue4',
      expect.anything()
    )
    expect(result.taskId).toBe('task-unified-1766319089-oqs9cue4')
    expect(result.buffer.equals(Buffer.from('audio-binary-3'))).toBe(true)
  })

  it('surfaces nested error.message from the current EvoLink task error payload', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'task-unified-1766319099-abcd1234',
          status: 'pending',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'task-unified-1766319099-abcd1234',
          status: 'failed',
          error: {
            code: 'invalid_parameters',
            message: 'Prompt is too long',
          },
        }),
      })

    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn()
      return 0 as unknown as ReturnType<typeof setTimeout>
    })

    const { generateAudioWithProvider } = await import('@/lib/generated-media/audio/providers')

    await expect(
      generateAudioWithProvider({
        model: 'suno-v4-beta',
        prompt: 'x'.repeat(5000),
        parameters: {
          customMode: false,
          instrumental: false,
          style: '',
          title: '',
          negativeTags: '',
          vocalGender: '',
        },
      })
    ).rejects.toThrow('Prompt is too long')
  })
})
