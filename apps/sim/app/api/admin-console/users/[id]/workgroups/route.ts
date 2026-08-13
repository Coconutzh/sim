import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin/auth'
import { setAdminConsoleWorkgroupMembership } from '@/lib/admin/console'
import { adminConsoleSetWorkgroupMembershipContract } from '@/lib/api/contracts/admin-console'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('AdminConsoleUserWorkgroupsAPI')

export const PUT = withRouteHandler(async (request: NextRequest, context) => {
  const auth = await requirePlatformAdmin()
  if (!auth.success) return auth.response

  const parsed = await parseRequest(adminConsoleSetWorkgroupMembershipContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const memberships = await setAdminConsoleWorkgroupMembership({
      actorUserId: auth.session.user.id,
      userId: parsed.data.params.id,
      body: parsed.data.body,
    })
    if (!memberships) {
      return NextResponse.json({ error: 'Workgroup not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true, memberships })
  } catch (error) {
    logger.error('Failed to set workgroup membership', { error, userId: parsed.data.params.id })
    return NextResponse.json({ error: 'Failed to set workgroup membership' }, { status: 500 })
  }
})
