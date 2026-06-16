import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  assertWorkflowMutable,
  authorizeWorkflowByWorkspacePermission,
  WorkflowLockedError,
} from '@sim/workflow-authz'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type GenerateContentCanvasPresentationResponse,
  generateContentCanvasPresentationContract,
} from '@/lib/api/contracts/content-canvas'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { HermesClientError } from '@/lib/hermes/client'
import { generatePresentationForCanvasNode } from '@/lib/presentation/presentation-generation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const logger = createLogger('ContentCanvasPresentationGenerateAPI')

function errorStatus(error: unknown): number {
  if (error instanceof HermesClientError) {
    return error.status && error.status >= 400 ? error.status : 503
  }
  if (error instanceof WorkflowLockedError) return error.status
  return 500
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status })
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return jsonError('Unauthorized', 401)
  }

  const parsed = await parseRequest(generateContentCanvasPresentationContract, request, {})
  if (!parsed.success) return parsed.response

  const { workspaceId, workflowId, nodeId, prompt, slideCount } = parsed.data.body

  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId: auth.userId,
    action: 'write',
  })

  if (!authorization.workflow) {
    return jsonError('Workflow not found', 404)
  }
  if (!authorization.allowed) {
    return jsonError(authorization.message || 'Access denied', authorization.status || 403)
  }
  if (authorization.accessSource && authorization.accessSource !== 'workspace') {
    return jsonError('Cross-team published workflow access does not include PPT generation', 403)
  }
  if (authorization.workflow.workspaceId !== workspaceId) {
    return jsonError('Workflow does not belong to the requested workspace', 400)
  }

  try {
    await assertWorkflowMutable(workflowId)
    const result = await generatePresentationForCanvasNode({
      userId: auth.userId,
      workspaceId,
      workflowId,
      nodeId,
      prompt,
      slideCount,
      traceId: request.headers.get('x-trace-id') ?? `presentation:${workflowId}:${nodeId}`,
      signal: request.signal,
    })

    return NextResponse.json(
      {
        success: true,
        answer: result.answer,
        nodeId,
        presentationStatus: 'complete',
        presentationArtifact: result.artifact,
        file: result.artifact.pptxFile,
        hermesResponseId: result.hermesResult.id,
      } satisfies GenerateContentCanvasPresentationResponse,
      { status: 200 }
    )
  } catch (error) {
    const err = toError(error)
    const status = errorStatus(error)
    logger.error('PPT generation failed', {
      userId: auth.userId,
      workspaceId,
      workflowId,
      nodeId,
      status,
      error: err.message,
    })
    return jsonError(err.message, status)
  }
})
