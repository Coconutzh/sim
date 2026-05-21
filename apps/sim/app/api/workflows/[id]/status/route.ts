import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { getWorkflowStatusContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import {
  checkNeedsRedeployment,
  createErrorResponse,
  createSuccessResponse,
} from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowStatusAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    let id = 'unknown'

    try {
      const auth = await checkHybridAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return createErrorResponse(auth.error || 'Unauthorized', 401)
      }

      const parsed = await parseRequest(getWorkflowStatusContract, request, context)
      if (!parsed.success) return parsed.response
      id = parsed.data.params.id

      const validation = await validateWorkflowAccess(request, id, false)
      if (validation.error) {
        logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
        return createErrorResponse(validation.error.message, validation.error.status)
      }

      const workflow = validation.workflow
      if (!workflow) {
        return createErrorResponse('Workflow not found', 404)
      }

      const needsRedeployment = workflow.isDeployed ? await checkNeedsRedeployment(id) : false

      return createSuccessResponse({
        isDeployed: workflow.isDeployed,
        deployedAt: workflow.deployedAt,
        isPublished: Boolean(workflow.publishedAt),
        needsRedeployment,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error getting status for workflow: ${id}`, error)
      return createErrorResponse('Failed to get status', 500)
    }
  }
)
