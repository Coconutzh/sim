import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { publishWorkflowContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { publishWorkflowToMainline } from '@/lib/workflows/publication'

const logger = createLogger('WorkflowPublishAPI')

function getStatusForErrorMessage(message: string): number {
  if (message === 'Workflow not found') return 404
  if (message.includes('Access denied')) return 403
  return 400
}

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()

    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized publish attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(publishWorkflowContract, request, context)
    if (!parsed.success) return parsed.response

    try {
      const publishedWorkflow = await publishWorkflowToMainline({
        workflowId: parsed.data.params.id,
        userId: auth.userId,
        name: parsed.data.body.name,
        visibility: parsed.data.body.visibility,
        viewerWorkgroupIds: parsed.data.body.viewerWorkgroupIds,
      })

      return NextResponse.json({ publishedWorkflow }, { status: 200 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to publish workflow'
      logger.error(`[${requestId}] Failed to publish workflow`, { error })
      return NextResponse.json({ error: message }, { status: getStatusForErrorMessage(message) })
    }
  }
)
