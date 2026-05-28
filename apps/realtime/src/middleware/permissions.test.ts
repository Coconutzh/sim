/**
 * Tests for socket server permission middleware.
 *
 * Tests cover:
 * - Role-based operation permissions (admin, write, read)
 * - All socket operations
 * - Edge cases and invalid inputs
 */

import {
  BLOCK_OPERATIONS,
  BLOCKS_OPERATIONS,
  EDGE_OPERATIONS,
  EDGES_OPERATIONS,
  SUBBLOCK_OPERATIONS,
  SUBFLOW_OPERATIONS,
  VARIABLE_OPERATIONS,
  WORKFLOW_OPERATIONS,
} from '@sim/realtime-protocol/constants'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthorizeWorkflowByWorkspacePermission,
  mockDb,
  mockIsAuthDisabled,
  mockResolveCanvasScope,
  mockWorkflowRows,
  schemaMock,
} = vi.hoisted(() => {
  const workflowRows: unknown[] = []
  const envFlags = { isAuthDisabled: false }
  const chain: Record<string, unknown> = {}

  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.limit = vi.fn(() => Promise.resolve(workflowRows.shift() ?? []))

  return {
    mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
    mockDb: {
      select: vi.fn(() => chain),
    },
    mockIsAuthDisabled: envFlags,
    mockResolveCanvasScope: vi.fn(),
    mockWorkflowRows: workflowRows,
    schemaMock: {
      workflow: {
        id: 'workflow.id',
        archivedAt: 'workflow.archivedAt',
        workspaceId: 'workflow.workspaceId',
        name: 'workflow.name',
        track: 'workflow.track',
      },
    },
  }
})

vi.mock('@sim/db', () => ({ db: mockDb }))
vi.mock('@sim/db/schema', () => schemaMock)
vi.mock('@/env', () => ({
  get isAuthDisabled() {
    return mockIsAuthDisabled.isAuthDisabled
  },
}))
vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
  resolveCanvasScope: mockResolveCanvasScope,
}))
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ kind: 'and', args })),
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
  isNull: vi.fn((value: unknown) => ({ kind: 'isNull', value })),
}))

import { checkRolePermission, verifyWorkflowAccess } from '@/middleware/permissions'

const SOCKET_OPERATIONS = [
  ...Object.values(BLOCK_OPERATIONS),
  ...Object.values(BLOCKS_OPERATIONS),
  ...Object.values(EDGE_OPERATIONS),
  ...Object.values(EDGES_OPERATIONS),
  ...Object.values(SUBFLOW_OPERATIONS),
  ...Object.values(WORKFLOW_OPERATIONS),
  ...Object.values(SUBBLOCK_OPERATIONS),
  VARIABLE_OPERATIONS.UPDATE,
] as const

const WRITE_ALLOWED_OPERATIONS = SOCKET_OPERATIONS.filter(
  (operation) => operation !== BLOCKS_OPERATIONS.BATCH_TOGGLE_LOCKED
)

function queueWorkflowRow(workflowId = 'workflow-1', track: 'draft' | 'published' = 'draft') {
  mockWorkflowRows.push([{ workspaceId: 'workspace-1', name: workflowId, track }])
}

function expectPermissionAllowed(result: { allowed: boolean; reason?: string }) {
  expect(result.allowed).toBe(true)
  expect(result.reason).toBeUndefined()
}

function expectPermissionDenied(result: { allowed: boolean; reason?: string }, message?: string) {
  expect(result.allowed).toBe(false)
  if (message) expect(result.reason).toContain(message)
}

