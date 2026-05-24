import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { recordProjectAdminFailureContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { recordProjectAdminFailureAudit } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('ProjectAdminFailureAuditAPI')

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(recordProjectAdminFailureContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const failure = await recordProjectAdminFailureAudit({
      userId: session.user.id,
      organizationId: parsed.data.params.id,
      scope: parsed.data.body.scope,
      operation: parsed.data.body.operation,
      target: parsed.data.body.target,
      message: parsed.data.body.message,
    })

    return NextResponse.json({ failure })
  } catch (error) {
    logger.warn('Failed to record project admin failure audit', { error })
    return NextResponse.json({ error: 'Organization admin access required' }, { status: 403 })
  }
})
