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

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
  isNull: vi.fn((field: unknown) => ({ field, type: 'isNull' })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
    as: vi.fn(() => ({ strings, values })),
  })),
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: vi.fn(() => 'http://localhost:3000'),
}))

import { GET } from './route'

describe('GET /api/mcp/discover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValue({
      success: true,
      userId: 'owner-1',
      apiKeyType: 'session',
    })
    permissionsMockFns.mockListAccessibleWorkspaceIds.mockResolvedValue(['ws-owner'])
    mockDbSelect.mockReturnValueOnce(
      createChain([
        {
          id: 'server-1',
          name: 'Workspace MCP',
          description: 'Owner-visible server',
          workspaceId: 'ws-owner',
          workspaceName: 'Owner Workspace',
          createdAt: new Date('2026-05-21T00:00:00Z'),
          toolCount: 2,
        },
      ])
    )
  })

  it('includes servers from owner-only workspaces without requiring a permission row', async () => {
    const response = await GET(new Request('http://localhost:3000/api/mcp/discover') as any)

    expect(response.status).toBe(200)
    expect(permissionsMockFns.mockListAccessibleWorkspaceIds).toHaveBeenCalledWith('owner-1')
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      servers: [
        {
          id: 'server-1',
          workspace: {
            id: 'ws-owner',
            name: 'Owner Workspace',
          },
        },
      ],
    })
  })

  it('returns an empty list when hidden personal workspace filtering leaves no accessible workspaces', async () => {
    permissionsMockFns.mockListAccessibleWorkspaceIds.mockResolvedValueOnce([])

    const response = await GET(new Request('http://localhost:3000/api/mcp/discover') as any)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      servers: [],
    })
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('returns canvas wording when a scoped API key has no canvas scope', async () => {
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'owner-1',
      apiKeyType: 'workspace',
      workspaceId: null,
    })

    const response = await GET(new Request('http://localhost:3000/api/mcp/discover') as any)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Canvas API key missing canvas scope',
    })
    expect(permissionsMockFns.mockListAccessibleWorkspaceIds).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})
