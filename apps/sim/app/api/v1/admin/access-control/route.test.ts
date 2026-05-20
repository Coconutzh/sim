/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { deleteWhereCalls, mockDbDelete, mockDbSelect, mockParseRequest, selectWhereCalls } =
  vi.hoisted(() => ({
    deleteWhereCalls: [] as unknown[],
    mockDbDelete: vi.fn(),
    mockDbSelect: vi.fn(),
    mockParseRequest: vi.fn(),
    selectWhereCalls: [] as unknown[],
  }))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).leftJoin = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn((condition: unknown) => {
    selectWhereCalls.push(condition)
    return Promise.resolve(result)
  })
  ;(chain as any).then = (resolve: (value: T) => unknown) => resolve(result)
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    delete: mockDbDelete,
    select: mockDbSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  permissionGroup: {
    createdAt: 'permissionGroup.createdAt',
    createdBy: 'permissionGroup.createdBy',
    description: 'permissionGroup.description',
    id: 'permissionGroup.id',
    name: 'permissionGroup.name',
    workspaceId: 'permissionGroup.workspaceId',
  },
  permissionGroupMember: {
    permissionGroupId: 'permissionGroupMember.permissionGroupId',
  },
  user: {
    email: 'user.email',
    id: 'user.id',
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
  and: vi.fn((...args) => ({ kind: 'and', args })),
  count: vi.fn(() => ({ kind: 'count' })),
  eq: vi.fn((left, right) => ({ kind: 'eq', left, right })),
  inArray: vi.fn((left, right) => ({ kind: 'inArray', left, right })),
  isNull: vi.fn((value) => ({ kind: 'isNull', value })),
  sql: vi.fn((strings, ...values) => ({ kind: 'sql', strings, values })),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { PERMISSION_GROUP_DELETED: 'permission_group.deleted' },
  AuditResourceType: { PERMISSION_GROUP: 'permission_group' },
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: (handler: unknown) => handler,
}))

vi.mock('@/app/api/v1/admin/middleware', () => ({
  withAdminAuth: (handler: unknown) => handler,
}))

import { DELETE, GET } from './route'

describe('admin access-control organization scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectWhereCalls.length = 0
    deleteWhereCalls.length = 0

    mockDbDelete.mockReturnValue({
      where: vi.fn((condition: unknown) => {
        deleteWhereCalls.push(condition)
        return Promise.resolve(undefined)
      }),
    })
  })

  it('limits organization permission-group listing to active organization workspaces', async () => {
    mockParseRequest.mockResolvedValue({
      success: true,
      data: { query: { organizationId: 'org-1' } },
    })
    mockDbSelect
      .mockReturnValueOnce(createSelectChain([]))

    const response = await GET(
      new Request('http://localhost/api/v1/admin/access-control?organizationId=org-1') as any
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      data: {
        data: [],
        pagination: {
          total: 0,
          limit: 0,
          offset: 0,
          hasMore: false,
        },
      },
    })
    expect(selectWhereCalls).toContainEqual({
      kind: 'and',
      args: [
        { kind: 'eq', left: 'workspace.organizationId', right: 'org-1' },
        { kind: 'eq', left: 'workspace.workspaceMode', right: 'organization' },
        { kind: 'isNull', value: 'workspace.archivedAt' },
      ],
    })
  })

  it('limits organization permission-group deletion to active organization workspaces', async () => {
    mockParseRequest.mockResolvedValue({
      success: true,
      data: { query: { organizationId: 'org-1', reason: 'cleanup' } },
    })
    mockDbSelect
      .mockReturnValueOnce(createSelectChain([]))

    const response = await DELETE(
      new Request('http://localhost/api/v1/admin/access-control?organizationId=org-1') as any
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual({
      success: true,
      deletedCount: 0,
      membersRemoved: 0,
      message: 'No permission groups found for the given scope',
    })
    expect(selectWhereCalls).toContainEqual({
      kind: 'and',
      args: [
        { kind: 'eq', left: 'workspace.organizationId', right: 'org-1' },
        { kind: 'eq', left: 'workspace.workspaceMode', right: 'organization' },
        { kind: 'isNull', value: 'workspace.archivedAt' },
      ],
    })
  })
})
