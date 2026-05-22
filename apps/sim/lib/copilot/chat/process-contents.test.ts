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
  mockAssertActiveWorkspaceAccess,
} = vi.hoisted(() => ({
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockGetActiveWorkflowRecord: vi.fn(),
  mockLoadWorkflowFromNormalizedTables: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbFrom: vi.fn(),
  mockDbInnerJoin: vi.fn(),
  mockDbWhere: vi.fn(),
  mockDbLimit: vi.fn(),
  mockAssertActiveWorkspaceAccess: vi.fn(),
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

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  assertActiveWorkspaceAccess: mockAssertActiveWorkspaceAccess,
  isActiveWorkspaceAccessError: vi.fn(
    (error: unknown) => error instanceof Error && error.name === 'ActiveWorkspaceAccessError'
  ),
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

import { serializeWorkflowMeta } from '@/lib/copilot/vfs/serializers'
import { getTableById } from '@/lib/table/service'
import { processContextsServer, resolveActiveResourceContext } from './process-contents'

describe('processContextsServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbSelect.mockReturnValue({ from: mockDbFrom })
    mockDbFrom.mockReturnValue({ innerJoin: mockDbInnerJoin })
    mockDbInnerJoin.mockReturnValue({ where: mockDbWhere })
    mockDbWhere.mockReturnValue({ limit: mockDbLimit })
    mockDbLimit.mockResolvedValue([])
    mockAssertActiveWorkspaceAccess.mockResolvedValue(undefined)
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

  it('sanitizes workflow metadata for published workflow readers', async () => {
    const publishedAt = new Date('2026-05-20T00:00:00Z')
    const updatedAt = new Date('2026-05-21T00:00:00Z')
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      accessSource: 'selected_workgroups',
      workflow: {
        id: 'wf-1',
        workspaceId: 'ws-source',
        folderId: 'folder-secret',
        name: 'Published Workflow',
        description: 'Visible publication summary',
        isDeployed: true,
        deployedAt: new Date('2026-05-19T00:00:00Z'),
        runCount: 42,
        lastRunAt: new Date('2026-05-21T08:00:00Z'),
        createdAt: new Date('2026-05-01T00:00:00Z'),
        updatedAt,
        publishedAt,
      },
    })

    const result = await processContextsServer(
      [
        {
          kind: 'workflow',
          workflowId: 'wf-1',
          label: 'Published Workflow',
        },
      ],
      'viewer-1'
    )

    expect(result).toEqual([
      {
        type: 'workflow',
        tag: '@Published Workflow',
        content: 'workflow-meta',
      },
    ])
    expect(serializeWorkflowMeta).toHaveBeenCalledWith({
      id: 'wf-1',
      name: 'Published Workflow',
      description: 'Visible publication summary',
      folderId: null,
      isDeployed: false,
      deployedAt: null,
      runCount: 0,
      lastRunAt: null,
      createdAt: publishedAt,
      updatedAt: publishedAt,
    })
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

  it('does not process server contexts when the active workspace is hidden', async () => {
    const accessError = new Error('Workspace not found')
    accessError.name = 'ActiveWorkspaceAccessError'
    mockAssertActiveWorkspaceAccess.mockRejectedValueOnce(accessError)
    const contexts = [
      {
        kind: 'table' as const,
        tableId: 'table-1',
        label: 'Table',
      },
    ]

    const result = await processContextsServer(contexts, 'user-1', undefined, 'ws-hidden')

    expect(result).toEqual([])
    expect(getTableById).not.toHaveBeenCalled()
  })

  it('does not resolve active resource context when the workspace is hidden', async () => {
    const accessError = new Error('Workspace not found')
    accessError.name = 'ActiveWorkspaceAccessError'
    mockAssertActiveWorkspaceAccess.mockRejectedValueOnce(accessError)

    const result = await resolveActiveResourceContext('table', 'table-1', 'ws-hidden', 'user-1')

    expect(result).toBeNull()
    expect(getTableById).not.toHaveBeenCalled()
  })
})
