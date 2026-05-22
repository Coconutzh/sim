/**
 * Integration tests for workflow by ID API route
 * Tests the new centralized permissions system
 *
 * @vitest-environment node
 */

import {
  auditMock,
  envMock,
  hybridAuthMockFns,
  telemetryMock,
  workflowAuthzMockFns,
  workflowsOrchestrationMock,
  workflowsOrchestrationMockFns,
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLoadWorkflowFromNormalizedTables =
  workflowsPersistenceUtilsMockFns.mockLoadWorkflowFromNormalizedTables
const mockGetWorkflowById = workflowsUtilsMockFns.mockGetWorkflowById
const mockGetActiveFolderInWorkspace = workflowsUtilsMockFns.mockGetActiveFolderInWorkspace
const mockAuthorizeWorkflowByWorkspacePermission =
  workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission
const mockPerformDeleteWorkflow = workflowsOrchestrationMockFns.mockPerformDeleteWorkflow

const { mockDbUpdate, mockDbSelect, mockDbTransaction } = vi.hoisted(() => ({
  mockDbUpdate: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbTransaction: vi.fn(),
}))

/**
 * Helper to set mock auth state consistently across getSession and hybrid auth.
 */
function mockGetSession(session: { user: { id: string } } | null) {
  if (session) {
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValue({
      success: true,
      userId: session.user.id,
    })
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: session.user.id,
    })
  } else {
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValue({ success: false })
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({ success: false })
  }
}

function createThrowingWorkflowParams(): Promise<{ id: string }> {
  return {
    then: () => {
      throw new Error('Route params should not be read before auth')
    },
  } as unknown as Promise<{ id: string }>
}

vi.mock('@/lib/core/config/env', () => envMock)

vi.mock('@/lib/core/telemetry', () => telemetryMock)

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)

vi.mock('@sim/db', () => ({
  db: {
    update: () => mockDbUpdate(),
    select: () => mockDbSelect(),
    transaction: mockDbTransaction,
  },
  workflow: {},
}))

import { DELETE, GET, PUT } from './route'

