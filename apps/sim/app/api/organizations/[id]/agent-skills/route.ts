import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  listOrganizationAgentSkillPoliciesContract,
  updateOrganizationAgentSkillPolicyContract,
} from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  listOrganizationAgentSkillPolicies,
  updateOrganizationAgentSkillPolicy,
} from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrganizationAgentSkillsAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(listOrganizationAgentSkillPoliciesContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const policies = await listOrganizationAgentSkillPolicies({
      userId: session.user.id,
      organizationId: parsed.data.params.id,
      agentCode: parsed.data.query.agentCode,
    })
    return NextResponse.json({ policies })
  } catch (error) {
    logger.warn('Failed to list organization agent skill policies', error)
    return NextResponse.json({ error: 'Organization admin access required' }, { status: 403 })
  }
})

export const PATCH = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(updateOrganizationAgentSkillPolicyContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const policy = await updateOrganizationAgentSkillPolicy({
      actorUserId: session.user.id,
      organizationId: parsed.data.params.id,
      agentCode: parsed.data.body.agentCode,
      skillId: parsed.data.body.skillId,
      enabled: parsed.data.body.enabled,
    })
    return NextResponse.json({ policy })
  } catch (error) {
    logger.warn('Failed to update organization agent skill policy', error)
    return NextResponse.json({ error: 'Unable to update agent skill policy' }, { status: 403 })
  }
})
