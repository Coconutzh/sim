/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthorizeWorkflowByWorkspacePermission } = vi.hoisted(() => ({
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
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
  extractAndPersistCustomTools: vi.fn(),
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: vi.fn(),
  saveWorkflowToNormalizedTables: vi.fn(),
}))

vi.mock('@/lib/workflows/sanitization/validation', () => ({
  validateWorkflowState: vi.fn(),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  getUserPermissionConfig: vi.fn(),
}))

vi.mock('@/stores/workflows/workflow/utils', () => ({
  generateLoopBlocks: vi.fn(() => ({})),
  generateParallelBlocks: vi.fn(() => ({})),
}))

vi.mock('@/stores/workflows/workflow/validation', () => ({
  normalizeWorkflowState: vi.fn(),
}))

vi.mock('./engine', () => ({
  applyOperationsToWorkflowState: vi.fn(),
}))

vi.mock('./validation', () => ({
  preValidateCredentialInputs: vi.fn(),
  validateWorkflowSelectorIds: vi.fn(),
}))

import { editWorkflowServerTool } from './index'

describe('editWorkflowServerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
