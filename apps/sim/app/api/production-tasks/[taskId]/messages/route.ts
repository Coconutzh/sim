import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  createProductionTaskMessageContract,
  listProductionTaskMessagesContract,
} from '@/lib/api/contracts/production-tasks'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createProductionTaskMessage,
  listProductionTaskMessages,
} from '@/lib/production-tasks/service'
import {
  getProductionTaskSessionUserId,
  productionTaskErrorResponse,
} from '@/app/api/production-tasks/_utils'

const logger = createLogger('ProductionTaskMessagesAPI')

export const GET = withRouteHandler(async (request, context) => {
  const userId = await getProductionTaskSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(listProductionTaskMessagesContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const messages = await listProductionTaskMessages({
      userId,
      taskId: parsed.data.params.taskId,
    })
    return NextResponse.json({ messages })
  } catch (error) {
    return productionTaskErrorResponse(logger, 'Failed to list production task messages', error)
  }
})

export const POST = withRouteHandler(async (request, context) => {
  const userId = await getProductionTaskSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(createProductionTaskMessageContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const message = await createProductionTaskMessage({
      userId,
      taskId: parsed.data.params.taskId,
      body: parsed.data.body.body,
    })
    return NextResponse.json({ message })
  } catch (error) {
    return productionTaskErrorResponse(logger, 'Failed to create production task message', error)
  }
})