describe('checkRolePermission', () => {
  describe('admin role', () => {
    it('should allow all operations for admin role', () => {
      const operations = SOCKET_OPERATIONS

      for (const operation of operations) {
        const result = checkRolePermission('admin', operation)
        expectPermissionAllowed(result)
      }
    })

    it('should allow batch-add-blocks operation', () => {
      const result = checkRolePermission('admin', 'batch-add-blocks')
      expectPermissionAllowed(result)
    })

    it('should allow batch-remove-blocks operation', () => {
      const result = checkRolePermission('admin', 'batch-remove-blocks')
      expectPermissionAllowed(result)
    })

    it('should allow update operation', () => {
      const result = checkRolePermission('admin', 'update')
      expectPermissionAllowed(result)
    })

    it('should allow batch-update-positions operation', () => {
      const result = checkRolePermission('admin', 'batch-update-positions')
      expectPermissionAllowed(result)
    })

    it('should allow replace-state operation', () => {
      const result = checkRolePermission('admin', 'replace-state')
      expectPermissionAllowed(result)
    })

    it('should allow subblock-batch-update operation', () => {
      const result = checkRolePermission('admin', 'subblock-batch-update')
      expectPermissionAllowed(result)
    })
  })

  describe('write role', () => {
    it('should allow write operations except admin-only operations', () => {
      const operations = WRITE_ALLOWED_OPERATIONS

      for (const operation of operations) {
        const result = checkRolePermission('write', operation)
        expectPermissionAllowed(result)
      }
    })

    it('should allow batch-add-blocks operation', () => {
      const result = checkRolePermission('write', 'batch-add-blocks')
      expectPermissionAllowed(result)
    })

    it('should allow batch-remove-blocks operation', () => {
      const result = checkRolePermission('write', 'batch-remove-blocks')
      expectPermissionAllowed(result)
    })

    it('should allow update-position operation', () => {
      const result = checkRolePermission('write', 'update-position')
      expectPermissionAllowed(result)
    })

    it('should allow subblock-batch-update operation', () => {
      const result = checkRolePermission('write', 'subblock-batch-update')
      expectPermissionAllowed(result)
    })
  })

  describe('read role', () => {
    it('should deny update-position for read role', () => {
      const result = checkRolePermission('read', 'update-position')
      expectPermissionDenied(result, 'read')
    })

    it('should deny batch-add-blocks operation for read role', () => {
      const result = checkRolePermission('read', 'batch-add-blocks')
      expectPermissionDenied(result, 'read')
      expectPermissionDenied(result, 'batch-add-blocks')
    })

    it('should deny batch-remove-blocks operation for read role', () => {
      const result = checkRolePermission('read', 'batch-remove-blocks')
      expectPermissionDenied(result, 'read')
    })

    it('should deny update operation for read role', () => {
      const result = checkRolePermission('read', 'update')
      expectPermissionDenied(result, 'read')
    })

    it('should deny batch-update-positions operation for read role', () => {
      const result = checkRolePermission('read', 'batch-update-positions')
      expectPermissionDenied(result, 'read')
    })

    it('should deny replace-state operation for read role', () => {
      const result = checkRolePermission('read', 'replace-state')
      expectPermissionDenied(result, 'read')
    })

    it('should deny subblock-batch-update operation for read role', () => {
      const result = checkRolePermission('read', 'subblock-batch-update')
      expectPermissionDenied(result, 'read')
    })

    it('should deny toggle-enabled operation for read role', () => {
      const result = checkRolePermission('read', 'toggle-enabled')
      expectPermissionDenied(result, 'read')
    })

    it('should deny all write operations for read role', () => {
      for (const operation of SOCKET_OPERATIONS) {
        const result = checkRolePermission('read', operation)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('read')
      }
    })
  })

  describe('unknown role', () => {
    it('should deny all operations for unknown role', () => {
      const operations = SOCKET_OPERATIONS

      for (const operation of operations) {
        const result = checkRolePermission('unknown', operation)
        expectPermissionDenied(result)
      }
    })

    it('should deny operations for empty role', () => {
      const result = checkRolePermission('', 'batch-add-blocks')
      expectPermissionDenied(result)
    })
  })

  describe('unknown operations', () => {
    it('should deny unknown operations for admin', () => {
      const result = checkRolePermission('admin', 'unknown-operation')
      expectPermissionDenied(result, 'admin')
      expectPermissionDenied(result, 'unknown-operation')
    })

    it('should deny unknown operations for write', () => {
      const result = checkRolePermission('write', 'unknown-operation')
      expectPermissionDenied(result)
    })

    it('should deny unknown operations for read', () => {
      const result = checkRolePermission('read', 'unknown-operation')
      expectPermissionDenied(result)
    })

    it('should deny empty operation', () => {
      const result = checkRolePermission('admin', '')
      expectPermissionDenied(result)
    })
  })

  describe('permission hierarchy verification', () => {
    it('should verify admin has one additional lock-management permission over write', () => {
      for (const operation of WRITE_ALLOWED_OPERATIONS) {
        expect(checkRolePermission('admin', operation).allowed).toBe(true)
        expect(checkRolePermission('write', operation).allowed).toBe(true)
      }
      expect(checkRolePermission('admin', BLOCKS_OPERATIONS.BATCH_TOGGLE_LOCKED).allowed).toBe(true)
      expect(checkRolePermission('write', BLOCKS_OPERATIONS.BATCH_TOGGLE_LOCKED).allowed).toBe(
        false
      )
    })

    it('should verify read has no mutation permissions', () => {
      for (const operation of SOCKET_OPERATIONS) {
        expect(checkRolePermission('read', operation).allowed).toBe(false)
      }
    })

    it('should verify read has minimal permissions', () => {
      expect(checkRolePermission('read', 'update-position').allowed).toBe(false)
      expect(checkRolePermission('read', 'batch-update-positions').allowed).toBe(false)
    })
  })

  describe('specific operations', () => {
    const testCases = [
      { operation: 'batch-add-blocks', adminAllowed: true, writeAllowed: true, readAllowed: false },
      {
        operation: 'batch-remove-blocks',
        adminAllowed: true,
        writeAllowed: true,
        readAllowed: false,
      },
      { operation: 'update', adminAllowed: true, writeAllowed: true, readAllowed: false },
      { operation: 'update-position', adminAllowed: true, writeAllowed: true, readAllowed: false },
      { operation: 'update-name', adminAllowed: true, writeAllowed: true, readAllowed: false },
      { operation: 'toggle-enabled', adminAllowed: true, writeAllowed: true, readAllowed: false },
      { operation: 'update-parent', adminAllowed: true, writeAllowed: true, readAllowed: false },
      {
        operation: 'update-canonical-mode',
        adminAllowed: true,
        writeAllowed: true,
        readAllowed: false,
      },
      { operation: 'toggle-handles', adminAllowed: true, writeAllowed: true, readAllowed: false },
      {
        operation: 'batch-toggle-locked',
        adminAllowed: true,
        writeAllowed: false, // Admin-only operation
        readAllowed: false,
      },
      {
        operation: 'batch-update-positions',
        adminAllowed: true,
        writeAllowed: true,
        readAllowed: false,
      },
      { operation: 'replace-state', adminAllowed: true, writeAllowed: true, readAllowed: false },
    ]

    for (const { operation, adminAllowed, writeAllowed, readAllowed } of testCases) {
      it(`should ${adminAllowed ? 'allow' : 'deny'} "${operation}" for admin`, () => {
        const result = checkRolePermission('admin', operation)
        expect(result.allowed).toBe(adminAllowed)
      })

      it(`should ${writeAllowed ? 'allow' : 'deny'} "${operation}" for write`, () => {
        const result = checkRolePermission('write', operation)
        expect(result.allowed).toBe(writeAllowed)
      })

      it(`should ${readAllowed ? 'allow' : 'deny'} "${operation}" for read`, () => {
        const result = checkRolePermission('read', operation)
        expect(result.allowed).toBe(readAllowed)
      })
    }
  })

  describe('reason messages', () => {
    it('should include role in denial reason', () => {
      const result = checkRolePermission('read', 'batch-add-blocks')
      expect(result.reason).toContain("'read'")
    })

    it('should include operation in denial reason', () => {
      const result = checkRolePermission('read', 'batch-add-blocks')
      expect(result.reason).toContain("'batch-add-blocks'")
    })

    it('should have descriptive denial message format', () => {
      const result = checkRolePermission('read', 'remove')
      expect(result.reason).toMatch(/Role '.*' not permitted to perform '.*'/)
    })
  })
})

