import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { updatePublicationVisibilityContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { updatePublicationVisibility } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('PublicationVisibilityAPI')

export const PATCH = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(updatePublicationVisibilityContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const publication = await updatePublicationVisibility({
      actorUserId: session.user.id,
      publicationVersionId: parsed.data.params.publicationVersionId,
      visibility: parsed.data.body.visibility,
      targetWorkgroupIds: parsed.data.body.targetWorkgroupIds,
      reason: parsed.data.body.reason,
    })
    return NextResponse.json({ publication })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Publication visibility update failed'
    logger.warn('Failed to update publication visibility', { error })
    const status = message.includes('access required') ? 403 : 404
    return NextResponse.json({ error: message }, { status })
  }
})
