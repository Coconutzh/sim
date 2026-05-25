import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  createTeamWorkspaceContract,
  getTeamWorkspaceContract,
} from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { createTeamWorkspace, getTeamWorkspace } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('TeamWorkspaceAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(getTeamWorkspaceContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const workspace = await getTeamWorkspace({
      userId: session.user.id,
      workgroupId: parsed.data.params.workgroupId,
    })
    return NextResponse.json({ workspace })
  } catch (error) {
    logger.warn('Failed to get team workspace', error)
    return NextResponse.json({ error: 'Team canvas access denied' }, { status: 403 })
  }
})

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(createTeamWorkspaceContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const result = await createTeamWorkspace({
      userId: session.user.id,
      workgroupId: parsed.data.params.workgroupId,
    })
    return NextResponse.json(result)
  } catch (error) {
    logger.warn('Failed to create team workspace', error)
    return NextResponse.json({ error: 'Team canvas initialization denied' }, { status: 403 })
  }
})
