import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'

const logger = createLogger('BillingLifecycleAudit')

export const ORGANIZATION_BILLING_LIFECYCLE_EVENTS = [
  'organization.invoice_payment_failed',
  'organization.invoice_payment_recovered',
  'organization.subscription_cancelled',
] as const

export type OrganizationBillingLifecycleEvent =
  (typeof ORGANIZATION_BILLING_LIFECYCLE_EVENTS)[number]

interface RecordOrganizationBillingLifecycleAuditParams {
  organizationId: string
  billingEvent: OrganizationBillingLifecycleEvent
  subscriptionId: string
  stripeSubscriptionId?: string | null
  invoiceId?: string | null
  invoiceType?: string | null
  billingPeriod?: string | null
  amountDollars?: number | null
  attemptCount?: number | null
  hostedInvoiceUrl?: string | null
  cancellationKind?: string | null
  totalOverage?: number | null
  remainingOverage?: number | null
  restoredProCount?: number | null
  membersSynced?: number | null
  workspacesDetached?: number | null
}

function getBillingLifecycleDescription(
  event: OrganizationBillingLifecycleEvent,
  amountDollars?: number | null
) {
  const amount = typeof amountDollars === 'number' ? ` for $${amountDollars.toFixed(2)}` : ''
  if (event === 'organization.invoice_payment_failed') {
    return `Organization invoice payment failed${amount}`
  }
  if (event === 'organization.subscription_cancelled') {
    return 'Organization subscription cancelled'
  }
  return `Organization invoice payment recovered${amount}`
}

export async function recordOrganizationBillingLifecycleAudit(
  params: RecordOrganizationBillingLifecycleAuditParams
): Promise<void> {
  let organizationName: string | null = null

  try {
    const [organizationRow] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, params.organizationId))
      .limit(1)
    organizationName = organizationRow?.name ?? null
  } catch (error) {
    logger.warn('Failed to resolve organization name for billing lifecycle audit', {
      error,
      organizationId: params.organizationId,
    })
  }

  recordAudit({
    actorId: 'system:stripe',
    actorName: 'Stripe webhook',
    action: AuditAction.ORGANIZATION_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: params.organizationId,
    resourceName: organizationName ?? params.organizationId,
    description: getBillingLifecycleDescription(params.billingEvent, params.amountDollars),
    metadata: {
      organizationId: params.organizationId,
      billingEvent: params.billingEvent,
      subscriptionId: params.subscriptionId,
      stripeSubscriptionId: params.stripeSubscriptionId,
      invoiceId: params.invoiceId,
      invoiceType: params.invoiceType,
      billingPeriod: params.billingPeriod,
      amountDollars: params.amountDollars,
      attemptCount: params.attemptCount,
      hostedInvoiceUrl: params.hostedInvoiceUrl,
      cancellationKind: params.cancellationKind,
      totalOverage: params.totalOverage,
      remainingOverage: params.remainingOverage,
      restoredProCount: params.restoredProCount,
      membersSynced: params.membersSynced,
      workspacesDetached: params.workspacesDetached,
    },
  })
}
