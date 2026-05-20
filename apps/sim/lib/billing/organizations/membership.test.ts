/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  dbSelectResults,
  deleteResults,
  insertOnConflictResults,
  transactionMock,
  txSelectWhereCalls,
  updateResults,
} = vi.hoisted(() => ({
    dbSelectResults: [] as unknown[],
    deleteResults: [] as unknown[],
    insertOnConflictResults: [] as unknown[],
    transactionMock: vi.fn(),
    txSelectWhereCalls: [] as unknown[],
    updateResults: [] as unknown[],
  }))

function shiftQueue<T>(queue: T[], fallback: T): T {
  return queue.length > 0 ? queue.shift()! : fallback
}

vi.mock('@sim/db', () => {
  const createSelectChain = (queue: unknown[]) => {
    const chain: {
      from: ReturnType<typeof vi.fn>
      innerJoin: ReturnType<typeof vi.fn>
      where: ReturnType<typeof vi.fn>
      limit: ReturnType<typeof vi.fn>
      then: (callback?: (rows: unknown) => unknown) => Promise<unknown>
    } = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(() => Promise.resolve(shiftQueue(queue, []))),
      then: async (callback) => {
        const result = shiftQueue(queue, [])
        return callback ? callback(result) : result
      },
    }
    chain.from.mockReturnValue(chain)
    chain.innerJoin.mockReturnValue(chain)
    chain.where.mockImplementation((condition) => {
      txSelectWhereCalls.push(condition)
      return chain
    })
    return chain
  }

  const createUpdateChain = () => {
    const chain: {
      where: ReturnType<typeof vi.fn>
      returning: ReturnType<typeof vi.fn>
      then: (callback?: (rows: unknown) => unknown) => Promise<unknown>
    } = {
      where: vi.fn(),
      returning: vi.fn(() => Promise.resolve(shiftQueue(updateResults, []))),
      then: async (callback) => {
        const result = shiftQueue(updateResults, undefined)
        return callback ? callback(result) : result
      },
    }
    chain.where.mockReturnValue(chain)
    return { set: vi.fn(() => chain) }
  }

  const createDeleteChain = () => {
    const chain: {
      where: ReturnType<typeof vi.fn>
      returning: ReturnType<typeof vi.fn>
      then: (callback?: (rows: unknown) => unknown) => Promise<unknown>
    } = {
      where: vi.fn(),
      returning: vi.fn(() => Promise.resolve(shiftQueue(deleteResults, []))),
      then: async (callback) => {
        const result = shiftQueue(deleteResults, undefined)
        return callback ? callback(result) : result
      },
    }
    chain.where.mockReturnValue(chain)
    return chain
  }

  const createInsertChain = () => ({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(() =>
        Promise.resolve(shiftQueue(insertOnConflictResults, undefined))
      ),
    })),
  })

  return {
    db: {
      delete: vi.fn(() => createDeleteChain()),
      insert: vi.fn(() => createInsertChain()),
      select: vi.fn(() => createSelectChain(dbSelectResults)),
      transaction: transactionMock,
      update: vi.fn(() => createUpdateChain()),
    },
  }
})

vi.mock('@sim/db/schema', () => ({
  credential: { id: 'credential.id', workspaceId: 'credential.workspaceId' },
  credentialMember: {
    credentialId: 'credentialMember.credentialId',
    id: 'credentialMember.id',
    role: 'credentialMember.role',
    status: 'credentialMember.status',
    userId: 'credentialMember.userId',
  },
  invitation: {
    email: 'invitation.email',
    id: 'invitation.id',
    membershipIntent: 'invitation.membershipIntent',
    organizationId: 'invitation.organizationId',
    status: 'invitation.status',
  },
  member: {
    id: 'member.id',
    organizationId: 'member.organizationId',
    role: 'member.role',
    userId: 'member.userId',
  },
  organization: { id: 'organization.id' },
  permissionGroupMember: {
    id: 'permissionGroupMember.id',
    userId: 'permissionGroupMember.userId',
    workspaceId: 'permissionGroupMember.workspaceId',
  },
  permissions: {
    entityId: 'permissions.entityId',
    entityType: 'permissions.entityType',
    permissionType: 'permissions.permissionType',
    userId: 'permissions.userId',
  },
  subscription: { referenceId: 'subscription.referenceId', status: 'subscription.status' },
  user: { email: 'user.email', id: 'user.id' },
  userStats: { billingBlockedReason: 'userStats.billingBlockedReason', userId: 'userStats.userId' },
  workspace: {
    archivedAt: 'workspace.archivedAt',
    billedAccountUserId: 'workspace.billedAccountUserId',
    id: 'workspace.id',
    organizationId: 'workspace.organizationId',
    ownerId: 'workspace.ownerId',
    updatedAt: 'workspace.updatedAt',
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

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn(() => 'generated-id'),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ kind: 'and', args })),
  eq: vi.fn((left, right) => ({ kind: 'eq', left, right })),
  inArray: vi.fn((left, right) => ({ kind: 'inArray', left, right })),
  isNull: vi.fn((value) => ({ kind: 'isNull', value })),
  ne: vi.fn((left, right) => ({ kind: 'ne', left, right })),
  or: vi.fn((...args) => ({ kind: 'or', args })),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}))

