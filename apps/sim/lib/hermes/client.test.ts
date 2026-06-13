/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, number | string | undefined>,
}))

vi.mock('@/lib/core/config/env', () => ({
  env: mockEnv,
  envNumber: (
    value: number | string | undefined | null,
    fallback: number,
    options: { min?: number } = {}
  ) => {
    const min = options.min ?? 0
    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
  },
}))

import {
  callHermesChatCompletion,
  callHermesResponse,
  checkHermesHealth,
  HermesClientError,
} from '@/lib/hermes/client'

function resetEnv(values: Record<string, number | string | undefined> = {}) {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key]
  Object.assign(mockEnv, values)
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Hermes client health probe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    resetEnv()
  })

  it('reports unconfigured when Hermes URL or key is missing', async () => {
    const result = await checkHermesHealth()

    expect(result.configured).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.status).toBe('unconfigured')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('checks health, capabilities, and required toolsets', async () => {
    resetEnv({
      HERMES_API_URL: 'http://hermes.local/',
      HERMES_API_KEY: 'test-key',
      HERMES_REQUIRED_TOOLSETS: 'sim,memory',
    })
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer test-key')
      const url = String(input)
      if (url.endsWith('/health')) {
        return jsonResponse({
          status: 'ok',
          version: '1.2.3',
          commit: 'abc123',
        })
      }
      if (url.endsWith('/v1/capabilities')) {
        return jsonResponse({
          features: {
            chat_completions: true,
            responses_api: true,
            skills_api: true,
            session_key_header: 'X-Hermes-Session-Key',
          },
        })
      }
      return jsonResponse({
        data: [
          {
            name: 'sim',
            enabled: true,
            tools: [
              'sim_canvas_agent_run',
              'sim_skill_proposal_run',
              'sim_external_evidence_prepare',
            ],
          },
          { name: 'memory', enabled: true, tools: ['memory'] },
        ],
      })
    })

    const result = await checkHermesHealth()

    expect(result.ok).toBe(true)
    expect(result.status).toBe('healthy')
    expect(result.baseUrl).toBe('http://hermes.local')
    expect(result.version).toBe('1.2.3')
    expect(result.commit).toBe('abc123')
    expect(result.capabilities?.chatCompletions).toBe(true)
    expect(result.toolsets?.missing).toEqual([])
    expect(result.toolsets?.forbidden).toEqual([
      'browser',
      'code_execution',
      'computer_use',
      'cronjob',
      'delegation',
      'file',
      'terminal',
    ])
    expect(result.toolsets?.enabledForbidden).toEqual([])
    expect(result.toolsets?.missingTools).toEqual({})
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('marks the runtime degraded when a required toolset is missing', async () => {
    resetEnv({
      HERMES_API_URL: 'http://hermes.local',
      HERMES_API_KEY: 'test-key',
      HERMES_REQUIRED_TOOLSETS: 'sim',
    })
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok', version: '1.2.3' })
      if (url.endsWith('/v1/capabilities')) {
        return jsonResponse({
          features: {
            chat_completions: true,
            responses_api: true,
            skills_api: true,
            session_key_header: 'X-Hermes-Session-Key',
          },
        })
      }
      return jsonResponse({ data: [{ name: 'memory', enabled: true, tools: ['memory'] }] })
    })

    const result = await checkHermesHealth()

    expect(result.ok).toBe(false)
    expect(result.status).toBe('degraded')
    expect(result.toolsets?.missing).toEqual(['sim'])
    expect(result.toolsets?.missingTools).toEqual({})
    expect(result.error).toContain('required Hermes toolsets missing: sim')
  })

  it('marks the runtime degraded when a required SIM tool is missing', async () => {
    resetEnv({
      HERMES_API_URL: 'http://hermes.local',
      HERMES_API_KEY: 'test-key',
      HERMES_REQUIRED_TOOLSETS: 'sim',
    })
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok', version: '1.2.3' })
      if (url.endsWith('/v1/capabilities')) {
        return jsonResponse({
          features: {
            chat_completions: true,
            responses_api: true,
            skills_api: true,
            session_key_header: 'X-Hermes-Session-Key',
          },
        })
      }
      return jsonResponse({
        data: [
          {
            name: 'sim',
            enabled: true,
            tools: ['sim_canvas_agent_run'],
          },
        ],
      })
    })

    const result = await checkHermesHealth()

    expect(result.ok).toBe(false)
    expect(result.status).toBe('degraded')
    expect(result.toolsets?.missing).toEqual([])
    expect(result.toolsets?.requiredTools).toEqual({
      sim: ['sim_canvas_agent_run', 'sim_skill_proposal_run', 'sim_external_evidence_prepare'],
    })
    expect(result.toolsets?.missingTools).toEqual({
      sim: ['sim_skill_proposal_run', 'sim_external_evidence_prepare'],
    })
    expect(result.error).toContain(
      'required Hermes tools missing: sim(sim_skill_proposal_run, sim_external_evidence_prepare)'
    )
  })

  it('marks the runtime degraded when forbidden toolsets are enabled', async () => {
    resetEnv({
      HERMES_API_URL: 'http://hermes.local',
      HERMES_API_KEY: 'test-key',
      HERMES_REQUIRED_TOOLSETS: 'sim',
      HERMES_FORBIDDEN_TOOLSETS: 'terminal,file,code_execution',
    })
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok', version: '1.2.3' })
      if (url.endsWith('/v1/capabilities')) {
        return jsonResponse({
          features: {
            chat_completions: true,
            responses_api: true,
            skills_api: true,
            session_key_header: 'X-Hermes-Session-Key',
          },
        })
      }
      return jsonResponse({
        data: [
          {
            name: 'sim',
            enabled: true,
            tools: [
              'sim_canvas_agent_run',
              'sim_skill_proposal_run',
              'sim_external_evidence_prepare',
            ],
          },
          { name: 'terminal', enabled: true, tools: ['terminal', 'process'] },
        ],
      })
    })

    const result = await checkHermesHealth()

    expect(result.ok).toBe(false)
    expect(result.status).toBe('degraded')
    expect(result.toolsets?.missing).toEqual([])
    expect(result.toolsets?.enabledForbidden).toEqual(['terminal'])
    expect(result.error).toContain('forbidden Hermes toolsets enabled: terminal')
  })

  it('reports unreachable when the Hermes service cannot be contacted', async () => {
    resetEnv({
      HERMES_API_URL: 'http://hermes.local',
      HERMES_API_KEY: 'test-key',
    })
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))

    const result = await checkHermesHealth()

    expect(result.configured).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.status).toBe('unreachable')
    expect(result.error).toBe('connection refused')
  })
})

