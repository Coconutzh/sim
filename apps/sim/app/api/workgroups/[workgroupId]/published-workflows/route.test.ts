/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckSessionOrInternalAuth,
  mockListPublishedWorkflowsForWorkgroup,
  mockListVisiblePublications,
} = vi.hoisted(() => ({
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockListPublishedWorkflowsForWorkgroup: vi.fn(),
  mockListVisiblePublications: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/collaboration/service', () => ({
  listVisiblePublications: mockListVisiblePublications,
}))

vi.mock('@/lib/workflows/publication', () => ({
  listPublishedWorkflowsForWorkgroup: mockListPublishedWorkflowsForWorkgroup,
}))

import { GET } from '@/app/api/workgroups/[workgroupId]/published-workflows/route'

describe('GET /api/workgroups/[workgroupId]/published-workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mockListPublishedWorkflowsForWorkgroup.mockResolvedValue([])
    mockListVisiblePublications.mockResolvedValue([])
  })

  it('validates and forwards showcase publication filters from the contract', async () => {
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/workgroups/wg-1/published-workflows?disciplineCode=lighting&sourceWorkgroupId=wg-source&agentCode=chief_director&status=superseded&limit=5'
      ),
      { params: Promise.resolve({ workgroupId: 'wg-1' }) }
    )

    expect(response.status).toBe(200)
    expect(mockListPublishedWorkflowsForWorkgroup).toHaveBeenCalledWith({
      workgroupId: 'wg-1',
      userId: 'user-1',
    })
    expect(mockListVisiblePublications).toHaveBeenCalledWith({
      workgroupId: 'wg-1',
      userId: 'user-1',
      disciplineCode: 'lighting',
      sourceWorkgroupId: 'wg-source',
      agentCode: 'chief_director',
      status: 'superseded',
      limit: 5,
    })
  })

  it('authenticates before parsing invalid showcase filters', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({ success: false })

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/workgroups/wg-1/published-workflows?limit=101'
      ),
      { params: Promise.resolve({ workgroupId: 'wg-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(mockListVisiblePublications).not.toHaveBeenCalled()
  })
})
