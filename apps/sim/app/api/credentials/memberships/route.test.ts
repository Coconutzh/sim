/**
 * @vitest-environment node
 */
import {
  authMock,
  authMockFns,
  createMockRequest,
  permissionsMock,
  permissionsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect, mockDbTransaction } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbTransaction: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

function createWhereResolvesChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    transaction: mockDbTransaction,
  },
}))

vi.mock('@sim/db/schema', () => ({
  credential: {
    id: 'credential.id',
    workspaceId: 'credential.workspaceId',
    type: 'credential.type',
    displayName: 'credential.displayName',
    providerId: 'credential.providerId',
  },
  credentialMember: {
    id: 'credentialMember.id',
    credentialId: 'credentialMember.credentialId',
    userId: 'credentialMember.userId',
    role: 'credentialMember.role',
    status: 'credentialMember.status',
    joinedAt: 'credentialMember.joinedAt',
    updatedAt: 'credentialMember.updatedAt',
  },
}))

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { DELETE, GET } from '@/app/api/credentials/memberships/route'

describe('/api/credentials/memberships', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com', name: 'User' },
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'user-1', workspaceMode: 'organization' },
    })
  })

  it('filters hidden foreign personal workspace memberships from the listing', async () => {
    mockDbSelect.mockReturnValueOnce(
      createWhereResolvesChain([
        {
          membershipId: 'member-visible',
          credentialId: 'cred-visible',
          workspaceId: 'ws-visible',
          type: 'oauth',
          displayName: 'Visible credential',
          providerId: 'google',
          role: 'admin',
          status: 'active',
          joinedAt: new Date('2026-05-21T00:00:00.000Z'),
        },
        {
          membershipId: 'member-hidden',
          credentialId: 'cred-hidden',
          workspaceId: 'ws-hidden',
          type: 'oauth',
          displayName: 'Hidden credential',
          providerId: 'slack',
          role: 'admin',
          status: 'active',
          joinedAt: new Date('2026-05-21T00:00:00.000Z'),
        },
      ])
    )
    permissionsMockFns.mockCheckWorkspaceAccess
      .mockResolvedValueOnce({
        exists: true,
        hasAccess: true,
        canWrite: true,
        workspace: { id: 'ws-visible', ownerId: 'user-1', workspaceMode: 'organization' },
      })
      .mockResolvedValueOnce({
        exists: true,
        hasAccess: false,
        canWrite: false,
        workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
      })

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.memberships).toEqual([
      expect.objectContaining({
        membershipId: 'member-visible',
        credentialId: 'cred-visible',
        workspaceId: 'ws-visible',
      }),
    ])
  })

  it('hides membership deletion for hidden foreign personal workspaces', async () => {
    mockDbSelect.mockReturnValueOnce(
      createSelectChain([
        {
          id: 'member-hidden',
          role: 'admin',
          status: 'active',
          workspaceId: 'ws-hidden',
        },
      ])
    )
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await DELETE(
      createMockRequest(
        'DELETE',
        undefined,
        {},
        'http://localhost:3000/api/credentials/memberships?credentialId=cred-hidden'
      )
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Membership not found' })
    expect(mockDbTransaction).not.toHaveBeenCalled()
  })
})
