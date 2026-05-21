import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { NextRequest, NextResponse } from 'next/server'
import { getDeployedWorkflowStateContract } from '@/lib/api/contracts/deployments'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { verifyInternalToken } from '@/lib/auth/internal'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowDeployedStateAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function addNoCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  return response
}

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    let id = 'unknown'

    try {
      const authHeader = request.headers.get('authorization')
      let isInternalCall = false

      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1]
        const verification = await verifyInternalToken(token)
        isInternalCall = verification.valid
      }

      if (!isInternalCall) {
        const session = await getSession()
        if (!session?.user?.id) {
          return addNoCacheHeaders(createErrorResponse('Unauthorized', 401))
        }
      }

      const parsed = await parseRequest(getDeployedWorkflowStateContract, request, context)
      if (!parsed.success) return parsed.response
      id = parsed.data.params.id

      if (!isInternalCall) {
        const { error } = await validateWorkflowPermissions(id, requestId, 'read')
        if (error) {
          const response = createErrorResponse(error.message, error.status)
          return addNoCacheHeaders(response)
        }
      }

      let deployedState = null
      try {
        const data = await loadDeployedWorkflowState(id)
        deployedState = {
          blocks: data.blocks,
          edges: data.edges,
          loops: data.loops,
          parallels: data.parallels,
          variables: data.variables,
        }
      } catch (error) {
        logger.warn(`[${requestId}] Failed to load deployed state for workflow ${id}`, { error })
        deployedState = null
      }

      const response = createSuccessResponse({ deployedState })
      return addNoCacheHeaders(response)
    } catch (error) {
      const normalizedError = toError(error)
      logger.error(`[${requestId}] Error fetching deployed state: ${id}`, normalizedError)
      const response = createErrorResponse(
        normalizedError.message || 'Failed to fetch deployed state',
        500
      )
      return addNoCacheHeaders(response)
    }
  }
)
