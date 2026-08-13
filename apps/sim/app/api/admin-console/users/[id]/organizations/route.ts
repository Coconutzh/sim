import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin/auth'
import { setAdminConsoleOrganizationMembership } from '@/lib/admin/console'
import { adminConsoleSetOrganizationMembershipContract } from '@/lib/api/contracts/admin-console'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('AdminConsoleUserOrganizationsAPI')

export const PUT = withRouteHandler(async (request: NextRequest, context) => {
  const auth = await requirePlatformAdmin()
  if (!auth.success) return auth.response

  const parsed = await parseRequest(adminConsoleSetOrganizationMembershipContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const memberships = await setAdminConsoleOrganizationMembership({
      actorUserId: auth.session.user.id,
      userId: parsed.data.params.id,
      body: parsed.data.body,
    })
    return NextResponse.json({ success: true, memberships })
  } catch (error) {
    logger.error('Failed to set organization membership', {
      error,
      userId: parsed.data.params.id,
    })
    return NextResponse.json({ error: 'Failed to set organization membership' }, { status: 500 })
  }
})
