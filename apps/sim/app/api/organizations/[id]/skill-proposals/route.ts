import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { listSkillProposalsContract } from '@/lib/api/contracts/skill-proposals'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listSkillProposalsForReview } from '@/lib/hermes/skill-proposals'

const logger = createLogger('SkillProposalsAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(listSkillProposalsContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const proposals = await listSkillProposalsForReview({
      userId: session.user.id,
      organizationId: parsed.data.params.id,
      status: parsed.data.query.status,
      limit: parsed.data.query.limit,
    })
    return NextResponse.json({ proposals })
  } catch (error) {
    logger.warn('Failed to list Hermes skill proposals', error)
    return NextResponse.json({ error: 'Organization admin access required' }, { status: 403 })
  }
})
