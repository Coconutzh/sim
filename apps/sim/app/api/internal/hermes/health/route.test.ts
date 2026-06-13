/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckHermesHealth } = vi.hoisted(() => ({
  mockCheckHermesHealth: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {
    INTERNAL_API_SECRET: 'i'.repeat(32),
  },
}))

vi.mock('@/lib/hermes/client', () => ({
  checkHermesHealth: mockCheckHermesHealth,
}))

import { GET } from '@/app/api/internal/hermes/health/route'

function buildRequest(apiKey?: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/internal/hermes/health', {
    method: 'GET',
    headers: apiKey ? { 'x-api-key': apiKey } : {},
  })
}

describe('Hermes health internal route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckHermesHealth.mockResolvedValue({
      configured: true,
      ok: true,
      status: 'healthy',
      checkedAt: '2026-06-13T00:00:00.000Z',
      baseUrl: 'http://hermes.local',
      version: '1.2.3',
      commit: 'abc123',
      capabilities: {
        chatCompletions: true,
        responsesApi: true,
        skillsApi: true,
        sessionKeyHeader: 'X-Hermes-Session-Key',
      },
      toolsets: {
        checked: true,
        required: ['sim'],
        forbidden: [
          'browser',
          'code_execution',
          'computer_use',
          'cronjob',
          'delegation',
          'file',
          'terminal',
        ],
        enabled: ['sim'],
        missing: [],
        enabledForbidden: [],
        requiredTools: {
          sim: ['sim_canvas_agent_run', 'sim_skill_proposal_run', 'sim_external_evidence_prepare'],
        },
        missingTools: {},
      },
      responseStatus: 200,
    })
  })

  it('requires the internal SIM API key before probing Hermes', async () => {
    const response = await GET(buildRequest())
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(payload).toEqual({ error: 'Unauthorized' })
    expect(mockCheckHermesHealth).not.toHaveBeenCalled()
  })

  it('returns 200 for a healthy Hermes runtime', async () => {
    const response = await GET(buildRequest('i'.repeat(32)))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.status).toBe('healthy')
    expect(payload.version).toBe('1.2.3')
    expect(payload.commit).toBe('abc123')
    expect(payload.toolsets.missing).toEqual([])
    expect(mockCheckHermesHealth).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
  })

  it('returns 503 when Hermes is configured but unhealthy', async () => {
    mockCheckHermesHealth.mockResolvedValueOnce({
      configured: true,
      ok: false,
      status: 'degraded',
      checkedAt: '2026-06-13T00:00:00.000Z',
      baseUrl: 'http://hermes.local',
      error: 'required Hermes toolsets missing: sim',
      responseStatus: 200,
    })

    const response = await GET(buildRequest('i'.repeat(32)))
    const payload = await response.json()

    expect(response.status).toBe(503)
    expect(payload.ok).toBe(false)
    expect(payload.status).toBe('degraded')
    expect(payload.error).toContain('required Hermes toolsets missing')
  })
})
