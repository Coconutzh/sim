import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { listAgentProfilesContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { listAgentProfiles } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('AgentProfilesAPI')

export const GET = withRouteHandler(async (request) => {
  const parsed = await parseRequest(listAgentProfilesContract, request, {})
  if (!parsed.success) return parsed.response
  try {
    const agents = await listAgentProfiles()
    return NextResponse.json({ agents: agents.map((agent) => ({ ...agent, defaultSkills: [] })) })
  } catch (error) {
    logger.error('Failed to list agent profiles', error)
    return NextResponse.json({ error: 'Failed to list agent profiles' }, { status: 500 })
  }
})
