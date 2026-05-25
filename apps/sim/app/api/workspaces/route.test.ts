/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAnnotateWorkspaceCanvasMetadata,
  mockGetWorkspaceCanvasCreationCapabilities,
  mockGetSession,
  mockGetWorkspaceCreationPolicy,
  mockDbSelect,
} = vi.hoisted(() => ({
  mockAnnotateWorkspaceCanvasMetadata: vi.fn(async (workspaces: unknown[]) => workspaces),
  mockGetWorkspaceCanvasCreationCapabilities: vi.fn(),
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

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  listAccessibleWorkspaceIds: vi.fn(),
}))

vi.mock('@/lib/workspaces/canvas-metadata', () => ({
  annotateWorkspaceCanvasMetadata: mockAnnotateWorkspaceCanvasMetadata,
  getWorkspaceCanvasCreationCapabilities: mockGetWorkspaceCanvasCreationCapabilities,
}))

import { listAccessibleWorkspaceIds } from '@/lib/workspaces/permissions/utils'
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
    mockGetWorkspaceCanvasCreationCapabilities.mockResolvedValue({
      canCreatePersonalCanvas: false,
      canCreateTeamCanvas: false,
    })
    mockAnnotateWorkspaceCanvasMetadata.mockImplementation(async (workspaces) => workspaces)
    vi.mocked(listAccessibleWorkspaceIds).mockResolvedValue(['ws-owner'])
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
    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/workspaces?scope=all')
    )

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
    vi.mocked(listAccessibleWorkspaceIds).mockResolvedValueOnce(['ws-team'])
    mockDbSelect
      .mockReturnValueOnce(createChain([{ lastActiveWorkspaceId: 'ws-team' }]))
      .mockReturnValueOnce(
        createChain([
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

    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/workspaces?scope=all')
    )

    expect(response.status).toBe(200)
    expect(listAccessibleWorkspaceIds).toHaveBeenCalledWith('user-1')
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

  it('returns collaboration canvas compatibility metadata on listed workspaces', async () => {
    mockAnnotateWorkspaceCanvasMetadata.mockImplementationOnce(
      async (workspaces: Array<Record<string, unknown>>) =>
        workspaces.map((workspace) => ({
          ...workspace,
          canvasScope: 'team',
          workgroupId: 'wg-stage',
          disciplineId: 'discipline-stage',
          isInternalWorkspace: true,
        }))
    )

    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/workspaces?scope=all')
    )

    expect(response.status).toBe(200)
    expect(mockAnnotateWorkspaceCanvasMetadata).toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      workspaces: [
        {
          id: 'ws-owner',
          canvasScope: 'team',
          workgroupId: 'wg-stage',
          disciplineId: 'discipline-stage',
          isInternalWorkspace: true,
        },
      ],
    })
  })

  it('returns workspace-shell canvas creation capabilities from the server', async () => {
    mockGetWorkspaceCanvasCreationCapabilities.mockResolvedValueOnce({
      canCreatePersonalCanvas: true,
      canCreateTeamCanvas: true,
    })

    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/workspaces?scope=all')
    )

    expect(response.status).toBe(200)
    expect(mockGetWorkspaceCanvasCreationCapabilities).toHaveBeenCalledWith('user-1')
    await expect(response.json()).resolves.toMatchObject({
      canvasCreationCapabilities: {
        canCreatePersonalCanvas: true,
        canCreateTeamCanvas: true,
      },
    })
  })

  it('does not leak hidden personal workspaces into the workspace list', async () => {
    mockDbSelect.mockReset()
    vi.mocked(listAccessibleWorkspaceIds).mockResolvedValueOnce(['ws-team'])
    mockDbSelect
      .mockReturnValueOnce(createChain([{ lastActiveWorkspaceId: 'ws-team' }]))
      .mockReturnValueOnce(
        createChain([
          {
            workspace: {
              id: 'ws-team',
              name: 'Team Workspace',
              ownerId: 'team-owner',
              workspaceMode: 'organization',
              billedAccountUserId: 'team-owner',
              archivedAt: null,
              createdAt: new Date('2026-05-21T00:00:00Z'),
              updatedAt: new Date('2026-05-21T00:00:00Z'),
            },
            permissionType: 'read',
          },
        ])
      )

    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/workspaces?scope=all')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.workspaces).toHaveLength(1)
    expect(data.workspaces[0].id).toBe('ws-team')
    expect(data.workspaces.find((workspace: { id: string }) => workspace.id === 'ws-hidden')).toBe(
      undefined
    )
    expect(listAccessibleWorkspaceIds).toHaveBeenCalledWith('user-1')
  })

  it('does not return an inaccessible last active workspace id', async () => {
    mockDbSelect.mockReset()
    vi.mocked(listAccessibleWorkspaceIds).mockResolvedValueOnce(['ws-team'])
    mockDbSelect
      .mockReturnValueOnce(createChain([{ lastActiveWorkspaceId: 'ws-hidden-personal' }]))
      .mockReturnValueOnce(
        createChain([
          {
            workspace: {
              id: 'ws-team',
              name: 'Team Workspace',
              ownerId: 'team-owner',
              workspaceMode: 'organization',
              billedAccountUserId: 'team-owner',
              archivedAt: null,
              createdAt: new Date('2026-05-21T00:00:00Z'),
              updatedAt: new Date('2026-05-21T00:00:00Z'),
            },
            permissionType: 'read',
          },
        ])
      )

    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/workspaces?scope=all')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.lastActiveWorkspaceId).toBeNull()
    expect(data.workspaces).toHaveLength(1)
    expect(data.workspaces[0].id).toBe('ws-team')
  })

  it('returns an empty list when no workspace is accessible and creation is blocked', async () => {
    vi.mocked(listAccessibleWorkspaceIds).mockResolvedValueOnce([])
    mockGetWorkspaceCreationPolicy.mockResolvedValueOnce({
      canCreate: false,
      status: 403,
      reason: 'Upgrade required',
      maxWorkspaces: 1,
      organizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: 'user-1',
    })
    mockDbSelect.mockReset()
    mockDbSelect
      .mockReturnValueOnce(createChain([{ lastActiveWorkspaceId: null }]))
      .mockReturnValueOnce(createChain([]))

    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/workspaces?scope=active')
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      lastActiveWorkspaceId: null,
      workspaces: [],
      creationPolicy: expect.objectContaining({
        canCreate: false,
      }),
    })
  })
})
