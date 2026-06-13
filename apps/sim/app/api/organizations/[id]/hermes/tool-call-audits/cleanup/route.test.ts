/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCleanupHermesToolCallAudits, mockGetSession } = vi.hoisted(() => ({
  mockCleanupHermesToolCallAudits: vi.fn(),
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/hermes/tool-call-audit', () => ({
  cleanupHermesToolCallAudits: mockCleanupHermesToolCallAudits,
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
  runWithRequestContext: (_context: unknown, callback: () => unknown) => callback(),
}))

import { POST } from '@/app/api/organizations/[id]/hermes/tool-call-audits/cleanup/route'

function context(params: Record<string, string>) {
  return { params: Promise.resolve(params) }
}

function request(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost:3000/api/organizations/org-1/hermes/tool-call-audits/cleanup',
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }
  )
}

describe('SIM Hermes tool-call audit cleanup route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mockCleanupHermesToolCallAudits.mockResolvedValue({
      retentionHours: 720,
      cutoff: '2026-05-14T00:00:00.000Z',
      dryRun: false,
      matchedCount: 2,
      deletedCount: 2,
    })
  })

  it('cleans old audit rows through the contract-bound route', async () => {
    const response = await POST(request({ retentionHours: 720 }), context({ id: 'org-1' }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.cleanup.deletedCount).toBe(2)
    expect(mockCleanupHermesToolCallAudits).toHaveBeenCalledWith({
      userId: 'admin-1',
      organizationId: 'org-1',
      retentionHours: 720,
      dryRun: false,
    })
  })

  it('supports dry-run previews without deleting rows', async () => {
    mockCleanupHermesToolCallAudits.mockResolvedValueOnce({
      retentionHours: 168,
      cutoff: '2026-06-06T00:00:00.000Z',
      dryRun: true,
      matchedCount: 4,
      deletedCount: 0,
    })

    const response = await POST(
      request({ retentionHours: 168, dryRun: true }),
      context({ id: 'org-1' })
    )

    expect(response.status).toBe(200)
    expect(mockCleanupHermesToolCallAudits).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true })
    )
  })

  it('returns 401 before parsing when no session is available', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const response = await POST(request({}), context({ id: 'org-1' }))

    expect(response.status).toBe(401)
    expect(mockCleanupHermesToolCallAudits).not.toHaveBeenCalled()
  })

  it('returns 403 when the actor is not an organization admin', async () => {
    mockCleanupHermesToolCallAudits.mockRejectedValueOnce(
      new Error('Organization admin access required')
    )

    const response = await POST(request({ retentionHours: 720 }), context({ id: 'org-1' }))
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error).toBe('Organization admin access required')
  })
})