describe('Workflow By ID API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-request-id-12345678'),
    })

    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(null)
    mockGetActiveFolderInWorkspace.mockResolvedValue({
      id: 'folder-2',
      workspaceId: 'workspace-456',
      parentId: null,
    })
    mockDbTransaction.mockImplementation(async (callback) =>
      callback({
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      })
    )
  })

  describe('GET /api/workflows/[id]', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockGetSession(null)

      const req = new NextRequest('http://localhost:3000/api/workflows/')
      const params = createThrowingWorkflowParams()

      const response = await GET(req, { params })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
      expect(mockGetWorkflowById).not.toHaveBeenCalled()
      expect(mockAuthorizeWorkflowByWorkspacePermission).not.toHaveBeenCalled()
    })

    it('should return 404 when workflow does not exist', async () => {
      mockGetSession({ user: { id: 'user-123' } })

      mockGetWorkflowById.mockResolvedValue(null)

      const req = new NextRequest('http://localhost:3000/api/workflows/nonexistent')
      const params = Promise.resolve({ id: 'nonexistent' })

      const response = await GET(req, { params })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Workflow not found')
    })

    it.concurrent('should allow access when user has admin workspace permission', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      const mockNormalizedData = {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        isFromNormalizedTables: true,
      }

      mockGetSession({ user: { id: 'user-123' } })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'admin',
      })

      mockLoadWorkflowFromNormalizedTables.mockResolvedValue(mockNormalizedData)

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.data.id).toBe('workflow-123')
    })

    it.concurrent('should allow access when user has workspace permissions', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      const mockNormalizedData = {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        isFromNormalizedTables: true,
      }

      mockGetSession({ user: { id: 'user-123' } })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'read',
      })

      mockLoadWorkflowFromNormalizedTables.mockResolvedValue(mockNormalizedData)

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.data.id).toBe('workflow-123')
    })

    it('should deny access when user has no workspace permissions', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      mockGetSession({ user: { id: 'user-123' } })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: false,
        status: 403,
        message: 'Unauthorized: Access denied to read this workflow',
        workflow: mockWorkflow,
        workspacePermission: null,
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized: Access denied to read this workflow')
    })

    it('hides foreign personal workflows behind 404 on read', async () => {
      const mockWorkflow = {
        id: 'workflow-hidden',
        userId: 'owner-2',
        name: 'Hidden Workflow',
        workspaceId: 'workspace-hidden',
      }

      mockGetSession({ user: { id: 'user-123' } })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: false,
        status: 404,
        message: 'Workflow not found',
        workflow: mockWorkflow,
        workspacePermission: null,
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-hidden')
      const params = Promise.resolve({ id: 'workflow-hidden' })

      const response = await GET(req, { params })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Workflow not found')
    })

    it.concurrent('should use normalized tables when available', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      const mockNormalizedData = {
        blocks: { 'block-1': { id: 'block-1', type: 'starter' } },
        edges: [{ id: 'edge-1', source: 'block-1', target: 'block-2' }],
        loops: {},
        parallels: {},
        isFromNormalizedTables: true,
      }

      mockGetSession({ user: { id: 'user-123' } })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'admin',
      })

      mockLoadWorkflowFromNormalizedTables.mockResolvedValue(mockNormalizedData)

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.data.state.blocks).toEqual(mockNormalizedData.blocks)
      expect(data.data.state.edges).toEqual(mockNormalizedData.edges)
      expect(data.data.state.metadata).toEqual({
        name: 'Test Workflow',
        description: undefined,
        accessScope: 'workspace',
      })
    })

    it('returns a sanitized summary for cross-team published readers', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'owner-123',
        name: 'Published Workflow',
        workspaceId: 'workspace-456',
        folderId: 'folder-1',
        sortOrder: 9,
        description: 'Internal notes',
        color: '#334455',
        track: 'published',
        visibility: 'selected_workgroups',
        sourceWorkflowId: 'draft-1',
        publishedAt: new Date('2026-05-21T00:00:00Z'),
        publishedBy: 'owner-123',
        lastSynced: new Date('2026-05-22T00:00:00Z'),
        createdAt: new Date('2026-05-10T00:00:00Z'),
        updatedAt: new Date('2026-05-23T00:00:00Z'),
        isDeployed: true,
        deployedAt: new Date('2026-05-20T00:00:00Z'),
        isPublicApi: true,
        locked: true,
        runCount: 42,
        lastRunAt: new Date('2026-05-23T08:00:00Z'),
        archivedAt: null,
        variables: {
          'var-1': { id: 'var-1', name: 'secret', type: 'string', value: 'hidden' },
        },
      }

      const mockNormalizedData = {
        blocks: {
          'block-1': {
            id: 'block-1',
            type: 'http',
            name: 'Fetch leads',
            position: { x: 120, y: 240 },
            subBlocks: {
              token: { id: 'token', type: 'short-input', value: 'secret-token' },
            },
            outputs: {
              body: { ok: true },
            },
            enabled: true,
          },
        },
        edges: [{ id: 'edge-1', source: 'block-1', target: 'block-2' }],
        loops: {
          'loop-1': { id: 'loop-1', nodes: ['block-1'], iterations: 2, loopType: 'for' },
        },
        parallels: {
          'parallel-1': { id: 'parallel-1', nodes: ['block-1'], count: 3, parallelType: 'count' },
        },
        isFromNormalizedTables: true,
      }

      mockGetSession({ user: { id: 'viewer-123' } })
      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'read',
        accessSource: 'selected_workgroups',
      })
      mockLoadWorkflowFromNormalizedTables.mockResolvedValue(mockNormalizedData)

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.data.workspaceId).toBeNull()
      expect(data.data.userId).toBe('')
      expect(data.data.folderId).toBeNull()
      expect(data.data.sourceWorkflowId).toBeNull()
      expect(data.data.publishedBy).toBeNull()
      expect(data.data.isPublicApi).toBe(false)
      expect(data.data.locked).toBe(true)
      expect(data.data.runCount).toBe(0)
      expect(data.data.variables).toEqual({})
      expect(data.data.state.blocks).toEqual({
        'published-block-1': {
          id: 'published-block-1',
          type: 'http',
          name: 'Fetch leads',
          position: { x: 120, y: 240 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        },
      })
      expect(data.data.state.edges).toEqual([
        { id: 'published-edge-1', source: 'published', target: 'workflow-123' },
      ])
      expect(data.data.state.metadata).toEqual({
        name: 'Published Workflow',
        description: 'Internal notes',
        accessScope: 'published_summary',
      })
    })
  })

  describe('DELETE /api/workflows/[id]', () => {
    it('should return 401 before reading route params when user is not authenticated', async () => {
      mockGetSession(null)

      const req = new NextRequest('http://localhost:3000/api/workflows/', {
        method: 'DELETE',
      })
      const params = createThrowingWorkflowParams()

      const response = await DELETE(req, { params })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
      expect(mockAuthorizeWorkflowByWorkspacePermission).not.toHaveBeenCalled()
      expect(mockPerformDeleteWorkflow).not.toHaveBeenCalled()
    })

    it('should allow admin to delete workflow', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      mockGetSession({ user: { id: 'user-123' } })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'admin',
      })

      mockPerformDeleteWorkflow.mockResolvedValue({ success: true })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'DELETE',
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await DELETE(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(mockPerformDeleteWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'workflow-123',
          userId: 'user-123',
        })
      )
    })

    it('should allow admin to delete workspace workflow', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      mockGetSession({ user: { id: 'user-123' } })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'admin',
      })

      mockPerformDeleteWorkflow.mockResolvedValue({ success: true })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'DELETE',
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await DELETE(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
    })

    it('should prevent deletion of the last workflow in workspace', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      mockGetSession({ user: { id: 'user-123' } })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'admin',
      })

      mockPerformDeleteWorkflow.mockResolvedValue({
        success: false,
        error: 'Cannot delete the only workflow in the workspace',
        errorCode: 'validation',
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'DELETE',
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await DELETE(req, { params })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Cannot delete the only workflow in the workspace')
    })

    it.concurrent('should deny deletion for non-admin users', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      mockGetSession({ user: { id: 'user-123' } })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: false,
        status: 403,
        message: 'Unauthorized: Access denied to admin this workflow',
        workflow: mockWorkflow,
        workspacePermission: null,
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'DELETE',
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await DELETE(req, { params })

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized: Access denied to admin this workflow')
    })

    it('hides foreign personal workflows behind 404 on delete', async () => {
      const mockWorkflow = {
        id: 'workflow-hidden',
        userId: 'owner-2',
        name: 'Hidden Workflow',
        workspaceId: 'workspace-hidden',
      }

      mockGetSession({ user: { id: 'user-123' } })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: false,
        status: 404,
        message: 'Workflow not found',
        workflow: mockWorkflow,
        workspacePermission: null,
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-hidden', {
        method: 'DELETE',
      })
      const params = Promise.resolve({ id: 'workflow-hidden' })

      const response = await DELETE(req, { params })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Workflow not found')
      expect(mockPerformDeleteWorkflow).not.toHaveBeenCalled()
    })

    it('should reject deletion via cross-team published access', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'owner-123',
        name: 'Published Workflow',
        workspaceId: 'workspace-456',
      }

      mockGetSession({ user: { id: 'viewer-123' } })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'admin',
        accessSource: 'selected_workgroups',
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'DELETE',
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await DELETE(req, { params })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe(
        'Cross-team published workflow access does not include workflow deletion'
      )
      expect(mockPerformDeleteWorkflow).not.toHaveBeenCalled()
    })
  })

  describe('PUT /api/workflows/[id]', () => {
    function mockDuplicateCheck(results: Array<{ id: string }> = []) {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(results),
          }),
        }),
      })
    }

    it('should return 401 before reading route params when user is not authenticated', async () => {
      mockGetSession(null)

      const req = new NextRequest('http://localhost:3000/api/workflows/', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Updated Workflow' }),
      })
      const params = createThrowingWorkflowParams()

      const response = await PUT(req, { params })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
      expect(mockAuthorizeWorkflowByWorkspacePermission).not.toHaveBeenCalled()
      expect(mockDbUpdate).not.toHaveBeenCalled()
    })

    it('should allow user with write permission to update workflow', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      const updateData = { name: 'Updated Workflow' }
      const updatedWorkflow = { ...mockWorkflow, ...updateData, updatedAt: new Date() }

      mockGetSession({ user: { id: 'user-123' } })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'write',
      })

      mockDuplicateCheck([])

      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedWorkflow]),
          }),
        }),
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify(updateData),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.workflow.name).toBe('Updated Workflow')
    })

    it('should allow users with write permission to update workflow', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      const updateData = { name: 'Updated Workflow' }
      const updatedWorkflow = { ...mockWorkflow, ...updateData, updatedAt: new Date() }

      mockGetSession({ user: { id: 'user-123' } })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'write',
      })

      mockDuplicateCheck([])

      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedWorkflow]),
          }),
        }),
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify(updateData),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.workflow.name).toBe('Updated Workflow')
    })

    it('should deny update for users with only read permission', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      const updateData = { name: 'Updated Workflow' }

      mockGetSession({ user: { id: 'user-123' } })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: false,
        status: 403,
        message: 'Unauthorized: Access denied to write this workflow',
        workflow: mockWorkflow,
        workspacePermission: 'read',
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify(updateData),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized: Access denied to write this workflow')
    })

    it('hides foreign personal workflows behind 404 on update', async () => {
      const mockWorkflow = {
        id: 'workflow-hidden',
        userId: 'owner-2',
        name: 'Hidden Workflow',
        workspaceId: 'workspace-hidden',
      }

      mockGetSession({ user: { id: 'user-123' } })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: false,
        status: 404,
        message: 'Workflow not found',
        workflow: mockWorkflow,
        workspacePermission: null,
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-hidden', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Updated Workflow' }),
      })
      const params = Promise.resolve({ id: 'workflow-hidden' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Workflow not found')
      expect(mockDbUpdate).not.toHaveBeenCalled()
    })

    it('should reject updates via cross-team published access', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'owner-123',
        name: 'Published Workflow',
        workspaceId: 'workspace-456',
      }

      mockGetSession({ user: { id: 'viewer-123' } })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'write',
        accessSource: 'selected_workgroups',
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Updated Workflow' }),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await PUT(req, { params })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe(
        'Cross-team published workflow access does not include workflow updates'
      )
      expect(mockDbUpdate).not.toHaveBeenCalled()
    })

    it('should reject cross-team visibility updates for workflows without a workgroup', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      mockGetSession({ user: { id: 'user-123' } })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'write',
        workspaceWorkgroupId: null,
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify({ visibility: 'organization' }),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await PUT(req, { params })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe(
        'Only organization team workspaces with a workgroup can publish across teams'
      )
    })

    it('should reject cross-team visibility updates for personal workspaces even with a workgroup', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      mockGetSession({ user: { id: 'user-123' } })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'write',
        workspaceWorkgroupId: 'wg-1',
        workspaceMode: 'personal',
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify({ visibility: 'organization' }),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await PUT(req, { params })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe(
        'Only organization team workspaces with a workgroup can publish across teams'
      )
    })

    it.concurrent('should validate request data', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      mockGetSession({ user: { id: 'user-123' } })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'write',
      })

      const invalidData = { name: '' }

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify(invalidData),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Validation error')
    })

    it('should reject rename when duplicate name exists in same folder', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Original Name',
        folderId: 'folder-1',
        workspaceId: 'workspace-456',
      }

      mockGetSession({ user: { id: 'user-123' } })
      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'write',
      })

      mockDuplicateCheck([{ id: 'workflow-other' }])

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Duplicate Name' }),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(409)
      const data = await response.json()
      expect(data.error).toBe('A workflow named "Duplicate Name" already exists in this folder')
    })

    it('should reject rename when duplicate name exists at root level', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Original Name',
        folderId: null,
        workspaceId: 'workspace-456',
      }

      mockGetSession({ user: { id: 'user-123' } })
      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'write',
      })

      mockDuplicateCheck([{ id: 'workflow-other' }])

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Duplicate Name' }),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(409)
      const data = await response.json()
      expect(data.error).toBe('A workflow named "Duplicate Name" already exists in this folder')
    })

    it('should allow rename when no duplicate exists in same folder', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Original Name',
        folderId: 'folder-1',
        workspaceId: 'workspace-456',
      }

      const updatedWorkflow = { ...mockWorkflow, name: 'Unique Name', updatedAt: new Date() }

      mockGetSession({ user: { id: 'user-123' } })
      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'write',
      })

      mockDuplicateCheck([])

      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedWorkflow]),
          }),
        }),
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Unique Name' }),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.workflow.name).toBe('Unique Name')
    })

    it('should allow same name in different folders', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'My Workflow',
        folderId: 'folder-1',
        workspaceId: 'workspace-456',
      }

      const updatedWorkflow = { ...mockWorkflow, folderId: 'folder-2', updatedAt: new Date() }

      mockGetSession({ user: { id: 'user-123' } })
      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'write',
      })

      // No duplicate in target folder
      mockDuplicateCheck([])

      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedWorkflow]),
          }),
        }),
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify({ folderId: 'folder-2' }),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.workflow.folderId).toBe('folder-2')
      expect(mockGetActiveFolderInWorkspace).toHaveBeenCalledWith('folder-2', 'workspace-456')
    })

    it('should reject moving to a folder outside the workflow workspace', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'My Workflow',
        folderId: 'folder-1',
        workspaceId: 'workspace-456',
      }

      mockGetSession({ user: { id: 'user-123' } })
      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'write',
      })
      mockGetActiveFolderInWorkspace.mockResolvedValueOnce(null)

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify({ folderId: 'foreign-folder' }),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await PUT(req, { params })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Folder not found')
      expect(mockDbUpdate).not.toHaveBeenCalled()
    })

    it('should reject moving to a folder where same name already exists', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'My Workflow',
        folderId: 'folder-1',
        workspaceId: 'workspace-456',
      }

      mockGetSession({ user: { id: 'user-123' } })
      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'write',
      })

      // Duplicate exists in target folder
      mockDuplicateCheck([{ id: 'workflow-other' }])

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify({ folderId: 'folder-2' }),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(409)
      const data = await response.json()
      expect(data.error).toBe('A workflow named "My Workflow" already exists in this folder')
    })

    it('should skip duplicate check when only updating non-name/non-folder fields', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      const updatedWorkflow = { ...mockWorkflow, color: '#FF0000', updatedAt: new Date() }

      mockGetSession({ user: { id: 'user-123' } })
      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'write',
      })

      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedWorkflow]),
          }),
        }),
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify({ color: '#FF0000' }),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(200)
      // db.select should NOT have been called since no name/folder change
      expect(mockDbSelect).not.toHaveBeenCalled()
    })
  })

  describe('Error handling', () => {
    it.concurrent('should handle database errors gracefully', async () => {
      mockGetSession({ user: { id: 'user-123' } })

      mockGetWorkflowById.mockRejectedValue(new Error('Database connection timeout'))

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBe('Internal server error')
    })
  })
})
