import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { listHermesUserMemoriesContract } from '@/lib/api/contracts/hermes-user-memories'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listHermesUserMemories } from '@/lib/hermes/user-memory'

const logger = createLogger('HermesUserMemoriesAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(listHermesUserMemoriesContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const memories = await listHermesUserMemories({
      requesterUserId: session.user.id,
      organizationId: parsed.data.params.id,
      query: parsed.data.query,
    })
    return NextResponse.json({ memories })
  } catch (error) {
    logger.warn('Failed to list Hermes user memories', error)
    return NextResponse.json({ error: 'Organization admin access required' }, { status: 403 })
  }
})
