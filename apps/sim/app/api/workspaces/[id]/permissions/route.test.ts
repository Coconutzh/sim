/**
 * @vitest-environment node
 */

import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkWorkspaceAccessMock,
  getSessionMock,
  getUserEntityPermissionsMock,
  getWorkspaceWithOwnerMock,
  getUsersWithPermissionsMock,
  hasWorkspaceAdminAccessMock,
  parseRequestMock,
} = vi.hoisted(() => ({
  checkWorkspaceAccessMock: vi.fn(),
  getSessionMock: vi.fn(),
  getUserEntityPermissionsMock: vi.fn(),
  getWorkspaceWithOwnerMock: vi.fn(),
  getUsersWithPermissionsMock: vi.fn(),
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
  checkWorkspaceAccess: checkWorkspaceAccessMock,
  getUserEntityPermissions: getUserEntityPermissionsMock,
  getWorkspaceWithOwner: getWorkspaceWithOwnerMock,
  getUsersWithPermissions: getUsersWithPermissionsMock,
  hasWorkspaceAdminAccess: hasWorkspaceAdminAccessMock,
}))

import { GET, PATCH } from '@/app/api/workspaces/[id]/permissions/route'

describe('/api/workspaces/[id]/permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbResults.value = []
    getSessionMock.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
    })
    hasWorkspaceAdminAccessMock.mockResolvedValue(true)
    checkWorkspaceAccessMock.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'owner-1', workspaceMode: 'organization' },
    })
    getUserEntityPermissionsMock.mockResolvedValue('admin')
    getWorkspaceWithOwnerMock.mockResolvedValue({
      id: 'ws-1',
      name: 'Workspace',
      ownerId: 'owner-1',
      organizationId: 'org-1',
      workgroupId: null,
      workspaceMode: 'organization',
      billedAccountUserId: 'billing-1',
      archivedAt: null,
    })
    getUsersWithPermissionsMock.mockResolvedValue([
      {
        userId: 'owner-1',
        email: 'owner@example.com',
        name: 'Owner',
        image: null,
        permissionType: 'admin',
        isExternal: false,
      },
    ])
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

  it('rejects reading permissions for personal workspaces', async () => {
    checkWorkspaceAccessMock.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'owner-1', workspaceMode: 'personal' },
    })

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'ws-1' }),
    } as any)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Personal canvases do not expose shared permission settings' })
    expect(getUsersWithPermissionsMock).not.toHaveBeenCalled()
  })

  it('returns 404 when stale personal rows no longer grant workspace permission visibility', async () => {
    checkWorkspaceAccessMock.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-1', ownerId: 'owner-2', workspaceMode: 'personal' },
    })
    hasWorkspaceAdminAccessMock.mockResolvedValueOnce(false)

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'ws-1' }),
    } as any)
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(getUsersWithPermissionsMock).not.toHaveBeenCalled()
    expect(getUserEntityPermissionsMock).not.toHaveBeenCalled()
  })

  it('authenticates reads before validating route params', async () => {
    getSessionMock.mockResolvedValue(null)

    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: '' }),
    } as any)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Authentication required' })
    expect(parseRequestMock).not.toHaveBeenCalled()
  })

  describe('PATCH', () => {
    it('authenticates writes before validating route params', async () => {
      getSessionMock.mockResolvedValue(null)

      const response = await PATCH(createMockRequest('PATCH'), {
        params: Promise.resolve({ id: '' }),
      } as any)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toEqual({ error: 'Authentication required' })
      expect(parseRequestMock).not.toHaveBeenCalled()
    })

    it('rejects permission updates that target the workspace owner', async () => {
      const response = await PATCH(createMockRequest('PATCH'), {
        params: Promise.resolve({ id: 'ws-1' }),
      } as any)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toEqual({ error: 'Cannot modify the canvas owner permissions' })
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
      getWorkspaceWithOwnerMock.mockResolvedValueOnce({
        id: 'ws-1',
        name: 'Personal Workspace',
        ownerId: 'owner-1',
        organizationId: null,
        workgroupId: null,
        workspaceMode: 'personal',
        billedAccountUserId: 'owner-1',
        archivedAt: null,
      })

      const response = await PATCH(createMockRequest('PATCH'), {
        params: Promise.resolve({ id: 'ws-1' }),
      } as any)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toEqual({ error: 'Personal canvases do not support shared members' })
    })

    it('hides foreign personal workspaces when stale admin access no longer grants visibility', async () => {
      checkWorkspaceAccessMock.mockResolvedValueOnce({
        exists: true,
        hasAccess: false,
        canWrite: false,
        workspace: { id: 'ws-1', ownerId: 'owner-2', workspaceMode: 'personal' },
      })
      hasWorkspaceAdminAccessMock.mockResolvedValueOnce(false)

      const response = await PATCH(createMockRequest('PATCH'), {
        params: Promise.resolve({ id: 'ws-1' }),
      } as any)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data).toEqual({ error: 'Canvas not found' })
      expect(parseRequestMock).toHaveBeenCalled()
      expect(getWorkspaceWithOwnerMock).not.toHaveBeenCalled()
    })
  })
})
