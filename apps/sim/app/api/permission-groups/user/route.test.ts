/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { checkWorkspaceAccessMock, isWorkspaceOnEnterprisePlanMock, orderByMock } = vi.hoisted(
  () => ({
    checkWorkspaceAccessMock: vi.fn(),
    isWorkspaceOnEnterprisePlanMock: vi.fn(),
    orderByMock: vi.fn(),
  })
)

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: orderByMock,
          }),
        }),
      }),
    })),
  },
}))

vi.mock('@sim/db/schema', () => ({
  permissionGroup: {
    config: 'permissionGroup.config',
    createdAt: 'permissionGroup.createdAt',
    id: 'permissionGroup.id',
    name: 'permissionGroup.name',
    workspaceId: 'permissionGroup.workspaceId',
  },
  permissionGroupMember: {
    permissionGroupId: 'permissionGroupMember.permissionGroupId',
    userId: 'permissionGroupMember.userId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ kind: 'and', args })),
  asc: vi.fn((value) => ({ kind: 'asc', value })),
  eq: vi.fn((left, right) => ({ kind: 'eq', left, right })),
}))

vi.mock('@/lib/api/contracts/permission-groups', () => ({
  userPermissionConfigQuerySchema: {
    safeParse: vi.fn((value: Record<string, unknown>) => ({
      success: Boolean(value.workspaceId),
      data: { workspaceId: value.workspaceId },
    })),
  },
}))

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn().mockResolvedValue({
    user: { id: 'owner-1', email: 'owner@example.com', name: 'Owner' },
  }),
}))

vi.mock('@/lib/billing', () => ({
  isWorkspaceOnEnterprisePlan: isWorkspaceOnEnterprisePlanMock,
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))

vi.mock('@/lib/permission-groups/types', () => ({
  parsePermissionGroupConfig: vi.fn((config) => config),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: checkWorkspaceAccessMock,
}))

import { GET } from './route'

describe('GET /api/permission-groups/user', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkWorkspaceAccessMock.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'owner-1', workspaceMode: 'organization' },
    })
    isWorkspaceOnEnterprisePlanMock.mockResolvedValue(true)
    orderByMock.mockReturnValue({
      limit: vi.fn().mockResolvedValue([]),
    })
  })

  it('returns canvas wording when the canvas query parameter is missing', async () => {
    const response = await GET(new Request('http://localhost/api/permission-groups/user'))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Canvas ID is required' })
    expect(checkWorkspaceAccessMock).not.toHaveBeenCalled()
  })

  it('rejects personal workspaces before loading permission-group membership', async () => {
    checkWorkspaceAccessMock.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'owner-1', workspaceMode: 'personal' },
    })

    const response = await GET(
      new Request('http://localhost/api/permission-groups/user?workspaceId=ws-1')
    )
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Personal canvases do not support permission groups' })
    expect(isWorkspaceOnEnterprisePlanMock).not.toHaveBeenCalled()
  })

  it('hides foreign personal workspaces from user permission-group config lookup', async () => {
    checkWorkspaceAccessMock.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await GET(
      new Request('http://localhost/api/permission-groups/user?workspaceId=ws-hidden')
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(isWorkspaceOnEnterprisePlanMock).not.toHaveBeenCalled()
  })
})
