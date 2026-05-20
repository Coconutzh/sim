/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dbSelectResults, selectWhereCalls } = vi.hoisted(() => ({
  dbSelectResults: [] as unknown[],
  selectWhereCalls: [] as unknown[],
}))

function shiftQueue<T>(queue: T[], fallback: T): T {
  return queue.length > 0 ? queue.shift()! : fallback
}

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => {
      const chain = {
        from: vi.fn(),
        where: vi.fn(),
      }
      chain.from.mockReturnValue(chain)
      chain.where.mockImplementation((condition) => {
        selectWhereCalls.push(condition)
        return Promise.resolve(shiftQueue(dbSelectResults, []))
      })
      return chain
    }),
  },
}))

vi.mock('@sim/db/schema', () => ({
  auditLog: {
    actorId: 'auditLog.actorId',
    workspaceId: 'auditLog.workspaceId',
  },
  workspace: {
    archivedAt: 'workspace.archivedAt',
    id: 'workspace.id',
    organizationId: 'workspace.organizationId',
    workspaceMode: 'workspace.workspaceMode',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ kind: 'and', args })),
  desc: vi.fn(),
  eq: vi.fn((left, right) => ({ kind: 'eq', left, right })),
  gte: vi.fn(),
  ilike: vi.fn(),
  inArray: vi.fn((left, right) => ({ kind: 'inArray', left, right })),
  isNull: vi.fn((value) => ({ kind: 'isNull', value })),
  lt: vi.fn(),
  lte: vi.fn(),
  or: vi.fn((...args) => ({ kind: 'or', args })),
  sql: vi.fn((strings, ...values) => ({ kind: 'sql', strings, values })),
}))

import { buildOrgScopeCondition, listOrganizationWorkspaceIds } from '@/app/api/v1/audit-logs/query'

describe('listOrganizationWorkspaceIds', () => {
  beforeEach(() => {
    dbSelectResults.length = 0
    selectWhereCalls.length = 0
    vi.clearAllMocks()
  })

  it('returns only active organization workspace ids', async () => {
    dbSelectResults.push([{ id: 'ws-1' }, { id: 'ws-2' }])

    const result = await listOrganizationWorkspaceIds('org-1')

    expect(result).toEqual(['ws-1', 'ws-2'])
    expect(selectWhereCalls).toEqual([
      {
        kind: 'and',
        args: [
          { kind: 'eq', left: 'workspace.organizationId', right: 'org-1' },
          { kind: 'eq', left: 'workspace.workspaceMode', right: 'organization' },
          { kind: 'isNull', value: 'workspace.archivedAt' },
        ],
      },
    ])
  })
})

describe('buildOrgScopeCondition', () => {
  beforeEach(() => {
    dbSelectResults.length = 0
    selectWhereCalls.length = 0
    vi.clearAllMocks()
  })

  it('uses organization workspace ids for departed-member scope', async () => {
    dbSelectResults.push([{ id: 'ws-1' }])

    const result = await buildOrgScopeCondition('org-1', ['user-1', 'user-2'], true)

    expect(result).toEqual({
      kind: 'or',
      args: [
        { kind: 'inArray', left: 'auditLog.actorId', right: ['user-1', 'user-2'] },
        { kind: 'inArray', left: 'auditLog.workspaceId', right: ['ws-1'] },
      ],
    })
  })
})
