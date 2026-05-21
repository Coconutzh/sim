import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { listMyWorkgroupsContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getDefaultActiveWorkgroupId, listUserWorkgroups } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('MyWorkgroupsAPI')

export const GET = withRouteHandler(async (request) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(listMyWorkgroupsContract, request, {})
  if (!parsed.success) return parsed.response
  try {
    const [workgroups, defaultWorkgroupId] = await Promise.all([
      listUserWorkgroups(session.user.id),
      getDefaultActiveWorkgroupId(session.user.id),
    ])
    return NextResponse.json({ workgroups, defaultWorkgroupId })
  } catch (error) {
    logger.error('Failed to list user workgroups', error)
    return NextResponse.json({ error: 'Failed to list workgroups' }, { status: 500 })
  }
})