describe('verifyWorkflowAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowRows.length = 0
    mockIsAuthDisabled.isAuthDisabled = false
    mockResolveCanvasScope.mockReturnValue('team')
  })

  it('bypasses workspace permission checks when auth is disabled', async () => {
    queueWorkflowRow('local-workflow')
    mockIsAuthDisabled.isAuthDisabled = true

    await expect(verifyWorkflowAccess('anonymous-user', 'local-workflow')).resolves.toEqual({
      hasAccess: true,
      role: 'admin',
      workspaceId: 'workspace-1',
      canvasScope: 'team',
    })

    expect(mockAuthorizeWorkflowByWorkspacePermission).not.toHaveBeenCalled()
    expect(mockResolveCanvasScope).not.toHaveBeenCalled()
  })

  it('denies personal draft room access when the caller is not the owner', async () => {
    queueWorkflowRow('personal-workflow')
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      workspacePermission: null,
      accessSource: null,
      workspaceMode: 'personal',
    })

    await expect(verifyWorkflowAccess('other-user', 'personal-workflow')).resolves.toEqual({
      hasAccess: false,
    })
    expect(mockResolveCanvasScope).not.toHaveBeenCalled()
  })

  it('denies team canvas room access when the caller is not a workgroup member', async () => {
    queueWorkflowRow('team-workflow')
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: false,
      status: 403,
      message: 'Unauthorized: Access denied to read this workflow',
      workspacePermission: null,
      accessSource: null,
      workspaceMode: 'organization',
      workspaceWorkgroupId: 'workgroup-1',
    })

    await expect(verifyWorkflowAccess('outsider-user', 'team-workflow')).resolves.toEqual({
      hasAccess: false,
    })
  })

  it('keeps showcase room joins read-only for visible cross-team publications', async () => {
    queueWorkflowRow('showcase-workflow', 'published')
    mockResolveCanvasScope.mockReturnValue('showcase')
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      workspacePermission: 'write',
      accessSource: 'selected_workgroups',
      workspaceMode: 'organization',
      workspaceWorkgroupId: 'publisher-workgroup',
    })

    await expect(verifyWorkflowAccess('viewer-user', 'showcase-workflow')).resolves.toEqual({
      hasAccess: true,
      role: 'read',
      workspaceId: 'workspace-1',
      canvasScope: 'showcase',
    })
    expect(checkRolePermission('read', BLOCK_OPERATIONS.UPDATE_POSITION).allowed).toBe(false)
  })

  it('keeps source team published workflow joins read-only', async () => {
    queueWorkflowRow('published-workflow', 'published')
    mockResolveCanvasScope.mockReturnValue('showcase')
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      workspacePermission: 'admin',
      accessSource: 'workspace',
      workspaceMode: 'organization',
      workspaceWorkgroupId: 'publisher-workgroup',
    })

    await expect(verifyWorkflowAccess('publisher-admin', 'published-workflow')).resolves.toEqual({
      hasAccess: true,
      role: 'read',
      workspaceId: 'workspace-1',
      canvasScope: 'showcase',
    })
    expect(mockResolveCanvasScope).toHaveBeenCalledWith(
      expect.objectContaining({ workflowTrack: 'published' })
    )
    expect(checkRolePermission('read', BLOCK_OPERATIONS.UPDATE_POSITION).allowed).toBe(false)
  })

  it('returns the workspace write role for team canvas members', async () => {
    queueWorkflowRow('team-workflow')
    mockResolveCanvasScope.mockReturnValue('team')
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      workspacePermission: 'write',
      accessSource: 'workspace',
      workspaceMode: 'organization',
      workspaceWorkgroupId: 'workgroup-1',
    })

    await expect(verifyWorkflowAccess('member-user', 'team-workflow')).resolves.toEqual({
      hasAccess: true,
      role: 'write',
      workspaceId: 'workspace-1',
      canvasScope: 'team',
    })
  })
})
