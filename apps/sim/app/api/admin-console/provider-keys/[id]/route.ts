import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin/auth'
import { deletePlatformProviderKey, updatePlatformProviderKey } from '@/lib/admin/console'
import {
  adminConsoleDeleteProviderKeyContract,
  adminConsoleUpdateProviderKeyContract,
} from '@/lib/api/contracts/admin-console'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('AdminConsoleProviderKeyAPI')

interface RouteParams {
  id: string
}

export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<RouteParams> }) => {
    const auth = await requirePlatformAdmin()
    if (!auth.success) return auth.response

    const parsed = await parseRequest(adminConsoleUpdateProviderKeyContract, request, context)
    if (!parsed.success) return parsed.response

    try {
      const key = await updatePlatformProviderKey({
        actorUserId: auth.session.user.id,
        keyId: parsed.data.params.id,
        body: parsed.data.body,
      })
      if (!key) return NextResponse.json({ error: 'Provider key not found' }, { status: 404 })
      return NextResponse.json({ success: true, key })
    } catch (error) {
      logger.error('Failed to update platform provider key', { error })
      return NextResponse.json({ error: 'Failed to update provider key' }, { status: 500 })
    }
  }
)

export const DELETE = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<RouteParams> }) => {
    const auth = await requirePlatformAdmin()
    if (!auth.success) return auth.response
    const parsed = await parseRequest(adminConsoleDeleteProviderKeyContract, request, context)
    if (!parsed.success) return parsed.response
    try {
      const deleted = await deletePlatformProviderKey({
        actorUserId: auth.session.user.id,
        keyId: parsed.data.params.id,
      })
      if (!deleted) return NextResponse.json({ error: 'Provider key not found' }, { status: 404 })
      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete provider key', { error })
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to delete provider key' },
        { status: 409 }
      )
    }
  }
)
