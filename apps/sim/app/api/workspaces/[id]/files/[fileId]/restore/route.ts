import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { restoreWorkspaceFileContract } from '@/lib/api/contracts/workspace-files'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { FileConflictError, restoreWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('RestoreWorkspaceFileAPI')

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; fileId: string }> }) => {
    const requestId = generateRequestId()

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(restoreWorkspaceFileContract, request, context)
      if (!parsed.success) return parsed.response
      const { id: workspaceId, fileId } = parsed.data.params

      const access = await checkWorkspaceAccess(workspaceId, session.user.id)
      if (!access.exists || !access.hasAccess) {
        return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
      }

      if (!access.canWrite) {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }

      await restoreWorkspaceFile(workspaceId, fileId)

      logger.info(`[${requestId}] Restored workspace file ${fileId}`)

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.FILE_RESTORED,
        resourceType: AuditResourceType.FILE,
        resourceId: fileId,
        resourceName: fileId,
        description: `Restored workspace file ${fileId}`,
        request,
      })

      return NextResponse.json({ success: true })
    } catch (error) {
      if (error instanceof FileConflictError) {
        return NextResponse.json({ error: error.message }, { status: 409 })
      }
      logger.error(`[${requestId}] Error restoring workspace file`, error)
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      )
    }
  }
)
