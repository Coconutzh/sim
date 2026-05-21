/**
 * @vitest-environment node
 */
import { auditMock, hybridAuthMockFns, telemetryMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDuplicateWorkflow = vi.hoisted(() => vi.fn())

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/core/telemetry', () => telemetryMock)
vi.mock('@/lib/workflows/persistence/duplicate', () => ({
  duplicateWorkflow: mockDuplicateWorkflow,
}))

import { POST } from '@/app/api/workflows/[id]/duplicate/route'

describe('Workflow Duplicate API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'viewer-1',
      userName: 'Viewer',
      userEmail: 'viewer@example.com',
      authType: 'session',
    })
  })

  it('rejects duplication through cross-team published access', async () => {
    mockDuplicateWorkflow.mockRejectedValueOnce(
      new Error('Workspace access required for source workflow duplication')
    )

    const request = new NextRequest('http://localhost:3000/api/workflows/published-1/duplicate', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'workspace-1',
        name: 'Copy of workflow',
        color: '#3972F6',
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'published-1' }) })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Cross-team published workflow access does not include workflow duplication',
    })
  })

  it('hides foreign personal source workflows behind 404', async () => {
    mockDuplicateWorkflow.mockRejectedValueOnce(new Error('Workflow not found'))

    const request = new NextRequest('http://localhost:3000/api/workflows/hidden-1/duplicate', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'workspace-1',
        name: 'Copy of workflow',
        color: '#3972F6',
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'hidden-1' }) })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Workflow not found',
    })
  })
})
