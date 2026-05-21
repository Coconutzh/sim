/**
 * @vitest-environment node
 */
import { permissionsMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthorizeWorkflowByWorkspacePermission } = vi.hoisted(() => ({
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { createPermissionError, verifyWorkflowAccess } from '@/lib/copilot/auth/permissions'

describe('Copilot Auth Permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      workflow: null,
      workspacePermission: null,
      accessSource: null,
    })
  })

  describe('verifyWorkflowAccess', () => {
    it('should return no access for non-existent workflow', async () => {
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: false,
        status: 404,
        message: 'Workflow not found',
        workflow: null,
        workspacePermission: null,
        accessSource: null,
      })

      const result = await verifyWorkflowAccess('user-123', 'non-existent-workflow')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
      })
    })

    it('should check workspace permissions for workflow with workspace', async () => {
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: true,
        status: 200,
        workflow: { workspaceId: 'workspace-456' },
        workspacePermission: 'write',
        accessSource: 'workspace',
      })

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: true,
        userPermission: 'write',
        workspaceId: 'workspace-456',
      })

      expect(mockAuthorizeWorkflowByWorkspacePermission).toHaveBeenCalledWith({
        action: 'read',
        userId: 'user-123',
        workflowId: 'workflow-789',
      })
    })

    it('should return read permission through workspace', async () => {
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: true,
        status: 200,
        workflow: { workspaceId: 'workspace-456' },
        workspacePermission: 'read',
        accessSource: 'workspace',
      })

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: true,
        userPermission: 'read',
        workspaceId: 'workspace-456',
      })
    })

    it('should return admin permission through workspace', async () => {
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: true,
        status: 200,
        workflow: { workspaceId: 'workspace-456' },
        workspacePermission: 'admin',
        accessSource: 'workspace',
      })

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: true,
        userPermission: 'admin',
        workspaceId: 'workspace-456',
      })
    })

    it('should return no access without workspace permissions', async () => {
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: false,
        status: 403,
        message: 'Access denied',
        workflow: { workspaceId: 'workspace-456' },
        workspacePermission: null,
        accessSource: null,
      })

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
        workspaceId: 'workspace-456',
      })
    })

    it('should return no access for workflow without workspace', async () => {
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: false,
        status: 403,
        message: 'Personal workflows are deprecated',
        workflow: { workspaceId: null },
        workspacePermission: null,
        accessSource: null,
      })

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
        workspaceId: undefined,
      })
    })

    it('should handle database errors gracefully', async () => {
      mockAuthorizeWorkflowByWorkspacePermission.mockRejectedValueOnce(
        new Error('Database connection failed')
      )

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
      })
    })

    it('should handle permission check errors gracefully', async () => {
      mockAuthorizeWorkflowByWorkspacePermission.mockRejectedValueOnce(
        new Error('Permission check failed')
      )

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
      })
    })

    it('hides foreign personal workflows behind missing access metadata', async () => {
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: false,
        status: 404,
        message: 'Workflow not found',
        workflow: { workspaceId: 'ws-hidden' },
        workspacePermission: null,
        accessSource: null,
      })

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
      })
    })
  })

  describe('createPermissionError', () => {
    it('should create a permission error message for edit operation', () => {
      const result = createPermissionError('edit')
      expect(result).toBe('Access denied: You do not have permission to edit this workflow')
    })

    it('should create a permission error message for view operation', () => {
      const result = createPermissionError('view')
      expect(result).toBe('Access denied: You do not have permission to view this workflow')
    })

    it('should create a permission error message for delete operation', () => {
      const result = createPermissionError('delete')
      expect(result).toBe('Access denied: You do not have permission to delete this workflow')
    })

    it('should create a permission error message for deploy operation', () => {
      const result = createPermissionError('deploy')
      expect(result).toBe('Access denied: You do not have permission to deploy this workflow')
    })

    it('should create a permission error message for custom operation', () => {
      const result = createPermissionError('modify settings of')
      expect(result).toBe(
        'Access denied: You do not have permission to modify settings of this workflow'
      )
    })
  })
})
