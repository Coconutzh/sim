import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  archiveProjectTaskContract,
  getProjectTaskContract,
  updateProjectTaskContract,
} from '@/lib/api/contracts/project-tasks'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  archiveProjectTask,
  getProjectTask,
  getProjectTaskErrorResponse,
  updateProjectTask,
} from '@/lib/collaboration/project-tasks'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('ProjectTaskAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(getProjectTaskContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const task = await getProjectTask({
      userId: session.user.id,
      taskId: parsed.data.params.taskId,
    })
    return NextResponse.json({ task })
  } catch (error) {
    const response = getProjectTaskErrorResponse(error, 'Failed to load project task')
    logger.warn('Failed to load project task', { error })
    return NextResponse.json({ error: response.message }, { status: response.status })
  }
})

export const PATCH = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(updateProjectTaskContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const task = await updateProjectTask({
      actorUserId: session.user.id,
      taskId: parsed.data.params.taskId,
      body: parsed.data.body,
    })
    return NextResponse.json({ task })
  } catch (error) {
    const response = getProjectTaskErrorResponse(error, 'Failed to update project task')
    logger.warn('Failed to update project task', { error })
    return NextResponse.json({ error: response.message }, { status: response.status })
  }
})

export const DELETE = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(archiveProjectTaskContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const task = await archiveProjectTask({
      actorUserId: session.user.id,
      taskId: parsed.data.params.taskId,
    })
    return NextResponse.json({ task, archived: true })
  } catch (error) {
    const response = getProjectTaskErrorResponse(error, 'Failed to archive project task')
    logger.warn('Failed to archive project task', { error })
    return NextResponse.json({ error: response.message }, { status: response.status })
  }
})
