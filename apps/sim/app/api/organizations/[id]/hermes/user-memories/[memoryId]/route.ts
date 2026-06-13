import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { deleteHermesUserMemoryContract } from '@/lib/api/contracts/hermes-user-memories'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { deleteHermesUserMemory } from '@/lib/hermes/user-memory'

const logger = createLogger('HermesUserMemoryDeleteAPI')
const MEMORY_NOT_FOUND_ERROR = 'Hermes user memory not found'
const ORGANIZATION_ADMIN_ERROR = 'Organization admin access required'

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === MEMORY_NOT_FOUND_ERROR) {
    return NextResponse.json({ error: MEMORY_NOT_FOUND_ERROR }, { status: 404 })
  }
  if (message === ORGANIZATION_ADMIN_ERROR) {
    return NextResponse.json({ error: ORGANIZATION_ADMIN_ERROR }, { status: 403 })
  }
  return NextResponse.json({ error: 'Unable to delete Hermes user memory' }, { status: 500 })
}

export const DELETE = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(deleteHermesUserMemoryContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const result = await deleteHermesUserMemory({
      requesterUserId: session.user.id,
      organizationId: parsed.data.params.id,
      memoryId: parsed.data.params.memoryId,
      reason: parsed.data.body.reason,
    })
    return NextResponse.json(result)
  } catch (error) {
    logger.warn('Failed to delete Hermes user memory', error)
    return errorResponse(error)
  }
})
