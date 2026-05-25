/**
 * @vitest-environment node
 */
import { auditMock, createMockRequest, createSession, loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockHasWorkspaceAdminAccess,
  mockDbState,
  mockGetSession,
  mockIsOrganizationWorkspace,
  mockSummarizeInvitationGrantVisibility,
  mockValidateInvitationsAllowed,
  mockValidateSeatAvailability,
  mockCreatePendingInvitation,
  mockSendInvitationEmail,
  mockCancelPendingInvitation,
} = vi.hoisted(() => ({
  mockHasWorkspaceAdminAccess: vi.fn(),
  mockDbState: {
    selectResults: [] as any[],
  },
  mockGetSession: vi.fn(),
  mockIsOrganizationWorkspace: vi.fn(),
  mockSummarizeInvitationGrantVisibility: vi.fn(),
  mockValidateInvitationsAllowed: vi.fn(),
  mockValidateSeatAvailability: vi.fn(),
  mockCreatePendingInvitation: vi.fn(),
  mockSendInvitationEmail: vi.fn(),
  mockCancelPendingInvitation: vi.fn(),
}))

function createSelectChain() {
  const chain: any = {}
  chain.from = vi.fn().mockReturnValue(chain)
  chain.innerJoin = vi.fn().mockReturnValue(chain)
  chain.leftJoin = vi.fn().mockReturnValue(chain)
  chain.where = vi.fn().mockReturnValue(chain)
  chain.orderBy = vi.fn().mockReturnValue(chain)
  chain.limit = vi
    .fn()
    .mockImplementation(() => Promise.resolve(mockDbState.selectResults.shift() ?? []))
  chain.then = vi.fn().mockImplementation((callback: (rows: any[]) => unknown) => {
    const rows = mockDbState.selectResults.shift() ?? []
    return Promise.resolve(callback(rows))
  })
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn().mockImplementation(() => createSelectChain()),
  },
}))

vi.mock('@sim/db/schema', () => ({
  invitation: {
    id: 'invitation.id',
    organizationId: 'invitation.organizationId',
    status: 'invitation.status',
    email: 'invitation.email',
    kind: 'invitation.kind',
    role: 'invitation.role',
    inviterId: 'invitation.inviterId',
    expiresAt: 'invitation.expiresAt',
    createdAt: 'invitation.createdAt',
  },
  member: {
    organizationId: 'member.organizationId',
    userId: 'member.userId',
    role: 'member.role',
  },
  organization: {
    id: 'organization.id',
    name: 'organization.name',
  },
  user: {
    id: 'user.id',
    name: 'user.name',
    email: 'user.email',
  },
  workspace: {
    archivedAt: 'workspace.archivedAt',
    id: 'workspace.id',
    name: 'workspace.name',
    organizationId: 'workspace.organizationId',
    workspaceMode: 'workspace.workspaceMode',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ field, values })),
  isNull: vi.fn((field: unknown) => ({ type: 'isNull', field })),
}))

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/billing/validation/seat-management', () => ({
  validateBulkInvitations: vi.fn(),
  validateSeatAvailability: mockValidateSeatAvailability,
}))

vi.mock('@/lib/invitations/send', () => ({
  createPendingInvitation: mockCreatePendingInvitation,
  sendInvitationEmail: mockSendInvitationEmail,
  cancelPendingInvitation: mockCancelPendingInvitation,
}))

vi.mock('@/lib/invitations/core', () => ({
  summarizeInvitationGrantVisibility: mockSummarizeInvitationGrantVisibility,
}))

vi.mock('@/lib/messaging/email/validation', () => ({
  quickValidateEmail: vi.fn((email: string) => ({ isValid: email.includes('@') })),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  hasWorkspaceAdminAccess: mockHasWorkspaceAdminAccess,
}))

vi.mock('@/lib/workspaces/policy', () => ({
  isOrganizationWorkspace: mockIsOrganizationWorkspace,
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  InvitationsNotAllowedError: class InvitationsNotAllowedError extends Error {},
  validateInvitationsAllowed: mockValidateInvitationsAllowed,
}))

import { GET, POST } from '@/app/api/organizations/[id]/invitations/route'

describe('GET /api/organizations/[id]/invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbState.selectResults = []
    mockGetSession.mockResolvedValue(null)
  })

  it('authenticates before validating route params', async () => {
    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: '' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockDbState.selectResults).toEqual([])
  })
})

