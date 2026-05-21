/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}))

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: (...args: unknown[]) => mockCreate(...args),
        },
      }
    },
  }
})

import { zhipuProvider } from '@/providers/zhipu'

describe('zhipuProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns plain text content for non-tool requests', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: '你好，世界',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 18,
        total_tokens: 30,
      },
    })

    const result = await zhipuProvider.executeRequest({
      apiKey: 'test-key',
      model: 'glm-4.7',
      workspaceId: 'ws-1',
      messages: [{ role: 'user', content: '你好' }],
    })

    expect('stream' in result).toBe(false)
    if ('stream' in result) {
      throw new Error('Expected non-streaming provider response')
    }

    expect(result.content).toBe('你好，世界')
    expect(result.model).toBe('glm-4.7')
    expect(result.tokens).toEqual({
      input: 12,
      output: 18,
      total: 30,
    })
  })
})
