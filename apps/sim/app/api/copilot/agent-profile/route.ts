import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { getCopilotAgentProfileContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { resolveAgentForWorkspace } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CopilotAgentProfileAPI')

export const GET = withRouteHandler(async (request) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(getCopilotAgentProfileContract, request, {})
  if (!parsed.success) return parsed.response
  try {
    const resolved = await resolveAgentForWorkspace({
      userId: session.user.id,
      workspaceId: parsed.data.query.workspaceId,
    })
    return NextResponse.json({
      agent: {
        code: resolved.agent.code,
        name: resolved.agent.name,
        description: resolved.agent.description,
        systemPrompt: resolved.agent.defaultSystemPrompt,
      },
      discipline: resolved.discipline,
      workgroup: resolved.workgroup,
      skills: resolved.skills,
    })
  } catch (error) {
    logger.warn('Failed to resolve copilot agent profile', error)
    return NextResponse.json({ error: 'Agent profile access denied' }, { status: 403 })
  }
})
