/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAssertOrganizationAdmin, mockCheckHermesHealth, mockGetSession } = vi.hoisted(() => ({
  mockAssertOrganizationAdmin: vi.fn(),
  mockCheckHermesHealth: vi.fn(),
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/collaboration/service', () => ({
  assertOrganizationAdmin: mockAssertOrganizationAdmin,
}))

vi.mock('@/lib/hermes/client', () => ({
  checkHermesHealth: mockCheckHermesHealth,
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
  runWithRequestContext: (_context: unknown, callback: () => unknown) => callback(),
}))

import { GET } from '@/app/api/organizations/[id]/hermes/health/route'

const health = {
  configured: true,
  ok: true,
  status: 'healthy',
  checkedAt: '2026-06-13T00:00:00.000Z',
  baseUrl: 'http://127.0.0.1:8642',
  version: '1.0.0',
  commit: 'abc123',
  build: {
    version: '1.0.0',
    commit: 'abc123',
    release: null,
    buildTime: null,
  },
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
      sim: ['sim_canvas_agent_run', 'sim_skill_proposal_run'],
    },
    missingTools: {},
  },
  responseStatus: 200,
} as const

function context(params: Record<string, string>) {
  return { params: Promise.resolve(params) }
}

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { method: 'GET' })
}

describe('SIM Hermes admin health route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mockAssertOrganizationAdmin.mockResolvedValue(undefined)
    mockCheckHermesHealth.mockResolvedValue(health)
  })

  it('checks Hermes health for organization admins', async () => {
    const response = await GET(
      request('/api/organizations/org-1/hermes/health?includeToolsets=false'),
      context({ id: 'org-1' })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.status).toBe('healthy')
    expect(mockAssertOrganizationAdmin).toHaveBeenCalledWith('admin-1', 'org-1')
    expect(mockCheckHermesHealth).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      includeToolsets: false,
    })
  })

  it('returns degraded and unreachable health details with a 200 admin response', async () => {
    mockCheckHermesHealth.mockResolvedValueOnce({
      configured: true,
      ok: false,
      status: 'unreachable',
      checkedAt: '2026-06-13T00:00:00.000Z',
      baseUrl: 'http://127.0.0.1:8642',
      error: 'connect ECONNREFUSED',
    })

    const response = await GET(
      request('/api/organizations/org-1/hermes/health'),
      context({ id: 'org-1' })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(false)
    expect(payload.status).toBe('unreachable')
  })

  it('rejects unauthenticated admin health requests', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const response = await GET(
      request('/api/organizations/org-1/hermes/health'),
      context({ id: 'org-1' })
    )

    expect(response.status).toBe(401)
    expect(mockAssertOrganizationAdmin).not.toHaveBeenCalled()
    expect(mockCheckHermesHealth).not.toHaveBeenCalled()
  })

  it('rejects non-admin organization users before checking Hermes', async () => {
    mockAssertOrganizationAdmin.mockRejectedValueOnce(
      new Error('Organization admin access required')
    )

    const response = await GET(
      request('/api/organizations/org-1/hermes/health'),
      context({ id: 'org-1' })
    )
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error).toBe('Organization admin access required')
    expect(mockCheckHermesHealth).not.toHaveBeenCalled()
  })
})
