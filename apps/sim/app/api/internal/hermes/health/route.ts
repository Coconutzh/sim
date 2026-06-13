import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { hermesHealthCheckContract } from '@/lib/api/contracts/internal/hermes-health'
import { parseRequest } from '@/lib/api/server'
import { checkInternalApiKey } from '@/lib/copilot/request/http'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkHermesHealth } from '@/lib/hermes/client'

const logger = createLogger('HermesHealthAPI')

export const GET = withRouteHandler(async (request) => {
  const auth = checkInternalApiKey(request)
  if (!auth.success) {
    logger.warn('Rejected unauthorized Hermes health probe', { error: auth.error })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(hermesHealthCheckContract, request, {})
  if (!parsed.success) return parsed.response

  const result = await checkHermesHealth({ signal: request.signal })
  logger.info('Checked Hermes health', {
    configured: result.configured,
    ok: result.ok,
    status: result.status,
    version: result.version,
    commit: result.commit,
    error: result.error,
  })

  return NextResponse.json(result, { status: result.ok ? 200 : 503 })
})
