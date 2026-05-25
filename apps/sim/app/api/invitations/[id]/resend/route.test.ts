/**
 * @vitest-environment node
 */
import {
  auditMock,
  authMock,
  authMockFns,
  createMockRequest,
  permissionsMock,
  permissionsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetInvitationById,
  mockIsOrganizationOwnerOrAdmin,
  mockGetOrganizationSubscription,
  mockPrepareInvitationResend,
  mockPersistInvitationResend,
  mockSummarizeInvitationGrantVisibility,
  mockSendInvitationEmail,
  mockGetWorkspaceInvitePolicy,
  mockDbSelect,
} = vi.hoisted(() => ({
  mockGetInvitationById: vi.fn(),
  mockIsOrganizationOwnerOrAdmin: vi.fn(),
  mockGetOrganizationSubscription: vi.fn(),
  mockPrepareInvitationResend: vi.fn(),
  mockPersistInvitationResend: vi.fn(),
  mockSummarizeInvitationGrantVisibility: vi.fn(),
  mockSendInvitationEmail: vi.fn(),
  mockGetWorkspaceInvitePolicy: vi.fn(),
  mockDbSelect: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/invitations/core', () => ({
  getInvitationById: mockGetInvitationById,
  summarizeInvitationGrantVisibility: mockSummarizeInvitationGrantVisibility,
}))

vi.mock('@/lib/billing/core/organization', () => ({
  isOrganizationOwnerOrAdmin: mockIsOrganizationOwnerOrAdmin,
}))

vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: mockGetOrganizationSubscription,
}))

vi.mock('@/lib/invitations/send', () => ({
  prepareInvitationResend: mockPrepareInvitationResend,
  persistInvitationResend: mockPersistInvitationResend,
  sendInvitationEmail: mockSendInvitationEmail,
}))

vi.mock('@/lib/workspaces/policy', () => ({
  getWorkspaceInvitePolicy: mockGetWorkspaceInvitePolicy,
}))

import { POST } from './route'

describe('POST /api/invitations/[id]/resend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
    })
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(true)
    permissionsMockFns.mockHasWorkspaceAdminAccess.mockResolvedValue(false)
    mockSummarizeInvitationGrantVisibility.mockResolvedValue({
      hasUnavailableGrant: false,
      hasHiddenPersonalGrant: false,
    })
    permissionsMockFns.mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Shared Workspace',
      ownerId: 'owner-1',
      organizationId: 'org-1',
      workspaceMode: 'organization',
      billedAccountUserId: 'owner-1',
      archivedAt: null,
    })
    mockGetWorkspaceInvitePolicy.mockResolvedValue({
      allowed: true,
      reason: null,
      requiresSeat: false,
      organizationId: 'org-1',
      upgradeRequired: false,
    })
    mockPrepareInvitationResend.mockResolvedValue({
      tokenForEmail: 'tok-2',
      nextToken: 'tok-next',
      nextExpiresAt: new Date('2026-06-01T00:00:00.000Z'),
    })
    mockSendInvitationEmail.mockResolvedValue({ success: true })
    mockDbSelect.mockReturnValue(createSelectChain([{ name: 'Admin', email: 'admin@example.com' }]))
  })

  it('authenticates before validating route params', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)

    const response = await POST(
      createMockRequest('POST', undefined, undefined, 'http://localhost/api/invitations//resend'),
      { params: Promise.resolve({ id: '' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(mockGetInvitationById).not.toHaveBeenCalled()
    expect(mockPrepareInvitationResend).not.toHaveBeenCalled()
  })

  it('rejects resending invitations that reference a personal workspace grant', async () => {
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
      grants: [
        {
          id: 'grant-1',
          workspaceId: 'workspace-1',
          permission: 'read',
          workspaceName: 'Personal',
        },
      ],
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

    const response = await POST(
      createMockRequest(
        'POST',
        undefined,
        undefined,
        'http://localhost/api/invitations/inv-1/resend'
      ),
      { params: Promise.resolve({ id: 'inv-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data).toEqual({
      error: 'Invitation references a personal canvas that can no longer be shared',
    })
    expect(mockPrepareInvitationResend).not.toHaveBeenCalled()
    expect(mockSendInvitationEmail).not.toHaveBeenCalled()
  })

  it('hides hidden personal workspace invitations from stale workspace admins', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce({
      user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
    })
    mockIsOrganizationOwnerOrAdmin.mockResolvedValueOnce(false)
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
      grants: [
        {
          id: 'grant-1',
          workspaceId: 'workspace-1',
          permission: 'read',
          workspaceName: 'Personal',
        },
      ],
    })
    mockSummarizeInvitationGrantVisibility.mockResolvedValueOnce({
      hasUnavailableGrant: false,
      hasHiddenPersonalGrant: true,
    })

    const response = await POST(
      createMockRequest(
        'POST',
        undefined,
        undefined,
        'http://localhost/api/invitations/inv-1/resend'
      ),
      { params: Promise.resolve({ id: 'inv-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Invitation not found' })
    expect(mockPrepareInvitationResend).not.toHaveBeenCalled()
    expect(mockSendInvitationEmail).not.toHaveBeenCalled()
  })

  it('resends an invitation for a valid shared workspace target', async () => {
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
      grants: [
        { id: 'grant-1', workspaceId: 'workspace-1', permission: 'read', workspaceName: 'Shared' },
      ],
    })
    permissionsMockFns.mockHasWorkspaceAdminAccess.mockResolvedValueOnce(true)

    const response = await POST(
      createMockRequest(
        'POST',
        undefined,
        undefined,
        'http://localhost/api/invitations/inv-1/resend'
      ),
      { params: Promise.resolve({ id: 'inv-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ success: true })
    expect(mockPrepareInvitationResend).toHaveBeenCalledWith({
      invitationId: 'inv-1',
      rotateToken: true,
      currentToken: 'tok-1',
    })
    expect(mockPersistInvitationResend).toHaveBeenCalled()
    expect(mockSendInvitationEmail).toHaveBeenCalled()
  })
})