vi.mock('@/lib/billing/core/usage', () => ({
  syncUsageLimitsFromSubscription: vi.fn(),
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  isPaid: vi.fn(() => false),
  sqlIsPro: vi.fn(),
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  ENTITLED_SUBSCRIPTION_STATUSES: ['active'],
}))

vi.mock('@/lib/billing/utils/decimal', () => ({
  toDecimal: vi.fn((value) => value),
  toNumber: vi.fn((value) => Number(value)),
}))

vi.mock('@/lib/billing/validation/seat-management', () => ({
  validateSeatAvailability: vi.fn(),
}))

vi.mock('@/lib/billing/webhooks/outbox-handlers', () => ({
  OUTBOX_EVENT_TYPES: {},
}))

vi.mock('@/lib/core/outbox/service', () => ({
  enqueueOutboxEvent: vi.fn(),
}))

import { removeExternalUserFromOrganizationWorkspaces } from '@/lib/billing/organizations/membership'

describe('removeExternalUserFromOrganizationWorkspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbSelectResults.length = 0
    updateResults.length = 0
    deleteResults.length = 0
    insertOnConflictResults.length = 0
    txSelectWhereCalls.length = 0

    transactionMock.mockImplementation(async (callback) => {
      const txSelectResults: unknown[] = [[{ id: 'ws-1' }], [], [{ userId: 'org-owner-1' }], []]

      const createSelectChain = (queue: unknown[]) => {
        const chain: {
          from: ReturnType<typeof vi.fn>
          innerJoin: ReturnType<typeof vi.fn>
          where: ReturnType<typeof vi.fn>
          limit: ReturnType<typeof vi.fn>
          then: (callback?: (rows: unknown) => unknown) => Promise<unknown>
        } = {
          from: vi.fn(),
          innerJoin: vi.fn(),
          where: vi.fn(),
          limit: vi.fn(() => Promise.resolve(shiftQueue(queue, []))),
          then: async (callbackFn) => {
            const result = shiftQueue(queue, [])
            return callbackFn ? callbackFn(result) : result
          },
        }
        chain.from.mockReturnValue(chain)
        chain.innerJoin.mockReturnValue(chain)
        chain.where.mockImplementation((condition) => {
          txSelectWhereCalls.push(condition)
          return chain
        })
        return chain
      }

      const txUpdateResults: unknown[] = [[{ id: 'ws-1' }], undefined]
      const txDeleteResults: unknown[] = [[], []]
      const txInsertResults: unknown[] = [undefined]

      const createUpdateChain = () => {
        const chain: {
          where: ReturnType<typeof vi.fn>
          returning: ReturnType<typeof vi.fn>
          then: (callback?: (rows: unknown) => unknown) => Promise<unknown>
        } = {
          where: vi.fn(),
          returning: vi.fn(() => Promise.resolve(shiftQueue(txUpdateResults, []))),
          then: async (callbackFn) => {
            const result = shiftQueue(txUpdateResults, undefined)
            return callbackFn ? callbackFn(result) : result
          },
        }
        chain.where.mockReturnValue(chain)
        return { set: vi.fn(() => chain) }
      }

      const createDeleteChain = () => {
        const chain: {
          where: ReturnType<typeof vi.fn>
          returning: ReturnType<typeof vi.fn>
          then: (callback?: (rows: unknown) => unknown) => Promise<unknown>
        } = {
          where: vi.fn(),
          returning: vi.fn(() => Promise.resolve(shiftQueue(txDeleteResults, []))),
          then: async (callbackFn) => {
            const result = shiftQueue(txDeleteResults, undefined)
            return callbackFn ? callbackFn(result) : result
          },
        }
        chain.where.mockReturnValue(chain)
        return chain
      }

      const tx = {
        delete: vi.fn(() => createDeleteChain()),
        insert: vi.fn(() => ({
          values: vi.fn(() => ({
            onConflictDoNothing: vi.fn(() =>
              Promise.resolve(shiftQueue(txInsertResults, undefined))
            ),
          })),
        })),
        select: vi.fn(() => createSelectChain(txSelectResults)),
        update: vi.fn(() => createUpdateChain()),
      }

      return callback(tx)
    })
  })

  it('treats owner-only organization workspace access as revocable external access', async () => {
    dbSelectResults.push([])

    const result = await removeExternalUserFromOrganizationWorkspaces({
      userId: 'owner-only-user',
      organizationId: 'org-1',
    })

    expect(result).toEqual({
      success: true,
      workspaceAccessRevoked: 1,
      permissionGroupsRevoked: 0,
      credentialMembershipsRevoked: 0,
      pendingInvitationsCancelled: 0,
    })
    expect(txSelectWhereCalls).toContainEqual({
      kind: 'and',
      args: [
        { kind: 'eq', left: 'workspace.organizationId', right: 'org-1' },
        { kind: 'eq', left: 'workspace.workspaceMode', right: 'organization' },
        { kind: 'isNull', value: 'workspace.archivedAt' },
      ],
    })
  })
})
