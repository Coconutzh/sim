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
  ;(chain as any).orderBy = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => chain)
  ;(chain as any).offset = vi.fn(() => Promise.resolve(result))
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
  desc: vi.fn((field: unknown) => ({ field, type: 'desc' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
    as: vi.fn(() => ({ strings, values })),
  })),
}))

import { GET } from './route'

describe('GET /api/logs/export', () => {
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

  it('lets a workspace owner export logs without an explicit permission row', async () => {
    mockDbSelect
      .mockReturnValueOnce(
        createChain([
          {
            startedAt: new Date('2026-05-21T00:00:00.000Z'),
            level: 'info',
            workflowName: 'Owner Flow',
            trigger: 'manual',
            totalDurationMs: 1200,
            cost: { total: 1.5 },
            workflowId: 'wf-1',
            executionId: 'exec-1',
            executionData: {
              finalOutput: 'done',
              traceSpans: [{ id: 'span-1' }],
            },
          },
        ])
      )
      .mockReturnValueOnce(createChain([]))

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/logs/export?workspaceId=ws-owner'
      )
    )

    expect(response.status).toBe(200)
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-owner', 'owner-1')
    await expect(response.text()).resolves.toContain(
      '2026-05-21T00:00:00.000Z,info,Owner Flow,manual,1200,1.5,wf-1,exec-1,done,"[{""id"":""span-1""}]"'
    )
  })

  it('hides foreign personal workspace log exports behind 404', async () => {
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
        'http://localhost:3000/api/logs/export?workspaceId=ws-owner'
      )
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Canvas not found' })
    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})
