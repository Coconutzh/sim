import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { listHermesToolCallAuditsContract } from '@/lib/api/contracts/hermes-tool-call-audits'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listHermesToolCallAudits } from '@/lib/hermes/tool-call-audit'

const logger = createLogger('HermesToolCallAuditsAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(listHermesToolCallAuditsContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const audits = await listHermesToolCallAudits({
      userId: session.user.id,
      organizationId: parsed.data.params.id,
      query: parsed.data.query,
    })
    return NextResponse.json({ audits })
  } catch (error) {
    logger.warn('Failed to list Hermes tool call audits', error)
    return NextResponse.json({ error: 'Organization admin access required' }, { status: 403 })
  }
})
