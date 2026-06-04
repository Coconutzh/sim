import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  deleteCopilotSkillCardContract,
  updateCopilotSkillCardContract,
} from '@/lib/api/contracts/copilot-skill-cards'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  CopilotSkillCardServiceError,
  deleteCopilotSkillCard,
  updateCopilotSkillCard,
} from '@/lib/copilot/skill-card-service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CopilotSkillCardDetailAPI')

function skillCardErrorResponse(message: string, error: unknown) {
  if (error instanceof CopilotSkillCardServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  logger.warn(message, error)
  return NextResponse.json({ error: message }, { status: 500 })
}

export const PATCH = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(updateCopilotSkillCardContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const card = await updateCopilotSkillCard({
      userId: session.user.id,
      cardId: parsed.data.params.cardId,
      input: parsed.data.body,
    })
    return NextResponse.json({ card })
  } catch (error) {
    return skillCardErrorResponse('Failed to update Copilot skill card', error)
  }
})

export const DELETE = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(deleteCopilotSkillCardContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    await deleteCopilotSkillCard({
      userId: session.user.id,
      cardId: parsed.data.params.cardId,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return skillCardErrorResponse('Failed to delete Copilot skill card', error)
  }
})
