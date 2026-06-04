import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { listRuntimeCopilotSkillCardsContract } from '@/lib/api/contracts/copilot-skill-cards'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  CopilotSkillCardServiceError,
  listRuntimeCopilotSkillCards,
} from '@/lib/copilot/skill-card-service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('RuntimeCopilotSkillCardsAPI')

function skillCardErrorResponse(message: string, error: unknown) {
  if (error instanceof CopilotSkillCardServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  logger.warn(message, error)
  return NextResponse.json({ error: message }, { status: 500 })
}

export const GET = withRouteHandler(async (request) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(listRuntimeCopilotSkillCardsContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    const cards = await listRuntimeCopilotSkillCards({
      userId: session.user.id,
      workspaceId: parsed.data.query.workspaceId,
    })
    return NextResponse.json({ cards })
  } catch (error) {
    return skillCardErrorResponse('Failed to list Copilot skill cards', error)
  }
})
