/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSelect } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).orderBy = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  hermesToolCallAudit: {
    id: 'id',
    traceId: 'traceId',
    hermesRunId: 'hermesRunId',
    simRequestId: 'simRequestId',
    userId: 'userId',
    organizationId: 'organizationId',
    workspaceId: 'workspaceId',
    workflowId: 'workflowId',
    toolName: 'toolName',
    mode: 'mode',
    status: 'status',
    requiresConfirmation: 'requiresConfirmation',
    createdAt: 'createdAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  desc: vi.fn((column: unknown) => ({ type: 'desc', column })),
  eq: vi.fn((column: unknown, value: unknown) => ({ type: 'eq', column, value })),
}))

import { queryHermesCanvasHistory } from '@/lib/hermes/canvas-history-query'

describe('queryHermesCanvasHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns scoped canvas audit summaries with evidence refs', async () => {
    mockSelect.mockReturnValueOnce(
      createSelectChain([
        {
          id: 'audit-1',
          traceId: 'trace-1',
          hermesRunId: 'resp-1',
          simRequestId: 'audit-1',
          userId: 'user-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          toolName: 'sim_canvas_agent_run',
          mode: 'apply_after_confirm',
          operation: null,
          status: 'success',
          inputSummary: { mode: 'apply_after_confirm' },
          outputSummary: { pendingActionId: 'pending-1' },
          risk: 'low',
          requiresConfirmation: false,
          changedNodeIds: ['node-1'],
          generatedNodeIds: ['node-2'],
          verificationSummary: 'verified',
          durationMs: 10,
          errorCode: null,
          error: null,
          createdAt: new Date('2026-06-14T00:00:00.000Z'),
        },
      ])
    )

    const result = await queryHermesCanvasHistory({
      userId: 'user-1',
      organizationId: 'org-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      query: 'recent_operations',
      limit: 10,
    })

    expect(result.success).toBe(true)
    expect(result.summary).toMatchObject({
      total: 1,
      successCount: 1,
      errorCount: 0,
      changedNodeIds: ['node-1'],
      generatedNodeIds: ['node-2'],
      latestVerificationSummary: 'verified',
    })
    expect(result.items[0]).toMatchObject({
      auditId: 'audit-1',
      pendingActionId: 'pending-1',
      evidenceRef: 'hermes_tool_call_audit:audit-1',
    })
    expect(result.evidenceRefs).toEqual(['hermes_tool_call_audit:audit-1'])
  })
})
