import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { reviewProjectTaskContract } from '@/lib/api/contracts/project-tasks'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getProjectTaskErrorResponse, reviewProjectTask } from '@/lib/collaboration/project-tasks'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('ProjectTaskReviewAPI')

export const PATCH = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(reviewProjectTaskContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const task = await reviewProjectTask({
      actorUserId: session.user.id,
      taskId: parsed.data.params.taskId,
      body: parsed.data.body,
    })
    return NextResponse.json({ task })
  } catch (error) {
    const response = getProjectTaskErrorResponse(error, 'Failed to review project task')
    logger.warn('Failed to review project task', { error })
    return NextResponse.json({ error: response.message }, { status: response.status })
  }
})
