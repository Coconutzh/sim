import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  createOrganizationWorkgroupContract,
  listOrganizationWorkgroupsContract,
} from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { createWorkgroup, listOrganizationWorkgroups } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrganizationWorkgroupsAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(listOrganizationWorkgroupsContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const workgroups = await listOrganizationWorkgroups({
      userId: session.user.id,
      organizationId: parsed.data.params.id,
    })
    return NextResponse.json({ workgroups })
  } catch (error) {
    logger.error('Failed to list organization workgroups', error)
    return NextResponse.json({ error: 'Failed to list workgroups' }, { status: 500 })
  }
})

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(createOrganizationWorkgroupContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const workgroup = await createWorkgroup({
      actorUserId: session.user.id,
      organizationId: parsed.data.params.id,
      disciplineId: parsed.data.body.disciplineId,
      name: parsed.data.body.name,
      teamCanvasName: parsed.data.body.teamCanvasName,
    })
    return NextResponse.json({ workgroup })
  } catch (error) {
    logger.warn('Failed to create workgroup', error)
    return NextResponse.json({ error: 'Unable to create workgroup' }, { status: 403 })
  }
})
