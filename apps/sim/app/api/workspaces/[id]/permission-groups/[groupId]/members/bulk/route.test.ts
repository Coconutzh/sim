/**
 * @vitest-environment node
 */

import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  andMock,
  checkWorkspaceAccessMock,
  eqMock,
  getSessionMock,
  getUsersWithPermissionsMock,
  hasWorkspaceAdminAccessMock,
  inArrayMock,
  insertValuesMock,
  isWorkspaceOnEnterprisePlanMock,
  parseRequestMock,
  recordAuditMock,
  selectGroupLimitMock,
  transactionMock,
} = vi.hoisted(() => {
  const selectGroupLimitMock = vi.fn()
  const insertValuesMock = vi.fn().mockResolvedValue(undefined)
  const transactionMock = vi.fn()

  return {
    andMock: vi.fn((...args) => ({ kind: 'and', args })),
    checkWorkspaceAccessMock: vi.fn(),
    eqMock: vi.fn((left, right) => ({ kind: 'eq', left, right })),
    getSessionMock: vi.fn(),
    getUsersWithPermissionsMock: vi.fn(),
    hasWorkspaceAdminAccessMock: vi.fn(),
    inArrayMock: vi.fn((left, right) => ({ kind: 'inArray', left, right })),
    insertValuesMock,
    isWorkspaceOnEnterprisePlanMock: vi.fn(),
    parseRequestMock: vi.fn(),
    recordAuditMock: vi.fn(),
    selectGroupLimitMock,
    transactionMock,
  }
})

vi.mock('@sim/audit', () => ({
  AuditAction: { PERMISSION_GROUP_MEMBER_ADDED: 'PERMISSION_GROUP_MEMBER_ADDED' },
  AuditResourceType: { PERMISSION_GROUP: 'PERMISSION_GROUP' },
  recordAudit: recordAuditMock,
}))

vi.mock('@sim/db', () => {
  const selectChain: {
    from: ReturnType<typeof vi.fn>
    where: ReturnType<typeof vi.fn>
    limit: ReturnType<typeof vi.fn>
  } = {
    from: vi.fn(),
    where: vi.fn(),
    limit: selectGroupLimitMock,
  }
  selectChain.from.mockReturnValue(selectChain)
  selectChain.where.mockReturnValue(selectChain)

  return {
    db: {
      select: vi.fn(() => selectChain),
      transaction: transactionMock,
    },
  }
})

vi.mock('@sim/db/schema', () => ({
  permissionGroup: {
    id: 'permissionGroup.id',
    name: 'permissionGroup.name',
    workspaceId: 'permissionGroup.workspaceId',
  },
  permissionGroupMember: {
    id: 'permissionGroupMember.id',
    permissionGroupId: 'permissionGroupMember.permissionGroupId',
    userId: 'permissionGroupMember.userId',
    workspaceId: 'permissionGroupMember.workspaceId',
  },
  permissions: {
    entityId: 'permissions.entityId',
    entityType: 'permissions.entityType',
    userId: 'permissions.userId',
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
  })),
}))

vi.mock('@sim/utils/errors', () => ({
  getPostgresConstraintName: vi.fn(),
  getPostgresErrorCode: vi.fn(),
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn(() => 'generated-id'),
}))

vi.mock('drizzle-orm', () => ({
  and: andMock,
  eq: eqMock,
  inArray: inArrayMock,
}))

vi.mock('@/lib/api/server', () => ({
  getValidationErrorMessage: vi.fn(() => 'invalid'),
  parseRequest: parseRequestMock,
}))

vi.mock('@/lib/auth', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/lib/billing', () => ({
  isWorkspaceOnEnterprisePlan: isWorkspaceOnEnterprisePlanMock,
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: checkWorkspaceAccessMock,
  getUsersWithPermissions: getUsersWithPermissionsMock,
  hasWorkspaceAdminAccess: hasWorkspaceAdminAccessMock,
}))

import { POST } from '@/app/api/workspaces/[id]/permission-groups/[groupId]/members/bulk/route'

