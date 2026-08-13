import { db, platformCreditLedger, platformCreditWallet, user } from '@sim/db'
import { generateId } from '@sim/utils/id'
import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import type { CreditCapability } from '@/lib/credits/media-pricing'

export class InsufficientCreditsError extends Error {
  constructor(requiredCredits: number, availableCredits: number) {
    super(`Insufficient credits: ${requiredCredits} required, ${availableCredits} available`)
    this.name = 'InsufficientCreditsError'
  }
}

export interface CreditWalletSummary {
  availableCredits: number
  reservedCredits: number
  totalConsumedCredits: number
  isUnlimited: boolean
}

async function isPlatformAdministrator(userId: string): Promise<boolean> {
  const [account] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  return account?.role === 'admin'
}

async function ensureWallet(userId: string) {
  await db
    .insert(platformCreditWallet)
    .values({ id: generateId(), userId })
    .onConflictDoNothing({ target: platformCreditWallet.userId })
  const [wallet] = await db
    .select()
    .from(platformCreditWallet)
    .where(eq(platformCreditWallet.userId, userId))
  if (!wallet) throw new Error('Failed to create platform credit wallet')
  return wallet
}

export async function getCreditWallet(userId: string): Promise<CreditWalletSummary> {
  if (await isPlatformAdministrator(userId)) {
    return { availableCredits: 0, reservedCredits: 0, totalConsumedCredits: 0, isUnlimited: true }
  }
  const wallet = await ensureWallet(userId)
  return {
    availableCredits: wallet.availableCredits,
    reservedCredits: wallet.reservedCredits,
    totalConsumedCredits: wallet.totalConsumedCredits,
    isUnlimited: false,
  }
}

/** Returns the currently reserved amount for one idempotent credit operation. */
export async function getReservedCreditsForOperation(operationId: string): Promise<number> {
  const [reservation] = await db
    .select({ reservedCredits: platformCreditLedger.reservedDelta })
    .from(platformCreditLedger)
    .where(
      and(
        eq(platformCreditLedger.operationId, operationId),
        eq(platformCreditLedger.eventType, 'reserve')
      )
    )
  return reservation?.reservedCredits ?? 0
}

