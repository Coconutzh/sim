import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { FolderLockedError } from '@sim/workflow-authz'
import { type NextRequest, NextResponse } from 'next/server'
import { duplicateWorkflowContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { duplicateWorkflow } from '@/lib/workflows/persistence/duplicate'

const logger = createLogger('WorkflowDuplicateAPI')

// POST /api/workflows/[id]/duplicate - Duplicate a workflow with all its blocks, edges, and subflows
export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const startTime = Date.now()
    let sourceWorkflowIdForLog = 'unknown'

    const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized workflow duplication attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = auth.userId

    try {
      const parsed = await parseRequest(duplicateWorkflowContract, req, context)
      if (!parsed.success) return parsed.response
      const { id: sourceWorkflowId } = parsed.data.params
      sourceWorkflowIdForLog = sourceWorkflowId
      const { name, description, color, workspaceId, folderId, newId } = parsed.data.body

      logger.info(`[${requestId}] Duplicating workflow ${sourceWorkflowId} for user ${userId}`)

      const result = await duplicateWorkflow({
        sourceWorkflowId,
        userId,
        name,
        description,
        color,
        workspaceId,
        folderId,
        requestId,
        newWorkflowId: newId,
      })

      try {
        PlatformEvents.workflowDuplicated({
          sourceWorkflowId,
          newWorkflowId: result.id,
          workspaceId,
        })
      } catch {
        // Telemetry should not fail the operation
      }

      captureServerEvent(
        userId,
        'workflow_duplicated',
        {
          source_workflow_id: sourceWorkflowId,
          new_workflow_id: result.id,
          workspace_id: workspaceId ?? '',
        },
        workspaceId ? { groups: { workspace: workspaceId } } : undefined
      )

      const elapsed = Date.now() - startTime
      logger.info(
        `[${requestId}] Successfully duplicated workflow ${sourceWorkflowId} to ${result.id} in ${elapsed}ms`
      )

      recordAudit({
        workspaceId: workspaceId || null,
        actorId: userId,
        actorName: auth.userName,
        actorEmail: auth.userEmail,
        action: AuditAction.WORKFLOW_DUPLICATED,
        resourceType: AuditResourceType.WORKFLOW,
        resourceId: result.id,
        resourceName: result.name,
        description: `Duplicated workflow from ${sourceWorkflowId}`,
        metadata: {
          sourceWorkflowId,
          newWorkflowId: result.id,
          folderId: folderId || undefined,
        },
        request: req,
      })

      return NextResponse.json(result, { status: 201 })
    } catch (error) {
      if (error instanceof Error) {
        if (error instanceof FolderLockedError) {
          return NextResponse.json({ error: error.message }, { status: error.status })
        }

        if (error.message === 'Source workflow not found') {
          logger.warn(`[${requestId}] Source workflow ${sourceWorkflowIdForLog} not found`)
          return NextResponse.json({ error: 'Source workflow not found' }, { status: 404 })
        }

        if (error.message === 'Workflow not found') {
          logger.warn(
            `[${requestId}] User ${userId} cannot see source workflow ${sourceWorkflowIdForLog}`
          )
          return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
        }

        if (error.message === 'Source workflow access denied') {
          logger.warn(
            `[${requestId}] User ${userId} denied access to source workflow ${sourceWorkflowIdForLog}`
          )
          return NextResponse.json({ error: 'Access denied' }, { status: 403 })
        }

        if (error.message === 'Canvas access required for source workflow duplication') {
          logger.warn(
            `[${requestId}] User ${userId} attempted workflow duplication through cross-team published access for ${sourceWorkflowIdForLog}`
          )
          return NextResponse.json(
            { error: 'Cross-team published workflow access does not include workflow duplication' },
            { status: 403 }
          )
        }

        if (error.message === 'Cross-canvas workflow duplication is not supported') {
          logger.warn(
            `[${requestId}] User ${userId} attempted cross-canvas workflow duplication for ${sourceWorkflowIdForLog}`
          )
          return NextResponse.json({ error: error.message }, { status: 400 })
        }

        if (error.message === 'Folder is locked') {
          return NextResponse.json({ error: error.message }, { status: 423 })
        }

        if (error.message === 'Target folder not found') {
          return NextResponse.json({ error: error.message }, { status: 400 })
        }
      }

      const elapsed = Date.now() - startTime
      logger.error(
        `[${requestId}] Error duplicating workflow ${sourceWorkflowIdForLog} after ${elapsed}ms:`,
        error
      )
      return NextResponse.json({ error: 'Failed to duplicate workflow' }, { status: 500 })
    }
  }
)