describe('POST /api/workspaces/[id]/permission-groups/[groupId]/members/bulk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
    })
    selectGroupLimitMock.mockResolvedValue([
      { id: 'group-1', workspaceId: 'ws-1', name: 'Team Members' },
    ])
    parseRequestMock.mockResolvedValue({
      success: true,
      data: {
        params: { id: 'ws-1', groupId: 'group-1' },
        body: { addAllWorkspaceMembers: false, userIds: [] },
      },
    })
    hasWorkspaceAdminAccessMock.mockResolvedValue(true)
    isWorkspaceOnEnterprisePlanMock.mockResolvedValue(true)
    checkWorkspaceAccessMock.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'owner-1', workspaceMode: 'organization' },
    })
    getUsersWithPermissionsMock.mockResolvedValue([
      { userId: 'owner-1', permissionType: 'admin' },
      { userId: 'member-1', permissionType: 'member' },
    ])
    transactionMock.mockImplementation(async (callback) => {
      const txSelectChain: {
        from: ReturnType<typeof vi.fn>
        innerJoin: ReturnType<typeof vi.fn>
        where: ReturnType<typeof vi.fn>
        then: (callback: (rows: unknown[]) => unknown) => Promise<unknown>
      } = {
        from: vi.fn(),
        innerJoin: vi.fn(),
        where: vi.fn(),
        then: async (callbackFn) => callbackFn([]),
      }
      txSelectChain.from.mockReturnValue(txSelectChain)
      txSelectChain.innerJoin.mockReturnValue(txSelectChain)
      txSelectChain.where.mockReturnValue(txSelectChain)

      const tx = {
        delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
        insert: vi.fn(() => ({ values: insertValuesMock })),
        select: vi.fn(() => txSelectChain),
      }

      return callback(tx)
    })
  })

  it('includes owner-only workspace members when adding all members', async () => {
    parseRequestMock.mockResolvedValueOnce({
      success: true,
      data: {
        params: { id: 'ws-1', groupId: 'group-1' },
        body: { addAllWorkspaceMembers: true },
      },
    })

    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ id: 'ws-1', groupId: 'group-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ added: 2, moved: 0 })
    expect(getUsersWithPermissionsMock).toHaveBeenCalledWith('ws-1')
    expect(insertValuesMock).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'owner-1', workspaceId: 'ws-1' }),
      expect.objectContaining({ userId: 'member-1', workspaceId: 'ws-1' }),
    ])
  })

  it('accepts owner-only members in explicit user selections', async () => {
    parseRequestMock.mockResolvedValueOnce({
      success: true,
      data: {
        params: { id: 'ws-1', groupId: 'group-1' },
        body: { addAllWorkspaceMembers: false, userIds: ['owner-1', 'missing-user'] },
      },
    })

    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ id: 'ws-1', groupId: 'group-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ added: 1, moved: 0 })
    expect(insertValuesMock).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'owner-1', workspaceId: 'ws-1' }),
    ])
  })

  it('rejects bulk permission-group assignment for personal workspaces', async () => {
    checkWorkspaceAccessMock.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'owner-1', workspaceMode: 'personal' },
    })

    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ id: 'ws-1', groupId: 'group-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Personal canvases do not support permission groups' })
    expect(hasWorkspaceAdminAccessMock).not.toHaveBeenCalled()
    expect(insertValuesMock).not.toHaveBeenCalled()
  })

  it('hides foreign personal workspaces from bulk permission-group assignment', async () => {
    checkWorkspaceAccessMock.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ id: 'ws-hidden', groupId: 'group-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(hasWorkspaceAdminAccessMock).not.toHaveBeenCalled()
    expect(insertValuesMock).not.toHaveBeenCalled()
  })

  it('authenticates bulk assignments before validating route params or body', async () => {
    getSessionMock.mockResolvedValue(null)

    const response = await POST(createMockRequest('POST', {}), {
      params: Promise.resolve({ id: '', groupId: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(parseRequestMock).not.toHaveBeenCalled()
    expect(checkWorkspaceAccessMock).not.toHaveBeenCalled()
  })
})
