import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin/auth'
import { applyAdminConsoleCredits } from '@/lib/admin/console'
import { adminConsoleApplyCreditsContract } from '@/lib/api/contracts/admin-console'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('AdminConsoleCreditsAPI')

interface RouteParams {
  id: string
}

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<RouteParams> }) => {
    const auth = await requirePlatformAdmin()
    if (!auth.success) return auth.response

    const parsed = await parseRequest(adminConsoleApplyCreditsContract, request, context)
    if (!parsed.success) return parsed.response

    try {
      const result = await applyAdminConsoleCredits({
        actorUserId: auth.session.user.id,
        userId: parsed.data.params.id,
        body: parsed.data.body,
      })
      return NextResponse.json(result)
    } catch (error) {
      logger.error('Failed to apply admin console credits', { error })
      return NextResponse.json({ error: 'Failed to update credits' }, { status: 500 })
    }
  }
)
