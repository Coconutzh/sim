import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import {
  assertFolderMutable,
  authorizeWorkflowByWorkspacePermission,
  FolderLockedError,
  WorkflowLockedError,
} from '@sim/workflow-authz'
import { type NextRequest, NextResponse } from 'next/server'
import { restoreWorkflowContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { restoreWorkflow } from '@/lib/workflows/lifecycle'

const logger = createLogger('RestoreWorkflowAPI')

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    let workflowId = 'unknown'

    try {
      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(restoreWorkflowContract, request, context)
      if (!parsed.success) return parsed.response
      workflowId = parsed.data.params.id

      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId: auth.userId,
        action: 'write',
        includeArchived: true,
      })
      const workflowData = authorization.workflow
      if (!workflowData) {
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }

      if (!authorization.allowed) {
        const status = authorization.status || 403
        const message = status === 404 ? 'Workflow not found' : authorization.message || 'Forbidden'
        return NextResponse.json({ error: message }, { status })
      }

      if (workflowData.locked) {
        throw new WorkflowLockedError('Workflow is locked')
      }
      await assertFolderMutable(workflowData.folderId)

      const result = await restoreWorkflow(workflowId, { requestId })

      if (!result.restored) {
        return NextResponse.json({ error: 'Workflow is not archived' }, { status: 400 })
      }

      logger.info(`[${requestId}] Restored workflow ${workflowId}`)

      recordAudit({
        workspaceId: workflowData.workspaceId,
        actorId: auth.userId,
        actorName: auth.userName,
        actorEmail: auth.userEmail,
        action: AuditAction.WORKFLOW_RESTORED,
        resourceType: AuditResourceType.WORKFLOW,
        resourceId: workflowId,
        resourceName: workflowData.name,
        description: `Restored workflow "${workflowData.name}"`,
        metadata: {
          workflowName: workflowData.name,
          workspaceId: workflowData.workspaceId || undefined,
        },
        request,
      })

      captureServerEvent(
        auth.userId,
        'workflow_restored',
        { workflow_id: workflowId, workspace_id: workflowData.workspaceId ?? '' },
        workflowData.workspaceId ? { groups: { workspace: workflowData.workspaceId } } : undefined
      )

      return NextResponse.json({ success: true })
    } catch (error) {
      if (error instanceof WorkflowLockedError || error instanceof FolderLockedError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }

      logger.error(`[${requestId}] Error restoring workflow ${workflowId}`, error)
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      )
    }
  }
)
