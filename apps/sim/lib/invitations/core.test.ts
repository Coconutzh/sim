/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockEnsureUserInOrganization,
  mockSetActiveOrganizationForCurrentSession,
  mockSyncUsageLimitsFromSubscription,
  mockSyncWorkspaceEnvCredentials,
  mockApplyWorkspaceAutoAddGroup,
} = vi.hoisted(() => ({
  mockEnsureUserInOrganization: vi.fn(),
  mockSetActiveOrganizationForCurrentSession: vi.fn(),
  mockSyncUsageLimitsFromSubscription: vi.fn(),
  mockSyncWorkspaceEnvCredentials: vi.fn(),
  mockApplyWorkspaceAutoAddGroup: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/billing/organizations/membership', () => ({
  ensureUserInOrganization: mockEnsureUserInOrganization,
}))

vi.mock('@/lib/auth/active-organization', () => ({
  setActiveOrganizationForCurrentSession: mockSetActiveOrganizationForCurrentSession,
}))

vi.mock('@/lib/billing/core/usage', () => ({
  syncUsageLimitsFromSubscription: mockSyncUsageLimitsFromSubscription,
}))

vi.mock('@/lib/credentials/environment', () => ({
  syncWorkspaceEnvCredentials: mockSyncWorkspaceEnvCredentials,
}))

vi.mock('@/lib/permission-groups/auto-add', () => ({
  applyWorkspaceAutoAddGroup: mockApplyWorkspaceAutoAddGroup,
}))

import { acceptInvitation } from '@/lib/invitations/core'

function queueWhereResponses(responses: unknown[][]) {
  const queue = [...responses]
  dbChainMockFns.where.mockImplementation(() => {
    const result = queue.shift() ?? []
    const thenable = Promise.resolve(result) as Promise<unknown[]> & {
      limit: ReturnType<typeof vi.fn>
      orderBy: ReturnType<typeof vi.fn>
      returning: ReturnType<typeof vi.fn>
      groupBy: ReturnType<typeof vi.fn>
    }
    thenable.limit = vi.fn(() => Promise.resolve(result))
    thenable.orderBy = vi.fn(() => Promise.resolve(result))
    thenable.returning = vi.fn(() => Promise.resolve(result))
    thenable.groupBy = vi.fn(() => Promise.resolve(result))
    return thenable as ReturnType<typeof dbChainMockFns.where>
  })
}

