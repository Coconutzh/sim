import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { projectTaskEventsContract } from '@/lib/api/contracts/project-tasks'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { projectTaskEvents } from '@/lib/collaboration/project-task-events'
import {
  assertCanReadProjectTaskEvents,
  getProjectTaskErrorResponse,
} from '@/lib/collaboration/project-tasks'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('ProjectTaskEventsAPI')
const HEARTBEAT_INTERVAL_MS = 30_000

export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) return new Response('Unauthorized', { status: 401 })

  const parsed = await parseRequest(projectTaskEventsContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    await assertCanReadProjectTaskEvents({
      userId: session.user.id,
      organizationId: parsed.data.query.organizationId,
      scope: parsed.data.query.scope,
      workgroupId: parsed.data.query.workgroupId,
    })
  } catch (error) {
    const response = getProjectTaskErrorResponse(error, 'Project task event access denied')
    logger.warn('Project task event access denied', { error })
    return new Response(response.message, { status: response.status })
  }

  const encoder = new TextEncoder()
  const { organizationId, scope, workgroupId } = parsed.data.query
  let cleaned = false
  let cleanup: () => void = () => {
    cleaned = true
  }

  const stream = new ReadableStream({
    start(controller) {
      const unsubscribe = projectTaskEvents.subscribe((event) => {
        if (cleaned || event.organizationId !== organizationId) return
        if (scope === 'self' && event.assigneeWorkgroupId !== workgroupId) return

        try {
          controller.enqueue(
            encoder.encode(`event: project_task\ndata: ${JSON.stringify(event)}\n\n`)
          )
        } catch {
          cleanup()
        }
      })

      const heartbeat = setInterval(() => {
        if (cleaned) {
          clearInterval(heartbeat)
          return
        }
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          cleanup()
        }
      }, HEARTBEAT_INTERVAL_MS)

      cleanup = () => {
        if (cleaned) return
        cleaned = true
        clearInterval(heartbeat)
        unsubscribe()
        logger.info('Project task SSE connection closed', { organizationId, scope, workgroupId })
      }

      request.signal.addEventListener(
        'abort',
        () => {
          cleanup()
          try {
            controller.close()
          } catch {}
        },
        { once: true }
      )

      logger.info('Project task SSE connection opened', { organizationId, scope, workgroupId })
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
})
