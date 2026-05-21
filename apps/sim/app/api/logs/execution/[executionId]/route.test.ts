/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  hybridAuthMock,
  hybridAuthMockFns,
  permissionsMock,
  permissionsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
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

vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

import { GET } from './route'

describe('GET /api/logs/execution/[executionId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'owner-1',
    })
    permissionsMockFns.mockListAccessibleWorkspaceIds.mockResolvedValue(['ws-owner'])
  })

  it('lets a workspace owner read execution state without an explicit permission row', async () => {
    mockDbSelect
      .mockReturnValueOnce(
        createChain([
          {
            id: 'log-1',
            workflowId: 'wf-1',
            executionId: 'exec-1',
            stateSnapshotId: 'snapshot-1',
            trigger: 'manual',
            startedAt: new Date('2026-05-21T00:00:00Z'),
            endedAt: new Date('2026-05-21T00:01:00Z'),
            totalDurationMs: 60000,
            cost: { total: 1.23 },
            executionData: {
              traceSpans: [],
            },
          },
        ])
      )
      .mockReturnValueOnce(
        createChain([
          {
            id: 'snapshot-1',
            stateData: { nodeStates: { a: { status: 'completed' } } },
          },
        ])
      )

    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/logs/execution/exec-1'),
      { params: Promise.resolve({ executionId: 'exec-1' }) }
    )

    expect(response.status).toBe(200)
    expect(permissionsMockFns.mockListAccessibleWorkspaceIds).toHaveBeenCalledWith('owner-1')
    await expect(response.json()).resolves.toMatchObject({
      executionId: 'exec-1',
      workflowId: 'wf-1',
      workflowState: {
        nodeStates: {
          a: {
            status: 'completed',
          },
        },
      },
    })
  })

  it('returns 404 when no accessible workspaces remain after hidden personal filtering', async () => {
    permissionsMockFns.mockListAccessibleWorkspaceIds.mockResolvedValueOnce([])

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/logs/execution/exec-hidden'
      ),
      { params: Promise.resolve({ executionId: 'exec-hidden' }) }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Workflow execution not found' })
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('authenticates before validating route params', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Authentication required',
    })

    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/logs/execution/'),
      { params: Promise.resolve({ executionId: '' }) }
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' })
    expect(permissionsMockFns.mockListAccessibleWorkspaceIds).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})
