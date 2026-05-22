import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { listShowcasePublicationsContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { listVisiblePublications } from '@/lib/collaboration/service'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listPublishedWorkflowsForWorkgroup } from '@/lib/workflows/publication'

const logger = createLogger('WorkgroupPublishedWorkflowsAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ workgroupId: string }> }) => {
    const requestId = generateRequestId()
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized published workflow list attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(listShowcasePublicationsContract, request, context)
    if (!parsed.success) return parsed.response
    const { workgroupId } = parsed.data.params
    const { disciplineCode, sourceWorkgroupId, agentCode, status, limit } = parsed.data.query

    try {
      const data = await listPublishedWorkflowsForWorkgroup({
        workgroupId,
        userId: auth.userId,
      })
      const publications = await listVisiblePublications({
        workgroupId,
        userId: auth.userId,
        disciplineCode,
        sourceWorkgroupId,
        agentCode,
        status,
        limit,
      })

      return NextResponse.json({ data, publications, nextCursor: null }, { status: 200 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list published workflows'
      logger.error(`[${requestId}] Failed to list published workflows`, { error })
      return NextResponse.json(
        { error: message },
        {
          status: message.includes('Access denied')
            ? 403
            : message.includes('not found')
              ? 404
              : 400,
        }
      )
    }
  }
)
