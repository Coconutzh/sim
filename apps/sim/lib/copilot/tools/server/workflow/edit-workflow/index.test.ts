/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthorizeWorkflowByWorkspacePermission,
  mockLoadWorkflowFromNormalizedTables,
  mockSaveWorkflowToNormalizedTables,
  mockValidateWorkflowState,
  mockApplyOperationsToWorkflowState,
  mockGetUserPermissionConfig,
  mockPreValidateCredentialInputs,
  mockValidateWorkflowSelectorIds,
  mockExtractAndPersistCustomTools,
  mockNormalizeWorkflowState,
  mockDbUpdateWhere,
} = vi.hoisted(() => ({
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockLoadWorkflowFromNormalizedTables: vi.fn(),
  mockSaveWorkflowToNormalizedTables: vi.fn(),
  mockValidateWorkflowState: vi.fn(),
  mockApplyOperationsToWorkflowState: vi.fn(),
  mockGetUserPermissionConfig: vi.fn(),
  mockPreValidateCredentialInputs: vi.fn(),
  mockValidateWorkflowSelectorIds: vi.fn(),
  mockExtractAndPersistCustomTools: vi.fn(),
  mockNormalizeWorkflowState: vi.fn(),
  mockDbUpdateWhere: vi.fn(),
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: mockDbUpdateWhere,
      })),
    })),
  },
}))

vi.mock('@sim/db/schema', () => ({
  workflow: {},
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@sim/utils/errors', () => ({
  toError: vi.fn((error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  })),
}))

vi.mock('@/lib/copilot/generated/tool-catalog-v1', () => ({
  EditWorkflow: { id: 'edit_workflow' },
}))

vi.mock('@/lib/copilot/tools/server/base-tool', () => ({
  assertServerToolNotAborted: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: { INTERNAL_API_SECRET: 'test-secret' },
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getSocketServerUrl: vi.fn(() => 'http://localhost:3001'),
}))

vi.mock('@/lib/workflows/autolayout', () => ({
  applyTargetedLayout: vi.fn(),
  getTargetedLayoutImpact: vi.fn(() => ({
    layoutBlockIds: [],
    resizedBlockIds: [],
    shiftSourceBlockIds: [],
  })),
  transferBlockHeights: vi.fn(),
}))

vi.mock('@/lib/workflows/autolayout/constants', () => ({
  DEFAULT_HORIZONTAL_SPACING: 250,
  DEFAULT_VERTICAL_SPACING: 80,
}))

vi.mock('@/lib/workflows/persistence/custom-tools-persistence', () => ({
  extractAndPersistCustomTools: mockExtractAndPersistCustomTools,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mockLoadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables: mockSaveWorkflowToNormalizedTables,
}))

vi.mock('@/lib/workflows/sanitization/validation', () => ({
  validateWorkflowState: mockValidateWorkflowState,
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  getUserPermissionConfig: mockGetUserPermissionConfig,
}))

vi.mock('@/stores/workflows/workflow/utils', () => ({
  generateLoopBlocks: vi.fn(() => ({})),
  generateParallelBlocks: vi.fn(() => ({})),
}))

vi.mock('@/stores/workflows/workflow/validation', () => ({
  normalizeWorkflowState: mockNormalizeWorkflowState,
}))

vi.mock('./engine', () => ({
  applyOperationsToWorkflowState: mockApplyOperationsToWorkflowState,
}))

vi.mock('./validation', () => ({
  preValidateCredentialInputs: mockPreValidateCredentialInputs,
  validateWorkflowSelectorIds: mockValidateWorkflowSelectorIds,
}))

import { editWorkflowServerTool } from './index'

