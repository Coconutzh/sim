import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { getMobileProjectContract } from '@/lib/api/contracts/mobile-production'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getMobileProductionProject } from '@/lib/production-tasks/service'
import {
  getProductionTaskSessionUserId,
  productionTaskErrorResponse,
} from '@/app/api/production-tasks/_utils'

const logger = createLogger('MobileProductionProjectAPI')

export const GET = withRouteHandler(async (request, context) => {
  const userId = await getProductionTaskSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(getMobileProjectContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const result = await getMobileProductionProject({
      userId,
      workspaceId: parsed.data.params.workspaceId,
      taskFilter: parsed.data.query.taskFilter,
      limit: parsed.data.query.limit,
      offset: parsed.data.query.offset,
    })
    return NextResponse.json(result)
  } catch (error) {
    return productionTaskErrorResponse(logger, 'Failed to get mobile project', error)
  }
})
