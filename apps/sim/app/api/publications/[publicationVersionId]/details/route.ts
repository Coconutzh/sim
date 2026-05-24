import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { updatePublicationDetailsContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { updatePublicationDetails } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('PublicationDetailsAPI')

export const PATCH = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(updatePublicationDetailsContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const publication = await updatePublicationDetails({
      actorUserId: session.user.id,
      publicationVersionId: parsed.data.params.publicationVersionId,
      title: parsed.data.body.title,
      description: parsed.data.body.description,
      reason: parsed.data.body.reason,
    })
    return NextResponse.json({ publication })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Publication detail update failed'
    logger.warn('Failed to update publication details', { error })
    const status = message.includes('access required') ? 403 : 404
    return NextResponse.json({ error: message }, { status })
  }
})