describe('editWorkflowServerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbUpdateWhere.mockResolvedValue(undefined)
    mockGetUserPermissionConfig.mockResolvedValue(null)
    mockPreValidateCredentialInputs.mockResolvedValue({
      filteredOperations: [],
      errors: [],
    })
    mockValidateWorkflowSelectorIds.mockResolvedValue([])
    mockExtractAndPersistCustomTools.mockResolvedValue({
      saved: 0,
      errors: [],
    })
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })
  })

  it('rejects published workflow readers from editing workflows', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      accessSource: 'published',
      workflow: { id: 'workflow-1', workspaceId: 'ws-1', name: 'Workflow One' },
    })

    await expect(
      editWorkflowServerTool.execute(
        {
          workflowId: 'workflow-1',
          operations: [{ type: 'noop' }],
        } as never,
        { userId: 'user-1', chatId: 'chat-1' }
      )
    ).rejects.toThrow('Unauthorized workflow access')
  })

  it('sanitizes unsupported legacy blocks and dangling edges before applying edits', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      accessSource: 'workspace',
      workflow: { id: 'workflow-1', workspaceId: 'ws-1', name: 'Workflow One' },
    })

    const rawWorkflow = {
      blocks: {
        'text-1': {
          id: 'text-1',
          type: 'content',
          name: 'Text 1',
          position: { x: 0, y: 0 },
          subBlocks: {},
          outputs: {},
          data: {},
          enabled: true,
          horizontalHandles: true,
          height: 0,
        },
        'legacy-image-1': {
          id: 'legacy-image-1',
          type: 'image_generator',
          name: 'Image 1',
          position: { x: 100, y: 0 },
          subBlocks: {},
          outputs: {},
          data: {},
          enabled: true,
          horizontalHandles: true,
          height: 0,
        },
      },
      edges: [
        {
          id: 'edge-1',
          source: 'text-1',
          target: 'legacy-image-1',
        },
      ],
      loops: {},
      parallels: {},
    }

    const cleanedWorkflow = {
      ...rawWorkflow,
      blocks: {
        'text-1': rawWorkflow.blocks['text-1'],
      },
      edges: [],
      loops: {},
      parallels: {},
    }

    mockPreValidateCredentialInputs.mockResolvedValue({
      filteredOperations: [
        {
          operation_type: 'edit',
          block_id: 'text-1',
          params: { name: 'Text 1 updated' },
        },
      ],
      errors: [],
    })

    mockValidateWorkflowState
      .mockReturnValueOnce({
        valid: false,
        errors: [
          "Block Image 1: unknown block type 'image_generator'",
          "Edge references non-existent target block 'legacy-image-1'",
        ],
        warnings: [],
        sanitizedState: {
          ...rawWorkflow,
          blocks: cleanedWorkflow.blocks,
          edges: rawWorkflow.edges,
        },
      })
      .mockReturnValueOnce({
        valid: true,
        errors: [],
        warnings: [],
        sanitizedState: cleanedWorkflow,
      })
      .mockReturnValueOnce({
        valid: true,
        errors: [],
        warnings: ['removed unsupported legacy blocks before applying edits'],
        sanitizedState: cleanedWorkflow,
      })

    mockApplyOperationsToWorkflowState.mockImplementation((workflowState) => ({
      state: workflowState,
      validationErrors: [],
      skippedItems: [],
    }))

    const result = await editWorkflowServerTool.execute(
      {
        workflowId: 'workflow-1',
        currentUserWorkflow: JSON.stringify(rawWorkflow),
        operations: [
          {
            operation_type: 'edit',
            block_id: 'text-1',
            params: { name: 'Text 1 updated' },
          },
        ],
      },
      { userId: 'user-1', chatId: 'chat-1' }
    )

    expect(mockApplyOperationsToWorkflowState).toHaveBeenCalledWith(
      expect.objectContaining({
        blocks: {
          'text-1': expect.objectContaining({ id: 'text-1' }),
        },
        edges: [],
      }),
      expect.any(Array),
      null
    )
    expect(mockSaveWorkflowToNormalizedTables).toHaveBeenCalledWith(
      'workflow-1',
      expect.objectContaining({
        blocks: {
          'text-1': expect.objectContaining({ id: 'text-1' }),
        },
        edges: [],
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        workflowId: 'workflow-1',
        sanitizationWarnings: expect.any(Array),
      })
    )
  })
})
