import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  removeWorkgroupMemberContract,
  updateWorkgroupMemberContract,
} from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { removeWorkgroupMember, updateWorkgroupMemberRole } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('WorkgroupMemberAPI')

export const PATCH = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(updateWorkgroupMemberContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    await updateWorkgroupMemberRole({
      actorUserId: session.user.id,
      workgroupId: parsed.data.params.workgroupId,
      userId: parsed.data.params.userId,
      role: parsed.data.body.role,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.warn('Failed to update workgroup member', error)
    return NextResponse.json({ error: 'Unable to update workgroup member' }, { status: 403 })
  }
})

export const DELETE = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(removeWorkgroupMemberContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    await removeWorkgroupMember({
      actorUserId: session.user.id,
      workgroupId: parsed.data.params.workgroupId,
      userId: parsed.data.params.userId,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.warn('Failed to remove workgroup member', error)
    return NextResponse.json({ error: 'Unable to remove workgroup member' }, { status: 403 })
  }
})
