/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreateWorkgroupJoinRequest,
  mockGetSession,
  mockListWorkgroupJoinRequests,
  mockReviewWorkgroupJoinRequest,
} = vi.hoisted(() => ({
  mockCreateWorkgroupJoinRequest: vi.fn(),
  mockGetSession: vi.fn(),
  mockListWorkgroupJoinRequests: vi.fn(),
  mockReviewWorkgroupJoinRequest: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/collaboration/service', () => ({
  createWorkgroupJoinRequest: mockCreateWorkgroupJoinRequest,
  listWorkgroupJoinRequests: mockListWorkgroupJoinRequests,
  reviewWorkgroupJoinRequest: mockReviewWorkgroupJoinRequest,
}))

import {
  GET as listJoinRequests,
  POST as createJoinRequest,
} from '@/app/api/workgroups/[workgroupId]/join-requests/route'
import { POST as reviewJoinRequest } from '@/app/api/workgroups/[workgroupId]/join-requests/[requestId]/review/route'

const pendingJoinRequest = {
  id: 'join-request-1',
  organizationId: 'org-1',
  workgroupId: 'wg-1',
  requesterUserId: 'user-1',
  requester: {
    id: 'user-1',
    name: 'Lighting User',
    email: 'lighting@example.com',
    avatarUrl: null,
  },
  role: 'member',
  message: '我需要参与灯光任务',
  status: 'pending',
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  createdAt: '2026-06-08T00:00:00.000Z',
  updatedAt: '2026-06-08T00:00:00.000Z',
} as const

describe('/api/workgroups/[workgroupId]/join-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mockListWorkgroupJoinRequests.mockResolvedValue([pendingJoinRequest])
    mockCreateWorkgroupJoinRequest.mockResolvedValue(pendingJoinRequest)
    mockReviewWorkgroupJoinRequest.mockResolvedValue({
      ...pendingJoinRequest,
      status: 'approved',
      reviewedBy: 'admin-1',
      reviewedAt: '2026-06-08T00:01:00.000Z',
    })
  })

  it('lists pending join requests for a team admin', async () => {
    const response = await listJoinRequests(createMockRequest('GET'), {
      params: Promise.resolve({ workgroupId: 'wg-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.requests).toEqual([pendingJoinRequest])
    expect(mockListWorkgroupJoinRequests).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      workgroupId: 'wg-1',
    })
  })

  it('creates a join request through the route contract', async () => {
    const response = await createJoinRequest(
      createMockRequest('POST', { message: '我需要参与灯光任务' }),
      { params: Promise.resolve({ workgroupId: 'wg-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.request).toEqual(pendingJoinRequest)
    expect(mockCreateWorkgroupJoinRequest).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      workgroupId: 'wg-1',
      message: '我需要参与灯光任务',
    })
  })

  it('approves a join request with member role by default', async () => {
    const response = await reviewJoinRequest(createMockRequest('POST', { action: 'approve' }), {
      params: Promise.resolve({ workgroupId: 'wg-1', requestId: 'join-request-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.request.status).toBe('approved')
    expect(mockReviewWorkgroupJoinRequest).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      workgroupId: 'wg-1',
      requestId: 'join-request-1',
      action: 'approve',
      role: 'member',
      reviewNote: undefined,
    })
  })

  it('validates review actions before calling the service', async () => {
    const response = await reviewJoinRequest(createMockRequest('POST', { action: 'archive' }), {
      params: Promise.resolve({ workgroupId: 'wg-1', requestId: 'join-request-1' }),
    })

    expect(response.status).toBe(400)
    expect(mockReviewWorkgroupJoinRequest).not.toHaveBeenCalled()
  })
})
