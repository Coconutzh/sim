/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockGetWorkspaceCreationPolicy, mockDbSelect } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetWorkspaceCreationPolicy: vi.fn(),
  mockDbSelect: vi.fn(),
}))

function createChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).leftJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).orderBy = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => chain)
  ;(chain as any).then = (resolve: (value: T) => unknown) => resolve(result)
  return chain
}

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/workspaces/policy', () => ({
  CONTACT_OWNER_TO_UPGRADE_REASON: 'Contact workspace owner to upgrade',
  UPGRADE_TO_INVITE_REASON: 'Upgrade required',
  WORKSPACE_MODE: {
    PERSONAL: 'personal',
    ORGANIZATION: 'organization',
    GRANDFATHERED_SHARED: 'grandfathered_shared',
  },
  evaluateWorkspaceInvitePolicy: vi.fn(() => ({
    allowed: true,
    upgradeRequired: false,
    reason: null,
  })),
  getWorkspaceCreationPolicy: mockGetWorkspaceCreationPolicy,
  getWorkspaceInvitePolicy: vi.fn(),
  hasActiveTeamOrEnterpriseSubscription: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

import { GET } from './route'

describe('GET /api/workspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Owner User' },
      session: { activeOrganizationId: null },
    })
    mockGetWorkspaceCreationPolicy.mockResolvedValue({
      canCreate: true,
      maxWorkspaces: 3,
      organizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: 'user-1',
    })
    mockDbSelect
      .mockReturnValueOnce(createChain([{ lastActiveWorkspaceId: 'ws-owner' }]))
      .mockReturnValueOnce(
        createChain([
          {
            workspace: {
              id: 'ws-owner',
              name: 'Owner Workspace',
              ownerId: 'user-1',
              workspaceMode: 'personal',
              billedAccountUserId: 'user-1',
              archivedAt: null,
              createdAt: new Date('2026-05-21T00:00:00Z'),
              updatedAt: new Date('2026-05-21T00:00:00Z'),
            },
            permissionType: null,
          },
        ])
      )
  })

  it('includes owner-only workspaces in the list response', async () => {
    const response = await GET(new Request('http://localhost:3000/api/workspaces?scope=all'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      lastActiveWorkspaceId: 'ws-owner',
      workspaces: [
        {
          id: 'ws-owner',
          ownerId: 'user-1',
          role: 'owner',
          permissions: 'admin',
        },
      ],
    })
  })

  it('filters out personal workspaces owned by other users even if a permission row exists', async () => {
    mockDbSelect.mockReset()
    mockDbSelect
      .mockReturnValueOnce(createChain([{ lastActiveWorkspaceId: 'ws-team' }]))
      .mockReturnValueOnce(
        createChain([
          {
            workspace: {
              id: 'ws-foreign-personal',
              name: 'Foreign Personal',
              ownerId: 'other-user',
              workspaceMode: 'personal',
              billedAccountUserId: 'other-user',
              archivedAt: null,
              createdAt: new Date('2026-05-20T00:00:00Z'),
              updatedAt: new Date('2026-05-20T00:00:00Z'),
            },
            permissionType: 'admin',
          },
          {
            workspace: {
              id: 'ws-team',
              name: 'Team Workspace',
              ownerId: 'other-user',
              workspaceMode: 'organization',
              billedAccountUserId: 'owner-1',
              archivedAt: null,
              createdAt: new Date('2026-05-21T00:00:00Z'),
              updatedAt: new Date('2026-05-21T00:00:00Z'),
            },
            permissionType: 'read',
          },
        ])
      )

    const response = await GET(new Request('http://localhost:3000/api/workspaces?scope=all'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      lastActiveWorkspaceId: 'ws-team',
      workspaces: [
        {
          id: 'ws-team',
          ownerId: 'other-user',
          role: 'member',
          permissions: 'read',
        },
      ],
    })
  })
})
