/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockListHermesToolCallAudits } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockListHermesToolCallAudits: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/hermes/tool-call-audit', () => ({
  listHermesToolCallAudits: mockListHermesToolCallAudits,
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
  runWithRequestContext: (_context: unknown, callback: () => unknown) => callback(),
}))

import { GET } from '@/app/api/organizations/[id]/hermes/tool-call-audits/route'

const audit = {
  id: 'audit-1',
  traceId: 'trace-1',
  hermesRunId: 'hermes-run-1',
  simRequestId: 'request-1',
  userId: 'user-1',
  organizationId: 'org-1',
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  toolName: 'sim_canvas_agent_run',
  mode: 'read_only',
  operation: 'inspect',
  status: 'success',
  inputSummary: { mode: 'read_only' },
  outputSummary: { answerLength: 128 },
  risk: 'low',
  requiresConfirmation: false,
  changedNodeIds: [],
  generatedNodeIds: [],
  verificationSummary: null,
  durationMs: 42,
  errorCode: null,
  error: null,
  createdAt: '2026-06-13T00:00:00.000Z',
} as const

function context(params: Record<string, string>) {
  return { params: Promise.resolve(params) }
}

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { method: 'GET' })
}

describe('SIM Hermes tool-call audit route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mockListHermesToolCallAudits.mockResolvedValue([audit])
  })

  it('lists sanitized Hermes tool-call audits for organization admins', async () => {
    const response = await GET(
      request(
        '/api/organizations/org-1/hermes/tool-call-audits?status=success&toolName=sim_canvas_agent_run&workflowId=workflow-1&limit=10'
      ),
      context({ id: 'org-1' })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.audits[0].id).toBe('audit-1')
    expect(mockListHermesToolCallAudits).toHaveBeenCalledWith({
      userId: 'admin-1',
      organizationId: 'org-1',
      query: {
        status: 'success',
        toolName: 'sim_canvas_agent_run',
        workflowId: 'workflow-1',
        limit: 10,
      },
    })
  })

  it('uses safe defaults for optional filters', async () => {
    const response = await GET(
      request('/api/organizations/org-1/hermes/tool-call-audits'),
      context({ id: 'org-1' })
    )

    expect(response.status).toBe(200)
    expect(mockListHermesToolCallAudits).toHaveBeenCalledWith({
      userId: 'admin-1',
      organizationId: 'org-1',
      query: { limit: 25 },
    })
  })

  it('rejects unauthenticated audit reads before service calls', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const response = await GET(
      request('/api/organizations/org-1/hermes/tool-call-audits'),
      context({ id: 'org-1' })
    )

    expect(response.status).toBe(401)
    expect(mockListHermesToolCallAudits).not.toHaveBeenCalled()
  })

  it('does not expose audit rows to non-admin organization users', async () => {
    mockListHermesToolCallAudits.mockRejectedValueOnce(
      new Error('Organization admin access required')
    )

    const response = await GET(
      request('/api/organizations/org-1/hermes/tool-call-audits'),
      context({ id: 'org-1' })
    )
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error).toBe('Organization admin access required')
  })
})
