/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    HERMES_API_URL: 'http://127.0.0.1:8642/' as string | undefined,
    HERMES_API_KEY: 'test-key' as string | undefined,
  },
}))

vi.mock('@/lib/core/config/env', () => ({
  env: mockEnv,
}))

import { callHermesChatCompletion, HermesClientError } from '@/lib/hermes/client'

describe('callHermesChatCompletion', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockEnv.HERMES_API_URL = 'http://127.0.0.1:8642/'
    mockEnv.HERMES_API_KEY = 'test-key'
  })

  it('posts OpenAI-compatible messages with Hermes session headers and metadata', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-1',
          choices: [{ message: { content: 'hello from hermes' } }],
          usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
        }),
        {
          status: 200,
          headers: {
            'x-hermes-session-id': 'session-1',
            'x-hermes-session-key': 'key-1',
          },
        }
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await callHermesChatCompletion({
      messages: [{ role: 'user', content: 'hello' }],
      sessionId: 'session-1',
      sessionKey: 'key-1',
      metadata: { sim: { userId: 'user-1' } },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8642/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer test-key',
          'x-hermes-session-id': 'session-1',
          'x-hermes-session-key': 'key-1',
        }),
      })
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.metadata).toEqual({ sim: { userId: 'user-1' } })
    expect(result).toEqual({
      id: 'chatcmpl-1',
      content: 'hello from hermes',
      sessionId: 'session-1',
      sessionKey: 'key-1',
      usage: { prompt: 7, completion: 3, total: 10 },
      raw: expect.any(Object),
    })
  })

  it('fails clearly when Hermes is not configured', async () => {
    mockEnv.HERMES_API_URL = undefined
    mockEnv.HERMES_API_KEY = undefined

    await expect(
      callHermesChatCompletion({ messages: [{ role: 'user', content: 'hello' }] })
    ).rejects.toBeInstanceOf(HermesClientError)
  })
})
