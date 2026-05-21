import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { getPublicationTreeContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getPublicationTree } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('PublicationTreeAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(getPublicationTreeContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const tree = await getPublicationTree({
      userId: session.user.id,
      publicationVersionId: parsed.data.params.publicationVersionId,
    })
    return NextResponse.json(tree)
  } catch (error) {
    logger.warn('Failed to get publication tree', error)
    return NextResponse.json({ error: 'Publication not found or access denied' }, { status: 404 })
  }
})
