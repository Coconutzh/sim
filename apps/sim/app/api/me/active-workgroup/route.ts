import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { setActiveWorkgroupContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { setActiveWorkgroup } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('ActiveWorkgroupAPI')

export const POST = withRouteHandler(async (request) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(setActiveWorkgroupContract, request, {})
  if (!parsed.success) return parsed.response
  try {
    await setActiveWorkgroup(session.user.id, parsed.data.body.workgroupId)
    return NextResponse.json({ activeWorkgroupId: parsed.data.body.workgroupId })
  } catch (error) {
    logger.warn('Failed to set active workgroup', error)
    return NextResponse.json({ error: 'Workgroup access denied' }, { status: 403 })
  }
})
