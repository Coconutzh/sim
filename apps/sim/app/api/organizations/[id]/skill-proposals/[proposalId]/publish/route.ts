import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { publishSkillProposalContract } from '@/lib/api/contracts/skill-proposals'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { publishSkillProposal } from '@/lib/hermes/skill-proposals'

const logger = createLogger('SkillProposalPublishAPI')

function statusForError(error: unknown): number {
  if (!(error instanceof Error)) return 500
  if (/proposal not found|skill not found/i.test(error.message)) return 404
  if (/already exists/i.test(error.message)) return 409
  if (/admin access|required|does not belong/i.test(error.message)) return 403
  return 400
}

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(publishSkillProposalContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const result = await publishSkillProposal({
      actorUserId: session.user.id,
      organizationId: parsed.data.params.id,
      proposalId: parsed.data.params.proposalId,
      enableBinding: parsed.data.body.enableBinding,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    logger.warn('Failed to publish Hermes skill proposal', error)
    return NextResponse.json(
      { error: 'Unable to publish skill proposal' },
      { status: statusForError(error) }
    )
  }
})
