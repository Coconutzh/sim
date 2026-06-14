import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  type HermesCanvasAgentRunResponse,
  hermesCanvasAgentRunContract,
} from '@/lib/api/contracts/internal/hermes-canvas-agent'
import { parseRequest } from '@/lib/api/server'
import { runLocalCanvasAgentHeadless } from '@/lib/copilot/request/lifecycle/local-canvas-agent'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { recordHermesToolCallAudit } from '@/lib/hermes/tool-call-audit'

const logger = createLogger('HermesCanvasAgentAPI')
const TOOL_NAME = 'sim_canvas_agent_run'

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

function buildAuthErrorResponse(params: {
  auditId: string
  traceId?: string
  error: string
}): NextResponse<HermesCanvasAgentRunResponse> {
  return NextResponse.json(
    {
      success: false,
      answer: '',
      auditId: params.auditId,
      traceId: params.traceId,
      errorCode: 'UNAUTHENTICATED_SERVICE',
      error: params.error,
    },
    { status: 401 }
  )
}

function verifyHermesServiceRequest(request: NextRequest): string | null {
  const expectedToken = env.HERMES_SERVICE_TOKEN
  const suppliedToken = getServiceToken(request)

  if (!expectedToken || !suppliedToken) return null
  return safeCompare(suppliedToken, expectedToken) ? suppliedToken : null
}

function statusForResult(result: HermesCanvasAgentRunResponse): number {
  if (result.success) return 200
  if (result.errorCode === 'USER_PERMISSION_DENIED') return 403
  if (result.errorCode === 'WORKFLOW_NOT_FOUND' || result.errorCode === 'WORKSPACE_NOT_FOUND') {
    return 404
  }
  if (
    result.errorCode === 'CONFIRMATION_REQUIRED' ||
    result.errorCode === 'CONFIRMATION_EXPIRED' ||
    result.errorCode === 'PATCH_VALIDATION_FAILED'
  ) {
    return 400
  }
  return 500
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auditId = generateId()
  const startedAt = Date.now()
  const headerTraceId = request.headers.get('x-trace-id') ?? undefined

  if (!verifyHermesServiceRequest(request)) {
    logger.warn('Rejected unauthorized Hermes canvas agent request', {
      auditId,
      traceId: headerTraceId,
      hasServiceToken: Boolean(getServiceToken(request)),
      configured: Boolean(env.HERMES_SERVICE_TOKEN),
    })
    await recordHermesToolCallAudit({
      auditId,
      traceId: headerTraceId,
      toolName: TOOL_NAME,
      status: 'unauthenticated',
      inputSummary: {
        hasServiceToken: Boolean(getServiceToken(request)),
        configured: Boolean(env.HERMES_SERVICE_TOKEN),
      },
      outputSummary: { success: false },
      durationMs: Date.now() - startedAt,
      errorCode: 'UNAUTHENTICATED_SERVICE',
      error: 'Hermes service authentication failed',
    })
    return buildAuthErrorResponse({
      auditId,
      traceId: headerTraceId,
      error: 'Hermes service authentication failed',
    })
  }

  const parsed = await parseRequest(hermesCanvasAgentRunContract, request, {})
  if (!parsed.success) {
    await recordHermesToolCallAudit({
      auditId,
      traceId: headerTraceId,
      toolName: TOOL_NAME,
      status: 'error',
      inputSummary: { validation: 'failed' },
      outputSummary: { success: false },
      durationMs: Date.now() - startedAt,
      errorCode: 'INVALID_REQUEST',
      error: 'Hermes canvas agent request validation failed',
    })
    return parsed.response
  }

  const body = parsed.data.body
  const traceId = body.traceId ?? headerTraceId

  let result: HermesCanvasAgentRunResponse
  try {
    result = (await runLocalCanvasAgentHeadless({
      userId: body.userId,
      organizationId: body.organizationId,
      workspaceId: body.workspaceId,
      workflowId: body.workflowId,
      chatId: body.chatId,
      message: body.message,
      selectedNodeIds: body.selectedNodeIds,
      mode: body.mode,
      confirmationMode: body.confirmationMode,
      pendingActionId: body.pendingActionId,
      structuredTask: body.structuredTask,
      traceId,
      hermesRunId: body.hermesRunId,
      auditId,
      metadata: body.metadata,
      abortSignal: request.signal,
    })) satisfies HermesCanvasAgentRunResponse
  } catch (error) {
    const err = toError(error)
    result = {
      success: false,
      answer: '',
      mode: body.mode,
      auditId,
      traceId,
      errorCode: 'INTERNAL_ERROR',
      error: err.message,
    }
  }

  logger.info('Handled Hermes canvas agent request', {
    auditId,
    traceId,
    hermesRunId: body.hermesRunId,
    userId: body.userId,
    workspaceId: body.workspaceId,
    workflowId: body.workflowId,
    mode: body.mode,
    success: result.success,
    errorCode: result.success ? undefined : result.errorCode,
  })

  await recordHermesToolCallAudit({
    auditId,
    traceId,
    hermesRunId: body.hermesRunId,
    userId: body.userId,
    organizationId: body.organizationId,
    workspaceId: body.workspaceId,
    workflowId: body.workflowId,
    toolName: TOOL_NAME,
    mode: body.mode,
    status: result.success ? 'success' : 'error',
    inputSummary: {
      mode: body.mode,
      messageLength: body.message.length,
      selectedNodeCount: body.selectedNodeIds.length,
      confirmationMode: body.confirmationMode,
      hasPendingActionId: Boolean(body.pendingActionId),
      hasStructuredTask: Boolean(body.structuredTask),
    },
    outputSummary: {
      success: result.success,
      answerLength: result.answer.length,
      pendingActionId: result.pendingActionId,
      proposedPatchSummaryLength: result.proposedPatchSummary?.length ?? 0,
      errorCode: result.success ? undefined : result.errorCode,
    },
    risk: result.risk,
    requiresConfirmation: result.requiresConfirmation,
    changedNodeIds: result.changedNodeIds,
    generatedNodeIds: result.generatedNodeIds,
    verificationSummary: result.verificationSummary,
    durationMs: Date.now() - startedAt,
    errorCode: result.success ? undefined : result.errorCode,
    error: result.success ? undefined : result.error,
  })

  return NextResponse.json(result, { status: statusForResult(result) })
})
