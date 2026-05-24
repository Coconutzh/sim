import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { listOrganizationWorkgroupActivityContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { listOrganizationWorkgroupActivity } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrganizationWorkgroupActivityAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(listOrganizationWorkgroupActivityContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const activity = await listOrganizationWorkgroupActivity({
      userId: session.user.id,
      organizationId: parsed.data.params.id,
      workgroupId: parsed.data.query.workgroupId,
      disciplineId: parsed.data.query.disciplineId,
      action: parsed.data.query.action,
      search: parsed.data.query.search,
      limit: parsed.data.query.limit,
    })
    return NextResponse.json({ activity })
  } catch (error) {
    logger.warn('Failed to list organization workgroup activity', error)
    return NextResponse.json({ error: 'Organization admin access required' }, { status: 403 })
  }
})
