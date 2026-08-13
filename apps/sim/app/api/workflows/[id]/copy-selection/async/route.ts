import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { queueCopySelectionContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getJobQueue } from '@/lib/core/async-jobs'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { CopySelectionError, copyWorkflowSelection } from '@/lib/workflows/copy-selection-service'

const logger = createLogger('QueueCopySelectionAPI')

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(queueCopySelectionContract, request, context)
  if (!parsed.success) return parsed.response

  if (
    parsed.data.body.source.workflowId &&
    parsed.data.body.source.workflowId !== parsed.data.params.id
  ) {
    return NextResponse.json({ error: 'Source workflow mismatch' }, { status: 400 })
  }

  try {
    const sourceWorkflowId = parsed.data.params.id
    const payload = { actorUserId: session.user.id, sourceWorkflowId, body: parsed.data.body }
    const jobQueue = await getJobQueue()
    const taskId = await jobQueue.enqueue('canvas-node-transfer', payload, {
      maxAttempts: 1,
      metadata: {
        workflowId: sourceWorkflowId,
        workspaceId: parsed.data.body.target.workspaceId,
        userId: session.user.id,
        targetWorkflowId: parsed.data.body.target.workflowId,
      },
      concurrencyKey: `canvas-node-transfer:${session.user.id}`,
      concurrencyLimit: 1,
      runner: (_jobPayload, signal) => copyWorkflowSelection({ ...payload, signal }),
    })
    return NextResponse.json({ taskId })
  } catch (error) {
    if (error instanceof CopySelectionError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error('Failed to queue selection copy', error)
    return NextResponse.json({ error: 'Failed to queue selection copy' }, { status: 500 })
  }
})
