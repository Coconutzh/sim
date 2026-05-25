/**
 * @vitest-environment node
 */
import { createMockRequest, permissionsMock, permissionsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockDbSelect } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDbSelect: vi.fn(),
}))

function createChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).leftJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).groupBy = vi.fn(() => Promise.resolve(result))
  ;(chain as any).then = (resolve: (value: T) => unknown) => resolve(result)
  return chain
}

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
    as: vi.fn(() => ({ strings, values })),
  })),
}))

import { GET } from './route'

describe('GET /api/logs/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'owner-1' } })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
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
  })

  it('lets a workspace owner load log stats without an explicit permission row', async () => {
    mockDbSelect
      .mockReturnValueOnce(
        createChain([
          {
            minTime: '2026-05-21T00:00:00.000Z',
            maxTime: '2026-05-21T01:00:00.000Z',
          },
        ])
      )
      .mockReturnValueOnce(
        createChain([
          {
            workflowId: 'wf-1',
            workflowName: 'Owner Flow',
            segmentIndex: 0,
            totalExecutions: 2,
            successfulExecutions: 1,
            avgDurationMs: 1500,
          },
        ])
      )

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/logs/stats?workspaceId=ws-owner&segmentCount=2'
      )
    )

    expect(response.status).toBe(200)
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-owner', 'owner-1')
    await expect(response.json()).resolves.toMatchObject({
      totalRuns: 2,
      totalErrors: 1,
      workflows: [
        {
          workflowId: 'wf-1',
          workflowName: 'Owner Flow',
          totalExecutions: 2,
          totalSuccessful: 1,
        },
      ],
      aggregateSegments: [
        {
          totalExecutions: 2,
          successfulExecutions: 1,
          avgDurationMs: 1500,
        },
        {
          totalExecutions: 0,
          successfulExecutions: 0,
          avgDurationMs: 0,
        },
      ],
    })
  })

  it('hides foreign personal workspace log stats behind 404', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: {
        id: 'ws-hidden',
        name: 'Hidden Workspace',
        ownerId: 'owner-2',
        organizationId: null,
        workspaceMode: 'personal',
        billedAccountUserId: 'owner-2',
      },
    })

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/logs/stats?workspaceId=ws-owner&segmentCount=2'
      )
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Canvas not found' })
    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})
