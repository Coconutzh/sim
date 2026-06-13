import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSmoke } from './hermes-sim-smoke'

const ENV_KEYS = [
  'HERMES_API_URL',
  'HERMES_API_KEY',
  'HERMES_REQUIRED_TOOLSETS',
  'HERMES_FORBIDDEN_TOOLSETS',
  'INTERNAL_API_SECRET',
  'SIM_BASE_URL',
  'HERMES_SMOKE_USER_ID',
  'HERMES_SMOKE_ORGANIZATION_ID',
  'HERMES_SMOKE_WORKSPACE_ID',
  'HERMES_SMOKE_WORKFLOW_ID',
  'HERMES_SMOKE_CHAT_ID',
  'HERMES_SMOKE_SELECTED_NODE_IDS',
  'HERMES_SMOKE_MODEL',
  'HERMES_SMOKE_TIMEOUT_MS',
] as const

const originalEnv = new Map<string, string | undefined>()

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function configureHermesEnv(): void {
  process.env.HERMES_API_URL = 'http://hermes.local/'
  process.env.HERMES_API_KEY = 'test-key'
}

describe('hermes-sim-smoke', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    originalEnv.clear()
    for (const key of ENV_KEYS) {
      originalEnv.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key)
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it('reports missing required Hermes env without making network calls', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { results } = await runSmoke(['--json'])

    expect(results).toEqual([
      {
        name: 'env:HERMES_API_URL',
        status: 'fail',
        detail: 'HERMES_API_URL is required',
      },
      {
        name: 'env:HERMES_API_KEY',
        status: 'fail',
        detail: 'HERMES_API_KEY is required',
      },
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes health, capabilities, and toolset policy when SIM tools are available', async () => {
    configureHermesEnv()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer test-key')
      const url = String(input)
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok', version: '1.0.0' })
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
      if (url.endsWith('/v1/toolsets')) {
        return jsonResponse({
          data: [
            {
              name: 'sim',
              enabled: true,
              tools: ['sim_canvas_agent_run', 'sim_skill_proposal_run'],
            },
            { name: 'memory', enabled: true, tools: ['memory'] },
          ],
        })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { results } = await runSmoke(['--skip-sim-health'])

    expect(results.map((result) => [result.name, result.status])).toEqual([
      ['hermes.health', 'pass'],
      ['hermes.capabilities', 'pass'],
      ['hermes.toolsets', 'pass'],
    ])
  })

  it('fails when SIM required tools are missing or forbidden toolsets are enabled', async () => {
    configureHermesEnv()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok', version: '1.0.0' })
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
      if (url.endsWith('/v1/toolsets')) {
        return jsonResponse({
          data: [
            {
              name: 'sim',
              enabled: true,
              tools: ['sim_canvas_agent_run'],
            },
            { name: 'terminal', enabled: true, tools: ['terminal', 'process'] },
          ],
        })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { results } = await runSmoke(['--skip-sim-health'])

    const toolsets = results.find((result) => result.name === 'hermes.toolsets')
    expect(toolsets?.status).toBe('fail')
    expect(toolsets?.detail).toContain('forbidden enabled: terminal')
    expect(toolsets?.detail).toContain('missing sim tools: sim_skill_proposal_run')
  })

  it('can include the optional no-tool chat completion smoke', async () => {
    configureHermesEnv()
    process.env.HERMES_SMOKE_USER_ID = 'user-1'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok' })
      if (url.endsWith('/v1/capabilities')) {
        return jsonResponse({
          features: {
            chat_completions: true,
            session_key_header: 'X-Hermes-Session-Key',
          },
        })
      }
      if (url.endsWith('/v1/toolsets')) {
        return jsonResponse({
          data: [
            {
              name: 'sim',
              enabled: true,
              tools: ['sim_canvas_agent_run', 'sim_skill_proposal_run'],
            },
          ],
        })
      }
      if (url.endsWith('/v1/chat/completions')) {
        expect((init?.headers as Record<string, string>)['x-hermes-session-key']).toBe(
          'sim:smoke:user:user-1'
        )
        const body = JSON.parse(String(init?.body))
        expect(body.metadata.sim.userId).toBe('user-1')
        return jsonResponse({
          choices: [{ message: { content: 'SIM_HERMES_SMOKE_OK' } }],
        })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { results } = await runSmoke(['--skip-sim-health', '--chat'])

    expect(results.find((result) => result.name === 'hermes.chat')?.status).toBe('pass')
  })
})
