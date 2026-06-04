import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { submitProductionTaskContract } from '@/lib/api/contracts/production-tasks'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { submitProductionTask } from '@/lib/production-tasks/service'
import {
  getProductionTaskSessionUserId,
  productionTaskErrorResponse,
} from '@/app/api/production-tasks/_utils'

const logger = createLogger('ProductionTaskSubmitAPI')

export const POST = withRouteHandler(async (request, context) => {
  const userId = await getProductionTaskSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(submitProductionTaskContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const task = await submitProductionTask({
      userId,
      taskId: parsed.data.params.taskId,
      workspaceId: parsed.data.body.workspaceId,
      workflowId: parsed.data.body.workflowId,
      nodeId: parsed.data.body.nodeId,
      submissionNote: parsed.data.body.submissionNote,
      attachments: parsed.data.body.attachments,
    })
    return NextResponse.json({ task })
  } catch (error) {
    return productionTaskErrorResponse(logger, 'Failed to submit production task', error)
  }
})
