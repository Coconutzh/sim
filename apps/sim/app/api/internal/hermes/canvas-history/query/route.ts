import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { toError } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  type HermesCanvasHistoryQueryResponse,
  hermesCanvasHistoryQueryContract,
} from '@/lib/api/contracts/internal/hermes-canvas-history'
import { parseRequest } from '@/lib/api/server'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { queryHermesCanvasHistory } from '@/lib/hermes/canvas-history-query'

const logger = createLogger('HermesCanvasHistoryAPI')

function getServiceToken(request: NextRequest): string | null {
  const directToken = request.headers.get('x-sim-service-token')
  if (directToken) return directToken

  const authHeader = request.headers.get('authorization')
  const bearerPrefix = 'Bearer '
  if (authHeader?.startsWith(bearerPrefix)) {
    return authHeader.slice(bearerPrefix.length)
  }
  return null
}

function verifyHermesServiceRequest(request: NextRequest): boolean {
  const expectedToken = env.HERMES_SERVICE_TOKEN
  const suppliedToken = getServiceToken(request)

  if (!expectedToken || !suppliedToken) return false
  return safeCompare(suppliedToken, expectedToken)
}

function authErrorResponse(traceId?: string): NextResponse<HermesCanvasHistoryQueryResponse> {
  return NextResponse.json(
    {
      success: false,
      traceId,
      scope: {
        userId: '',
        workspaceId: '',
        workflowId: '',
        query: 'recent_operations',
      },
      summary: {
        total: 0,
        successCount: 0,
        errorCount: 0,
        pendingConfirmationCount: 0,
        changedNodeIds: [],
        generatedNodeIds: [],
        latestVerificationSummary: null,
      },
      items: [],
      evidenceRefs: [],
      errorCode: 'UNAUTHENTICATED_SERVICE',
      error: 'Hermes service authentication failed',
    },
    { status: 401 }
  )
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const headerTraceId = request.headers.get('x-trace-id') ?? undefined

  if (!verifyHermesServiceRequest(request)) {
    logger.warn('Rejected unauthorized Hermes canvas history request', {
      traceId: headerTraceId,
      hasServiceToken: Boolean(getServiceToken(request)),
      configured: Boolean(env.HERMES_SERVICE_TOKEN),
    })
    return authErrorResponse(headerTraceId)
  }

  const parsed = await parseRequest(hermesCanvasHistoryQueryContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    const result = await queryHermesCanvasHistory(parsed.data.body)
    logger.info('Handled Hermes canvas history request', {
      traceId: result.traceId,
      userId: result.scope.userId,
      workspaceId: result.scope.workspaceId,
      workflowId: result.scope.workflowId,
      query: result.scope.query,
      total: result.summary.total,
    })
    return NextResponse.json(result)
  } catch (error) {
    const body = parsed.data.body
    const err = toError(error)
    logger.error('Failed to query Hermes canvas history', {
      traceId: body.traceId ?? headerTraceId,
      userId: body.userId,
      workspaceId: body.workspaceId,
      workflowId: body.workflowId,
      error: err.message,
    })
    return NextResponse.json(
      {
        success: false,
        traceId: body.traceId ?? headerTraceId,
        scope: {
          userId: body.userId,
          ...(body.organizationId ? { organizationId: body.organizationId } : {}),
          workspaceId: body.workspaceId,
          workflowId: body.workflowId,
          ...(body.chatId ? { chatId: body.chatId } : {}),
          query: body.query,
        },
        summary: {
          total: 0,
          successCount: 0,
          errorCount: 0,
          pendingConfirmationCount: 0,
          changedNodeIds: [],
          generatedNodeIds: [],
          latestVerificationSummary: null,
        },
        items: [],
        evidenceRefs: [],
        errorCode: 'INTERNAL_ERROR',
        error: err.message,
      } satisfies HermesCanvasHistoryQueryResponse,
      { status: 500 }
    )
  }
})