describe('POST /api/organizations/[id]/invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbState.selectResults = []
    mockHasWorkspaceAdminAccess.mockResolvedValue(true)
    mockIsOrganizationWorkspace.mockReturnValue(true)
    mockSummarizeInvitationGrantVisibility.mockResolvedValue({
      hasUnavailableGrant: false,
      hasHiddenPersonalGrant: false,
    })
    mockValidateInvitationsAllowed.mockResolvedValue(undefined)
    mockValidateSeatAvailability.mockResolvedValue({
      canInvite: true,
      currentSeats: 1,
      maxSeats: 5,
      availableSeats: 4,
    })
    mockCreatePendingInvitation.mockResolvedValue({
      invitationId: 'inv-1',
      token: 'tok-1',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    mockSendInvitationEmail.mockResolvedValue({ success: true })
  })

  it('creates a unified invitation and sends a single email', async () => {
    mockGetSession.mockResolvedValue(
      createSession({ userId: 'user-1', email: 'owner@example.com', name: 'Owner' })
    )
    mockDbState.selectResults = [
      [{ role: 'owner' }],
      [{ name: 'Org One' }],
      [],
      [],
      [{ name: 'Owner', email: 'owner@example.com' }],
    ]

    const response = await POST(
      createMockRequest(
        'POST',
        { emails: ['invitee@example.com'] },
        {},
        'http://localhost/api/organizations/org-1/invitations'
      ),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(200)
    expect(mockCreatePendingInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'organization',
        email: 'invitee@example.com',
        organizationId: 'org-1',
        role: 'member',
        grants: [],
      })
    )
    expect(mockSendInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'organization', email: 'invitee@example.com' })
    )
    expect(mockCancelPendingInvitation).not.toHaveBeenCalled()
  })

  it('rolls back the pending invitation when email delivery fails', async () => {
    mockGetSession.mockResolvedValue(
      createSession({ userId: 'user-1', email: 'owner@example.com', name: 'Owner' })
    )
    mockDbState.selectResults = [
      [{ role: 'owner' }],
      [{ name: 'Org One' }],
      [],
      [],
      [{ name: 'Owner', email: 'owner@example.com' }],
    ]
    mockSendInvitationEmail.mockResolvedValue({ success: false, error: 'mailer unavailable' })

    const response = await POST(
      createMockRequest(
        'POST',
        { emails: ['invitee@example.com'] },
        {},
        'http://localhost/api/organizations/org-1/invitations'
      ),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(502)
    expect(mockCancelPendingInvitation).toHaveBeenCalledWith('inv-1')
  })

  it('returns per-email results for sent, existing, pending, and invalid invitations', async () => {
    mockGetSession.mockResolvedValue(
      createSession({ userId: 'user-1', email: 'owner@example.com', name: 'Owner' })
    )
    mockDbState.selectResults = [
      [{ role: 'owner' }],
      [{ name: 'Org One' }],
      [{ userEmail: 'member@example.com' }],
      [{ email: 'pending@example.com' }],
      [{ name: 'Owner', email: 'owner@example.com' }],
    ]

    const response = await POST(
      createMockRequest(
        'POST',
        {
          emails: ['sent@example.com', 'member@example.com', 'pending@example.com', 'not-an-email'],
        },
        {},
        'http://localhost/api/organizations/org-1/invitations'
      ),
      { params: Promise.resolve({ id: 'org-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockCreatePendingInvitation).toHaveBeenCalledTimes(1)
    expect(mockCreatePendingInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'sent@example.com' })
    )
    expect(data.data.emailResults).toEqual([
      {
        email: 'sent@example.com',
        status: 'sent',
        message: 'Invitation email sent',
        invitationId: 'inv-1',
      },
      {
        email: 'member@example.com',
        status: 'existing_member',
        message: 'Already a member of this organization',
      },
      {
        email: 'pending@example.com',
        status: 'pending_invitation',
        message: 'A pending invitation already exists',
      },
      {
        email: 'not-an-email',
        status: 'invalid_email',
        message: 'Invalid email address',
      },
    ])
  })

  it('returns per-email results when part of a batch fails delivery', async () => {
    mockGetSession.mockResolvedValue(
      createSession({ userId: 'user-1', email: 'owner@example.com', name: 'Owner' })
    )
    mockDbState.selectResults = [
      [{ role: 'owner' }],
      [{ name: 'Org One' }],
      [],
      [],
      [{ name: 'Owner', email: 'owner@example.com' }],
    ]
    mockCreatePendingInvitation.mockImplementation(({ email }: { email: string }) =>
      Promise.resolve({
        invitationId: email === 'fail@example.com' ? 'inv-fail' : 'inv-ok',
        token: email === 'fail@example.com' ? 'tok-fail' : 'tok-ok',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
    )
    mockSendInvitationEmail.mockImplementation(({ email }: { email: string }) =>
      Promise.resolve(
        email === 'fail@example.com'
          ? { success: false, error: 'mailer unavailable' }
          : { success: true }
      )
    )

    const response = await POST(
      createMockRequest(
        'POST',
        { emails: ['sent@example.com', 'fail@example.com'] },
        {},
        'http://localhost/api/organizations/org-1/invitations'
      ),
      { params: Promise.resolve({ id: 'org-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(207)
    expect(mockCancelPendingInvitation).toHaveBeenCalledWith('inv-fail')
    expect(data.data.emailResults).toEqual([
      {
        email: 'sent@example.com',
        status: 'sent',
        message: 'Invitation email sent',
        invitationId: 'inv-ok',
      },
      {
        email: 'fail@example.com',
        status: 'failed',
        message: 'mailer unavailable',
      },
    ])
  })

  it('rejects batch grants for personal workspaces', async () => {
    mockGetSession.mockResolvedValue(
      createSession({ userId: 'user-1', email: 'owner@example.com', name: 'Owner' })
    )
    mockIsOrganizationWorkspace.mockReturnValue(false)
    mockDbState.selectResults = [
      [{ role: 'owner' }],
      [{ name: 'Org One' }],
      [{ id: 'ws-personal', archivedAt: null, organizationId: 'org-1', workspaceMode: 'personal' }],
    ]

    const response = await POST(
      createMockRequest(
        'POST',
        {
          emails: ['invitee@example.com'],
          workspaceInvitations: [{ workspaceId: 'ws-personal', permission: 'read' }],
        },
        { batch: 'true' },
        'http://localhost/api/organizations/org-1/invitations?batch=true'
      ),
      { params: Promise.resolve({ id: 'org-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({
      error: 'Canvas ws-personal is not an organization-owned canvas.',
    })
    expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
  })

  it('hides foreign personal workspace batch grants behind not found semantics', async () => {
    mockGetSession.mockResolvedValue(
      createSession({ userId: 'user-1', email: 'owner@example.com', name: 'Owner' })
    )
    mockHasWorkspaceAdminAccess.mockResolvedValueOnce(false)
    mockSummarizeInvitationGrantVisibility.mockResolvedValueOnce({
      hasUnavailableGrant: false,
      hasHiddenPersonalGrant: true,
    })
    mockDbState.selectResults = [[{ role: 'owner' }], [{ name: 'Org One' }]]

    const response = await POST(
      createMockRequest(
        'POST',
        {
          emails: ['invitee@example.com'],
          workspaceInvitations: [{ workspaceId: 'ws-hidden-personal', permission: 'read' }],
        },
        { batch: 'true' },
        'http://localhost/api/organizations/org-1/invitations?batch=true'
      ),
      { params: Promise.resolve({ id: 'org-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
  })

  it('rejects batch grants for archived organization workspaces', async () => {
    mockGetSession.mockResolvedValue(
      createSession({ userId: 'user-1', email: 'owner@example.com', name: 'Owner' })
    )
    mockHasWorkspaceAdminAccess.mockReset()
    mockHasWorkspaceAdminAccess.mockResolvedValue(true)
    mockDbState.selectResults = [[{ role: 'owner' }], [{ name: 'Org One' }], []]

    const response = await POST(
      createMockRequest(
        'POST',
        {
          emails: ['invitee@example.com'],
          workspaceInvitations: [{ workspaceId: 'ws-archived', permission: 'read' }],
        },
        { batch: 'true' },
        'http://localhost/api/organizations/org-1/invitations?batch=true'
      ),
      { params: Promise.resolve({ id: 'org-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({
      error: 'Canvas ws-archived is not an organization-owned canvas.',
    })
    expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
  })
})