describe('acceptInvitation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('accepts external workspace invitations without joining the organization', async () => {
    queueWhereResponses([
      [
        {
          id: 'inv-1',
          kind: 'workspace',
          email: 'external@example.com',
          organizationId: 'org-1',
          membershipIntent: 'external',
          inviterId: 'inviter-1',
          role: 'member',
          status: 'pending',
          token: 'tok-1',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          id: 'grant-1',
          workspaceId: 'workspace-1',
          permission: 'write',
          workspaceName: 'Workspace',
        },
      ],
      [{ name: 'Acme' }],
      [{ name: 'Inviter', email: 'inviter@example.com' }],
      [{ ownerId: 'someone-else', workspaceMode: 'organization', archivedAt: null }],
      [],
      [],
      [{ variables: {} }],
    ])

    const result = await acceptInvitation({
      userId: 'external-user',
      userEmail: 'external@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.acceptedWorkspaceIds).toEqual(['workspace-1'])
      expect(result.membershipAlreadyExists).toBe(false)
    }
    expect(mockEnsureUserInOrganization).not.toHaveBeenCalled()
    expect(mockSetActiveOrganizationForCurrentSession).not.toHaveBeenCalled()
    expect(mockSyncUsageLimitsFromSubscription).not.toHaveBeenCalled()
    expect(mockApplyWorkspaceAutoAddGroup).toHaveBeenCalled()
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'external-user',
        entityType: 'workspace',
        entityId: 'workspace-1',
        permissionType: 'write',
      })
    )
  })

  it('adds accepted team canvas invitees to the mapped workgroup', async () => {
    queueWhereResponses([
      [
        {
          id: 'inv-1',
          kind: 'workspace',
          email: 'member@example.com',
          organizationId: 'org-1',
          membershipIntent: 'external',
          inviterId: 'inviter-1',
          role: 'member',
          status: 'pending',
          token: 'tok-1',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          id: 'grant-1',
          workspaceId: 'team-workspace-1',
          permission: 'write',
          workspaceName: 'Lighting team canvas',
        },
      ],
      [{ name: 'Acme' }],
      [{ name: 'Inviter', email: 'inviter@example.com' }],
      [
        {
          ownerId: 'someone-else',
          workgroupId: 'workgroup-1',
          workspaceMode: 'organization',
          archivedAt: null,
        },
      ],
      [],
      [],
      [{ variables: {} }],
    ])

    const result = await acceptInvitation({
      userId: 'member-1',
      userEmail: 'member@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
    })

    expect(result.success).toBe(true)
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        workgroupId: 'workgroup-1',
        userId: 'member-1',
        role: 'member',
      })
    )
  })

  it('falls back to external access when an internal workspace invitee joined another organization', async () => {
    mockEnsureUserInOrganization.mockResolvedValueOnce({
      success: false,
      alreadyMember: false,
      existingOrgId: 'org-2',
      error:
        'User is already a member of another organization. Users can only belong to one organization at a time.',
      billingActions: {
        proUsageSnapshotted: false,
        proCancelledAtPeriodEnd: false,
      },
    })

    queueWhereResponses([
      [
        {
          id: 'inv-1',
          kind: 'workspace',
          email: 'invitee@example.com',
          organizationId: 'org-1',
          membershipIntent: 'internal',
          inviterId: 'inviter-1',
          role: 'member',
          status: 'pending',
          token: 'tok-1',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          id: 'grant-1',
          workspaceId: 'workspace-1',
          permission: 'read',
          workspaceName: 'Workspace',
        },
      ],
      [{ name: 'Acme' }],
      [{ name: 'Inviter', email: 'inviter@example.com' }],
      [{ ownerId: 'someone-else', workspaceMode: 'organization', archivedAt: null }],
      [],
      [],
      [{ variables: {} }],
    ])

    const result = await acceptInvitation({
      userId: 'invitee-user',
      userEmail: 'invitee@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.invitation.membershipIntent).toBe('external')
      expect(result.acceptedWorkspaceIds).toEqual(['workspace-1'])
      expect(result.membershipAlreadyExists).toBe(false)
    }
    expect(mockEnsureUserInOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'invitee-user',
        organizationId: 'org-1',
        acceptingInvitationId: 'inv-1',
      })
    )
    expect(mockSetActiveOrganizationForCurrentSession).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'accepted',
        membershipIntent: 'external',
      })
    )
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'invitee-user',
        entityType: 'workspace',
        entityId: 'workspace-1',
        permissionType: 'read',
      })
    )
  })

  it('does not insert a permission row when the invited user already owns the workspace', async () => {
    queueWhereResponses([
      [
        {
          id: 'inv-1',
          kind: 'workspace',
          email: 'owner@example.com',
          organizationId: null,
          membershipIntent: 'internal',
          inviterId: 'inviter-1',
          role: 'member',
          status: 'pending',
          token: 'tok-1',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          id: 'grant-1',
          workspaceId: 'workspace-1',
          permission: 'read',
          workspaceName: 'Workspace',
        },
      ],
      [{ name: 'Inviter', email: 'inviter@example.com' }],
      [{ ownerId: 'owner-user', workspaceMode: 'personal', archivedAt: null }],
      [],
      [{ variables: {} }],
    ])

    const result = await acceptInvitation({
      userId: 'owner-user',
      userEmail: 'owner@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.acceptedWorkspaceIds).toEqual(['workspace-1'])
    }
    expect(mockApplyWorkspaceAutoAddGroup).toHaveBeenCalledWith(
      expect.anything(),
      'workspace-1',
      'owner-user'
    )
    expect(dbChainMockFns.values).not.toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner-user',
        entityType: 'workspace',
        entityId: 'workspace-1',
      })
    )
  })

  it('rejects invitations that target a foreign personal workspace', async () => {
    queueWhereResponses([
      [
        {
          id: 'inv-1',
          kind: 'workspace',
          email: 'invitee@example.com',
          organizationId: null,
          membershipIntent: 'external',
          inviterId: 'inviter-1',
          role: 'member',
          status: 'pending',
          token: 'tok-1',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          id: 'grant-1',
          workspaceId: 'workspace-1',
          permission: 'write',
          workspaceName: 'Personal Workspace',
        },
      ],
      [{ name: 'Inviter', email: 'inviter@example.com' }],
      [{ ownerId: 'owner-user', workspaceMode: 'personal', archivedAt: null }],
    ])

    const result = await acceptInvitation({
      userId: 'invitee-user',
      userEmail: 'invitee@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
    })

    expect(result).toEqual({ success: false, kind: 'workspace-unavailable' })
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
  })

  it('rejects invitations that target an archived workspace', async () => {
    queueWhereResponses([
      [
        {
          id: 'inv-1',
          kind: 'workspace',
          email: 'invitee@example.com',
          organizationId: null,
          membershipIntent: 'external',
          inviterId: 'inviter-1',
          role: 'member',
          status: 'pending',
          token: 'tok-1',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          id: 'grant-1',
          workspaceId: 'workspace-1',
          permission: 'read',
          workspaceName: 'Archived Workspace',
        },
      ],
      [{ name: 'Inviter', email: 'inviter@example.com' }],
      [{ ownerId: 'owner-user', workspaceMode: 'organization', archivedAt: new Date() }],
    ])

    const result = await acceptInvitation({
      userId: 'invitee-user',
      userEmail: 'invitee@example.com',
      invitationId: 'inv-1',
      token: 'tok-1',
    })

    expect(result).toEqual({ success: false, kind: 'workspace-unavailable' })
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
  })
})
