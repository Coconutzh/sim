import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin/auth'
import { createAdminConsoleUser, listAdminConsoleUsers } from '@/lib/admin/console'
import {
  adminConsoleCreateUserContract,
  adminConsoleListUsersContract,
} from '@/lib/api/contracts/admin-console'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('AdminConsoleUsersAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  const auth = await requirePlatformAdmin()
  if (!auth.success) return auth.response

  const parsed = await parseRequest(adminConsoleListUsersContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    return NextResponse.json(await listAdminConsoleUsers(parsed.data.query))
  } catch (error) {
    logger.error('Failed to list admin console users', { error })
    return NextResponse.json({ error: 'Failed to list users' }, { status: 500 })
  }
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await requirePlatformAdmin()
  if (!auth.success) return auth.response

  const parsed = await parseRequest(adminConsoleCreateUserContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    const user = await createAdminConsoleUser({
      actorUserId: auth.session.user.id,
      body: parsed.data.body,
    })
    if (!user) return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
    return NextResponse.json({ success: true, user })
  } catch (error) {
    logger.error('Failed to create admin console user', { error })
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }
})
