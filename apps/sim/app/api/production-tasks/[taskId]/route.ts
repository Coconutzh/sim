import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { updateProductionTaskContract } from '@/lib/api/contracts/production-tasks'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { updateProductionTask } from '@/lib/production-tasks/service'
import {
  getProductionTaskSessionUserId,
  productionTaskErrorResponse,
} from '@/app/api/production-tasks/_utils'

const logger = createLogger('ProductionTaskDetailAPI')

export const PATCH = withRouteHandler(async (request, context) => {
  const userId = await getProductionTaskSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(updateProductionTaskContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const task = await updateProductionTask({
      userId,
      taskId: parsed.data.params.taskId,
      title: parsed.data.body.title,
      description: parsed.data.body.description,
      dueAt: parsed.data.body.dueAt,
      assigneeWorkgroupId: parsed.data.body.assigneeWorkgroupId,
      status: parsed.data.body.status,
      dependencyTaskIds: parsed.data.body.dependencyTaskIds,
      attachments: parsed.data.body.attachments,
      delayReason: parsed.data.body.delayReason,
    })
    return NextResponse.json({ task })
  } catch (error) {
    return productionTaskErrorResponse(logger, 'Failed to update production task', error)
  }
})
