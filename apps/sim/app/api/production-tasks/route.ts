import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  createProductionTaskContract,
  listProductionTasksContract,
} from '@/lib/api/contracts/production-tasks'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createProductionTask,
  getProductionTaskCapabilities,
  listProductionTasks,
} from '@/lib/production-tasks/service'
import {
  getProductionTaskSessionUserId,
  productionTaskErrorResponse,
} from '@/app/api/production-tasks/_utils'

const logger = createLogger('ProductionTasksAPI')

export const GET = withRouteHandler(async (request) => {
  const userId = await getProductionTaskSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(listProductionTasksContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    const [tasks, capabilities] = await Promise.all([
      listProductionTasks({
        userId,
        workspaceId: parsed.data.query.workspaceId,
        workflowId: parsed.data.query.workflowId,
        scope: parsed.data.query.scope,
        status: parsed.data.query.status,
        limit: parsed.data.query.limit,
      }),
      getProductionTaskCapabilities({
        userId,
        workspaceId: parsed.data.query.workspaceId,
      }),
    ])
    return NextResponse.json({ tasks, capabilities })
  } catch (error) {
    return productionTaskErrorResponse(logger, 'Failed to list production tasks', error)
  }
})

export const POST = withRouteHandler(async (request) => {
  const userId = await getProductionTaskSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(createProductionTaskContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    const task = await createProductionTask({
      userId,
      workspaceId: parsed.data.body.workspaceId,
      sourceWorkflowId: parsed.data.body.sourceWorkflowId,
      assigneeWorkgroupId: parsed.data.body.assigneeWorkgroupId,
      title: parsed.data.body.title,
      description: parsed.data.body.description,
      dueAt: parsed.data.body.dueAt,
      dependencyTaskIds: parsed.data.body.dependencyTaskIds,
      attachments: parsed.data.body.attachments,
    })
    return NextResponse.json({ task })
  } catch (error) {
    return productionTaskErrorResponse(logger, 'Failed to create production task', error)
  }
})
