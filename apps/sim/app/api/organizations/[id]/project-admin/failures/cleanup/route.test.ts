/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCleanupProjectAdminFailureAudit, mockGetSession } = vi.hoisted(() => ({
  mockCleanupProjectAdminFailureAudit: vi.fn(),
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))
vi.mock('@/lib/collaboration/service', () => ({
  cleanupProjectAdminFailureAudit: mockCleanupProjectAdminFailureAudit,
}))

import { POST } from '@/app/api/organizations/[id]/project-admin/failures/cleanup/route'

describe('Project admin failure cleanup API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
  })

  it('cleans project admin failure audit rows through the contract-bound route', async () => {
    mockCleanupProjectAdminFailureAudit.mockResolvedValue({
      retentionHours: 720,
      cutoff: '2026-04-25T00:00:00.000Z',
      dryRun: false,
      matchedCount: 2,
      deletedCount: 2,
    })

    const request = new NextRequest(
      'http://localhost:3000/api/organizations/org-1/project-admin/failures/cleanup',
      {
        method: 'POST',
        body: JSON.stringify({ retentionHours: 720 }),
        headers: { 'content-type': 'application/json' },
      }
    )

    const response = await POST(request, {
      params: Promise.resolve({ id: 'org-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockCleanupProjectAdminFailureAudit).toHaveBeenCalledWith({
      userId: 'admin-1',
      organizationId: 'org-1',
      retentionHours: 720,
      dryRun: false,
    })
    await expect(response.json()).resolves.toEqual({
      cleanup: {
        retentionHours: 720,
        cutoff: '2026-04-25T00:00:00.000Z',
        dryRun: false,
        matchedCount: 2,
        deletedCount: 2,
      },
    })
  })

  it('supports dry-run previews without deleting rows', async () => {
    mockCleanupProjectAdminFailureAudit.mockResolvedValue({
      retentionHours: 168,
      cutoff: '2026-05-18T00:00:00.000Z',
      dryRun: true,
      matchedCount: 4,
      deletedCount: 0,
    })

    const request = new NextRequest(
      'http://localhost:3000/api/organizations/org-1/project-admin/failures/cleanup',
      {
        method: 'POST',
        body: JSON.stringify({ retentionHours: 168, dryRun: true }),
        headers: { 'content-type': 'application/json' },
      }
    )

    const response = await POST(request, {
      params: Promise.resolve({ id: 'org-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockCleanupProjectAdminFailureAudit).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true })
    )
  })

  it('returns 401 before parsing when no session is available', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const request = new NextRequest(
      'http://localhost:3000/api/organizations/org-1/project-admin/failures/cleanup',
      {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      }
    )

    const response = await POST(request, {
      params: Promise.resolve({ id: 'org-1' }),
    })

    expect(response.status).toBe(401)
    expect(mockCleanupProjectAdminFailureAudit).not.toHaveBeenCalled()
  })

  it('returns 403 when the actor is not an organization admin', async () => {
    mockCleanupProjectAdminFailureAudit.mockRejectedValueOnce(
      new Error('Organization admin access required')
    )

    const request = new NextRequest(
      'http://localhost:3000/api/organizations/org-1/project-admin/failures/cleanup',
      {
        method: 'POST',
        body: JSON.stringify({ retentionHours: 720 }),
        headers: { 'content-type': 'application/json' },
      }
    )

    const response = await POST(request, {
      params: Promise.resolve({ id: 'org-1' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Organization admin access required' })
  })
})
