/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockRecordProjectAdminFailureAudit } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRecordProjectAdminFailureAudit: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))
vi.mock('@/lib/collaboration/service', () => ({
  recordProjectAdminFailureAudit: mockRecordProjectAdminFailureAudit,
}))

import { POST } from '@/app/api/organizations/[id]/project-admin/failures/route'

describe('Project admin failure audit API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
  })

  it('records project admin failures through the contract-bound route', async () => {
    mockRecordProjectAdminFailureAudit.mockResolvedValue({
      id: 'failure-1',
      scope: 'publication',
      operation: 'Approve current',
      target: 'Lighting v3',
      message: 'Review update failed',
      recordedAt: '2026-05-25T00:00:00.000Z',
    })

    const request = new NextRequest(
      'http://localhost:3000/api/organizations/org-1/project-admin/failures',
      {
        method: 'POST',
        body: JSON.stringify({
          scope: 'publication',
          operation: 'Approve current',
          target: 'Lighting v3',
          message: 'Review update failed',
        }),
        headers: { 'content-type': 'application/json' },
      }
    )

    const response = await POST(request, {
      params: Promise.resolve({ id: 'org-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockRecordProjectAdminFailureAudit).toHaveBeenCalledWith({
      userId: 'admin-1',
      organizationId: 'org-1',
      scope: 'publication',
      operation: 'Approve current',
      target: 'Lighting v3',
      message: 'Review update failed',
    })
    await expect(response.json()).resolves.toEqual({
      failure: {
        id: 'failure-1',
        scope: 'publication',
        operation: 'Approve current',
        target: 'Lighting v3',
        message: 'Review update failed',
        recordedAt: '2026-05-25T00:00:00.000Z',
      },
    })
  })

  it('returns 401 before parsing when no session is available', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const request = new NextRequest(
      'http://localhost:3000/api/organizations/org-1/project-admin/failures',
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
    expect(mockRecordProjectAdminFailureAudit).not.toHaveBeenCalled()
  })

  it('returns 403 when the actor is not an organization admin', async () => {
    mockRecordProjectAdminFailureAudit.mockRejectedValueOnce(
      new Error('Organization admin access required')
    )

    const request = new NextRequest(
      'http://localhost:3000/api/organizations/org-1/project-admin/failures',
      {
        method: 'POST',
        body: JSON.stringify({
          scope: 'team',
          operation: 'Archive team',
          target: 'Stage',
          message: 'Forbidden',
        }),
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
