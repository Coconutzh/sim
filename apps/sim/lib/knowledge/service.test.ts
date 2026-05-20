/**
 * @vitest-environment node
 */
import { schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockWhere, mockOrderBy } = vi.hoisted(() => {
  const mockOrderBy = vi.fn().mockResolvedValue([])
  const mockWhere = vi.fn().mockReturnValue({
    groupBy: vi.fn().mockReturnValue({
      orderBy: mockOrderBy,
    }),
  })

  return { mockWhere, mockOrderBy }
})

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn().mockImplementation(() => {
      const chain: any = {}
      chain.from = vi.fn().mockReturnValue(chain)
      chain.leftJoin = vi.fn().mockReturnValue(chain)
      chain.where = mockWhere
      return chain
    }),
  },
}))

vi.mock('@sim/db/schema', () => schemaMock)

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  count: vi.fn((field: unknown) => ({ field, type: 'count' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'eq' })),
  inArray: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'inArray' })),
  isNotNull: vi.fn((field: unknown) => ({ field, type: 'isNotNull' })),
  isNull: vi.fn((field: unknown) => ({ field, type: 'isNull' })),
  ne: vi.fn((field: unknown, value: unknown) => ({ field, value, type: 'ne' })),
  or: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'or' })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
      mapWith: vi.fn(() => ({ strings, type: 'sql', values })),
    })),
    {
      raw: vi.fn((value: string) => ({ type: 'raw', value })),
    }
  ),
}))

import { workspace } from '@sim/db/schema'
import { getKnowledgeBases } from '@/lib/knowledge/service'

function hasOwnerAccessBranch(value: unknown, ownerId: string): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }

  const node = value as {
    type?: string
    field?: unknown
    value?: unknown
    conditions?: unknown[]
  }

  if (node.type === 'eq' && node.field === workspace.ownerId && node.value === ownerId) {
    return true
  }

  return Array.isArray(node.conditions)
    ? node.conditions.some((condition) => hasOwnerAccessBranch(condition, ownerId))
    : false
}

describe('getKnowledgeBases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOrderBy.mockResolvedValue([])
  })

  it('includes workspace ownership in the filtered workspace access predicate', async () => {
    await getKnowledgeBases('owner-1', 'ws-owner')

    expect(mockWhere).toHaveBeenCalledTimes(1)
    expect(hasOwnerAccessBranch(mockWhere.mock.calls[0][0], 'owner-1')).toBe(true)
  })

  it('includes workspace ownership in the unfiltered workspace access predicate', async () => {
    await getKnowledgeBases('owner-1')

    expect(mockWhere).toHaveBeenCalledTimes(1)
    expect(hasOwnerAccessBranch(mockWhere.mock.calls[0][0], 'owner-1')).toBe(true)
  })
})
