import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { batchAddWorkgroupMembersContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { addWorkgroupMembersBatch } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('WorkgroupMembersBatchAPI')

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(batchAddWorkgroupMembersContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const assigned = await addWorkgroupMembersBatch({
      actorUserId: session.user.id,
      workgroupId: parsed.data.params.workgroupId,
      role: parsed.data.body.role,
      targets: parsed.data.body.targets,
    })
    return NextResponse.json({ success: true, assigned })
  } catch (error) {
    logger.warn('Failed to batch add workgroup members', error)
    return NextResponse.json({ error: 'Unable to batch add workgroup members' }, { status: 403 })
  }
})
