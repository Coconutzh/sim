/**
 * @vitest-environment node
 */

import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  captureServerEventMock,
  deleteWhereMock,
  getSessionMock,
  hasWorkspaceAdminAccessMock,
  parseRequestMock,
  recordAuditMock,
  revokeWorkspaceCredentialMembershipsTxMock,
  transactionMock,
} = vi.hoisted(() => ({
  captureServerEventMock: vi.fn(),
  deleteWhereMock: vi.fn().mockResolvedValue(undefined),
  getSessionMock: vi.fn(),
  hasWorkspaceAdminAccessMock: vi.fn(),
  parseRequestMock: vi.fn(),
  recordAuditMock: vi.fn(),
  revokeWorkspaceCredentialMembershipsTxMock: vi.fn().mockResolvedValue(undefined),
  transactionMock: vi.fn(),
}))

const mockDbResults = vi.hoisted(() => ({ value: [] as unknown[] }))

function createChain() {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(mockDbResults.value.shift() || []))
  ;(chain as any).then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(resolve(mockDbResults.value.shift() || []))
  return chain
}

vi.mock('@sim/audit', () => ({
  AuditAction: { MEMBER_REMOVED: 'MEMBER_REMOVED' },
  AuditResourceType: { WORKSPACE: 'WORKSPACE' },
  recordAudit: recordAuditMock,
}))

vi.mock('@sim/db', () => ({
  db: {
    delete: vi.fn(() => ({ where: deleteWhereMock })),
    select: vi.fn(() => createChain()),
    transaction: transactionMock,
  },
}))

vi.mock('@sim/db/schema', () => ({
  permissionGroupMember: {
    userId: 'permissionGroupMember.userId',
    workspaceId: 'permissionGroupMember.workspaceId',
  },
  permissions: {
    entityId: 'permissions.entityId',
    id: 'permissions.id',
    permissionType: 'permissions.permissionType',
    userId: 'permissions.userId',
  },
  workspace: {
    billedAccountUserId: 'workspace.billedAccountUserId',
    id: 'workspace.id',
    ownerId: 'workspace.ownerId',
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

vi.mock('@/lib/credentials/access', () => ({
  revokeWorkspaceCredentialMembershipsTx: revokeWorkspaceCredentialMembershipsTxMock,
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: captureServerEventMock,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  hasWorkspaceAdminAccess: hasWorkspaceAdminAccessMock,
}))

import { DELETE } from './route'

describe('DELETE /api/workspaces/members/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbResults.value = []
    getSessionMock.mockResolvedValue({
      user: { id: 'member-1', email: 'member@example.com', name: 'Member' },
    })
    parseRequestMock.mockResolvedValue({
      success: true,
      data: {
        params: { id: 'member-1' },
        body: { workspaceId: 'ws-1' },
      },
    })
    hasWorkspaceAdminAccessMock.mockResolvedValue(true)
    transactionMock.mockImplementation(async (callback) =>
      callback({
        delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
        insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
        select: vi.fn(() => createChain()),
        update: vi.fn(() => ({
          set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
        })),
      })
    )
  })

  it('allows an admin to leave when the only other admin is an owner-only workspace owner', async () => {
    mockDbResults.value = [
      [{ ownerId: 'owner-1', billedAccountUserId: 'owner-1', workspaceMode: 'organization' }],
      [{ permissionType: 'admin' }],
      [],
    ]

    const response = await DELETE(createMockRequest('DELETE'), {
      params: Promise.resolve({ id: 'member-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ success: true })
    expect(transactionMock).toHaveBeenCalled()
    expect(recordAuditMock).toHaveBeenCalled()
  })

  it('rejects member removal for personal workspaces', async () => {
    mockDbResults.value = [
      [{ ownerId: 'owner-1', billedAccountUserId: 'owner-1', workspaceMode: 'personal' }],
    ]

    const response = await DELETE(createMockRequest('DELETE'), {
      params: Promise.resolve({ id: 'member-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Personal workspaces do not support shared members' })
    expect(transactionMock).not.toHaveBeenCalled()
    expect(recordAuditMock).not.toHaveBeenCalled()
  })
})
