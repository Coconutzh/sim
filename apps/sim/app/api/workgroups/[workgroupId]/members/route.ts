import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  addWorkgroupMemberContract,
  getWorkgroupMembersContract,
} from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { addWorkgroupMember, getWorkgroupMembers } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('WorkgroupMembersAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(getWorkgroupMembersContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const members = await getWorkgroupMembers({
      userId: session.user.id,
      workgroupId: parsed.data.params.workgroupId,
    })
    return NextResponse.json({ members })
  } catch (error) {
    logger.warn('Failed to list workgroup members', error)
    return NextResponse.json({ error: 'Workgroup admin access required' }, { status: 403 })
  }
})

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(addWorkgroupMemberContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    await addWorkgroupMember({
      actorUserId: session.user.id,
      workgroupId: parsed.data.params.workgroupId,
      userId: parsed.data.body.userId,
      email: parsed.data.body.email,
      role: parsed.data.body.role,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.warn('Failed to add workgroup member', error)
    return NextResponse.json({ error: 'Unable to add workgroup member' }, { status: 403 })
  }
})
