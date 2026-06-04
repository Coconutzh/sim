import { createLogger } from '@sim/logger'
import {
  scanProductionTaskRemindersContract,
  scanProductionTaskRemindersCronContract,
} from '@/lib/api/contracts/production-tasks'
import { parseRequest } from '@/lib/api/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { scanProductionTaskReminders } from '@/lib/production-tasks/service'
import { productionTaskErrorResponse } from '@/app/api/production-tasks/_utils'

const logger = createLogger('ProductionTaskReminderScanAPI')

export const GET = withRouteHandler(async (request) => {
  const authError = verifyCronAuth(request, 'Production task DDL reminders')
  if (authError) return authError

  const parsed = await parseRequest(scanProductionTaskRemindersCronContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    return Response.json(await scanProductionTaskReminders())
  } catch (error) {
    return productionTaskErrorResponse(logger, 'Failed to scan production task reminders', error)
  }
})

export const POST = withRouteHandler(async (request) => {
  const authError = verifyCronAuth(request, 'Production task DDL reminders')
  if (authError) return authError

  const parsed = await parseRequest(scanProductionTaskRemindersContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    return Response.json(await scanProductionTaskReminders())
  } catch (error) {
    return productionTaskErrorResponse(logger, 'Failed to scan production task reminders', error)
  }
})
