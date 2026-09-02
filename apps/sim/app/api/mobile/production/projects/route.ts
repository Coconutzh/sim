import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { listMobileProjectsContract } from '@/lib/api/contracts/mobile-production'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listMobileProductionProjects } from '@/lib/production-tasks/service'
import {
  getProductionTaskSessionUserId,
  productionTaskErrorResponse,
} from '@/app/api/production-tasks/_utils'

const logger = createLogger('MobileProductionProjectsAPI')

export const GET = withRouteHandler(async (request) => {
  const userId = await getProductionTaskSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(listMobileProjectsContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    const projects = await listMobileProductionProjects({ userId })
    return NextResponse.json({ projects })
  } catch (error) {
    return productionTaskErrorResponse(logger, 'Failed to list mobile projects', error)
  }
})
