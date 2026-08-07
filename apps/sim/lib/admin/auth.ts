import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

const logger = createLogger('AdminConsoleAuth')

export interface PlatformAdminSession {
  user: {
    id: string
    email?: string | null
    name?: string | null
    role?: string | null
  }
}

export type PlatformAdminAuthResult =
  | { success: true; session: PlatformAdminSession }
  | { success: false; response: NextResponse }

export async function requirePlatformAdmin(): Promise<PlatformAdminAuthResult> {
  const session = await getSession()
  if (!session?.user?.id) {
    return {
      success: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const user = session.user as PlatformAdminSession['user']
  if (user.role !== 'admin') {
    logger.warn('Non-admin attempted to access admin console', { userId: user.id })
    return {
      success: false,
      response: NextResponse.json({ error: 'Admin access required' }, { status: 403 }),
    }
  }

  return { success: true, session: { user } }
}
