/**
 * @vitest-environment node
 */
import {
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
  ;(chain as any).orderBy = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => chain)
  ;(chain as any).then = (resolve: (value: T) => unknown) => resolve(result)
  return chain
}

vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/api/server', () => ({
  parseRequest: vi.fn(async () => ({
    success: true,
    data: {
      query: {
        workspaceId: 'ws-owner',
        sortBy: 'date',
        sortOrder: 'desc',
        limit: 20,
      },
    },
  })),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  asc: vi.fn((value: unknown) => ({ type: 'asc', value })),
  desc: vi.fn((value: unknown) => ({ type: 'desc', value })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
  gt: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'gt' })),
  gte: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'gte' })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ field, values, type: 'inArray' })),
  isNotNull: vi.fn((field: unknown) => ({ field, type: 'isNotNull' })),
  isNull: vi.fn((field: unknown) => ({ field, type: 'isNull' })),
  lt: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'lt' })),
  lte: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'lte' })),
  ne: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'ne' })),
  or: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'or' })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
    as: vi.fn(() => ({ strings, values })),
  })),
}))

import { GET } from './route'

describe('GET /api/logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'owner-1',
    })
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

  it('lets a workspace owner list logs without an explicit permission row', async () => {
    mockDbSelect
      .mockReturnValueOnce(
        createChain([
          {
            id: 'log-1',
            workflowId: 'wf-1',
            executionId: 'exec-1',
            deploymentVersionId: 'deploy-1',
            level: 'info',
            status: 'completed',
            trigger: 'manual',
            startedAt: new Date('2026-05-21T00:00:00.000Z'),
            endedAt: new Date('2026-05-21T00:01:00.000Z'),
            totalDurationMs: 60000,
            cost: { total: 1.23 },
            createdAt: new Date('2026-05-21T00:00:00.000Z'),
            workflowName: 'Owner Flow',
            workflowDescription: null,
            workflowColor: '#000000',
            workflowFolderId: null,
            workflowUserId: 'owner-1',
            workflowWorkspaceId: 'ws-owner',
            workflowCreatedAt: new Date('2026-05-20T00:00:00.000Z'),
            workflowUpdatedAt: new Date('2026-05-21T00:00:00.000Z'),
            pausedStatus: null,
            pausedTotalPauseCount: 0,
            pausedResumedCount: 0,
            deploymentVersion: 3,
            deploymentVersionName: 'v3',
            sortValue: new Date('2026-05-21T00:00:00.000Z'),
          },
        ])
      )
      .mockReturnValueOnce(createChain([]))

    const response = await GET(new Request('http://localhost:3000/api/logs') as any)
    expect(response.status).toBe(200)
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-owner', 'owner-1')
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'log-1',
          workflowId: 'wf-1',
          executionId: 'exec-1',
          workflow: {
            id: 'wf-1',
            workspaceId: 'ws-owner',
          },
        },
      ],
      nextCursor: null,
    })
  })

  it('hides foreign personal workspace logs behind 404', async () => {
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

    const response = await GET(new Request('http://localhost:3000/api/logs') as any)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Canvas not found' })
    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})
