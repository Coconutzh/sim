import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  type HermesCanvasTaskRunResponse,
  hermesCanvasTaskRunContract,
} from '@/lib/api/contracts/internal/hermes-canvas-task'
import { parseRequest } from '@/lib/api/server'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { runHermesCanvasTaskGateway } from '@/lib/hermes/canvas-task-gateway'
import { recordHermesToolCallAudit } from '@/lib/hermes/tool-call-audit'

const logger = createLogger('HermesCanvasTaskAPI')
const TOOL_NAME = 'sim_canvas_task_gateway'

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

function statusForResult(result: HermesCanvasTaskRunResponse): number {
  if (result.success) return 200
  if (result.errorCode === 'USER_PERMISSION_DENIED') return 403
  if (result.errorCode === 'WORKFLOW_NOT_FOUND' || result.errorCode === 'WORKSPACE_NOT_FOUND') {
    return 404
  }
  if (
    result.errorCode === 'CONFIRMATION_REQUIRED' ||
    result.errorCode === 'CONFIRMATION_EXPIRED' ||
    result.errorCode === 'CONFIRMATION_SUPERSEDED' ||
    result.errorCode === 'PATCH_VALIDATION_FAILED' ||
    result.errorCode === 'INVALID_TASK'
  ) {
    return 400
  }
  return 500
}

function authErrorResponse(params: {
  auditId: string
  traceId?: string
}): NextResponse<HermesCanvasTaskRunResponse> {
  return NextResponse.json(
    {
      success: false,
      answer: '',
      auditId: params.auditId,
      traceId: params.traceId,
      errorCode: 'UNAUTHENTICATED_SERVICE',
      error: 'Hermes service authentication failed',
    },
    { status: 401 }
  )
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auditId = generateId()
  const startedAt = Date.now()
  const headerTraceId = request.headers.get('x-trace-id') ?? undefined

  if (!verifyHermesServiceRequest(request)) {
    logger.warn('Rejected unauthorized Hermes canvas task request', {
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
    return authErrorResponse({ auditId, traceId: headerTraceId })
  }

  const parsed = await parseRequest(hermesCanvasTaskRunContract, request, {})
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
      error: 'Hermes canvas task request validation failed',
    })
    return parsed.response
  }

  const body = parsed.data.body
  const traceId = body.traceId ?? headerTraceId
  let result: HermesCanvasTaskRunResponse

  try {
    result = await runHermesCanvasTaskGateway({
      body: { ...body, traceId },
      auditId,
      abortSignal: request.signal,
    })
  } catch (error) {
    const err = toError(error)
    result = {
      success: false,
      operation: body.operation,
      answer: '',
      auditId,
      traceId,
      errorCode: 'INTERNAL_ERROR',
      error: err.message,
    }
  }

  logger.info('Handled Hermes canvas task request', {
    auditId,
    traceId,
    hermesRunId: body.hermesRunId,
    userId: body.userId,
    workspaceId: body.workspaceId,
    workflowId: body.workflowId,
    operation: body.operation,
    taskType: body.task?.taskType,
    queryType: body.queryType,
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
    mode: body.operation,
    status: result.success ? 'success' : 'error',
    inputSummary: {
      operation: body.operation,
      queryType: body.queryType,
      taskType: body.task?.taskType,
      messageLength: body.message.length,
      selectedNodeCount: body.selectedNodeIds.length,
      hasPendingActionId: Boolean(body.pendingActionId),
      hasPreviewActionId: Boolean(body.previewActionId),
    },
    outputSummary: {
      success: result.success,
      answerLength: result.answer.length,
      pendingActionId: result.pendingActionId,
      previewActionId: result.previewActionId,
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
