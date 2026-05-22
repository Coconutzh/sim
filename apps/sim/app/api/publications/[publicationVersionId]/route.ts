import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  getPublicationContract,
  updatePublicationLifecycleContract,
} from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getPublication, updatePublicationLifecycleStatus } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('PublicationAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(getPublicationContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const publication = await getPublication({
      userId: session.user.id,
      publicationVersionId: parsed.data.params.publicationVersionId,
    })
    return NextResponse.json({ publication })
  } catch (error) {
    logger.warn('Failed to get publication', error)
    return NextResponse.json({ error: 'Publication not found or access denied' }, { status: 404 })
  }
})


export const PATCH = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(updatePublicationLifecycleContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const publication = await updatePublicationLifecycleStatus({
      actorUserId: session.user.id,
      publicationVersionId: parsed.data.params.publicationVersionId,
      action: parsed.data.body.action,
      reason: parsed.data.body.reason,
    })
    return NextResponse.json({ publication })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Publication update failed'
    logger.warn('Failed to update publication lifecycle', { error })
    const status = message.includes('access required') ? 403 : 404
    return NextResponse.json({ error: message }, { status })
  }
})
