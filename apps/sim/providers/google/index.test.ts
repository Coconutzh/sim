/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGoogleGenAI,
  mockExecuteGeminiRequest,
  mockExecuteEvolinkGeminiFallback,
} = vi.hoisted(() => ({
  mockGoogleGenAI: vi.fn(),
  mockExecuteGeminiRequest: vi.fn(),
  mockExecuteEvolinkGeminiFallback: vi.fn(),
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: mockGoogleGenAI,
}))

vi.mock('@/providers/gemini/core', () => ({
  executeGeminiRequest: (...args: unknown[]) => mockExecuteGeminiRequest(...args),
}))

vi.mock('@/providers/google/evolink', () => ({
  executeEvolinkGeminiFallback: (...args: unknown[]) => mockExecuteEvolinkGeminiFallback(...args),
  shouldPreferEvolinkGeminiTransport: (request: { apiKey?: string; model: string }) =>
    request.model.startsWith('gemini-') && !!request.apiKey && !request.apiKey.startsWith('AIza'),
  isRetryableGoogleAuthError: () => true,
}))

import { googleProvider } from '@/providers/google'

describe('googleProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes non-native Gemini API keys through Evolink transport', async () => {
    mockExecuteEvolinkGeminiFallback.mockResolvedValue({
      content: 'fallback response',
      model: 'gemini-2.5-flash',
    })

    const result = await googleProvider.executeRequest({
      model: 'gemini-2.5-flash',
      apiKey: 'ek_test_123',
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(mockGoogleGenAI).not.toHaveBeenCalled()
    expect(mockExecuteGeminiRequest).not.toHaveBeenCalled()
    expect(mockExecuteEvolinkGeminiFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-flash',
        apiKey: 'ek_test_123',
      })
    )
    expect(result).toMatchObject({
      content: 'fallback response',
      model: 'gemini-2.5-flash',
    })
  })
})
