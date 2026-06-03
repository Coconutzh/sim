import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  createProjectTaskContract,
  listProjectTasksContract,
} from '@/lib/api/contracts/project-tasks'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  createProjectTask,
  getProjectTaskErrorResponse,
  listProjectTasks,
} from '@/lib/collaboration/project-tasks'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('ProjectTasksAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(listProjectTasksContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const result = await listProjectTasks({
      userId: session.user.id,
      organizationId: parsed.data.params.id,
      query: parsed.data.query,
    })
    return NextResponse.json(result)
  } catch (error) {
    const response = getProjectTaskErrorResponse(error, 'Failed to list project tasks')
    logger.warn('Failed to list project tasks', { error })
    return NextResponse.json({ error: response.message }, { status: response.status })
  }
})

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(createProjectTaskContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const task = await createProjectTask({
      actorUserId: session.user.id,
      organizationId: parsed.data.params.id,
      body: parsed.data.body,
    })
    return NextResponse.json({ task }, { status: 201 })
  } catch (error) {
    const response = getProjectTaskErrorResponse(error, 'Failed to create project task')
    logger.warn('Failed to create project task', { error })
    return NextResponse.json({ error: response.message }, { status: response.status })
  }
})
