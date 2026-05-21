/**
 * @vitest-environment node
 */
import { authMock, authMockFns, createMockRequest, permissionsMock, permissionsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetInvitationById, mockIsOrganizationOwnerOrAdmin } = vi.hoisted(() => ({
  mockGetInvitationById: vi.fn(),
  mockIsOrganizationOwnerOrAdmin: vi.fn(),
}))

vi.mock('@/lib/auth', () => authMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/invitations/core', () => ({
  getInvitationById: mockGetInvitationById,
  cancelInvitation: vi.fn(),
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
}))

vi.mock('@/lib/billing/core/organization', () => ({
  isOrganizationOwnerOrAdmin: mockIsOrganizationOwnerOrAdmin,
}))

import { GET } from './route'

describe('GET /api/invitations/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'invitee@example.com', name: 'Invitee' },
    })
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(false)
    permissionsMockFns.mockHasWorkspaceAdminAccess.mockResolvedValue(false)
    permissionsMockFns.mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace',
      ownerId: 'user-1',
      organizationId: null,
      workspaceMode: 'organization',
      billedAccountUserId: 'owner-1',
      archivedAt: null,
    })
  })

  it('hides invitations that point to a foreign personal workspace from the invitee', async () => {
    mockGetInvitationById.mockResolvedValue({
      id: 'inv-1',
      kind: 'workspace',
      email: 'invitee@example.com',
      organizationId: null,
      organizationName: null,
      membershipIntent: 'external',
      inviterId: 'inviter-1',
      inviterName: 'Inviter',
      inviterEmail: 'inviter@example.com',
      role: 'member',
      status: 'pending',
      token: 'tok-1',
      expiresAt: new Date('2026-06-01T00:00:00.000Z'),
      createdAt: new Date('2026-05-21T00:00:00.000Z'),
      updatedAt: new Date('2026-05-21T00:00:00.000Z'),
      grants: [{ id: 'grant-1', workspaceId: 'workspace-1', permission: 'read', workspaceName: 'Personal' }],
    })
    permissionsMockFns.mockGetWorkspaceWithOwner.mockResolvedValueOnce({
      id: 'workspace-1',
      name: 'Personal',
      ownerId: 'owner-2',
      organizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: 'owner-2',
      archivedAt: null,
    })

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'inv-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Invitation not found' })
  })

  it('hides invitations that point to an archived or missing workspace from the invitee', async () => {
    mockGetInvitationById.mockResolvedValue({
      id: 'inv-1',
      kind: 'workspace',
      email: 'invitee@example.com',
      organizationId: null,
      organizationName: null,
      membershipIntent: 'external',
      inviterId: 'inviter-1',
      inviterName: 'Inviter',
      inviterEmail: 'inviter@example.com',
      role: 'member',
      status: 'pending',
      token: 'tok-1',
      expiresAt: new Date('2026-06-01T00:00:00.000Z'),
      createdAt: new Date('2026-05-21T00:00:00.000Z'),
      updatedAt: new Date('2026-05-21T00:00:00.000Z'),
      grants: [{ id: 'grant-1', workspaceId: 'workspace-1', permission: 'read', workspaceName: 'Archived' }],
    })
    permissionsMockFns.mockGetWorkspaceWithOwner.mockResolvedValueOnce(null)

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'inv-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Invitation not found' })
  })

  it('still allows an organization admin to inspect a stale invitation for cleanup', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
    })
    mockGetInvitationById.mockResolvedValue({
      id: 'inv-1',
      kind: 'workspace',
      email: 'invitee@example.com',
      organizationId: 'org-1',
      organizationName: 'Acme',
      membershipIntent: 'internal',
      inviterId: 'inviter-1',
      inviterName: 'Inviter',
      inviterEmail: 'inviter@example.com',
      role: 'member',
      status: 'pending',
      token: 'tok-1',
      expiresAt: new Date('2026-06-01T00:00:00.000Z'),
      createdAt: new Date('2026-05-21T00:00:00.000Z'),
      updatedAt: new Date('2026-05-21T00:00:00.000Z'),
      grants: [{ id: 'grant-1', workspaceId: 'workspace-1', permission: 'read', workspaceName: 'Personal' }],
    })
    mockIsOrganizationOwnerOrAdmin.mockResolvedValueOnce(true)
    permissionsMockFns.mockGetWorkspaceWithOwner.mockResolvedValueOnce(null)

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'inv-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.invitation.id).toBe('inv-1')
    expect(permissionsMockFns.mockGetWorkspaceWithOwner).not.toHaveBeenCalled()
  })
})
