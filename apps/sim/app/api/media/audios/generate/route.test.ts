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

const { mockGenerateWorkspaceAudioFromPrompt } = vi.hoisted(() => ({
  mockGenerateWorkspaceAudioFromPrompt: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/generated-media/audio/audio-generation-service', () => ({
  generateWorkspaceAudioFromPrompt: (...args: unknown[]) =>
    mockGenerateWorkspaceAudioFromPrompt(...args),
}))

import { POST } from '@/app/api/media/audios/generate/route'

describe('POST /api/media/audios/generate', () => {
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
    mockGenerateWorkspaceAudioFromPrompt.mockResolvedValue({
      file: {
        id: 'wf_audio_123',
        name: 'generated-audio.mp3',
        size: 321,
        type: 'audio/mpeg',
        key: 'workspace/ws-1/generated-audio.mp3',
        url: '/api/files/serve/workspace/ws-1/generated-audio.mp3?context=workspace',
        context: 'workspace',
      },
      metadata: {
        provider: 'evolink',
        providerModel: 'suno-v5-beta',
        taskId: 'task-audio-1',
      },
    })
  })

  it('accepts a simple Suno generation request', async () => {
    const request = createMockRequest(
      'POST',
      {
        workspaceId: 'ws-1',
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
      },
      {
        'content-type': 'application/json',
      },
      'http://localhost:3000/api/media/audios/generate'
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockGenerateWorkspaceAudioFromPrompt).toHaveBeenCalledWith({
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
    expect(body).toMatchObject({
      success: true,
      file: {
        id: 'wf_audio_123',
        name: 'generated-audio.mp3',
      },
    })
  })

  it('returns the provider error message to the client when generation fails', async () => {
    mockGenerateWorkspaceAudioFromPrompt.mockRejectedValue(new Error('EvoLink task failed'))

    const request = createMockRequest(
      'POST',
      {
        workspaceId: 'ws-1',
        model: 'suno-v4.5-beta',
        prompt: 'We were fire in the rain',
        parameters: {
          customMode: true,
          instrumental: false,
          style: 'cinematic pop',
          title: 'Fire In The Rain',
          negativeTags: 'metal',
          vocalGender: 'female',
        },
      },
      {
        'content-type': 'application/json',
      },
      'http://localhost:3000/api/media/audios/generate'
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body).toMatchObject({
      error: 'EvoLink task failed',
    })
  })
})
