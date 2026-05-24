import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { updatePublicationReviewContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { updatePublicationReview } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('PublicationReviewAPI')

export const PATCH = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(updatePublicationReviewContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const publication = await updatePublicationReview({
      actorUserId: session.user.id,
      publicationVersionId: parsed.data.params.publicationVersionId,
      reviewState: parsed.data.body.reviewState,
      riskLevel: parsed.data.body.riskLevel,
      reviewerUserId: parsed.data.body.reviewerUserId,
      reason: parsed.data.body.reason,
    })
    return NextResponse.json({ publication })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Publication review update failed'
    logger.warn('Failed to update publication review', { error })
    const status = message.includes('access required')
      ? 403
      : message.includes('Reviewer must')
        ? 400
        : 404
    return NextResponse.json({ error: message }, { status })
  }
})
