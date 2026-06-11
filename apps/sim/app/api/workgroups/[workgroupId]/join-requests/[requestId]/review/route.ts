import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { reviewWorkgroupJoinRequestContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { reviewWorkgroupJoinRequest } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('WorkgroupJoinRequestReviewAPI')

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(reviewWorkgroupJoinRequestContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const joinRequest = await reviewWorkgroupJoinRequest({
      actorUserId: session.user.id,
      workgroupId: parsed.data.params.workgroupId,
      requestId: parsed.data.params.requestId,
      action: parsed.data.body.action,
      role: parsed.data.body.role,
      reviewNote: parsed.data.body.reviewNote,
    })
    return NextResponse.json({ request: joinRequest })
  } catch (error) {
    logger.warn('Failed to review workgroup join request', error)
    return NextResponse.json({ error: 'Unable to review join request' }, { status: 403 })
  }
})
