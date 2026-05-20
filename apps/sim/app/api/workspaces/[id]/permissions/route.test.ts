/**
 * @vitest-environment node
 */

import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, hasWorkspaceAdminAccessMock, parseRequestMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  hasWorkspaceAdminAccessMock: vi.fn(),
  parseRequestMock: vi.fn(),
}))

const mockDbResults = vi.hoisted(() => ({ value: [] as unknown[] }))

function createChain() {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(mockDbResults.value.shift() || []))
  return chain
}

vi.mock('@sim/audit', () => ({
  AuditAction: { MEMBER_ROLE_CHANGED: 'MEMBER_ROLE_CHANGED' },
  AuditResourceType: { WORKSPACE: 'WORKSPACE' },
  recordAudit: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => createChain()),
    transaction: vi.fn(),
  },
}))

vi.mock('@sim/db/schema', () => ({
  permissions: {
    createdAt: 'permissions.createdAt',
    entityId: 'permissions.entityId',
    entityType: 'permissions.entityType',
    permissionType: 'permissions.permissionType',
    updatedAt: 'permissions.updatedAt',
    userId: 'permissions.userId',
  },
  user: {
    email: 'user.email',
    id: 'user.id',
  },
  workspace: {
    billedAccountUserId: 'workspace.billedAccountUserId',
    id: 'workspace.id',
    ownerId: 'workspace.ownerId',
  },
  workspaceEnvironment: {
    variables: 'workspaceEnvironment.variables',
    workspaceId: 'workspaceEnvironment.workspaceId',
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
  })),
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn(() => 'generated-id'),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ kind: 'and', args })),
  eq: vi.fn((left, right) => ({ kind: 'eq', left, right })),
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: parseRequestMock,
}))

vi.mock('@/lib/auth', () => ({
  getSession: getSessionMock,
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))

vi.mock('@/lib/credentials/environment', () => ({
  syncWorkspaceEnvCredentials: vi.fn(),
}))

vi.mock('@/lib/permission-groups/auto-add', () => ({
  applyWorkspaceAutoAddGroup: vi.fn(),
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: vi.fn(),
  getUserEntityPermissions: vi.fn(),
  getUsersWithPermissions: vi.fn(),
  hasWorkspaceAdminAccess: hasWorkspaceAdminAccessMock,
}))

import { PATCH } from './route'

describe('PATCH /api/workspaces/[id]/permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbResults.value = []
    getSessionMock.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
    })
    hasWorkspaceAdminAccessMock.mockResolvedValue(true)
    parseRequestMock.mockResolvedValue({
      success: true,
      data: {
        body: {
          updates: [{ userId: 'owner-1', permissions: 'read' }],
        },
        params: { id: 'ws-1' },
      },
    })
  })

  it('rejects permission updates that target the workspace owner', async () => {
    mockDbResults.value = [[{ billedAccountUserId: 'billing-1', ownerId: 'owner-1' }]]

    const response = await PATCH(createMockRequest('PATCH'), {
      params: Promise.resolve({ id: 'ws-1' }),
    } as any)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Cannot modify the workspace owner permissions' })
  })

  it('rejects permission updates for personal workspaces', async () => {
    parseRequestMock.mockResolvedValueOnce({
      success: true,
      data: {
        body: {
          updates: [{ userId: 'member-1', permissions: 'read' }],
        },
        params: { id: 'ws-1' },
      },
    })
    mockDbResults.value = [
      [{ billedAccountUserId: 'owner-1', ownerId: 'owner-1', workspaceMode: 'personal' }],
    ]

    const response = await PATCH(createMockRequest('PATCH'), {
      params: Promise.resolve({ id: 'ws-1' }),
    } as any)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Personal workspaces do not support shared members' })
  })
})
