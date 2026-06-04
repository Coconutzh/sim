/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerateAudioWithProvider, mockUploadWorkspaceFile } = vi.hoisted(() => ({
  mockGenerateAudioWithProvider: vi.fn(),
  mockUploadWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/generated-media/audio/providers', () => ({
  generateAudioWithProvider: (...args: unknown[]) => mockGenerateAudioWithProvider(...args),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  uploadWorkspaceFile: (...args: unknown[]) => mockUploadWorkspaceFile(...args),
}))

import { generateWorkspaceAudioFromPrompt } from '@/lib/generated-media/audio/audio-generation-service'

describe('generateWorkspaceAudioFromPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates a Suno audio file, saves it, and returns metadata', async () => {
    mockGenerateAudioWithProvider.mockResolvedValue({
      buffer: Buffer.from('audio-binary'),
      mimeType: 'audio/mpeg',
      provider: 'evolink',
      providerModel: 'suno-v5-beta',
      taskId: 'task-audio-1',
    })

    mockUploadWorkspaceFile.mockResolvedValue({
      id: 'wf_audio_123',
      name: 'generated-audio.mp3',
      size: 321,
      type: 'audio/mpeg',
      key: 'workspace/ws-1/generated-audio.mp3',
      url: '/api/files/serve/workspace/ws-1/generated-audio.mp3?context=workspace',
      context: 'workspace',
    })

    const result = await generateWorkspaceAudioFromPrompt({
      workspaceId: 'ws-1',
      userId: 'user-1',
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
      referenceContext: {
        text: ['Reference text node: sparse drums, warm tape, midnight subway ambience.'],
      },
    })

    expect(mockGenerateAudioWithProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'suno-v5-beta',
        prompt: 'A dreamy indie pop song about late-night trains.',
        referenceContext: {
          text: ['Reference text node: sparse drums, warm tape, midnight subway ambience.'],
        },
      })
    )
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'ws-1',
      'user-1',
      expect.any(Buffer),
      'generated-audio.mp3',
      'audio/mpeg'
    )
    expect(result.metadata).toMatchObject({
      provider: 'evolink',
      providerModel: 'suno-v5-beta',
      taskId: 'task-audio-1',
    })
  })
})
