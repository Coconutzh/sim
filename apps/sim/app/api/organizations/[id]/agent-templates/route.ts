import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  listOrganizationAgentTemplatesContract,
  updateOrganizationAgentTemplateContract,
} from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  listOrganizationAgentTemplates,
  updateOrganizationAgentTemplate,
} from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrganizationAgentTemplatesAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(listOrganizationAgentTemplatesContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const templates = await listOrganizationAgentTemplates({
      userId: session.user.id,
      organizationId: parsed.data.params.id,
    })
    return NextResponse.json({ templates })
  } catch (error) {
    logger.warn('Failed to list organization agent templates', error)
    return NextResponse.json({ error: 'Organization admin access required' }, { status: 403 })
  }
})

export const PATCH = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(updateOrganizationAgentTemplateContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const template = await updateOrganizationAgentTemplate({
      actorUserId: session.user.id,
      organizationId: parsed.data.params.id,
      agentCode: parsed.data.body.agentCode,
      projectInstructions: parsed.data.body.projectInstructions,
    })
    return NextResponse.json({ template })
  } catch (error) {
    logger.warn('Failed to update organization agent template', error)
    return NextResponse.json({ error: 'Unable to update agent template' }, { status: 403 })
  }
})
