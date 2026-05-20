/**
 * @vitest-environment node
 */
import { permissionsMock, permissionsMockFns, schemaMock } from '@sim/testing'
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
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
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

vi.mock('@sim/db/schema', () => schemaMock)

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  desc: vi.fn((value: unknown) => ({ type: 'desc', value })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
  gte: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'gte' })),
  inArray: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'inArray' })),
  isNotNull: vi.fn((field: unknown) => ({ field, type: 'isNotNull' })),
  isNull: vi.fn((field: unknown) => ({ field, type: 'isNull' })),
  lte: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'lte' })),
  or: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'or' })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}))

import { GET } from './route'

describe('GET /api/workspaces/[id]/metrics/executions', () => {
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

  it('lets a workspace owner load execution metrics without an explicit permission row', async () => {
    mockDbSelect.mockReturnValueOnce(createChain([]))

    const response = await GET(
      new Request(
        'http://localhost:3000/api/workspaces/ws-owner/metrics/executions?segments=24'
      ) as any,
      {
        params: Promise.resolve({ id: 'ws-owner' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      workflows: [],
      startTime: expect.any(String),
      endTime: expect.any(String),
      segmentMs: 0,
    })
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-owner', 'owner-1')
  })

  it('returns 403 when the user cannot access the workspace', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: {
        id: 'ws-owner',
        name: 'Owner Workspace',
        ownerId: 'owner-1',
        organizationId: null,
        workspaceMode: 'personal',
        billedAccountUserId: 'owner-1',
      },
    })

    const response = await GET(
      new Request(
        'http://localhost:3000/api/workspaces/ws-owner/metrics/executions?segments=24'
      ) as any,
      {
        params: Promise.resolve({ id: 'ws-owner' }),
      }
    )
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Forbidden' })
    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})
