import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin/auth'
import { getAdminConsoleUsage } from '@/lib/admin/console'
import { adminConsoleUsageContract } from '@/lib/api/contracts/admin-console'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('AdminConsoleUsageAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  const auth = await requirePlatformAdmin()
  if (!auth.success) return auth.response

  const parsed = await parseRequest(adminConsoleUsageContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    return NextResponse.json(await getAdminConsoleUsage(parsed.data.query))
  } catch (error) {
    logger.error('Failed to get admin console usage', { error })
    return NextResponse.json({ error: 'Failed to get usage' }, { status: 500 })
  }
})
