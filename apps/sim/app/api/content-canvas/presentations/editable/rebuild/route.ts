import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { NextResponse } from 'next/server'
import { rebuildContentCanvasPresentationEditableContract } from '@/lib/api/contracts/content-canvas'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { getJobQueue } from '@/lib/core/async-jobs'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  markPresentationEditableRebuildQueued,
  rebuildPresentationAsEditable,
} from '@/lib/presentation/presentation-generation'

const logger = createLogger('EditablePresentationRebuildAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Queues an object-level editable copy of an existing canvas PPT artifact. */
export const POST = withRouteHandler(async (request) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const parsed = await parseRequest(rebuildContentCanvasPresentationEditableContract, request, {})
  if (!parsed.success) return parsed.response

  const { workspaceId, workflowId, nodeId } = parsed.data.body
  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId: auth.userId,
    action: 'write',
  })
  if (!authorization.workflow) {
    return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 })
  }
  if (!authorization.allowed || authorization.workflow.workspaceId !== workspaceId) {
    return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 })
  }

  const taskId = `run_${generateId().replace(/-/g, '').slice(0, 20)}`
  const payload = { actorUserId: auth.userId, workspaceId, workflowId, nodeId, taskId }
  try {
    await markPresentationEditableRebuildQueued({ workflowId, nodeId, taskId })
    const jobQueue = await getJobQueue()
    await jobQueue.enqueue('editable-presentation-rebuild', payload, {
      jobId: taskId,
      maxAttempts: 2,
      metadata: { userId: auth.userId, workspaceId, workflowId },
      concurrencyKey: `editable-presentation:${workflowId}:${nodeId}`,
      concurrencyLimit: 1,
      runner: (_jobPayload, signal) => rebuildPresentationAsEditable({ ...payload, signal }),
    })
    return NextResponse.json({ success: true, taskId })
  } catch (error) {
    logger.error('Failed to queue editable PPT rebuild', {
      workflowId,
      nodeId,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to queue editable PPT rebuild',
      },
      { status: 500 }
    )
  }
})
