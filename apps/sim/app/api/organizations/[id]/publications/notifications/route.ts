import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { deliverOrganizationPublicationNotificationsContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { deliverOrganizationPublicationNotifications } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrganizationPublicationNotificationsAPI')

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(
    deliverOrganizationPublicationNotificationsContract,
    request,
    context
  )
  if (!parsed.success) return parsed.response

  try {
    const delivery = await deliverOrganizationPublicationNotifications({
      userId: session.user.id,
      organizationId: parsed.data.params.id,
      channel: parsed.data.body.channel,
      projectName: parsed.data.body.projectName,
      webhookUrl: parsed.data.body.webhookUrl,
    })

    return NextResponse.json({ delivery })
  } catch (error) {
    logger.warn('Failed to deliver organization publication notifications', { error })
    return NextResponse.json({ error: 'Organization admin access required' }, { status: 403 })
  }
})
