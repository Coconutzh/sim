import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin/auth'
import { getAdminConsoleUserMemberships } from '@/lib/admin/console'
import { adminConsoleUserMembershipsContract } from '@/lib/api/contracts/admin-console'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('AdminConsoleUserMembershipsAPI')

export const GET = withRouteHandler(async (request: NextRequest, context) => {
  const auth = await requirePlatformAdmin()
  if (!auth.success) return auth.response

  const parsed = await parseRequest(adminConsoleUserMembershipsContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    return NextResponse.json(await getAdminConsoleUserMemberships(parsed.data.params.id))
  } catch (error) {
    logger.error('Failed to get user memberships', { error, userId: parsed.data.params.id })
    return NextResponse.json({ error: 'Failed to get user memberships' }, { status: 500 })
  }
})
