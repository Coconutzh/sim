import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  listOrganizationProjectNotificationCenterContract,
  markOrganizationProjectNotificationCenterReadContract,
} from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  listOrganizationProjectNotificationCenter,
  markOrganizationProjectNotificationCenterRead,
} from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrganizationProjectNotificationCenterAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(
    listOrganizationProjectNotificationCenterContract,
    request,
    context
  )
  if (!parsed.success) return parsed.response

  try {
    return NextResponse.json(
      await listOrganizationProjectNotificationCenter({
        userId: session.user.id,
        organizationId: parsed.data.params.id,
        limit: parsed.data.query.limit,
        offset: parsed.data.query.offset,
        kind: parsed.data.query.kind,
      })
    )
  } catch (error) {
    logger.warn('Failed to list organization project notification center', { error })
    return NextResponse.json({ error: 'Organization admin access required' }, { status: 403 })
  }
})

export const PATCH = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(
    markOrganizationProjectNotificationCenterReadContract,
    request,
    context
  )
  if (!parsed.success) return parsed.response

  try {
    return NextResponse.json(
      await markOrganizationProjectNotificationCenterRead({
        userId: session.user.id,
        organizationId: parsed.data.params.id,
        notificationId: parsed.data.body.notificationId,
        markAll: parsed.data.body.markAll,
        kind: parsed.data.body.kind,
      })
    )
  } catch (error) {
    logger.warn('Failed to mark organization project notification center read', { error })
    return NextResponse.json({ error: 'Organization admin access required' }, { status: 403 })
  }
})
