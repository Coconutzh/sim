import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  createCopilotSkillCardContract,
  listOrganizationCopilotSkillCardsContract,
} from '@/lib/api/contracts/copilot-skill-cards'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  CopilotSkillCardServiceError,
  createCopilotSkillCard,
  listOrganizationCopilotSkillCards,
} from '@/lib/copilot/skill-card-service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrganizationCopilotSkillCardsAPI')

function skillCardErrorResponse(message: string, error: unknown) {
  if (error instanceof CopilotSkillCardServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  logger.warn(message, error)
  return NextResponse.json({ error: message }, { status: 500 })
}

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(listOrganizationCopilotSkillCardsContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const cards = await listOrganizationCopilotSkillCards({
      userId: session.user.id,
      organizationId: parsed.data.params.id,
      agentCode: parsed.data.query.agentCode,
      workgroupId: parsed.data.query.workgroupId,
    })
    return NextResponse.json({ cards })
  } catch (error) {
    return skillCardErrorResponse('Failed to list Copilot skill cards', error)
  }
})

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(createCopilotSkillCardContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const card = await createCopilotSkillCard({
      userId: session.user.id,
      organizationId: parsed.data.params.id,
      input: {
        agentCode: parsed.data.body.agentCode,
        workgroupId: parsed.data.body.workgroupId,
        title: parsed.data.body.title,
        description: parsed.data.body.description,
        prompt: parsed.data.body.prompt,
        actionKind: parsed.data.body.actionKind,
        taskDraft: parsed.data.body.taskDraft,
        enabled: parsed.data.body.enabled,
        sortOrder: parsed.data.body.sortOrder,
      },
    })
    return NextResponse.json({ card })
  } catch (error) {
    return skillCardErrorResponse('Failed to create Copilot skill card', error)
  }
})
