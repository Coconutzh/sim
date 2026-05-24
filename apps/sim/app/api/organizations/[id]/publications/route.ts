import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { listOrganizationPublicationsContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { listOrganizationPublications } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrganizationPublicationsAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(listOrganizationPublicationsContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const publications = await listOrganizationPublications({
      userId: session.user.id,
      organizationId: parsed.data.params.id,
      disciplineCode: parsed.data.query.disciplineCode,
      sourceWorkgroupId: parsed.data.query.sourceWorkgroupId,
      agentCode: parsed.data.query.agentCode,
      status: parsed.data.query.status,
      limit: parsed.data.query.limit,
    })
    return NextResponse.json({ publications, nextCursor: null })
  } catch (error) {
    logger.warn('Failed to list organization publications', { error })
    return NextResponse.json({ error: 'Organization admin access required' }, { status: 403 })
  }
})
