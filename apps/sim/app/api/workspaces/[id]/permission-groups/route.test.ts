/**
 * @vitest-environment node
 */

import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkWorkspaceAccessMock,
  hasWorkspaceAdminAccessMock,
  isWorkspaceOnEnterprisePlanMock,
  parseRequestMock,
} = vi.hoisted(() => ({
  checkWorkspaceAccessMock: vi.fn(),
  hasWorkspaceAdminAccessMock: vi.fn(),
  isWorkspaceOnEnterprisePlanMock: vi.fn(),
  parseRequestMock: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { PERMISSION_GROUP_CREATED: 'PERMISSION_GROUP_CREATED' },
  AuditResourceType: { PERMISSION_GROUP: 'PERMISSION_GROUP' },
  recordAudit: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
}))

vi.mock('@sim/db/schema', () => ({
  permissionGroup: {
    autoAddNewMembers: 'permissionGroup.autoAddNewMembers',
    createdAt: 'permissionGroup.createdAt',
    createdBy: 'permissionGroup.createdBy',
    config: 'permissionGroup.config',
    description: 'permissionGroup.description',
    id: 'permissionGroup.id',
    name: 'permissionGroup.name',
    updatedAt: 'permissionGroup.updatedAt',
    workspaceId: 'permissionGroup.workspaceId',
  },
  permissionGroupMember: {
    permissionGroupId: 'permissionGroupMember.permissionGroupId',
  },
  user: {
    email: 'user.email',
    id: 'user.id',
    name: 'user.name',
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
  })),
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn(() => 'generated-id'),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ kind: 'and', args })),
  count: vi.fn(() => ({ kind: 'count' })),
  desc: vi.fn((value) => ({ kind: 'desc', value })),
  eq: vi.fn((left, right) => ({ kind: 'eq', left, right })),
}))

vi.mock('@/lib/api/server', () => ({
  getValidationErrorMessage: vi.fn(() => 'invalid'),
  parseRequest: parseRequestMock,
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

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: checkWorkspaceAccessMock,
  hasWorkspaceAdminAccess: hasWorkspaceAdminAccessMock,
}))

import { POST } from './route'

describe('POST /api/workspaces/[id]/permission-groups', () => {
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
    parseRequestMock.mockResolvedValue({
      success: true,
      data: {
        body: {
          name: 'Team Members',
          description: '',
          config: {},
          autoAddNewMembers: false,
        },
      },
    })
  })

  it('rejects permission group creation for personal workspaces', async () => {
    checkWorkspaceAccessMock.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'owner-1', workspaceMode: 'personal' },
    })

    const response = await POST(createMockRequest('POST'), {
      params: Promise.resolve({ id: 'ws-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Personal workspaces do not support permission groups' })
    expect(hasWorkspaceAdminAccessMock).not.toHaveBeenCalled()
    expect(isWorkspaceOnEnterprisePlanMock).not.toHaveBeenCalled()
  })
})
