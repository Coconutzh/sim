import { type NextRequest, NextResponse } from 'next/server'
import { getMyCreditsContract } from '@/lib/api/contracts/credits'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getCreditWallet } from '@/lib/credits/wallet'

export const GET = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(getMyCreditsContract, request, {})
  if (!parsed.success) return parsed.response
  return NextResponse.json(await getCreditWallet(auth.userId))
})
