import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  createPersonalWorkspaceContract,
  getPersonalWorkspaceContract,
} from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { createPersonalWorkspace, getOrCreatePersonalWorkspace } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('PersonalWorkspaceAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(getPersonalWorkspaceContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const workspace = await getOrCreatePersonalWorkspace({
      userId: session.user.id,
      workgroupId: parsed.data.params.workgroupId,
    })
    return NextResponse.json({ workspace })
  } catch (error) {
    logger.warn('Failed to get personal workspace', error)
    return NextResponse.json({ error: 'Personal workspace access denied' }, { status: 403 })
  }
})

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(createPersonalWorkspaceContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const result = await createPersonalWorkspace({
      userId: session.user.id,
      workgroupId: parsed.data.params.workgroupId,
      name: parsed.data.body.name,
    })
    return NextResponse.json(result)
  } catch (error) {
    logger.warn('Failed to create personal workspace', error)
    return NextResponse.json({ error: 'Personal workspace creation denied' }, { status: 403 })
  }
})
