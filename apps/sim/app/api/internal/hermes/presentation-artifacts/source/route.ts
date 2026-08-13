import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { hermesPresentationSourceContract } from '@/lib/api/contracts/internal/hermes-presentation-artifacts'
import { parseRequest } from '@/lib/api/server'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  exportHermesPresentationSource,
  HermesPresentationSourceError,
  type HermesPresentationSourceErrorCode,
} from '@/lib/hermes/presentation-source'
import { recordHermesToolCallAudit } from '@/lib/hermes/tool-call-audit'

const logger = createLogger('HermesPresentationSourceAPI')
const TOOL_NAME = 'sim_presentation_editable_source_prepare'

function getServiceToken(request: NextRequest): string | null {
  const directToken = request.headers.get('x-sim-service-token')
  if (directToken) return directToken

  const authorization = request.headers.get('authorization')
  return authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
}

function isAuthorized(request: NextRequest): boolean {
  const suppliedToken = getServiceToken(request)
  return Boolean(
    env.HERMES_SERVICE_TOKEN &&
      suppliedToken &&
      safeCompare(suppliedToken, env.HERMES_SERVICE_TOKEN)
  )
}

function statusForError(code: HermesPresentationSourceErrorCode): number {
  if (code === 'USER_PERMISSION_DENIED') return 403
  if (
    code === 'WORKFLOW_NOT_FOUND' ||
    code === 'PRESENTATION_NODE_NOT_FOUND' ||
    code === 'PRESENTATION_FILE_NOT_FOUND'
  ) {
    return 404
  }
  if (code === 'PRESENTATION_FILE_INVALID') return 400
  if (code === 'PRESENTATION_FILE_TOO_LARGE') return 413
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

export const GET = withRouteHandler(async (request: NextRequest) => {
  const auditId = generateId()
  const startedAt = Date.now()
  const headerTraceId = request.headers.get('x-trace-id') ?? undefined

  if (!isAuthorized(request)) {
    logger.warn('Rejected unauthorized Hermes presentation source request', {
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

  const parsed = await parseRequest(hermesPresentationSourceContract, request, {})
  if (!parsed.success) return parsed.response

  const query = parsed.data.query
  const traceId = query.traceId ?? headerTraceId
  try {
    const source = await exportHermesPresentationSource({
      userId: query.userId,
      workspaceId: query.workspaceId,
      workflowId: query.workflowId,
      nodeId: query.nodeId,
    })

    await recordHermesToolCallAudit({
      auditId,
      traceId,
      userId: query.userId,
      organizationId: query.organizationId,
      workspaceId: query.workspaceId,
      workflowId: query.workflowId,
      toolName: TOOL_NAME,
      status: 'success',
      inputSummary: { nodeId: query.nodeId },
      outputSummary: {
        success: true,
        contentType: source.contentType,
        size: source.size,
      },
      durationMs: Date.now() - startedAt,
    })

    return new NextResponse(new Uint8Array(source.buffer), {
      status: 200,
      headers: {
        'content-type': source.contentType,
        'content-length': String(source.size),
        'cache-control': 'no-store',
        'x-sim-audit-id': auditId,
        'x-sim-presentation-file-name': encodeURIComponent(source.fileName).slice(0, 512),
      },
    })
  } catch (error) {
    const err =
      error instanceof HermesPresentationSourceError
        ? error
        : new HermesPresentationSourceError('INTERNAL_ERROR', toError(error).message)
    const status = statusForError(err.code)
    await recordHermesToolCallAudit({
      auditId,
      traceId,
      userId: query.userId,
      organizationId: query.organizationId,
      workspaceId: query.workspaceId,
      workflowId: query.workflowId,
      toolName: TOOL_NAME,
      status: 'error',
      inputSummary: { nodeId: query.nodeId },
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
