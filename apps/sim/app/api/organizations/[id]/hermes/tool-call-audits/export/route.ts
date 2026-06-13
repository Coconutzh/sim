import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { exportHermesToolCallAuditsContract } from '@/lib/api/contracts/hermes-tool-call-audits'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { exportHermesToolCallAudits } from '@/lib/hermes/tool-call-audit'

const logger = createLogger('HermesToolCallAuditExportAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(exportHermesToolCallAuditsContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const payload = await exportHermesToolCallAudits({
      userId: session.user.id,
      organizationId: parsed.data.params.id,
      query: parsed.data.query,
    })
    return NextResponse.json(payload)
  } catch (error) {
    logger.warn('Failed to export Hermes tool-call audits', error)
    return NextResponse.json({ error: 'Organization admin access required' }, { status: 403 })
  }
})
