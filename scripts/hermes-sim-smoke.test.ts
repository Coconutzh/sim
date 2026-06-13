import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSmoke } from './hermes-sim-smoke'

const ENV_KEYS = [
  'HERMES_API_URL',
  'HERMES_API_KEY',
  'HERMES_SERVICE_TOKEN',
  'HERMES_REQUIRED_TOOLSETS',
  'HERMES_FORBIDDEN_TOOLSETS',
  'INTERNAL_API_SECRET',
  'SIM_BASE_URL',
  'HERMES_SMOKE_USER_ID',
  'HERMES_SMOKE_OTHER_USER_ID',
  'HERMES_SMOKE_ORGANIZATION_ID',
  'HERMES_SMOKE_WORKGROUP_ID',
  'HERMES_SMOKE_WORKSPACE_ID',
  'HERMES_SMOKE_WORKFLOW_ID',
  'HERMES_SMOKE_CHAT_ID',
  'HERMES_SMOKE_WRITE_CONFIRM',
  'HERMES_SMOKE_AGENT_CODE',
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
              tools: [
                'sim_canvas_agent_run',
                'sim_skill_proposal_run',
                'sim_external_evidence_prepare',
              ],
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
    expect(toolsets?.detail).toContain('sim_external_evidence_prepare')
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
              tools: [
                'sim_canvas_agent_run',
                'sim_skill_proposal_run',
                'sim_external_evidence_prepare',
              ],
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

  it('verifies canvas read smoke through a Responses API tool call', async () => {
    configureHermesEnv()
    process.env.HERMES_SMOKE_USER_ID = 'user-a'
    process.env.HERMES_SMOKE_WORKSPACE_ID = 'workspace-1'
    process.env.HERMES_SMOKE_WORKFLOW_ID = 'workflow-1'
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
              tools: [
                'sim_canvas_agent_run',
                'sim_skill_proposal_run',
                'sim_external_evidence_prepare',
              ],
            },
          ],
        })
      }
      if (url.endsWith('/v1/responses')) {
        expect((init?.headers as Record<string, string>)['x-hermes-session-key']).toBe(
          'sim:smoke:user:user-a'
        )
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        expect(body.metadata).toMatchObject({
          sim: {
            userId: 'user-a',
            workspaceId: 'workspace-1',
            workflowId: 'workflow-1',
          },
        })
        return jsonResponse({
          output: [
            {
              type: 'function_call',
              name: 'sim_canvas_agent_run',
              arguments: '{"mode":"read_only"}',
              call_id: 'call-1',
            },
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Canvas has two nodes.' }],
            },
          ],
        })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { results } = await runSmoke(['--skip-sim-health', '--canvas-read'])

    expect(results.find((result) => result.name === 'hermes.sim-canvas-read')?.status).toBe('pass')
  })

  it('fails skill list smoke when Hermes does not emit the expected tool call', async () => {
    configureHermesEnv()
    process.env.HERMES_SMOKE_USER_ID = 'user-a'
    process.env.HERMES_SMOKE_ORGANIZATION_ID = 'org-1'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
              tools: [
                'sim_canvas_agent_run',
                'sim_skill_proposal_run',
                'sim_external_evidence_prepare',
              ],
            },
          ],
        })
      }
      if (url.endsWith('/v1/responses')) {
        return jsonResponse({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'There are zero skills.' }],
            },
          ],
        })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { results } = await runSmoke(['--skip-sim-health', '--skill-list'])

    const skillList = results.find((result) => result.name === 'hermes.sim-skill-list')
    expect(skillList?.status).toBe('fail')
    expect(skillList?.detail).toContain('tool call missing')
  })

  it('can include the SIM-backed memory smoke with user isolation and ephemeral rejection', async () => {
    configureHermesEnv()
    process.env.HERMES_SERVICE_TOKEN = 'service-token'
    process.env.HERMES_SMOKE_USER_ID = 'user-a'
    process.env.HERMES_SMOKE_OTHER_USER_ID = 'user-b'
    process.env.HERMES_SMOKE_ORGANIZATION_ID = 'org-1'
    const memoryBodies: Array<Record<string, unknown>> = []
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
              tools: [
                'sim_canvas_agent_run',
                'sim_skill_proposal_run',
                'sim_external_evidence_prepare',
              ],
            },
          ],
        })
      }
      if (url.endsWith('/api/internal/hermes/memory/run')) {
        expect((init?.headers as Record<string, string>)['x-sim-service-token']).toBe(
          'service-token'
        )
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        memoryBodies.push(body)
        if (body.operation === 'write' && String(body.content).includes('当前画布')) {
          return jsonResponse(
            {
              success: false,
              errorCode: 'INVALID_MEMORY_CONTENT',
              error: 'Canvas task state cannot be stored in Hermes user memory',
            },
            400
          )
        }
        if (body.operation === 'write') {
          return jsonResponse({ success: true, operation: 'write', created: 1 })
        }
        if (body.operation === 'prefetch' && body.userId === 'user-b') {
          return jsonResponse({ success: true, operation: 'prefetch', memories: [] })
        }
        if (body.operation === 'prefetch') {
          return jsonResponse({
            success: true,
            operation: 'prefetch',
            memories: [
              {
                content: `${body.query}: 用户做短视频脚本时偏好先出三版 hook，再生成分镜。`,
              },
            ],
          })
        }
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { results } = await runSmoke(['--skip-sim-health', '--memory'])

    expect(results.map((result) => [result.name, result.status])).toEqual([
      ['hermes.health', 'pass'],
      ['hermes.capabilities', 'pass'],
      ['hermes.toolsets', 'pass'],
      ['sim.hermes-memory-write', 'pass'],
      ['sim.hermes-memory-prefetch', 'pass'],
      ['sim.hermes-memory-user-isolation', 'pass'],
      ['sim.hermes-memory-reject-ephemeral', 'pass'],
    ])
    expect(memoryBodies.map((body) => body.operation)).toEqual([
      'write',
      'prefetch',
      'prefetch',
      'write',
    ])
    expect(memoryBodies[0]).toMatchObject({
      userId: 'user-a',
      organizationId: 'org-1',
      operation: 'write',
      category: 'workflow_habit',
    })
    expect(memoryBodies[2]).toMatchObject({
      userId: 'user-b',
      organizationId: 'org-1',
      operation: 'prefetch',
    })
  })

  it('can include the SIM skill proposal create smoke with compare verification', async () => {
    configureHermesEnv()
    process.env.HERMES_SERVICE_TOKEN = 'service-token'
    process.env.HERMES_SMOKE_USER_ID = 'user-a'
    process.env.HERMES_SMOKE_ORGANIZATION_ID = 'org-1'
    process.env.HERMES_SMOKE_WORKGROUP_ID = 'workgroup-1'
    process.env.HERMES_SMOKE_WRITE_CONFIRM = 'CREATE_SKILL_PROPOSAL'
    const proposalBodies: Array<Record<string, unknown>> = []
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
              tools: [
                'sim_canvas_agent_run',
                'sim_skill_proposal_run',
                'sim_external_evidence_prepare',
              ],
            },
          ],
        })
      }
      if (url.endsWith('/api/internal/hermes/skill-proposals/run')) {
        expect((init?.headers as Record<string, string>)['x-sim-service-token']).toBe(
          'service-token'
        )
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        proposalBodies.push(body)
        if (body.operation === 'propose_create') {
          expect(body.status).toBe('pending_review')
          expect(body.workgroupId).toBe('workgroup-1')
          return jsonResponse({
            success: true,
            operation: 'propose_create',
            answer: 'Created SIM skill proposal',
            auditId: 'audit-1',
            proposal: {
              id: 'proposal-1',
              status: 'pending_review',
              title: body.title,
            },
          })
        }
        if (body.operation === 'compare') {
          return jsonResponse({
            success: true,
            operation: 'compare',
            answer: 'Prepared comparison',
            auditId: 'audit-2',
            comparison: {
              proposalId: body.proposalId,
              targetSkillId: null,
              targetContent: null,
              proposedContent: 'content',
              proposedDiff: null,
            },
          })
        }
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { results } = await runSmoke(['--skip-sim-health', '--skill-proposal-create'])

    expect(results.map((result) => [result.name, result.status])).toEqual([
      ['hermes.health', 'pass'],
      ['hermes.capabilities', 'pass'],
      ['hermes.toolsets', 'pass'],
      ['sim.skill-proposal-create', 'pass'],
      ['sim.skill-proposal-compare', 'pass'],
    ])
    expect(proposalBodies.map((body) => body.operation)).toEqual(['propose_create', 'compare'])
    expect(proposalBodies[0]).toMatchObject({
      userId: 'user-a',
      organizationId: 'org-1',
      workgroupId: 'workgroup-1',
      operation: 'propose_create',
      risk: 'low',
    })
    expect(proposalBodies[1]).toMatchObject({
      userId: 'user-a',
      organizationId: 'org-1',
      operation: 'compare',
      proposalId: 'proposal-1',
    })
  })
})
