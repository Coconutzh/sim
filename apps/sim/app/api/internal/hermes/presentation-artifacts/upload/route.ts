import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  type HermesPresentationArtifactErrorCode,
  type HermesPresentationArtifactUploadResponse,
  hermesPresentationArtifactUploadContract,
} from '@/lib/api/contracts/internal/hermes-presentation-artifacts'
import { parseRequest } from '@/lib/api/server'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  HermesPresentationArtifactError,
  storeHermesPresentationArtifact,
} from '@/lib/hermes/presentation-artifacts'
import { recordHermesToolCallAudit } from '@/lib/hermes/tool-call-audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const logger = createLogger('HermesPresentationArtifactsAPI')
const TOOL_NAME = 'sim_presentation_artifact_upload'

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

function statusForError(code: HermesPresentationArtifactErrorCode): number {
  if (code === 'USER_PERMISSION_DENIED') return 403
  if (code === 'WORKSPACE_NOT_FOUND') return 404
  if (code === 'PRESENTATION_FILE_TOO_LARGE') return 413
  if (code === 'PRESENTATION_FILE_INVALID') return 400
  if (code === 'UNAUTHENTICATED_SERVICE') return 401
  return 500
}

function jsonError(params: {
  status: number
  auditId: string
  traceId?: string
  errorCode: HermesPresentationArtifactErrorCode
  error: string
}): NextResponse<HermesPresentationArtifactUploadResponse> {
  return NextResponse.json(
    {
      success: false,
      answer: '',
      auditId: params.auditId,
      traceId: params.traceId,
      errorCode: params.errorCode,
      error: params.error,
    },
    { status: params.status }
  )
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auditId = generateId()
  const startedAt = Date.now()
  const headerTraceId = request.headers.get('x-trace-id') ?? undefined

  if (!verifyHermesServiceRequest(request)) {
    logger.warn('Rejected unauthorized Hermes presentation artifact upload request', {
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

  const parsed = await parseRequest(hermesPresentationArtifactUploadContract, request, {})
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
      error: 'Hermes presentation artifact upload request validation failed',
    })
    return parsed.response
  }

  const body = parsed.data.body
  const traceId = body.traceId ?? headerTraceId

  try {
    const stored = await storeHermesPresentationArtifact(body)
    await recordHermesToolCallAudit({
      auditId,
      traceId,
      hermesRunId: body.hermesRunId,
      userId: body.userId,
      organizationId: body.organizationId,
      workspaceId: body.workspaceId,
      workflowId: body.workflowId,
      toolName: TOOL_NAME,
      operation: 'upload',
      status: 'success',
      inputSummary: {
        title: body.title,
        slideCount: body.slideCount,
        source: body.source,
        hasCoverImage: Boolean(body.coverImage),
        hasTargetNodeId: Boolean(body.targetNodeId),
      },
      outputSummary: {
        success: true,
        pptxFileId: stored.pptxFile.id,
        coverImageFileId: stored.coverImageFile?.id,
        manifestFileId: stored.manifestFile.id,
      },
      durationMs: Date.now() - startedAt,
    })

    return NextResponse.json(
      {
        success: true,
        answer: `Presentation artifact "${stored.pptxFile.name}" was uploaded to SIM workspace storage.`,
        auditId,
        traceId,
        pptxFile: stored.pptxFile,
        coverImageFile: stored.coverImageFile,
        manifestFile: stored.manifestFile,
        manifest: stored.manifest,
      } satisfies HermesPresentationArtifactUploadResponse,
      { status: 200 }
    )
  } catch (error) {
    const err =
      error instanceof HermesPresentationArtifactError
        ? error
        : new HermesPresentationArtifactError('INTERNAL_ERROR', toError(error).message)
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
      operation: 'upload',
      status: 'error',
      inputSummary: {
        title: body.title,
        slideCount: body.slideCount,
        source: body.source,
        hasCoverImage: Boolean(body.coverImage),
        hasTargetNodeId: Boolean(body.targetNodeId),
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
