import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { toError } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  type HermesUserMemoryErrorCode,
  type HermesUserMemoryRunResponse,
  hermesUserMemoryRunContract,
} from '@/lib/api/contracts/internal/hermes-user-memory'
import { parseRequest } from '@/lib/api/server'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  HermesUserMemoryContentError,
  HermesUserMemoryScopeError,
  runHermesUserMemoryOperation,
} from '@/lib/hermes/user-memory'

const logger = createLogger('HermesUserMemoryAPI')

function getServiceToken(request: NextRequest): string | null {
  const directToken = request.headers.get('x-sim-service-token')
  if (directToken) return directToken

  const authHeader = request.headers.get('authorization')
  const bearerPrefix = 'Bearer '
  if (authHeader?.startsWith(bearerPrefix)) return authHeader.slice(bearerPrefix.length)
  return null
}

function verifyHermesServiceRequest(request: NextRequest): boolean {
  const expectedToken = env.HERMES_SERVICE_TOKEN
  const suppliedToken = getServiceToken(request)

  if (!expectedToken || !suppliedToken) return false
  return safeCompare(suppliedToken, expectedToken)
}

function authErrorResponse(traceId?: string): NextResponse<HermesUserMemoryRunResponse> {
  return NextResponse.json(
    {
      success: false,
      answer: '',
      traceId,
      errorCode: 'UNAUTHENTICATED_SERVICE',
      error: 'Hermes service authentication failed',
    },
    { status: 401 }
  )
}

function errorCodeForError(error: Error): HermesUserMemoryErrorCode {
  if (error instanceof HermesUserMemoryScopeError) return 'USER_SCOPE_DENIED'
  if (error instanceof HermesUserMemoryContentError) return 'INVALID_MEMORY_CONTENT'
  return 'INTERNAL_ERROR'
}

function statusForErrorCode(errorCode: HermesUserMemoryErrorCode): number {
  if (errorCode === 'UNAUTHENTICATED_SERVICE') return 401
  if (errorCode === 'USER_SCOPE_DENIED') return 403
  if (errorCode === 'INVALID_MEMORY_CONTENT') return 400
  return 500
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const headerTraceId = request.headers.get('x-trace-id') ?? undefined

  if (!verifyHermesServiceRequest(request)) {
    logger.warn('Rejected unauthorized Hermes user memory request', {
      traceId: headerTraceId,
      hasServiceToken: Boolean(getServiceToken(request)),
      configured: Boolean(env.HERMES_SERVICE_TOKEN),
    })
    return authErrorResponse(headerTraceId)
  }

  const parsed = await parseRequest(hermesUserMemoryRunContract, request, {})
  if (!parsed.success) return parsed.response

  const body = parsed.data.body
  const traceId = body.traceId ?? headerTraceId

  try {
    const result = await runHermesUserMemoryOperation({ ...body, traceId })
    const response = {
      success: true,
      ...result,
      traceId,
    } satisfies HermesUserMemoryRunResponse

    logger.info('Handled Hermes user memory request', {
      traceId,
      hermesRunId: body.hermesRunId,
      userId: body.userId,
      organizationId: body.organizationId,
      workspaceId: body.workspaceId,
      operation: body.operation,
      created: 'created' in response ? response.created : undefined,
      memoryCount:
        'memories' in response && Array.isArray(response.memories)
          ? response.memories.length
          : undefined,
    })

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    const err = toError(error)
    const errorCode = errorCodeForError(err)
    const response = {
      success: false,
      operation: body.operation,
      answer: '',
      traceId,
      errorCode,
      error: err.message,
    } satisfies HermesUserMemoryRunResponse

    logger.warn('Hermes user memory request failed', {
      traceId,
      hermesRunId: body.hermesRunId,
      userId: body.userId,
      organizationId: body.organizationId,
      workspaceId: body.workspaceId,
      operation: body.operation,
      errorCode,
      error: err.message,
    })

    return NextResponse.json(response, { status: statusForErrorCode(errorCode) })
  }
})
