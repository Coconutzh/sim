import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { reviewSkillProposalContract } from '@/lib/api/contracts/skill-proposals'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { reviewSkillProposal } from '@/lib/hermes/skill-proposals'

const logger = createLogger('SkillProposalReviewAPI')

function statusForError(error: unknown): number {
  if (!(error instanceof Error)) return 500
  if (/proposal not found/i.test(error.message)) return 404
  if (/admin access|required|does not belong/i.test(error.message)) return 403
  return 400
}

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(reviewSkillProposalContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const proposal = await reviewSkillProposal({
      actorUserId: session.user.id,
      organizationId: parsed.data.params.id,
      proposalId: parsed.data.params.proposalId,
      action: parsed.data.body.action,
      reviewNote: parsed.data.body.reviewNote,
    })
    return NextResponse.json({ proposal }, { status: 200 })
  } catch (error) {
    logger.warn('Failed to review Hermes skill proposal', error)
    return NextResponse.json(
      { error: 'Unable to review skill proposal' },
      { status: statusForError(error) }
    )
  }
})
