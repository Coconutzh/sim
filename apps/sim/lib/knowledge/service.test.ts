/**
 * @vitest-environment node
 */
import { schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockWhere, mockOrderBy, mockLimit, mockInsertValues } = vi.hoisted(() => {
  const mockOrderBy = vi.fn().mockResolvedValue([])
  const mockLimit = vi.fn().mockResolvedValue([])
  const mockInsertValues = vi.fn().mockResolvedValue(undefined)
  const mockWhere = vi.fn().mockReturnValue({
    groupBy: vi.fn().mockReturnValue({
      orderBy: mockOrderBy,
    }),
    limit: mockLimit,
  })

  return { mockWhere, mockOrderBy, mockLimit, mockInsertValues }
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
    insert: vi.fn(() => ({
      values: mockInsertValues,
    })),
  },
}))

vi.mock('@sim/db/schema', () => schemaMock)

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: vi.fn(),
  getUserEntityPermissions: vi.fn(),
  listAccessibleWorkspaceIds: vi.fn(),
}))

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

import { knowledgeBase } from '@sim/db/schema'
import { createKnowledgeBase, getKnowledgeBases } from '@/lib/knowledge/service'
import {
  checkWorkspaceAccess,
  getUserEntityPermissions,
  listAccessibleWorkspaceIds,
} from '@/lib/workspaces/permissions/utils'

function hasAccessibleWorkspaceFilter(value: unknown, workspaceIds: string[]): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }

  const node = value as {
    type?: string
    field?: unknown
    value?: unknown
    conditions?: unknown[]
  }

  if (
    node.type === 'inArray' &&
    node.field === knowledgeBase.workspaceId &&
    JSON.stringify(node.value) === JSON.stringify(workspaceIds)
  ) {
    return true
  }

  return Array.isArray(node.conditions)
    ? node.conditions.some((condition) => hasAccessibleWorkspaceFilter(condition, workspaceIds))
    : false
}

describe('getKnowledgeBases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOrderBy.mockResolvedValue([])
    mockLimit.mockResolvedValue([])
    mockInsertValues.mockResolvedValue(undefined)
    vi.mocked(checkWorkspaceAccess).mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-owner', ownerId: 'owner-1', workspaceMode: 'organization' },
    })
    vi.mocked(getUserEntityPermissions).mockResolvedValue('write')
  })

  it('filters workspace-backed knowledge bases through accessible workspace ids', async () => {
    vi.mocked(listAccessibleWorkspaceIds).mockResolvedValueOnce(['ws-owner'])

    await getKnowledgeBases('owner-1', 'ws-owner')

    expect(mockWhere).toHaveBeenCalledTimes(1)
    expect(hasAccessibleWorkspaceFilter(mockWhere.mock.calls[0][0], ['ws-owner'])).toBe(true)
  })

  it('filters unscoped workspace-backed knowledge bases through accessible workspace ids', async () => {
    vi.mocked(listAccessibleWorkspaceIds).mockResolvedValueOnce(['ws-owner', 'ws-team'])

    await getKnowledgeBases('owner-1')

    expect(mockWhere).toHaveBeenCalledTimes(1)
    expect(hasAccessibleWorkspaceFilter(mockWhere.mock.calls[0][0], ['ws-owner', 'ws-team'])).toBe(
      true
    )
  })

  it('hides foreign personal workspaces before checking create permissions', async () => {
    vi.mocked(checkWorkspaceAccess).mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-hidden', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    await expect(
      createKnowledgeBase(
        {
          name: 'Secret KB',
          workspaceId: 'ws-hidden',
          userId: 'user-1',
          embeddingModel: 'text-embedding-3-large',
          embeddingDimension: 3072,
          chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200, strategy: 'simple' },
        },
        'req-1'
      )
    ).rejects.toThrow('Canvas not found')

    expect(getUserEntityPermissions).not.toHaveBeenCalled()
    expect(mockInsertValues).not.toHaveBeenCalled()
  })
})
