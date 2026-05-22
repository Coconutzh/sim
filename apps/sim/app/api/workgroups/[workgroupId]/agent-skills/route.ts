import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  listWorkgroupAgentSkillsContract,
  updateWorkgroupAgentSkillContract,
} from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { listWorkgroupAgentSkills, updateWorkgroupAgentSkill } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('WorkgroupAgentSkillsAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(listWorkgroupAgentSkillsContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const result = await listWorkgroupAgentSkills({
      userId: session.user.id,
      workgroupId: parsed.data.params.workgroupId,
    })
    return NextResponse.json(result)
  } catch (error) {
    logger.warn('Failed to list workgroup agent skills', error)
    return NextResponse.json({ error: 'Workgroup admin access required' }, { status: 403 })
  }
})

export const PATCH = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(updateWorkgroupAgentSkillContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const binding = await updateWorkgroupAgentSkill({
      actorUserId: session.user.id,
      workgroupId: parsed.data.params.workgroupId,
      skillId: parsed.data.body.skillId,
      enabled: parsed.data.body.enabled,
    })
    return NextResponse.json({ binding })
  } catch (error) {
    logger.warn('Failed to update workgroup agent skill', error)
    return NextResponse.json({ error: 'Unable to update agent skill binding' }, { status: 403 })
  }
})
