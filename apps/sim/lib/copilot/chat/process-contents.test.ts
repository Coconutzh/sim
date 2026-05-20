/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthorizeWorkflowByWorkspacePermission,
  mockGetActiveWorkflowRecord,
  mockLoadWorkflowFromNormalizedTables,
  mockDbSelect,
  mockDbFrom,
  mockDbInnerJoin,
  mockDbWhere,
  mockDbLimit,
} = vi.hoisted(() => ({
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockGetActiveWorkflowRecord: vi.fn(),
  mockLoadWorkflowFromNormalizedTables: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbFrom: vi.fn(),
  mockDbInnerJoin: vi.fn(),
  mockDbWhere: vi.fn(),
  mockDbLimit: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  document: {},
  knowledgeBase: {},
  templates: {},
  workflow: {},
  workflowExecutionLogs: {},
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
  getActiveWorkflowRecord: mockGetActiveWorkflowRecord,
}))

vi.mock('@/lib/copilot/vfs/serializers', () => ({
  serializeFileMeta: vi.fn(),
  serializeTableMeta: vi.fn(),
  serializeWorkflowMeta: vi.fn(() => 'workflow-meta'),
}))

vi.mock('@/lib/table/service', () => ({
  getTableById: vi.fn(),
}))

vi.mock('@/lib/templates/permissions', () => ({
  canAccessTemplate: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mockLoadWorkflowFromNormalizedTables,
}))

vi.mock('@/lib/workflows/sanitization/json-sanitizer', () => ({
  sanitizeForCopilot: vi.fn((value: unknown) => value),
}))

vi.mock('@/app/api/knowledge/utils', () => ({
  checkKnowledgeBaseAccess: vi.fn(),
}))

vi.mock('@/blocks/types', () => ({
  isHiddenFromDisplay: vi.fn(() => false),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  getUserPermissionConfig: vi.fn(),
}))

vi.mock('@/executor/constants', () => ({
  escapeRegExp: vi.fn((value: string) => value),
}))

import { processContextsServer } from './process-contents'

describe('processContextsServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbSelect.mockReturnValue({ from: mockDbFrom })
    mockDbFrom.mockReturnValue({ innerJoin: mockDbInnerJoin })
    mockDbInnerJoin.mockReturnValue({ where: mockDbWhere })
    mockDbWhere.mockReturnValue({ limit: mockDbLimit })
    mockDbLimit.mockResolvedValue([])
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      accessSource: 'published',
      workflow: {
        id: 'wf-1',
        workspaceId: 'ws-1',
        name: 'Published Workflow',
      },
    })
    mockGetActiveWorkflowRecord.mockResolvedValue({
      id: 'wf-1',
      workspaceId: 'ws-1',
      name: 'Published Workflow',
    })
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue({
      blocks: {
        blockA: { id: 'blockA', name: 'Block A' },
      },
      edges: [],
      loops: {},
      parallels: {},
    })
  })

  it('does not expose current workflow state to published workflow readers', async () => {
    const contexts = [
      {
        kind: 'current_workflow' as const,
        workflowId: 'wf-1',
        label: 'Current Workflow',
      },
    ]

    const result = await processContextsServer(contexts, 'user-1', undefined, 'ws-1')

    expect(result).toEqual([])
    expect(mockLoadWorkflowFromNormalizedTables).not.toHaveBeenCalled()
  })

  it('does not expose workflow block details to published workflow readers', async () => {
    const contexts = [
      {
        kind: 'workflow_block' as const,
        workflowId: 'wf-1',
        blockId: 'blockA',
        label: 'Block A',
      },
    ]

    const result = await processContextsServer(contexts, 'user-1', undefined, 'ws-1')

    expect(result).toEqual([])
    expect(mockLoadWorkflowFromNormalizedTables).not.toHaveBeenCalled()
  })

  it('does not expose workflow execution logs to published workflow readers', async () => {
    mockDbLimit.mockResolvedValueOnce([
      {
        id: 'log-1',
        workflowId: 'wf-1',
        executionId: 'exec-1',
        level: 'info',
        trigger: 'manual',
        startedAt: new Date('2026-05-21T00:00:00Z'),
        endedAt: new Date('2026-05-21T00:00:01Z'),
        totalDurationMs: 1000,
        executionData: {},
        cost: null,
        workflowName: 'Published Workflow',
      },
    ])

    const contexts = [
      {
        kind: 'logs' as const,
        executionId: 'exec-1',
        label: 'Execution Logs',
      },
    ]

    const result = await processContextsServer(contexts, 'user-1', undefined, 'ws-1')

    expect(result).toEqual([])
  })
})
