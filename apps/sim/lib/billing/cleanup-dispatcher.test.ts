/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dbSelectResults, enqueueMock } = vi.hoisted(() => ({
  dbSelectResults: [] as unknown[],
  enqueueMock: vi.fn(async () => 'job-1'),
}))

function shiftQueue<T>(queue: T[], fallback: T): T {
  return queue.length > 0 ? queue.shift()! : fallback
}

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => {
      const chain = {
        from: vi.fn(),
        innerJoin: vi.fn(),
        leftJoin: vi.fn(),
        where: vi.fn(),
        groupBy: vi.fn(),
        limit: vi.fn(),
      }
      chain.from.mockReturnValue(chain)
      chain.innerJoin.mockReturnValue(chain)
      chain.leftJoin.mockReturnValue(chain)
      chain.where.mockReturnValue(chain)
      chain.groupBy.mockImplementation(() => Promise.resolve(shiftQueue(dbSelectResults, [])))
      chain.limit.mockImplementation(() => Promise.resolve(shiftQueue(dbSelectResults, [])))
      return chain
    }),
  },
}))

vi.mock('@sim/db/schema', () => ({
  organization: {
    dataRetentionSettings: 'organization.dataRetentionSettings',
    id: 'organization.id',
    name: 'organization.name',
  },
  subscription: {
    id: 'subscription.id',
    plan: 'subscription.plan',
    referenceId: 'subscription.referenceId',
    status: 'subscription.status',
  },
  workspace: {
    archivedAt: 'workspace.archivedAt',
    billedAccountUserId: 'workspace.billedAccountUserId',
    id: 'workspace.id',
    organizationId: 'workspace.organizationId',
    workspaceMode: 'workspace.workspaceMode',
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}))

vi.mock('@trigger.dev/sdk', () => ({
  tasks: {
    batchTrigger: vi.fn(),
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ kind: 'and', args })),
  eq: vi.fn((left, right) => ({ kind: 'eq', left, right })),
  inArray: vi.fn((left, right) => ({ kind: 'inArray', left, right })),
  isNotNull: vi.fn((value) => ({ kind: 'isNotNull', value })),
  isNull: vi.fn((value) => ({ kind: 'isNull', value })),
  sql: vi.fn((strings, ...values) => ({ kind: 'sql', strings, values })),
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  sqlIsPaid: vi.fn(() => ({ kind: 'sqlIsPaid' })),
  sqlIsPro: vi.fn(() => ({ kind: 'sqlIsPro' })),
  sqlIsTeam: vi.fn(() => ({ kind: 'sqlIsTeam' })),
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  ENTITLED_SUBSCRIPTION_STATUSES: ['active'],
}))

vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: vi.fn(async () => ({
    enqueue: enqueueMock,
  })),
}))

vi.mock('@/lib/core/async-jobs/config', () => ({
  shouldExecuteInline: vi.fn(() => false),
}))

vi.mock('@/lib/knowledge/documents/service', () => ({
  isTriggerAvailable: vi.fn(() => false),
}))

import { dispatchCleanupJobs, resolveCleanupScope } from '@/lib/billing/cleanup-dispatcher'

describe('resolveCleanupScope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbSelectResults.length = 0
    enqueueMock.mockClear()
  })

  it('ignores foreign personal workspaces for enterprise retention lookup', async () => {
    dbSelectResults.push([])

    const result = await resolveCleanupScope('cleanup-logs', {
      plan: 'enterprise',
      workspaceId: 'ws-personal',
    })

    expect(result).toBeNull()
  })
})

describe('dispatchCleanupJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbSelectResults.length = 0
    enqueueMock.mockClear()
  })

  it('does not enqueue enterprise cleanup jobs for personal workspaces tied to an organization', async () => {
    dbSelectResults.push([])

    const result = await dispatchCleanupJobs('cleanup-tasks')

    expect(result.enterpriseCount).toBe(0)
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})
