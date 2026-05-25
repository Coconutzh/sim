import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  getWorkflowPublicationContract,
  updateWorkflowPublicationContract,
} from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  getWorkflowPublicationDetails,
  updateWorkflowPublicationDetails,
} from '@/lib/workflows/publication'

const logger = createLogger('WorkflowPublicationAPI')

function getStatusForErrorMessage(message: string): number {
  if (message === 'Workflow not found') return 404
  if (message === 'Canvas access required') return 403
  if (message.includes('Access denied')) return 403
  return 400
}

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized publication read attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getWorkflowPublicationContract, request, context)
    if (!parsed.success) return parsed.response

    try {
      const publication = await getWorkflowPublicationDetails({
        workflowId: parsed.data.params.id,
        userId: auth.userId,
      })
      return NextResponse.json(publication, { status: 200 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load publication'
      logger.error(`[${requestId}] Failed to load publication`, { error })
      return NextResponse.json({ error: message }, { status: getStatusForErrorMessage(message) })
    }
  }
)

export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized publication update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(updateWorkflowPublicationContract, request, context)
    if (!parsed.success) return parsed.response

    try {
      const publication = await updateWorkflowPublicationDetails({
        workflowId: parsed.data.params.id,
        userId: auth.userId,
        visibility: parsed.data.body.visibility,
        viewerWorkgroupIds: parsed.data.body.viewerWorkgroupIds,
      })
      return NextResponse.json(publication, { status: 200 })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to update publication settings'
      logger.error(`[${requestId}] Failed to update publication settings`, { error })
      return NextResponse.json({ error: message }, { status: getStatusForErrorMessage(message) })
    }
  }
)
