import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  createWorkgroupJoinRequestContract,
  listWorkgroupJoinRequestsContract,
} from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  createWorkgroupJoinRequest,
  listWorkgroupJoinRequests,
} from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('WorkgroupJoinRequestsAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(listWorkgroupJoinRequestsContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const requests = await listWorkgroupJoinRequests({
      actorUserId: session.user.id,
      workgroupId: parsed.data.params.workgroupId,
    })
    return NextResponse.json({ requests })
  } catch (error) {
    logger.warn('Failed to list workgroup join requests', error)
    return NextResponse.json({ error: 'Workgroup admin access required' }, { status: 403 })
  }
})

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(createWorkgroupJoinRequestContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const joinRequest = await createWorkgroupJoinRequest({
      actorUserId: session.user.id,
      workgroupId: parsed.data.params.workgroupId,
      message: parsed.data.body.message,
    })
    return NextResponse.json({ request: joinRequest })
  } catch (error) {
    logger.warn('Failed to create workgroup join request', error)
    return NextResponse.json({ error: 'Unable to create join request' }, { status: 403 })
  }
})
