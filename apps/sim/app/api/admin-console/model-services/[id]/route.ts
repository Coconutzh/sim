import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin/auth'
import { deletePlatformModelService, updatePlatformModelService } from '@/lib/admin/console'
import {
  adminConsoleDeleteModelServiceContract,
  adminConsoleUpdateModelServiceContract,
} from '@/lib/api/contracts/admin-console'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('AdminConsoleModelServiceAPI')

interface RouteParams {
  id: string
}

export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<RouteParams> }) => {
    const auth = await requirePlatformAdmin()
    if (!auth.success) return auth.response

    const parsed = await parseRequest(adminConsoleUpdateModelServiceContract, request, context)
    if (!parsed.success) return parsed.response

    try {
      const service = await updatePlatformModelService({
        actorUserId: auth.session.user.id,
        serviceId: parsed.data.params.id,
        body: parsed.data.body,
      })
      if (!service) return NextResponse.json({ error: 'Model service not found' }, { status: 404 })
      return NextResponse.json({ success: true, service })
    } catch (error) {
      logger.error('Failed to update platform model service', { error })
      return NextResponse.json({ error: 'Failed to update model service' }, { status: 500 })
    }
  }
)

export const DELETE = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<RouteParams> }) => {
    const auth = await requirePlatformAdmin()
    if (!auth.success) return auth.response

    const parsed = await parseRequest(adminConsoleDeleteModelServiceContract, request, context)
    if (!parsed.success) return parsed.response

    try {
      const deleted = await deletePlatformModelService({
        actorUserId: auth.session.user.id,
        serviceId: parsed.data.params.id,
      })
      if (!deleted) return NextResponse.json({ error: 'Model service not found' }, { status: 404 })
      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete platform model service', { error })
      return NextResponse.json({ error: 'Failed to delete model service' }, { status: 500 })
    }
  }
)
