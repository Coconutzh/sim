/**
 * @vitest-environment node
 */

import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkWorkspaceAccessMock,
  getUsersWithPermissionsMock,
  hasWorkspaceAdminAccessMock,
  insertValuesMock,
  isWorkspaceOnEnterprisePlanMock,
  parseRequestMock,
  selectGroupLimitMock,
  transactionMock,
} = vi.hoisted(() => {
  const selectGroupLimitMock = vi.fn()
  const insertValuesMock = vi.fn().mockResolvedValue(undefined)
  const transactionMock = vi.fn()

  return {
    checkWorkspaceAccessMock: vi.fn(),
    getUsersWithPermissionsMock: vi.fn(),
    hasWorkspaceAdminAccessMock: vi.fn(),
    insertValuesMock,
    isWorkspaceOnEnterprisePlanMock: vi.fn(),
    parseRequestMock: vi.fn(),
    selectGroupLimitMock,
    transactionMock,
  }
})

vi.mock('@sim/audit', () => ({
  AuditAction: {
    PERMISSION_GROUP_MEMBER_ADDED: 'PERMISSION_GROUP_MEMBER_ADDED',
    PERMISSION_GROUP_MEMBER_REMOVED: 'PERMISSION_GROUP_MEMBER_REMOVED',
  },
  AuditResourceType: { PERMISSION_GROUP: 'PERMISSION_GROUP' },
  recordAudit: vi.fn(),
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
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
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
    assignedAt: 'permissionGroupMember.assignedAt',
    id: 'permissionGroupMember.id',
    permissionGroupId: 'permissionGroupMember.permissionGroupId',
    userId: 'permissionGroupMember.userId',
    workspaceId: 'permissionGroupMember.workspaceId',
  },
  user: {
    email: 'user.email',
    id: 'user.id',
    image: 'user.image',
    name: 'user.name',
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
  and: vi.fn((...args) => ({ kind: 'and', args })),
  eq: vi.fn((left, right) => ({ kind: 'eq', left, right })),
  inArray: vi.fn((left, right) => ({ kind: 'inArray', left, right })),
}))

vi.mock('@/lib/api/server', () => ({
  getValidationErrorMessage: vi.fn(() => 'invalid'),
  parseRequest: parseRequestMock,
}))

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn().mockResolvedValue({
    user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
  }),
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

import { DELETE, POST } from './route'

describe('POST /api/workspaces/[id]/permission-groups/[groupId]/members', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectGroupLimitMock.mockResolvedValue([
      { id: 'group-1', workspaceId: 'ws-1', name: 'Team Members' },
    ])
    hasWorkspaceAdminAccessMock.mockResolvedValue(true)
    isWorkspaceOnEnterprisePlanMock.mockResolvedValue(true)
    parseRequestMock.mockResolvedValue({
      success: true,
      data: { body: { userId: 'owner-1' } },
    })
    getUsersWithPermissionsMock.mockResolvedValue([
      { userId: 'owner-1', email: 'owner@example.com', permissionType: 'admin' },
      { userId: 'member-1', email: 'member@example.com', permissionType: 'member' },
    ])
    checkWorkspaceAccessMock.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'owner-1', workspaceMode: 'organization' },
    })
    transactionMock.mockImplementation(async (callback) => {
      const txSelectChain: {
        from: ReturnType<typeof vi.fn>
        innerJoin: ReturnType<typeof vi.fn>
        where: ReturnType<typeof vi.fn>
      } = {
        from: vi.fn(),
        innerJoin: vi.fn(),
        where: vi.fn().mockResolvedValue([]),
      }
      txSelectChain.from.mockReturnValue(txSelectChain)
      txSelectChain.innerJoin.mockReturnValue(txSelectChain)

      const tx = {
        delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
        insert: vi.fn(() => ({ values: insertValuesMock })),
        select: vi.fn(() => txSelectChain),
      }

      return callback(tx)
    })
  })

  it('allows adding an owner-only workspace member to a permission group', async () => {
    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ id: 'ws-1', groupId: 'group-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data).toEqual({
      member: expect.objectContaining({
        permissionGroupId: 'group-1',
        userId: 'owner-1',
        workspaceId: 'ws-1',
      }),
    })
    expect(getUsersWithPermissionsMock).toHaveBeenCalledWith('ws-1')
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionGroupId: 'group-1',
        userId: 'owner-1',
        workspaceId: 'ws-1',
      })
    )
  })

  it('rejects users who are not workspace members', async () => {
    parseRequestMock.mockResolvedValueOnce({
      success: true,
      data: { body: { userId: 'missing-user' } },
    })

    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ id: 'ws-1', groupId: 'group-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'User does not have access to this workspace' })
    expect(insertValuesMock).not.toHaveBeenCalled()
  })

  it('rejects permission-group membership changes for personal workspaces', async () => {
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
    expect(data).toEqual({ error: 'Personal workspaces do not support permission groups' })
    expect(hasWorkspaceAdminAccessMock).not.toHaveBeenCalled()
    expect(insertValuesMock).not.toHaveBeenCalled()
  })

  it('rejects permission-group member removals for personal workspaces before admin checks', async () => {
    checkWorkspaceAccessMock.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'owner-1', workspaceMode: 'personal' },
    })

    const response = await DELETE(
      createMockRequest('DELETE', undefined, undefined, 'http://localhost?memberId=member-1'),
      {
        params: Promise.resolve({ id: 'ws-1', groupId: 'group-1' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Personal workspaces do not support permission groups' })
    expect(hasWorkspaceAdminAccessMock).not.toHaveBeenCalled()
  })

  it('hides foreign personal workspaces from permission-group membership routes', async () => {
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
    expect(data).toEqual({ error: 'Workspace not found' })
    expect(hasWorkspaceAdminAccessMock).not.toHaveBeenCalled()
    expect(insertValuesMock).not.toHaveBeenCalled()
  })
})
