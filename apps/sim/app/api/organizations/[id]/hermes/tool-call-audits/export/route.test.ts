/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExportHermesToolCallAudits, mockGetSession } = vi.hoisted(() => ({
  mockExportHermesToolCallAudits: vi.fn(),
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/hermes/tool-call-audit', () => ({
  exportHermesToolCallAudits: mockExportHermesToolCallAudits,
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
  runWithRequestContext: (_context: unknown, callback: () => unknown) => callback(),
}))

import { GET } from '@/app/api/organizations/[id]/hermes/tool-call-audits/export/route'

function context(params: Record<string, string>) {
  return { params: Promise.resolve(params) }
}

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { method: 'GET' })
}

describe('SIM Hermes tool-call audit export route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mockExportHermesToolCallAudits.mockResolvedValue({
      exportedAt: '2026-06-13T00:00:00.000Z',
      filters: { status: 'success', toolName: 'sim_canvas_agent_run', limit: 500 },
      count: 1,
      audits: [{ id: 'audit-1', toolName: 'sim_canvas_agent_run' }],
    })
  })

  it('exports filtered audit rows for organization admins', async () => {
    const response = await GET(
      request(
        '/api/organizations/org-1/hermes/tool-call-audits/export?status=success&toolName=sim_canvas_agent_run&limit=500'
      ),
      context({ id: 'org-1' })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.count).toBe(1)
    expect(mockExportHermesToolCallAudits).toHaveBeenCalledWith({
      userId: 'admin-1',
      organizationId: 'org-1',
      query: {
        status: 'success',
        toolName: 'sim_canvas_agent_run',
        limit: 500,
      },
    })
  })

  it('uses export defaults when filters are omitted', async () => {
    const response = await GET(
      request('/api/organizations/org-1/hermes/tool-call-audits/export'),
      context({ id: 'org-1' })
    )

    expect(response.status).toBe(200)
    expect(mockExportHermesToolCallAudits).toHaveBeenCalledWith({
      userId: 'admin-1',
      organizationId: 'org-1',
      query: { limit: 500 },
    })
  })

  it('rejects unauthenticated export reads before service calls', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const response = await GET(
      request('/api/organizations/org-1/hermes/tool-call-audits/export'),
      context({ id: 'org-1' })
    )

    expect(response.status).toBe(401)
    expect(mockExportHermesToolCallAudits).not.toHaveBeenCalled()
  })

  it('does not export rows to non-admin organization users', async () => {
    mockExportHermesToolCallAudits.mockRejectedValueOnce(
      new Error('Organization admin access required')
    )

    const response = await GET(
      request('/api/organizations/org-1/hermes/tool-call-audits/export'),
      context({ id: 'org-1' })
    )
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error).toBe('Organization admin access required')
  })
})
