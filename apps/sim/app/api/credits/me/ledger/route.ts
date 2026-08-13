import { db, platformCreditLedger, platformCreditWallet } from '@sim/db'
import { desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getMyCreditLedgerContract } from '@/lib/api/contracts/credits'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getCreditWallet } from '@/lib/credits/wallet'

export const GET = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(getMyCreditLedgerContract, request, {})
  if (!parsed.success) return parsed.response
  await getCreditWallet(auth.userId)
  const entries = await db
    .select({
      id: platformCreditLedger.id,
      eventType: platformCreditLedger.eventType,
      availableDelta: platformCreditLedger.availableDelta,
      reservedDelta: platformCreditLedger.reservedDelta,
      balanceAfter: platformCreditLedger.balanceAfter,
      capability: platformCreditLedger.capability,
      modelId: platformCreditLedger.modelId,
      metadata: platformCreditLedger.metadata,
      createdAt: platformCreditLedger.createdAt,
    })
    .from(platformCreditLedger)
    .innerJoin(platformCreditWallet, eq(platformCreditLedger.walletId, platformCreditWallet.id))
    .where(eq(platformCreditWallet.userId, auth.userId))
    .orderBy(desc(platformCreditLedger.createdAt))
    .limit(parsed.data.query.limit)
  return NextResponse.json({ entries })
})
