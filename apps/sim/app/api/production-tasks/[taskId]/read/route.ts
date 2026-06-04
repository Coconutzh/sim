import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { markProductionTaskReadContract } from '@/lib/api/contracts/production-tasks'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { markProductionTaskRead } from '@/lib/production-tasks/service'
import {
  getProductionTaskSessionUserId,
  productionTaskErrorResponse,
} from '@/app/api/production-tasks/_utils'

const logger = createLogger('ProductionTaskReadAPI')

export const POST = withRouteHandler(async (request, context) => {
  const userId = await getProductionTaskSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(markProductionTaskReadContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const readAt = await markProductionTaskRead({
      userId,
      taskId: parsed.data.params.taskId,
    })
    return NextResponse.json({ readAt })
  } catch (error) {
    return productionTaskErrorResponse(logger, 'Failed to mark production task read', error)
  }
})
