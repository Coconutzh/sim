import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin/auth'
import { getAdminConsoleUserDetail, updateAdminConsoleUser } from '@/lib/admin/console'
import {
  adminConsoleGetUserContract,
  adminConsoleUpdateUserContract,
} from '@/lib/api/contracts/admin-console'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('AdminConsoleUserAPI')

interface RouteParams {
  id: string
}

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<RouteParams> }) => {
    const auth = await requirePlatformAdmin()
    if (!auth.success) return auth.response

    const parsed = await parseRequest(adminConsoleGetUserContract, request, context)
    if (!parsed.success) return parsed.response

    try {
      const user = await getAdminConsoleUserDetail(parsed.data.params.id)
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
      return NextResponse.json({ user })
    } catch (error) {
      logger.error('Failed to get admin console user', { error })
      return NextResponse.json({ error: 'Failed to get user' }, { status: 500 })
    }
  }
)

export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<RouteParams> }) => {
    const auth = await requirePlatformAdmin()
    if (!auth.success) return auth.response

    const parsed = await parseRequest(adminConsoleUpdateUserContract, request, context)
    if (!parsed.success) return parsed.response

    try {
      const user = await updateAdminConsoleUser({
        actorUserId: auth.session.user.id,
        userId: parsed.data.params.id,
        body: parsed.data.body,
      })
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
      return NextResponse.json({ success: true, user })
    } catch (error) {
      logger.error('Failed to update admin console user', { error })
      return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
    }
  }
)
