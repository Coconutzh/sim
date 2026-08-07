import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin/auth'
import { createPlatformProviderKey, listPlatformProviderKeys } from '@/lib/admin/console'
import {
  adminConsoleCreateProviderKeyContract,
  adminConsoleListProviderKeysContract,
} from '@/lib/api/contracts/admin-console'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('AdminConsoleProviderKeysAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  const auth = await requirePlatformAdmin()
  if (!auth.success) return auth.response

  const parsed = await parseRequest(adminConsoleListProviderKeysContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    return NextResponse.json({ keys: await listPlatformProviderKeys() })
  } catch (error) {
    logger.error('Failed to list platform provider keys', { error })
    return NextResponse.json({ error: 'Failed to list provider keys' }, { status: 500 })
  }
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await requirePlatformAdmin()
  if (!auth.success) return auth.response

  const parsed = await parseRequest(adminConsoleCreateProviderKeyContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    const key = await createPlatformProviderKey({
      actorUserId: auth.session.user.id,
      body: parsed.data.body,
    })
    return NextResponse.json({ success: true, key })
  } catch (error) {
    logger.error('Failed to create platform provider key', { error })
    return NextResponse.json({ error: 'Failed to create provider key' }, { status: 500 })
  }
})