describe('callHermesChatCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    resetEnv({
      HERMES_API_URL: 'http://127.0.0.1:8642/',
      HERMES_API_KEY: 'test-key',
    })
  })

  it('posts OpenAI-compatible messages with Hermes session headers and metadata', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
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
    )

    const result = await callHermesChatCompletion({
      messages: [{ role: 'user', content: 'hello' }],
      sessionId: 'session-1',
      sessionKey: 'key-1',
      metadata: { sim: { userId: 'user-1' } },
    })

    expect(fetch).toHaveBeenCalledWith(
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
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
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
    resetEnv()

    await expect(
      callHermesChatCompletion({ messages: [{ role: 'user', content: 'hello' }] })
    ).rejects.toBeInstanceOf(HermesClientError)
  })
})

describe('callHermesResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    resetEnv({
      HERMES_API_URL: 'http://127.0.0.1:8642/',
      HERMES_API_KEY: 'test-key',
    })
  })

  it('posts Responses API input with SIM metadata and extracts output text', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'resp-1',
          output: [
            {
              type: 'function_call',
              name: 'sim_canvas_agent_run',
              call_id: 'call-1',
            },
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Canvas has three nodes.' }],
            },
          ],
          usage: { input_tokens: 11, output_tokens: 5, total_tokens: 16 },
        }),
        {
          status: 200,
          headers: {
            'x-hermes-session-id': 'session-1',
            'x-hermes-session-key': 'key-1',
          },
        }
      )
    )

    const result = await callHermesResponse({
      instructions: 'Use SIM tools.',
      input: 'read canvas',
      sessionId: 'session-1',
      sessionKey: 'key-1',
      metadata: { sim: { userId: 'user-1' } },
    })

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8642/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer test-key',
          'x-hermes-session-id': 'session-1',
          'x-hermes-session-key': 'key-1',
        }),
      })
    )
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
    expect(body).toMatchObject({
      instructions: 'Use SIM tools.',
      input: 'read canvas',
      metadata: { sim: { userId: 'user-1' } },
      store: false,
    })
    expect(result).toEqual({
      id: 'resp-1',
      content: 'Canvas has three nodes.',
      sessionId: 'session-1',
      sessionKey: 'key-1',
      usage: { prompt: 11, completion: 5, total: 16 },
      raw: expect.any(Object),
    })
  })
})
