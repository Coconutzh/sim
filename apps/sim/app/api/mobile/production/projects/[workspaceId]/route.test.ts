/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSessionUserId, mockGetMobileProductionProject, mockErrorResponse } = vi.hoisted(
  () => ({
    mockGetSessionUserId: vi.fn(),
    mockGetMobileProductionProject: vi.fn(),
    mockErrorResponse: vi.fn(),
  })
)

vi.mock('@/app/api/production-tasks/_utils', () => ({
  getProductionTaskSessionUserId: mockGetSessionUserId,
  productionTaskErrorResponse: mockErrorResponse,
}))
vi.mock('@/lib/production-tasks/service', () => ({
  getMobileProductionProject: mockGetMobileProductionProject,
}))

import { GET } from '@/app/api/mobile/production/projects/[workspaceId]/route'

describe('mobile project detail route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSessionUserId.mockResolvedValue('user-1')
    mockGetMobileProductionProject.mockResolvedValue({
      project: {
        workspaceId: 'ws-1',
        organizationId: 'org-1',
        name: '项目一',
        status: 'active',
        estimatedDueAt: null,
        canCreateProductionTask: false,
        metrics: {
          total: 0,
          completed: 0,
          overdue: 0,
          dueSoon: 0,
          pendingReview: 0,
          unreadMessages: 0,
          adoptedResults: 0,
        },
      },
      tasks: [],
      taskPage: { total: 0, offset: 0, limit: 30, hasMore: false },
      showcaseItems: [],
      assignableWorkgroups: [],
    })
  })

  it('rejects unauthenticated detail requests', async () => {
    mockGetSessionUserId.mockResolvedValueOnce(null)
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost/api/mobile/production/projects/ws-1'
      ),
      { params: Promise.resolve({ workspaceId: 'ws-1' }) }
    )
    expect(response.status).toBe(401)
    expect(mockGetMobileProductionProject).not.toHaveBeenCalled()
  })

  it('passes route params and pagination to the service', async () => {
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost/api/mobile/production/projects/ws-1?taskFilter=completed&limit=10&offset=20'
      ),
      { params: Promise.resolve({ workspaceId: 'ws-1' }) }
    )
    expect(response.status).toBe(200)
    expect(mockGetMobileProductionProject).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'ws-1',
      taskFilter: 'completed',
      limit: 10,
      offset: 20,
    })
  })
})
