import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { cleanupProjectAdminFailureContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { cleanupProjectAdminFailureAudit } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('ProjectAdminFailureCleanupAPI')

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(cleanupProjectAdminFailureContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const cleanup = await cleanupProjectAdminFailureAudit({
      userId: session.user.id,
      organizationId: parsed.data.params.id,
      retentionHours: parsed.data.body.retentionHours,
      dryRun: parsed.data.body.dryRun,
    })

    return NextResponse.json({ cleanup })
  } catch (error) {
    logger.warn('Failed to clean up project admin failure audit', { error })
    return NextResponse.json({ error: 'Organization admin access required' }, { status: 403 })
  }
})
