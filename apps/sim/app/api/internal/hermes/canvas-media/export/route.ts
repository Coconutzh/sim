import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { hermesCanvasMediaExportContract } from '@/lib/api/contracts/internal/hermes-canvas-media'
import { parseRequest } from '@/lib/api/server'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  exportHermesCanvasNodeImage,
  HermesCanvasMediaExportError,
  type HermesCanvasMediaExportErrorCode,
} from '@/lib/hermes/canvas-media-export'
import { recordHermesToolCallAudit } from '@/lib/hermes/tool-call-audit'

const logger = createLogger('HermesCanvasMediaAPI')
const TOOL_NAME = 'sim_canvas_media_prepare'

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
  return Boolean(expectedToken && suppliedToken && safeCompare(suppliedToken, expectedToken))
}

function statusForError(code: HermesCanvasMediaExportErrorCode): number {
  if (code === 'USER_PERMISSION_DENIED') return 403
  if (code === 'MEDIA_NODE_NOT_FOUND' || code === 'WORKFLOW_NOT_FOUND') return 404
  if (code === 'MEDIA_TOO_LARGE') return 413
  if (
    code === 'MEDIA_NODE_AMBIGUOUS' ||
    code === 'MEDIA_UNSUPPORTED' ||
    code === 'MEDIA_FILE_NOT_FOUND'
  ) {
    return 400
  }
  return 500
}

function jsonError(params: {
  status: number
  auditId: string
  traceId?: string
  errorCode: string
  error: string
}): NextResponse {
  return NextResponse.json(
    {
      success: false,
      auditId: params.auditId,
      traceId: params.traceId,
      errorCode: params.errorCode,
      error: params.error,
    },
    { status: params.status }
  )
}

function headerSafe(value: string): string {
  return encodeURIComponent(value).slice(0, 512)
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auditId = generateId()
  const startedAt = Date.now()
  const headerTraceId = request.headers.get('x-trace-id') ?? undefined

  if (!verifyHermesServiceRequest(request)) {
    logger.warn('Rejected unauthorized Hermes canvas media export request', {
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
    return jsonError({
      status: 401,
      auditId,
      traceId: headerTraceId,
      errorCode: 'UNAUTHENTICATED_SERVICE',
      error: 'Hermes service authentication failed',
    })
  }

  const parsed = await parseRequest(hermesCanvasMediaExportContract, request, {})
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
      error: 'Hermes canvas media export request validation failed',
    })
    return parsed.response
  }

  const body = parsed.data.body
  const traceId = body.traceId ?? headerTraceId

  try {
    const exported = await exportHermesCanvasNodeImage({
      userId: body.userId,
      workspaceId: body.workspaceId,
      workflowId: body.workflowId,
      nodeId: body.nodeId,
      selectedNodeIds: body.selectedNodeIds,
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
      status: 'success',
      inputSummary: {
        nodeId: body.nodeId,
        selectedNodeCount: body.selectedNodeIds.length,
        questionLength: body.question?.length ?? 0,
      },
      outputSummary: {
        success: true,
        nodeId: exported.nodeId,
        contentType: exported.contentType,
        size: exported.size,
      },
      durationMs: Date.now() - startedAt,
    })

    return new NextResponse(new Uint8Array(exported.buffer), {
      status: 200,
      headers: {
        'content-type': exported.contentType,
        'content-length': String(exported.size),
        'cache-control': 'no-store',
        'x-sim-audit-id': auditId,
        'x-sim-canvas-node-id': exported.nodeId,
        'x-sim-canvas-node-title': headerSafe(exported.nodeTitle),
        'x-sim-media-file-name': headerSafe(exported.fileName),
      },
    })
  } catch (error) {
    const err =
      error instanceof HermesCanvasMediaExportError
        ? error
        : new HermesCanvasMediaExportError('INTERNAL_ERROR', toError(error).message)
    const status = statusForError(err.code)
    await recordHermesToolCallAudit({
      auditId,
      traceId,
      hermesRunId: body.hermesRunId,
      userId: body.userId,
      organizationId: body.organizationId,
      workspaceId: body.workspaceId,
      workflowId: body.workflowId,
      toolName: TOOL_NAME,
      status: 'error',
      inputSummary: {
        nodeId: body.nodeId,
        selectedNodeCount: body.selectedNodeIds.length,
        questionLength: body.question?.length ?? 0,
      },
      outputSummary: { success: false },
      durationMs: Date.now() - startedAt,
      errorCode: err.code,
      error: err.message,
    })
    return jsonError({
      status,
      auditId,
      traceId,
      errorCode: err.code,
      error: err.message,
    })
  }
})
