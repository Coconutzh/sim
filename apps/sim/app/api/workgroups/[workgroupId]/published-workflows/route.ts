import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { listPublishedWorkflowsForWorkgroupContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
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

    const parsed = await parseRequest(listPublishedWorkflowsForWorkgroupContract, request, context)
    if (!parsed.success) return parsed.response

    try {
      const data = await listPublishedWorkflowsForWorkgroup({
        workgroupId: parsed.data.params.workgroupId,
        userId: auth.userId,
      })

      return NextResponse.json({ data }, { status: 200 })
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
