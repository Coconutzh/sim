/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildEvolinkChatMessages,
  executeEvolinkGeminiFallback,
  shouldPreferEvolinkGeminiTransport,
} from '@/providers/google/evolink'
import type { ProviderRequest } from '@/providers/types'

describe('Evolink Gemini fallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('prefers Evolink transport for non-native Gemini API keys', () => {
    expect(
      shouldPreferEvolinkGeminiTransport({
        model: 'gemini-2.5-flash',
        apiKey: 'ek_test_123',
      } satisfies ProviderRequest)
    ).toBe(true)

    expect(
      shouldPreferEvolinkGeminiTransport({
        model: 'gemini-2.5-flash',
        apiKey: 'AIzaSyNativeGoogleKey',
      } satisfies ProviderRequest)
    ).toBe(false)
  })

  it('converts text and image parts into OpenAI-compatible chat content', () => {
    const messages = buildEvolinkChatMessages({
      model: 'gemini-2.5-flash',
      systemPrompt: 'You are helpful.',
      messages: [
        {
          role: 'user',
          content: 'Describe this image.',
          parts: [
            { type: 'text', text: 'Describe this image.' },
            {
              type: 'image',
              mimeType: 'image/png',
              data: 'ZmFrZS1pbWFnZQ==',
            },
          ],
        },
      ],
    })

    expect(messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image.' },
          {
            type: 'image_url',
            image_url: {
              url: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
            },
          },
        ],
      },
    ])
  })

  it('submits Gemini chat requests to Evolink and returns the assistant text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'length',
            message: {
              content: 'Evolink Gemini response',
            },
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          completion_tokens_details: {
            reasoning_tokens: 3,
          },
          total_tokens: 20,
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeEvolinkGeminiFallback({
      model: 'gemini-2.5-flash',
      apiKey: 'ek_test_123',
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://direct.evolink.ai/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer ek_test_123',
          'Content-Type': 'application/json',
        }),
      })
    )
    expect(result).toMatchObject({
      content: 'Evolink Gemini response',
      model: 'gemini-2.5-flash',
      finishReason: 'length',
      tokens: {
        input: 12,
        output: 8,
        total: 20,
        reasoning: 3,
      },
    })
  })
})