export async function reserveCredits(params: {
  userId: string
  operationId: string
  credits: number
  capability: CreditCapability
  modelId: string
  workspaceId?: string
  workflowId?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  if (await isPlatformAdministrator(params.userId)) return
  const wallet = await ensureWallet(params.userId)
  const existing = await db
    .select({ id: platformCreditLedger.id })
    .from(platformCreditLedger)
    .where(
      and(
        eq(platformCreditLedger.operationId, params.operationId),
        eq(platformCreditLedger.eventType, 'reserve')
      )
    )
  if (existing.length > 0) return

  const updated = await db
    .update(platformCreditWallet)
    .set({
      availableCredits: sql`${platformCreditWallet.availableCredits} - ${params.credits}`,
      reservedCredits: sql`${platformCreditWallet.reservedCredits} + ${params.credits}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(platformCreditWallet.id, wallet.id),
        gte(platformCreditWallet.availableCredits, params.credits)
      )
    )
    .returning({ availableCredits: platformCreditWallet.availableCredits })
  if (updated.length === 0)
    throw new InsufficientCreditsError(params.credits, wallet.availableCredits)

  await db.insert(platformCreditLedger).values({
    id: generateId(),
    walletId: wallet.id,
    operationId: params.operationId,
    eventType: 'reserve',
    availableDelta: -params.credits,
    reservedDelta: params.credits,
    balanceAfter: updated[0].availableCredits,
    actorUserId: params.userId,
    workspaceId: params.workspaceId ?? null,
    workflowId: params.workflowId ?? null,
    capability: params.capability,
    modelId: params.modelId,
    metadata: params.metadata ?? null,
  })
}

async function finishReservation(params: {
  userId: string
  operationId: string
  eventType: 'settle' | 'release'
  capability: CreditCapability
  modelId: string
  workspaceId?: string
  workflowId?: string
  consumedCredits?: number
  metadata?: Record<string, unknown>
}) {
  if (await isPlatformAdministrator(params.userId)) return
  const wallet = await ensureWallet(params.userId)
  const [reservation] = await db
    .select()
    .from(platformCreditLedger)
    .where(
      and(
        eq(platformCreditLedger.operationId, params.operationId),
        eq(platformCreditLedger.eventType, 'reserve')
      )
    )
  if (!reservation) return
  const existing = await db
    .select({ id: platformCreditLedger.id })
    .from(platformCreditLedger)
    .where(
      and(
        eq(platformCreditLedger.operationId, params.operationId),
        inArray(platformCreditLedger.eventType, ['settle', 'release'])
      )
    )
  if (existing.length > 0) return
  const reservedCredits = reservation.reservedDelta
  const consumedCredits = params.eventType === 'settle' ? params.consumedCredits ?? reservedCredits : 0
  if (!Number.isInteger(consumedCredits) || consumedCredits < 0) {
    throw new Error('Consumed credits must be a non-negative integer')
  }
  const availableDelta =
    params.eventType === 'release' ? reservedCredits : reservedCredits - consumedCredits
  const updated = await db
    .update(platformCreditWallet)
    .set({
      availableCredits:
        availableDelta >= 0
          ? sql`${platformCreditWallet.availableCredits} + ${availableDelta}`
          : sql`${platformCreditWallet.availableCredits} - ${Math.abs(availableDelta)}`,
      reservedCredits: sql`GREATEST(0, ${platformCreditWallet.reservedCredits} - ${reservedCredits})`,
      totalConsumedCredits:
        params.eventType === 'settle'
          ? sql`${platformCreditWallet.totalConsumedCredits} + ${consumedCredits}`
          : platformCreditWallet.totalConsumedCredits,
      updatedAt: new Date(),
    })
    .where(
      availableDelta < 0
        ? and(eq(platformCreditWallet.id, wallet.id), gte(platformCreditWallet.availableCredits, Math.abs(availableDelta)))
        : eq(platformCreditWallet.id, wallet.id)
    )
    .returning({ availableCredits: platformCreditWallet.availableCredits })
  if (updated.length === 0) {
    const latest = await getCreditWallet(params.userId)
    throw new InsufficientCreditsError(Math.abs(availableDelta), latest.availableCredits)
  }
  await db.insert(platformCreditLedger).values({
    id: generateId(),
    walletId: wallet.id,
    operationId: params.operationId,
    eventType: params.eventType,
    availableDelta,
    reservedDelta: -reservedCredits,
    balanceAfter: updated[0].availableCredits,
    actorUserId: params.userId,
    workspaceId: params.workspaceId ?? null,
    workflowId: params.workflowId ?? null,
    capability: params.capability,
    modelId: params.modelId,
    metadata: params.metadata ?? null,
  })
}

export function settleCredits(params: Omit<Parameters<typeof finishReservation>[0], 'eventType'>) {
  return finishReservation({ ...params, eventType: 'settle' })
}

export function releaseCredits(params: Omit<Parameters<typeof finishReservation>[0], 'eventType'>) {
  return finishReservation({ ...params, eventType: 'release' })
}

export async function adjustCredits(params: {
  userId: string
  actorUserId: string
  amount: number
  reason: string
}) {
  if (!Number.isInteger(params.amount) || params.amount === 0)
    throw new Error('Credit amount must be a non-zero integer')
  const wallet = await ensureWallet(params.userId)
  const updated = await db
    .update(platformCreditWallet)
    .set({
      availableCredits:
        params.amount > 0
          ? sql`${platformCreditWallet.availableCredits} + ${params.amount}`
          : sql`GREATEST(0, ${platformCreditWallet.availableCredits} + ${params.amount})`,
      updatedAt: new Date(),
    })
    .where(eq(platformCreditWallet.id, wallet.id))
    .returning({ availableCredits: platformCreditWallet.availableCredits })
  await db.insert(platformCreditLedger).values({
    id: generateId(),
    walletId: wallet.id,
    operationId: generateId(),
    eventType: 'admin_adjust',
    availableDelta: params.amount,
    reservedDelta: 0,
    balanceAfter: updated[0].availableCredits,
    actorUserId: params.actorUserId,
    metadata: { reason: params.reason },
  })
  return updated[0]
}
