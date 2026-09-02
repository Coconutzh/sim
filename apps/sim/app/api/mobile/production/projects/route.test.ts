/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSessionUserId, mockListMobileProductionProjects } = vi.hoisted(() => ({
  mockGetSessionUserId: vi.fn(),
  mockListMobileProductionProjects: vi.fn(),
}))

vi.mock('@/app/api/production-tasks/_utils', () => ({
  getProductionTaskSessionUserId: mockGetSessionUserId,
  productionTaskErrorResponse: vi.fn(),
}))
vi.mock('@/lib/production-tasks/service', () => ({
  listMobileProductionProjects: mockListMobileProductionProjects,
}))

import { GET } from '@/app/api/mobile/production/projects/route'

describe('mobile project list route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSessionUserId.mockResolvedValue('user-1')
    mockListMobileProductionProjects.mockResolvedValue([
      {
        workspaceId: 'ws-1',
        organizationId: 'org-1',
        name: '项目一',
        status: 'active',
        estimatedDueAt: null,
        canCreateProductionTask: true,
        metrics: {
          total: 1,
          completed: 0,
          overdue: 1,
          dueSoon: 0,
          pendingReview: 0,
          unreadMessages: 0,
          adoptedResults: 0,
        },
      },
    ])
  })

  it('rejects unauthenticated requests', async () => {
    mockGetSessionUserId.mockResolvedValueOnce(null)
    const response = await GET(createMockRequest('GET'))
    expect(response.status).toBe(401)
    expect(mockListMobileProductionProjects).not.toHaveBeenCalled()
  })

  it('returns only the service-authorized project summaries', async () => {
    const response = await GET(createMockRequest('GET'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      projects: expect.arrayContaining([expect.objectContaining({ workspaceId: 'ws-1' })]),
    })
  })
})
