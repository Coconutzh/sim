import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { dispatchProjectTaskDueRemindersContract } from '@/lib/api/contracts/project-tasks'
import { parseRequest } from '@/lib/api/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { dispatchProjectTaskDueReminders } from '@/lib/collaboration/project-tasks'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('ProjectTaskDueRemindersAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'project task due reminders')
  if (authError) return authError

  const parsed = await parseRequest(dispatchProjectTaskDueRemindersContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    const result = await dispatchProjectTaskDueReminders()
    logger.info('Project task due reminders dispatched', result)
    return NextResponse.json(result)
  } catch (error) {
    logger.error('Failed to dispatch project task due reminders', { error })
    return NextResponse.json(
      { error: 'Failed to dispatch project task due reminders' },
      { status: 500 }
    )
  }
})
