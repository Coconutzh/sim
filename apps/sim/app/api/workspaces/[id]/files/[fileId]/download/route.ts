import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { downloadWorkspaceFileContract } from '@/lib/api/contracts/workspace-files'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { getWorkspaceMembershipAccess } from '@/app/api/workflows/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceFileDownloadAPI')

/**
 * POST /api/workspaces/[id]/files/[fileId]/download
 * Return authenticated file serve URL (requires read permission)
 * Uses /api/files/serve endpoint which enforces authentication and context
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; fileId: string }> }) => {
    const requestId = generateRequestId()

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(downloadWorkspaceFileContract, request, context)
      if (!parsed.success) return parsed.response
      const { id: workspaceId, fileId } = parsed.data.params

      const membership = await getWorkspaceMembershipAccess(session.user.id, workspaceId)
      if (!membership.exists || !membership.hasAccess) {
        logger.warn(
          `[${requestId}] User ${session.user.id} lacks permission for workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
      }

      const fileRecord = await getWorkspaceFile(workspaceId, fileId)
      if (!fileRecord) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      const { getBaseUrl } = await import('@/lib/core/utils/urls')
      const serveUrl = `${getBaseUrl()}/api/files/serve/${encodeURIComponent(fileRecord.key)}?context=workspace`
      const viewerUrl = `${getBaseUrl()}/workspace/${workspaceId}/files/${fileId}`

      logger.info(`[${requestId}] Generated download URL for workspace file: ${fileRecord.name}`)

      return NextResponse.json({
        success: true,
        downloadUrl: serveUrl,
        viewerUrl: viewerUrl,
        fileName: fileRecord.name,
        expiresIn: null,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error generating download URL:`, error)
      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to generate download URL',
        },
        { status: 500 }
      )
    }
  }
)
