/**
 * @vitest-environment node
 */
import { permissionsMock, permissionsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect, schemaTables } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  schemaTables: {
    jobExecutionLogs: {
      id: 'jobExecutionLogs.id',
      executionId: 'jobExecutionLogs.executionId',
      workspaceId: 'jobExecutionLogs.workspaceId',
      level: 'jobExecutionLogs.level',
      status: 'jobExecutionLogs.status',
      trigger: 'jobExecutionLogs.trigger',
      startedAt: 'jobExecutionLogs.startedAt',
      endedAt: 'jobExecutionLogs.endedAt',
      totalDurationMs: 'jobExecutionLogs.totalDurationMs',
      executionData: 'jobExecutionLogs.executionData',
      cost: 'jobExecutionLogs.cost',
      createdAt: 'jobExecutionLogs.createdAt',
    },
    pausedExecutions: {
      status: 'pausedExecutions.status',
      totalPauseCount: 'pausedExecutions.totalPauseCount',
      resumedCount: 'pausedExecutions.resumedCount',
      executionId: 'pausedExecutions.executionId',
    },
    workflow: {
      id: 'workflow.id',
      name: 'workflow.name',
      description: 'workflow.description',
      color: 'workflow.color',
      folderId: 'workflow.folderId',
      userId: 'workflow.userId',
      workspaceId: 'workflow.workspaceId',
      createdAt: 'workflow.createdAt',
      updatedAt: 'workflow.updatedAt',
    },
    workflowDeploymentVersion: {
      id: 'workflowDeploymentVersion.id',
      version: 'workflowDeploymentVersion.version',
      name: 'workflowDeploymentVersion.name',
    },
    workflowExecutionLogs: {
      id: 'workflowExecutionLogs.id',
      workflowId: 'workflowExecutionLogs.workflowId',
      executionId: 'workflowExecutionLogs.executionId',
      workspaceId: 'workflowExecutionLogs.workspaceId',
      deploymentVersionId: 'workflowExecutionLogs.deploymentVersionId',
      level: 'workflowExecutionLogs.level',
      status: 'workflowExecutionLogs.status',
      trigger: 'workflowExecutionLogs.trigger',
      startedAt: 'workflowExecutionLogs.startedAt',
      endedAt: 'workflowExecutionLogs.endedAt',
      totalDurationMs: 'workflowExecutionLogs.totalDurationMs',
      executionData: 'workflowExecutionLogs.executionData',
      cost: 'workflowExecutionLogs.cost',
      files: 'workflowExecutionLogs.files',
      createdAt: 'workflowExecutionLogs.createdAt',
    },
  },
}))

function createChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).leftJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  ;(chain as any).then = (resolve: (value: T) => unknown) => resolve(result)
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('@sim/db/schema', () => schemaTables)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { fetchLogDetail } from './fetch-log-detail'

describe('fetchLogDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lets a workspace owner load workflow log details without an explicit permission row', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: {
        id: 'ws-owner',
        name: 'Owner Workspace',
        ownerId: 'owner-1',
        organizationId: null,
        workspaceMode: 'personal',
        billedAccountUserId: 'owner-1',
      },
    })
    mockDbSelect.mockReturnValueOnce(
      createChain([
        {
          id: 'log-1',
          workflowId: 'wf-1',
          executionId: 'exec-1',
          deploymentVersionId: 'deploy-1',
          level: 'info',
          status: 'completed',
          trigger: 'manual',
          startedAt: new Date('2026-05-21T00:00:00Z'),
          endedAt: new Date('2026-05-21T00:01:00Z'),
          totalDurationMs: 60000,
          executionData: { finalOutput: 'done' },
          cost: { total: 1.23 },
          files: null,
          createdAt: new Date('2026-05-21T00:00:00Z'),
          workflowName: 'Owner Flow',
          workflowDescription: null,
          workflowColor: '#000000',
          workflowFolderId: null,
          workflowUserId: 'owner-1',
          workflowWorkspaceId: 'ws-owner',
          workflowCreatedAt: new Date('2026-05-20T00:00:00Z'),
          workflowUpdatedAt: new Date('2026-05-21T00:00:00Z'),
          deploymentVersion: 3,
          deploymentVersionName: 'v3',
          pausedStatus: null,
          pausedTotalPauseCount: 0,
          pausedResumedCount: 0,
        },
      ])
    )

    const result = await fetchLogDetail({
      userId: 'owner-1',
      workspaceId: 'ws-owner',
      lookupColumn: 'id',
      lookupValue: 'log-1',
    })

    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-owner', 'owner-1')
    expect(result).toMatchObject({
      id: 'log-1',
      workflowId: 'wf-1',
      executionId: 'exec-1',
      workflow: {
        id: 'wf-1',
        workspaceId: 'ws-owner',
      },
      executionData: {
        totalDuration: 60000,
        finalOutput: 'done',
        enhanced: true,
      },
    })
  })

  it('returns null without querying logs when workspace access is denied', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: {
        id: 'ws-team',
        name: 'Team Workspace',
        ownerId: 'other-user',
        organizationId: null,
        workspaceMode: 'team',
        billedAccountUserId: 'other-user',
      },
    })

    const result = await fetchLogDetail({
      userId: 'viewer-1',
      workspaceId: 'ws-team',
      lookupColumn: 'executionId',
      lookupValue: 'exec-404',
    })

    expect(result).toBeNull()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})
