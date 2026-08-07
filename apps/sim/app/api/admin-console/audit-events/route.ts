import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin/auth'
import { getAdminConsoleAuditEvents } from '@/lib/admin/console'
import { adminConsoleAuditEventsContract } from '@/lib/api/contracts/admin-console'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('AdminConsoleAuditEventsAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  const auth = await requirePlatformAdmin()
  if (!auth.success) return auth.response

  const parsed = await parseRequest(adminConsoleAuditEventsContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    return NextResponse.json(await getAdminConsoleAuditEvents(parsed.data.query))
  } catch (error) {
    logger.error('Failed to get admin console audit events', { error })
    return NextResponse.json({ error: 'Failed to get audit events' }, { status: 500 })
  }
})
