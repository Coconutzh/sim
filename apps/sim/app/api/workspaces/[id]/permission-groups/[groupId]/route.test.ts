/**
 * @vitest-environment node
 */

import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkWorkspaceAccessMock,
  deleteWhereMock,
  hasWorkspaceAdminAccessMock,
  isWorkspaceOnEnterprisePlanMock,
  selectGroupLimitMock,
} = vi.hoisted(() => ({
  checkWorkspaceAccessMock: vi.fn(),
  deleteWhereMock: vi.fn().mockResolvedValue(undefined),
  hasWorkspaceAdminAccessMock: vi.fn(),
  isWorkspaceOnEnterprisePlanMock: vi.fn(),
  selectGroupLimitMock: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/audit', () => ({
  AuditAction: { PERMISSION_GROUP_DELETED: 'PERMISSION_GROUP_DELETED' },
  AuditResourceType: { PERMISSION_GROUP: 'PERMISSION_GROUP' },
  recordAudit: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    delete: vi.fn(() => ({ where: deleteWhereMock })),
    select: vi.fn(() => createSelectChain(selectGroupLimitMock())),
    transaction: vi.fn(async (callback) =>
      callback({
        delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
      })
    ),
  },
}))

vi.mock('@sim/db/schema', () => ({
  permissionGroup: {
    autoAddNewMembers: 'permissionGroup.autoAddNewMembers',
    config: 'permissionGroup.config',
    createdAt: 'permissionGroup.createdAt',
    createdBy: 'permissionGroup.createdBy',
    description: 'permissionGroup.description',
    id: 'permissionGroup.id',
    name: 'permissionGroup.name',
    updatedAt: 'permissionGroup.updatedAt',
    workspaceId: 'permissionGroup.workspaceId',
  },
  permissionGroupMember: {
    permissionGroupId: 'permissionGroupMember.permissionGroupId',
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
  })),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ kind: 'and', args })),
  eq: vi.fn((left, right) => ({ kind: 'eq', left, right })),
}))

vi.mock('@/lib/api/server', () => ({
  getValidationErrorMessage: vi.fn(() => 'invalid'),
  parseRequest: vi.fn(),
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

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: checkWorkspaceAccessMock,
  hasWorkspaceAdminAccess: hasWorkspaceAdminAccessMock,
}))

import { DELETE } from './route'

describe('DELETE /api/workspaces/[id]/permission-groups/[groupId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkWorkspaceAccessMock.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'owner-1', workspaceMode: 'organization' },
    })
    hasWorkspaceAdminAccessMock.mockResolvedValue(true)
    isWorkspaceOnEnterprisePlanMock.mockResolvedValue(true)
    selectGroupLimitMock.mockReturnValue([
      { id: 'group-1', workspaceId: 'ws-1', name: 'Team Members' },
    ])
  })

  it('rejects permission-group deletion for personal workspaces before admin checks', async () => {
    checkWorkspaceAccessMock.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'owner-1', workspaceMode: 'personal' },
    })

    const response = await DELETE(createMockRequest('DELETE'), {
      params: Promise.resolve({ id: 'ws-1', groupId: 'group-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Personal workspaces do not support permission groups' })
    expect(hasWorkspaceAdminAccessMock).not.toHaveBeenCalled()
  })

  it('hides foreign personal workspaces from permission-group detail routes', async () => {
    checkWorkspaceAccessMock.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await DELETE(createMockRequest('DELETE'), {
      params: Promise.resolve({ id: 'ws-hidden', groupId: 'group-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Workspace not found' })
    expect(hasWorkspaceAdminAccessMock).not.toHaveBeenCalled()
  })
})
