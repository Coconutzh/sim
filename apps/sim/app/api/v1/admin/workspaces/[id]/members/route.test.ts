/**
 * @vitest-environment node
 */
import { permissionsMock, permissionsMockFns, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect, mockParseRequest } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockParseRequest: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).orderBy = vi.fn(() => Promise.resolve(result))
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    insert: vi.fn(() => ({
      values: vi.fn().mockResolvedValue(undefined),
    })),
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  },
}))

vi.mock('@sim/db/schema', () => schemaMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))
vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: (handler: unknown) => handler,
}))
vi.mock('@/app/api/v1/admin/middleware', () => ({
  withAdminAuthParams: (handler: unknown) => handler,
}))
vi.mock('@/lib/permission-groups/auto-add', () => ({
  applyWorkspaceAutoAddGroup: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/credentials/environment', () => ({
  syncWorkspaceEnvCredentials: vi.fn().mockResolvedValue(undefined),
}))

import { GET } from './route'

describe('GET /api/v1/admin/workspaces/[id]/members', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    permissionsMockFns.mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'ws-owner',
      name: 'Owner Workspace',
      ownerId: 'owner-1',
      organizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: 'owner-1',
      archivedAt: null,
    })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: {
        params: { id: 'ws-owner' },
        query: { limit: 50, offset: 0 },
      },
    })
  })

  it('includes an owner-only workspace owner in the admin member list', async () => {
    mockDbSelect
      .mockReturnValueOnce(
        createSelectChain([
          {
            userId: 'owner-1',
            userName: 'Owner',
            userEmail: 'owner@example.com',
            userImage: null,
            userCreatedAt: new Date('2026-05-21T00:00:00.000Z'),
            userUpdatedAt: new Date('2026-05-21T00:00:00.000Z'),
          },
        ])
      )
      .mockReturnValueOnce(createSelectChain([]))

    const response = await GET(
      new Request('http://localhost/api/v1/admin/workspaces/ws-owner/members') as any,
      {
        params: Promise.resolve({ id: 'ws-owner' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual([
      expect.objectContaining({
        id: 'owner:ws-owner:owner-1',
        workspaceId: 'ws-owner',
        userId: 'owner-1',
        permissions: 'admin',
        userName: 'Owner',
        userEmail: 'owner@example.com',
      }),
    ])
    expect(data.pagination.total).toBe(1)
  })

  it('canonicalizes owner permission rows to the synthetic owner member id', async () => {
    mockDbSelect
      .mockReturnValueOnce(
        createSelectChain([
          {
            userId: 'owner-1',
            userName: 'Owner',
            userEmail: 'owner@example.com',
            userImage: null,
            userCreatedAt: new Date('2026-05-21T00:00:00.000Z'),
            userUpdatedAt: new Date('2026-05-21T00:00:00.000Z'),
          },
        ])
      )
      .mockReturnValueOnce(
        createSelectChain([
          {
            id: 'perm-owner-1',
            userId: 'owner-1',
            permissionType: 'admin',
            createdAt: new Date('2026-05-21T00:00:00.000Z'),
            updatedAt: new Date('2026-05-21T00:00:00.000Z'),
            userName: 'Owner',
            userEmail: 'owner@example.com',
            userImage: null,
          },
        ])
      )

    const response = await GET(
      new Request('http://localhost/api/v1/admin/workspaces/ws-owner/members') as any,
      {
        params: Promise.resolve({ id: 'ws-owner' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual([
      expect.objectContaining({
        id: 'owner:ws-owner:owner-1',
        workspaceId: 'ws-owner',
        userId: 'owner-1',
        permissions: 'admin',
      }),
    ])
  })
})
