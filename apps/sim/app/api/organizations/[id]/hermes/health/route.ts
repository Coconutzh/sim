import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { hermesAdminHealthContract } from '@/lib/api/contracts/hermes-health'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { assertOrganizationAdmin } from '@/lib/collaboration/service'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkHermesHealth } from '@/lib/hermes/client'

const logger = createLogger('HermesAdminHealthAPI')

export const GET = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(hermesAdminHealthContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    await assertOrganizationAdmin(session.user.id, parsed.data.params.id)
  } catch (error) {
    logger.warn('Rejected Hermes health admin request', error)
    return NextResponse.json({ error: 'Organization admin access required' }, { status: 403 })
  }

  const result = await checkHermesHealth({
    signal: request.signal,
    includeToolsets: parsed.data.query.includeToolsets,
  })
  logger.info('Checked Hermes health for project admin', {
    organizationId: parsed.data.params.id,
    configured: result.configured,
    ok: result.ok,
    status: result.status,
    version: result.version,
    commit: result.commit,
    error: result.error,
  })

  return NextResponse.json(result)
})
