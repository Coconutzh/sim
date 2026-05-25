/**
 * @vitest-environment node
 */

import { loggingSessionMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetActiveWorkflowRecord, mockGetWorkspaceBilledAccountUserId } = vi.hoisted(() => ({
  mockGetActiveWorkflowRecord: vi.fn().mockResolvedValue({
    id: 'workflow-1',
    workspaceId: 'workspace-1',
    isDeployed: true,
  }),
  mockGetWorkspaceBilledAccountUserId: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: {} }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))
vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkServerSideUsageLimits: vi.fn(),
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: vi.fn(),
}))
vi.mock('@/lib/core/execution-limits', () => ({
  getExecutionTimeout: vi.fn(() => 0),
}))
vi.mock('@/lib/core/rate-limiter/rate-limiter', () => ({
  RateLimiter: vi.fn(),
}))
vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)
vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBilledAccountUserId: mockGetWorkspaceBilledAccountUserId,
}))

vi.mock('@sim/workflow-authz', () => ({
  getActiveWorkflowRecord: mockGetActiveWorkflowRecord,
}))

import { preprocessExecution } from './preprocessing'

describe('preprocessExecution correlation logging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a provided workspace id that does not match the workflow record', async () => {
    const result = await preprocessExecution({
      workflowId: 'workflow-1',
      userId: 'user-1',
      triggerType: 'api',
      executionId: 'execution-1',
      requestId: 'request-1',
      workspaceId: 'workspace-spoofed',
    })

    expect(result).toMatchObject({
      success: false,
      error: {
        message: 'Workflow not found',
        statusCode: 404,
        logCreated: false,
      },
    })
    expect(mockGetWorkspaceBilledAccountUserId).not.toHaveBeenCalled()
  })

  it('uses canvas wording when a legacy workflow has no workspace container', async () => {
    mockGetActiveWorkflowRecord.mockResolvedValueOnce({
      id: 'workflow-legacy',
      workspaceId: null,
      isDeployed: true,
    })

    const result = await preprocessExecution({
      workflowId: 'workflow-legacy',
      userId: 'user-1',
      triggerType: 'api',
      executionId: 'execution-1',
      requestId: 'request-1',
    })

    expect(result).toMatchObject({
      success: false,
      error: {
        message:
          'This workflow is not attached to a canvas. Legacy personal workflows are deprecated and cannot execute.',
        statusCode: 403,
        logCreated: false,
      },
    })
    expect(mockGetWorkspaceBilledAccountUserId).not.toHaveBeenCalled()
  })

  it('preserves trigger correlation when logging preprocessing failures', async () => {
    mockGetWorkspaceBilledAccountUserId.mockResolvedValueOnce(null)

    const loggingSession = {
      safeStart: vi.fn().mockResolvedValue(true),
      safeCompleteWithError: vi.fn().mockResolvedValue(undefined),
    }

    const correlation = {
      executionId: 'execution-1',
      requestId: 'request-1',
      source: 'schedule' as const,
      workflowId: 'workflow-1',
      scheduleId: 'schedule-1',
      triggerType: 'schedule',
      scheduledFor: '2025-01-01T00:00:00.000Z',
    }

    const result = await preprocessExecution({
      workflowId: 'workflow-1',
      userId: 'unknown',
      triggerType: 'schedule',
      executionId: 'execution-1',
      requestId: 'request-1',
      loggingSession: loggingSession as any,
      triggerData: { correlation },
      workflowRecord: {
        id: 'workflow-1',
        workspaceId: 'workspace-1',
        isDeployed: true,
      } as any,
    })

    expect(result).toMatchObject({
      success: false,
      error: {
        statusCode: 500,
        logCreated: true,
      },
    })

    expect(loggingSession.safeStart).toHaveBeenCalledWith({
      userId: 'unknown',
      workspaceId: 'workspace-1',
      variables: {},
      triggerData: { correlation },
    })
  })
})
