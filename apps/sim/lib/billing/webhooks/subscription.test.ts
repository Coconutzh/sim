/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, drizzleOrmMock, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCalculateSubscriptionOverage,
  mockCaptureServerEvent,
  mockDetachOrganizationWorkspaces,
  mockGetBilledOverageForSubscription,
  mockRecordAudit,
  mockRequireStripeClient,
  mockResetUsageForSubscription,
  mockRestoreUserProSubscription,
  mockStripeWebhookIdempotency,
  mockSyncUsageLimitsFromSubscription,
  mockIsSubscriptionOrgScoped,
} = vi.hoisted(() => ({
  mockCalculateSubscriptionOverage: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
  mockDetachOrganizationWorkspaces: vi.fn(),
  mockGetBilledOverageForSubscription: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockRequireStripeClient: vi.fn(),
  mockResetUsageForSubscription: vi.fn(),
  mockRestoreUserProSubscription: vi.fn(),
  mockStripeWebhookIdempotency: vi.fn(
    async (_provider: string, _identifier: string, operation: () => Promise<unknown>) => operation()
  ),
  mockSyncUsageLimitsFromSubscription: vi.fn(),
  mockIsSubscriptionOrgScoped: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    ORGANIZATION_UPDATED: 'organization.updated',
  },
  AuditResourceType: {
    ORGANIZATION: 'organization',
  },
  recordAudit: mockRecordAudit,
}))

vi.mock('@sim/db', () => dbChainMock)
vi.mock('drizzle-orm', () => drizzleOrmMock)

vi.mock('@/lib/billing/core/billing', () => ({
  calculateSubscriptionOverage: mockCalculateSubscriptionOverage,
  isSubscriptionOrgScoped: mockIsSubscriptionOrgScoped,
}))

vi.mock('@/lib/billing/core/usage', () => ({
  syncUsageLimitsFromSubscription: mockSyncUsageLimitsFromSubscription,
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  restoreUserProSubscription: mockRestoreUserProSubscription,
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  isEnterprise: vi.fn((plan: string | null | undefined) => plan === 'enterprise'),
  isPaid: vi.fn((plan: string | null | undefined) => Boolean(plan && plan !== 'free')),
  isPro: vi.fn((plan: string | null | undefined) => Boolean(plan?.startsWith('pro'))),
  isTeam: vi.fn((plan: string | null | undefined) => Boolean(plan?.startsWith('team'))),
}))

vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: mockRequireStripeClient,
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  ENTITLED_SUBSCRIPTION_STATUSES: ['active', 'trialing', 'past_due'],
}))

vi.mock('@/lib/billing/webhooks/idempotency', () => ({
  stripeWebhookIdempotency: {
    executeWithIdempotency: mockStripeWebhookIdempotency,
  },
}))

vi.mock('@/lib/billing/webhooks/invoices', () => ({
  getBilledOverageForSubscription: mockGetBilledOverageForSubscription,
  resetUsageForSubscription: mockResetUsageForSubscription,
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}))

vi.mock('@/lib/workspaces/organization-workspaces', () => ({
  detachOrganizationWorkspaces: mockDetachOrganizationWorkspaces,
}))

import { handleSubscriptionDeleted } from '@/lib/billing/webhooks/subscription'

interface SelectResponse {
  limitResult?: unknown
  whereResult?: unknown
}

const selectResponses: SelectResponse[] = []

function queueSelectResponse(response: SelectResponse) {
  selectResponses.push(response)
}

function installSelectResponseQueue() {
  dbChainMockFns.where.mockImplementation(() => {
    const next = selectResponses.shift()
    if (!next) {
      throw new Error('No queued db.select response')
    }
    const builder = {
      limit: vi.fn(async () => next.limitResult ?? next.whereResult ?? []),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(next.whereResult ?? next.limitResult ?? []).then(resolve, reject),
    }
    return builder as unknown as ReturnType<typeof dbChainMockFns.where>
  })
}

describe('subscription billing lifecycle webhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    selectResponses.length = 0
    installSelectResponseQueue()

    mockCalculateSubscriptionOverage.mockResolvedValue(0)
    mockDetachOrganizationWorkspaces.mockResolvedValue({ detachedWorkspaceIds: ['workspace-1'] })
    mockGetBilledOverageForSubscription.mockResolvedValue(0)
    mockIsSubscriptionOrgScoped.mockResolvedValue(true)
    mockRequireStripeClient.mockReturnValue({})
    mockRestoreUserProSubscription.mockResolvedValue({ restored: true })
  })

  it('records an organization billing lifecycle audit when a team subscription is cancelled', async () => {
    queueSelectResponse({
      whereResult: [{ userId: 'owner-1' }, { userId: 'member-1' }],
    })
    queueSelectResponse({
      whereResult: [],
    })
    queueSelectResponse({
      whereResult: [{ userId: 'owner-1' }, { userId: 'member-1' }],
    })
    queueSelectResponse({
      limitResult: [{ name: 'Theater Project' }],
    })

    await handleSubscriptionDeleted(
      {
        id: 'sub-db-1',
        plan: 'team_8000',
        referenceId: 'org-1',
        stripeSubscriptionId: 'sub_stripe_1',
        seats: 3,
      },
      'evt-sub-deleted-1'
    )

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'system:stripe',
        action: 'organization.updated',
        resourceId: 'org-1',
        resourceName: 'Theater Project',
        metadata: expect.objectContaining({
          organizationId: 'org-1',
          billingEvent: 'organization.subscription_cancelled',
          subscriptionId: 'sub-db-1',
          stripeSubscriptionId: 'sub_stripe_1',
          cancellationKind: 'standard',
          totalOverage: 0,
          remainingOverage: 0,
          restoredProCount: 2,
          membersSynced: 2,
          workspacesDetached: 1,
        }),
      })
    )
    expect(mockCaptureServerEvent).toHaveBeenCalledWith('org-1', 'subscription_cancelled', {
      plan: 'team_8000',
      reference_id: 'org-1',
    })
  })
})
