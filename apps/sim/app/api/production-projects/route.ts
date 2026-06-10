import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { createProductionProjectContract } from '@/lib/api/contracts/production-projects'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { createProductionProject } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('ProductionProjectsAPI')

export const POST = withRouteHandler(async (request) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(createProductionProjectContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    const project = await createProductionProject({
      actorUserId: session.user.id,
      name: parsed.data.body.name,
      estimatedDueAt: parsed.data.body.estimatedDueAt ?? null,
      phases: parsed.data.body.phases ?? [],
    })
    return NextResponse.json({ project })
  } catch (error) {
    logger.warn('Failed to create production project', error)
    return NextResponse.json({ error: 'Unable to create project' }, { status: 403 })
  }
})
