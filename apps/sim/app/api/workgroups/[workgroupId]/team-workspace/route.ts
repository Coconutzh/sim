import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { getTeamWorkspaceContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getTeamWorkspace } from '@/lib/collaboration/service'
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
    return NextResponse.json({ error: 'Team workspace access denied' }, { status: 403 })
  }
})
