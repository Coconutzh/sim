import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { listOrganizationPublicationNotificationInboxContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { listOrganizationPublicationNotificationInbox } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrganizationPublicationNotificationInboxAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(
    listOrganizationPublicationNotificationInboxContract,
    request,
    context
  )
  if (!parsed.success) return parsed.response

  try {
    return NextResponse.json(
      await listOrganizationPublicationNotificationInbox({
        userId: session.user.id,
        organizationId: parsed.data.params.id,
        limit: parsed.data.query.limit,
        offset: parsed.data.query.offset,
      })
    )
  } catch (error) {
    logger.warn('Failed to list organization publication notification inbox', { error })
    return NextResponse.json({ error: 'Organization admin access required' }, { status: 403 })
  }
})
