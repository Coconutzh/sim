/**
 * @vitest-environment node
 */
import { createEnvMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockExecuteProviderRequest,
  mockExtractAndParseJSON,
  mockGetProviderFromModel,
  mockGetProviderDefaultModel,
  mockGetProviderModels,
} = vi.hoisted(() => ({
  mockExecuteProviderRequest: vi.fn(),
  mockExtractAndParseJSON: vi.fn(),
  mockGetProviderFromModel: vi.fn(),
  mockGetProviderDefaultModel: vi.fn((provider: string) =>
    provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4.1'
  ),
  mockGetProviderModels: vi.fn((provider: string) =>
    provider === 'deepseek' ? ['deepseek-chat', 'deepseek-reasoner'] : ['gpt-4.1', 'gpt-4.1-mini']
  ),
}))

vi.mock('@/lib/core/config/env', () =>
  createEnvMock({
    LOCAL_COPILOT_PROVIDER: 'deepseek',
    LOCAL_COPILOT_MODEL: 'deepseek-chat',
    DEEPSEEK_API_KEY: 'deepseek-test-key',
  })
)

vi.mock('@/providers', () => ({
  executeProviderRequest: mockExecuteProviderRequest,
}))

vi.mock('@/providers/models', () => ({
  getProviderDefaultModel: mockGetProviderDefaultModel,
  getProviderModels: mockGetProviderModels,
}))

vi.mock('@/providers/utils', () => ({
  extractAndParseJSON: mockExtractAndParseJSON,
  getProviderFromModel: mockGetProviderFromModel,
}))

import {
  getLocalCopilotPlannerConfig,
  planLocalWorkflow,
} from '@/lib/copilot/request/lifecycle/local-workflow-planner'

describe('local workflow planner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProviderFromModel.mockReturnValue('deepseek')
  })

  it('resolves a DeepSeek planner configuration from local env vars', () => {
    expect(getLocalCopilotPlannerConfig()).toEqual({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'deepseek-test-key',
      keySource: 'DEEPSEEK_API_KEY',
    })
  })

  it('plans a local image-to-video workflow through the provider executor', async () => {
    mockExecuteProviderRequest.mockResolvedValue({
      content: '{"intent":"image_to_video"}',
      model: 'deepseek-chat',
    })
    mockExtractAndParseJSON.mockReturnValue({
      intent: 'image_to_video',
      assistantText: 'proposal ready',
      imagePrompt: 'A silver robot standing in the rain',
      videoPrompt: 'Animate the robot into a cinematic reveal shot',
      imageModel: 'gpt-image-1',
      videoProvider: 'runway',
      durationSeconds: 5,
      aspectRatio: '16:9',
    })

    const result = await planLocalWorkflow({
      message:
        '\u5728\u753b\u5e03\u751f\u6210\u4e00\u5957\u6587\u751f\u56fe\u751f\u89c6\u9891\u8282\u70b9\u5e76\u8fde\u7ebf',
    })

    expect(mockExecuteProviderRequest).toHaveBeenCalledWith(
      'deepseek',
      expect.objectContaining({
        model: 'deepseek-chat',
        apiKey: 'deepseek-test-key',
      })
    )
    expect(result).toEqual({
      config: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        apiKey: 'deepseek-test-key',
        keySource: 'DEEPSEEK_API_KEY',
      },
      plan: {
        intent: 'image_to_video',
        assistantText: 'proposal ready',
        imagePrompt: 'A silver robot standing in the rain',
        videoPrompt: 'Animate the robot into a cinematic reveal shot',
        imageModel: 'gpt-image-1',
        videoProvider: 'runway',
        durationSeconds: 5,
        aspectRatio: '16:9',
      },
    })
  })
})
