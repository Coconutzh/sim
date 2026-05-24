import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { archiveWorkgroupContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { archiveWorkgroup } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('WorkgroupArchiveAPI')

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(archiveWorkgroupContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const workgroup = await archiveWorkgroup({
      actorUserId: session.user.id,
      workgroupId: parsed.data.params.workgroupId,
    })
    return NextResponse.json({ workgroup })
  } catch (error) {
    logger.warn('Failed to archive workgroup', error)
    return NextResponse.json({ error: 'Unable to archive workgroup' }, { status: 403 })
  }
})
