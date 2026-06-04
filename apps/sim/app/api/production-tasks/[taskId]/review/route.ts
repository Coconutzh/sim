import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { reviewProductionTaskContract } from '@/lib/api/contracts/production-tasks'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { reviewProductionTask } from '@/lib/production-tasks/service'
import {
  getProductionTaskSessionUserId,
  productionTaskErrorResponse,
} from '@/app/api/production-tasks/_utils'

const logger = createLogger('ProductionTaskReviewAPI')

export const PATCH = withRouteHandler(async (request, context) => {
  const userId = await getProductionTaskSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(reviewProductionTaskContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const task = await reviewProductionTask({
      userId,
      taskId: parsed.data.params.taskId,
      action: parsed.data.body.action,
      reviewNote: parsed.data.body.reviewNote,
    })
    return NextResponse.json({ task })
  } catch (error) {
    return productionTaskErrorResponse(logger, 'Failed to review production task', error)
  }
})
