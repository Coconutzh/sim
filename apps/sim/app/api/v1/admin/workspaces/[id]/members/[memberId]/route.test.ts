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
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
      returning: vi.fn().mockResolvedValue([]),
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
vi.mock('@/lib/credentials/access', () => ({
  revokeWorkspaceCredentialMemberships: vi.fn().mockResolvedValue(undefined),
}))

import { DELETE, GET, PATCH } from './route'

describe('GET /api/v1/admin/workspaces/[id]/members/[memberId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbSelect.mockReset()
    mockParseRequest.mockReset()
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
        params: { id: 'ws-owner', memberId: 'owner:ws-owner:owner-1' },
      },
    })
  })

  it('returns owner-only members through the synthetic owner member id', async () => {
    mockDbSelect.mockReturnValueOnce(
      createSelectChain([
        {
          id: 'owner-1',
          createdAt: new Date('2026-05-21T00:00:00.000Z'),
          updatedAt: new Date('2026-05-21T00:00:00.000Z'),
          userName: 'Owner',
          userEmail: 'owner@example.com',
          userImage: null,
        },
      ])
    )

    const response = await GET(
      new Request(
        'http://localhost/api/v1/admin/workspaces/ws-owner/members/owner:ws-owner:owner-1'
      ) as any,
      {
        params: Promise.resolve({ id: 'ws-owner', memberId: 'owner:ws-owner:owner-1' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual(
      expect.objectContaining({
        id: 'owner:ws-owner:owner-1',
        workspaceId: 'ws-owner',
        userId: 'owner-1',
        permissions: 'admin',
        userName: 'Owner',
        userEmail: 'owner@example.com',
      })
    )
  })

  it('canonicalizes owner permission rows to the synthetic owner member id', async () => {
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: {
        params: { id: 'ws-owner', memberId: 'perm-owner-1' },
      },
    })
    mockDbSelect.mockReturnValueOnce(
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
      new Request('http://localhost/api/v1/admin/workspaces/ws-owner/members/perm-owner-1') as any,
      {
        params: Promise.resolve({ id: 'ws-owner', memberId: 'perm-owner-1' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual(
      expect.objectContaining({
        id: 'owner:ws-owner:owner-1',
        workspaceId: 'ws-owner',
        userId: 'owner-1',
        permissions: 'admin',
      })
    )
  })

  it('hides stale non-owner permission rows for personal workspaces', async () => {
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: {
        params: { id: 'ws-owner', memberId: 'perm-user-2' },
      },
    })
    mockDbSelect.mockReturnValueOnce(
      createSelectChain([
        {
          id: 'perm-user-2',
          userId: 'user-2',
          permissionType: 'write',
          createdAt: new Date('2026-05-21T00:00:00.000Z'),
          updatedAt: new Date('2026-05-21T00:00:00.000Z'),
          userName: 'User Two',
          userEmail: 'user2@example.com',
          userImage: null,
        },
      ])
    )

    const response = await GET(
      new Request('http://localhost/api/v1/admin/workspaces/ws-owner/members/perm-user-2') as any,
      {
        params: Promise.resolve({ id: 'ws-owner', memberId: 'perm-user-2' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Canvas member not found',
    })
  })
})

describe('PATCH /api/v1/admin/workspaces/[id]/members/[memberId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbSelect.mockReset()
    mockParseRequest.mockReset()
    permissionsMockFns.mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'ws-owner',
      name: 'Owner Workspace',
      ownerId: 'owner-1',
      organizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: 'owner-1',
      archivedAt: null,
    })
  })

  it('rejects owner permission-row updates', async () => {
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: {
        params: { id: 'ws-owner', memberId: 'perm-owner-1' },
        body: { permissions: 'read' },
      },
    })
    mockDbSelect.mockReturnValueOnce(
      createSelectChain([
        {
          id: 'perm-owner-1',
          userId: 'owner-1',
          permissionType: 'admin',
          createdAt: new Date('2026-05-21T00:00:00.000Z'),
        },
      ])
    )

    const response = await PATCH(
      new Request('http://localhost/api/v1/admin/workspaces/ws-owner/members/perm-owner-1', {
        method: 'PATCH',
        body: JSON.stringify({ permissions: 'read' }),
      }) as any,
      {
        params: Promise.resolve({ id: 'ws-owner', memberId: 'perm-owner-1' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toEqual({
      code: 'BAD_REQUEST',
      message: 'Cannot modify the workspace owner from this endpoint',
    })
  })

  it('hides stale non-owner updates on personal workspaces', async () => {
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: {
        params: { id: 'ws-owner', memberId: 'perm-user-2' },
        body: { permissions: 'read' },
      },
    })
    mockDbSelect.mockReturnValueOnce(
      createSelectChain([
        {
          id: 'perm-user-2',
          userId: 'user-2',
          permissionType: 'write',
          createdAt: new Date('2026-05-21T00:00:00.000Z'),
        },
      ])
    )

    const response = await PATCH(
      new Request('http://localhost/api/v1/admin/workspaces/ws-owner/members/perm-user-2', {
        method: 'PATCH',
        body: JSON.stringify({ permissions: 'read' }),
      }) as any,
      {
        params: Promise.resolve({ id: 'ws-owner', memberId: 'perm-user-2' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Canvas member not found',
    })
  })
})

describe('DELETE /api/v1/admin/workspaces/[id]/members/[memberId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbSelect.mockReset()
    mockParseRequest.mockReset()
    permissionsMockFns.mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'ws-owner',
      name: 'Owner Workspace',
      ownerId: 'owner-1',
      organizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: 'owner-1',
      archivedAt: null,
    })
  })

  it('rejects owner permission-row removals', async () => {
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: {
        params: { id: 'ws-owner', memberId: 'perm-owner-1' },
      },
    })
    mockDbSelect.mockReturnValueOnce(
      createSelectChain([
        {
          id: 'perm-owner-1',
          userId: 'owner-1',
        },
      ])
    )

    const response = await DELETE(
      new Request('http://localhost/api/v1/admin/workspaces/ws-owner/members/perm-owner-1', {
        method: 'DELETE',
      }) as any,
      {
        params: Promise.resolve({ id: 'ws-owner', memberId: 'perm-owner-1' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toEqual({
      code: 'BAD_REQUEST',
      message: 'Cannot remove the workspace owner from this endpoint',
    })
  })

  it('hides stale non-owner removals on personal workspaces', async () => {
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: {
        params: { id: 'ws-owner', memberId: 'perm-user-2' },
      },
    })
    mockDbSelect.mockReturnValueOnce(
      createSelectChain([
        {
          id: 'perm-user-2',
          userId: 'user-2',
        },
      ])
    )

    const response = await DELETE(
      new Request('http://localhost/api/v1/admin/workspaces/ws-owner/members/perm-user-2', {
        method: 'DELETE',
      }) as any,
      {
        params: Promise.resolve({ id: 'ws-owner', memberId: 'perm-user-2' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Canvas member not found',
    })
  })
})
