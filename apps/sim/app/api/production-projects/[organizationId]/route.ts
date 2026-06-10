import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { updateProductionProjectContract } from '@/lib/api/contracts/production-projects'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { updateProductionProject } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('ProductionProjectAPI')

export const PATCH = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(updateProductionProjectContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const project = await updateProductionProject({
      actorUserId: session.user.id,
      organizationId: parsed.data.params.organizationId,
      status: parsed.data.body.status,
      estimatedDueAt: parsed.data.body.estimatedDueAt,
      phases: parsed.data.body.phases,
    })
    return NextResponse.json({ project })
  } catch (error) {
    logger.warn('Failed to update production project', error)
    return NextResponse.json({ error: 'Unable to update project' }, { status: 403 })
  }
})
