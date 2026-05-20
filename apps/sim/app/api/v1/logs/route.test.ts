/**
 * @vitest-environment node
 */
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
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  ;(chain as any).then = (resolve: (value: T) => unknown) => resolve(result)
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('@/lib/api/server', () => ({
  getValidationErrorMessage: vi.fn(() => 'Invalid parameters'),
  parseRequest: vi.fn(async () => ({
    success: true,
    data: {
      query: {
        workspaceId: 'ws-owner',
        limit: 20,
        order: 'desc',
        details: 'basic',
      },
    },
  })),
}))

vi.mock('@/app/api/v1/logs/filters', () => ({
  buildLogFilters: vi.fn(() => ({ type: 'filters' })),
  getOrderBy: vi.fn(() => ({ type: 'orderBy' })),
}))

vi.mock('@/app/api/v1/logs/meta', () => ({
  createApiResponse: vi.fn((body) => ({ body, headers: {} })),
  getUserLimits: vi.fn(async () => ({ limit: 100 })),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: vi.fn(async () => ({
    allowed: true,
    remaining: 99,
    resetAt: new Date('2026-05-21T00:00:00.000Z'),
    limit: 100,
    userId: 'owner-1',
    keyType: 'personal',
  })),
  checkWorkspaceScope: vi.fn(() => null),
  createRateLimitResponse: vi.fn(),
  validateWorkspaceAccess: vi.fn(async () => null),
}))

import { validateWorkspaceAccess } from '@/app/api/v1/middleware'
import { GET } from './route'

describe('GET /api/v1/logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lets a workspace owner list v1 logs without an explicit permission row', async () => {
    mockDbSelect.mockReturnValueOnce(
      createChain([
        {
          id: 'log-1',
          workflowId: 'wf-1',
          executionId: 'exec-1',
          deploymentVersionId: 'deploy-1',
          level: 'info',
          trigger: 'manual',
          startedAt: new Date('2026-05-21T00:00:00.000Z'),
          endedAt: new Date('2026-05-21T00:01:00.000Z'),
          totalDurationMs: 60000,
          cost: { total: 1.25 },
          files: null,
          executionData: null,
          workflowName: 'Owner Flow',
          workflowDescription: null,
        },
      ])
    )

    const response = await GET(new Request('http://localhost:3000/api/v1/logs') as any)

    expect(response.status).toBe(200)
    expect(validateWorkspaceAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner-1' }),
      'owner-1',
      'ws-owner',
      'read'
    )
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'log-1',
          workflowId: 'wf-1',
          executionId: 'exec-1',
          totalDurationMs: 60000,
        },
      ],
    })
  })
})
