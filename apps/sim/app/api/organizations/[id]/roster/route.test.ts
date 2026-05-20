/**
 * @vitest-environment node
 */
import { authMock, authMockFns, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect, mockExpireStalePendingInvitationsForOrganization } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockExpireStalePendingInvitationsForOrganization: vi.fn().mockResolvedValue(undefined),
}))

const mockDbResults = vi.hoisted(() => ({ value: [] as any[] }))

function createChain() {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).leftJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(mockDbResults.value.shift() || []))
  ;(chain as any).then = (resolve: (value: unknown) => unknown) =>
    resolve(mockDbResults.value.shift() || [])
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect.mockImplementation(() => createChain()),
  },
}))

vi.mock('@sim/db/schema', () => schemaMock)
vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/invitations/core', () => ({
  expireStalePendingInvitationsForOrganization: mockExpireStalePendingInvitationsForOrganization,
}))

import { GET } from './route'

describe('GET /api/organizations/[id]/roster', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbResults.value = []
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'owner@example.com', name: 'Owner' },
    })
  })

  it('includes owner-only workspace access for organization members', async () => {
    const createdAt = new Date('2026-05-21T00:00:00.000Z')
    mockDbResults.value = [
      [{ role: 'owner' }],
      [{ id: 'ws-owner', name: 'Owner Workspace', ownerId: 'user-1' }],
      [
        {
          memberId: 'member-1',
          userId: 'user-1',
          role: 'owner',
          createdAt,
          userName: 'Owner',
          userEmail: 'owner@example.com',
          userImage: null,
        },
      ],
      [],
      [],
      [],
    ]

    const response = await GET(
      new Request('http://localhost:3000/api/organizations/org-1/roster'),
      {
        params: Promise.resolve({ id: 'org-1' }),
      } as any
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(
      data.data.members.map((member: { userId: string; workspaces: unknown[] }) => ({
        userId: member.userId,
        workspaces: member.workspaces,
      }))
    ).toEqual([
      {
        userId: 'user-1',
        workspaces: [
          {
            workspaceId: 'ws-owner',
            workspaceName: 'Owner Workspace',
            permission: 'admin',
          },
        ],
      },
    ])
    expect(mockExpireStalePendingInvitationsForOrganization).toHaveBeenCalledWith('org-1')
  })
})
