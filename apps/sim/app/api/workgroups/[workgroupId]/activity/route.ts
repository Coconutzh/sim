import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { listWorkgroupActivityContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { listWorkgroupActivity } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('WorkgroupActivityAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(listWorkgroupActivityContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const activity = await listWorkgroupActivity({
      userId: session.user.id,
      workgroupId: parsed.data.params.workgroupId,
      limit: parsed.data.query.limit,
    })
    return NextResponse.json({ activity })
  } catch (error) {
    logger.warn('Failed to list workgroup activity', error)
    return NextResponse.json({ error: 'Workgroup admin access required' }, { status: 403 })
  }
})
