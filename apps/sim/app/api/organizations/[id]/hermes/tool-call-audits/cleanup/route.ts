import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { cleanupHermesToolCallAuditsContract } from '@/lib/api/contracts/hermes-tool-call-audits'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { cleanupHermesToolCallAudits } from '@/lib/hermes/tool-call-audit'

const logger = createLogger('HermesToolCallAuditCleanupAPI')

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(cleanupHermesToolCallAuditsContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const cleanup = await cleanupHermesToolCallAudits({
      userId: session.user.id,
      organizationId: parsed.data.params.id,
      retentionHours: parsed.data.body.retentionHours,
      dryRun: parsed.data.body.dryRun,
    })
    return NextResponse.json({ cleanup })
  } catch (error) {
    logger.warn('Failed to clean up Hermes tool-call audits', error)
    return NextResponse.json({ error: 'Organization admin access required' }, { status: 403 })
  }
})
