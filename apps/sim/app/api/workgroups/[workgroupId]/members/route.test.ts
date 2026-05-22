/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAddWorkgroupMember, mockGetSession, mockGetWorkgroupMembers } = vi.hoisted(() => ({
  mockAddWorkgroupMember: vi.fn(),
  mockGetSession: vi.fn(),
  mockGetWorkgroupMembers: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/collaboration/service', () => ({
  addWorkgroupMember: mockAddWorkgroupMember,
  getWorkgroupMembers: mockGetWorkgroupMembers,
}))

import { GET, POST } from '@/app/api/workgroups/[workgroupId]/members/route'

describe('/api/workgroups/[workgroupId]/members', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mockGetWorkgroupMembers.mockResolvedValue([
      {
        userId: 'member-1',
        name: 'Lighting Member',
        email: 'member@example.com',
        avatarUrl: null,
        role: 'member',
        joinedAt: '2026-05-23T00:00:00.000Z',
      },
    ])
  })

  it('lists workgroup members for a team admin', async () => {
    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ workgroupId: 'wg-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.members).toHaveLength(1)
    expect(mockGetWorkgroupMembers).toHaveBeenCalledWith({
      userId: 'admin-1',
      workgroupId: 'wg-1',
    })
  })

  it('adds an existing user by email through the route contract', async () => {
    const response = await POST(
      createMockRequest('POST', { email: 'member@example.com', role: 'member' }),
      { params: Promise.resolve({ workgroupId: 'wg-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ success: true })
    expect(mockAddWorkgroupMember).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      workgroupId: 'wg-1',
      userId: undefined,
      email: 'member@example.com',
      role: 'member',
    })
  })

  it('validates that an email or user ID is present before calling service', async () => {
    const response = await POST(createMockRequest('POST', { role: 'member' }), {
      params: Promise.resolve({ workgroupId: 'wg-1' }),
    })

    expect(response.status).toBe(400)
    expect(mockAddWorkgroupMember).not.toHaveBeenCalled()
  })
})
