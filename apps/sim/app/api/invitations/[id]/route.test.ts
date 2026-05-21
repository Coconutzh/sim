/**
 * @vitest-environment node
 */
import { authMock, authMockFns, createMockRequest, permissionsMock, permissionsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCancelInvitation,
  mockGetInvitationById,
  mockIsOrganizationOwnerOrAdmin,
  mockSummarizeInvitationGrantVisibility,
} = vi.hoisted(() => ({
  mockCancelInvitation: vi.fn(),
  mockGetInvitationById: vi.fn(),
  mockIsOrganizationOwnerOrAdmin: vi.fn(),
  mockSummarizeInvitationGrantVisibility: vi.fn(),
}))

vi.mock('@/lib/auth', () => authMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/invitations/core', () => ({
  cancelInvitation: mockCancelInvitation,
  getInvitationById: mockGetInvitationById,
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
  summarizeInvitationGrantVisibility: mockSummarizeInvitationGrantVisibility,
}))

vi.mock('@/lib/billing/core/organization', () => ({
  isOrganizationOwnerOrAdmin: mockIsOrganizationOwnerOrAdmin,
}))

import { DELETE, GET, PATCH } from './route'

describe('GET /api/invitations/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'invitee@example.com', name: 'Invitee' },
    })
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(false)
    mockSummarizeInvitationGrantVisibility.mockResolvedValue({
      hasUnavailableGrant: false,
      hasHiddenPersonalGrant: false,
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: {
        id: 'workspace-1',
        name: 'Workspace',
        ownerId: 'user-1',
        organizationId: null,
        workspaceMode: 'organization',
        billedAccountUserId: 'owner-1',
        archivedAt: null,
      },
    })
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
    mockSummarizeInvitationGrantVisibility.mockResolvedValueOnce({
      hasUnavailableGrant: false,
      hasHiddenPersonalGrant: true,
    })

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'inv-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Invitation not found' })
  })

  it('hides invitations that point to a foreign personal workspace from stale workspace admins', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
    })
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
    mockSummarizeInvitationGrantVisibility.mockResolvedValueOnce({
      hasUnavailableGrant: false,
      hasHiddenPersonalGrant: true,
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
    mockSummarizeInvitationGrantVisibility.mockResolvedValueOnce({
      hasUnavailableGrant: true,
      hasHiddenPersonalGrant: false,
    })

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

  it('hides hidden personal workspace grant updates behind not found semantics', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
    })
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
    mockSummarizeInvitationGrantVisibility.mockResolvedValueOnce({
      hasUnavailableGrant: false,
      hasHiddenPersonalGrant: true,
    })

    const response = await PATCH(
      createMockRequest('PATCH', {
        grants: [{ workspaceId: 'workspace-1', permission: 'write' }],
      }),
      { params: Promise.resolve({ id: 'inv-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Invitation not found' })
  })

  it('hides hidden personal workspace role updates behind not found semantics for stale workspace admins', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
    })
    mockGetInvitationById.mockResolvedValue({
      id: 'inv-1',
      kind: 'organization',
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
    mockIsOrganizationOwnerOrAdmin.mockResolvedValueOnce(false)
    mockSummarizeInvitationGrantVisibility.mockResolvedValueOnce({
      hasUnavailableGrant: false,
      hasHiddenPersonalGrant: true,
    })

    const response = await PATCH(
      createMockRequest('PATCH', {
        role: 'admin',
      }),
      { params: Promise.resolve({ id: 'inv-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Invitation not found' })
  })

  it('hides hidden personal workspace invitation cancellation behind not found semantics', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
    })
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
    mockSummarizeInvitationGrantVisibility.mockResolvedValueOnce({
      hasUnavailableGrant: false,
      hasHiddenPersonalGrant: true,
    })

    const response = await DELETE(createMockRequest('DELETE'), {
      params: Promise.resolve({ id: 'inv-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Invitation not found' })
    expect(mockCancelInvitation).not.toHaveBeenCalled()
  })
})
