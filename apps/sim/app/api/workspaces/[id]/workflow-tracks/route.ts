import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { listWorkflowTracksContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listWorkflowTracksForWorkspace } from '@/lib/workflows/publication'

const logger = createLogger('WorkspaceWorkflowTracksAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized workflow tracks attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(listWorkflowTracksContract, request, context)
    if (!parsed.success) return parsed.response

    try {
      const tracks = await listWorkflowTracksForWorkspace({
        workspaceId: parsed.data.params.id,
        userId: auth.userId,
      })

      return NextResponse.json(tracks, { status: 200 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list workflow tracks'
      logger.error(`[${requestId}] Failed to list workflow tracks`, { error })
      if (message.includes('Access denied to workspace')) {
        return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
      }
      return NextResponse.json(
        { error: message },
        { status: message.includes('Access denied') ? 403 : 400 }
      )
    }
  }
)
