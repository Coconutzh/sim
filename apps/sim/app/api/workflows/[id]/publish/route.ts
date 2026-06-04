import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { publishWorkflowContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  createPublicationVersion,
  syncCurrentPublicationVersionSnapshot,
} from '@/lib/collaboration/service'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { publishWorkflowToMainline, syncWorkflowMainlineContent } from '@/lib/workflows/publication'

const logger = createLogger('WorkflowPublishAPI')

function getStatusForErrorMessage(message: string): number {
  if (message === 'Workflow not found') return 404
  if (message.includes('not found')) return 404
  if (message === 'Canvas access required') return 403
  if (message.includes('Access denied') || message.includes('access denied')) return 403
  return 400
}

function mapPublicationVersionSummary(publicationVersion: {
  id: string
  title: string
  versionNumber: number
  status: 'published' | 'superseded' | 'archived' | 'retracted' | 'draft'
  parentVersionId: string | null
  publishedAt: Date
}) {
  return {
    id: publicationVersion.id,
    title: publicationVersion.title,
    versionNumber: publicationVersion.versionNumber,
    status: publicationVersion.status,
    parentVersionId: publicationVersion.parentVersionId,
    publishedAt: publicationVersion.publishedAt.toISOString(),
  }
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
      if (parsed.data.body.action === 'sync_content') {
        const publishedWorkflow = await syncWorkflowMainlineContent({
          workflowId: parsed.data.params.id,
          userId: auth.userId,
        })
        const publicationVersion = await syncCurrentPublicationVersionSnapshot({
          sourceWorkflowId: parsed.data.params.id,
          publishedWorkflowId: publishedWorkflow.id,
          publishedBy: auth.userId,
        })

        return NextResponse.json({
          publishedWorkflow,
          publicationVersion: mapPublicationVersionSummary(publicationVersion),
        })
      }

      const publishedWorkflow = await publishWorkflowToMainline({
        workflowId: parsed.data.params.id,
        userId: auth.userId,
        name: parsed.data.body.name ?? parsed.data.body.title,
        visibility: parsed.data.body.visibility,
        viewerWorkgroupIds:
          parsed.data.body.targetWorkgroupIds.length > 0
            ? parsed.data.body.targetWorkgroupIds
            : parsed.data.body.viewerWorkgroupIds,
      })
      const publicationVersion = await createPublicationVersion({
        sourceWorkflowId: parsed.data.params.id,
        publishedWorkflowId: publishedWorkflow.id,
        title: parsed.data.body.title ?? parsed.data.body.name ?? publishedWorkflow.name,
        description: parsed.data.body.description ?? null,
        visibility:
          parsed.data.body.visibility === 'selected_workgroups'
            ? 'selected_workgroups'
            : 'organization',
        parentVersionId: parsed.data.body.parentVersionId ?? null,
        publishedBy: auth.userId,
      })

      return NextResponse.json(
        {
          publishedWorkflow,
          publicationVersion: mapPublicationVersionSummary(publicationVersion),
        },
        { status: 200 }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to publish workflow'
      logger.error(`[${requestId}] Failed to publish workflow`, { error })
      return NextResponse.json({ error: message }, { status: getStatusForErrorMessage(message) })
    }
  }
)
