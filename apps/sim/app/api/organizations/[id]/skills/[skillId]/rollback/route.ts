import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { rollbackSkillRevisionContract } from '@/lib/api/contracts/skill-proposals'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { rollbackSkillRevision } from '@/lib/hermes/skill-proposals'

const logger = createLogger('SkillRevisionRollbackAPI')

function statusForError(error: unknown): number {
  if (!(error instanceof Error)) return 500
  if (/skill revision not found|skill not found/i.test(error.message)) return 404
  if (/admin access|required|does not belong/i.test(error.message)) return 403
  return 400
}

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(rollbackSkillRevisionContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const result = await rollbackSkillRevision({
      actorUserId: session.user.id,
      organizationId: parsed.data.params.id,
      skillId: parsed.data.params.skillId,
      version: parsed.data.body.version,
      reason: parsed.data.body.reason,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    logger.warn('Failed to rollback SIM skill revision', error)
    return NextResponse.json(
      { error: 'Unable to rollback skill revision' },
      { status: statusForError(error) }
    )
  }
})
