import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  createProjectTaskMessageContract,
  listProjectTaskMessagesContract,
} from '@/lib/api/contracts/project-tasks'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  createProjectTaskMessage,
  getProjectTaskErrorResponse,
  listProjectTaskMessages,
} from '@/lib/collaboration/project-tasks'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('ProjectTaskMessagesAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(listProjectTaskMessagesContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    return NextResponse.json(
      await listProjectTaskMessages({
        userId: session.user.id,
        taskId: parsed.data.params.taskId,
        query: parsed.data.query,
      })
    )
  } catch (error) {
    const response = getProjectTaskErrorResponse(error, 'Failed to list project task messages')
    logger.warn('Failed to list project task messages', { error })
    return NextResponse.json({ error: response.message }, { status: response.status })
  }
})

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(createProjectTaskMessageContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const message = await createProjectTaskMessage({
      actorUserId: session.user.id,
      taskId: parsed.data.params.taskId,
      body: parsed.data.body,
    })
    return NextResponse.json({ message }, { status: 201 })
  } catch (error) {
    const response = getProjectTaskErrorResponse(error, 'Failed to create project task message')
    logger.warn('Failed to create project task message', { error })
    return NextResponse.json({ error: response.message }, { status: response.status })
  }
})
