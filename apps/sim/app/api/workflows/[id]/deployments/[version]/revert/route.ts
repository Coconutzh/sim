import { createLogger } from '@sim/logger'
import { assertWorkflowMutable, WorkflowLockedError } from '@sim/workflow-authz'
import type { NextRequest } from 'next/server'
import { revertToDeploymentVersionContract } from '@/lib/api/contracts/deployments'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performRevertToVersion } from '@/lib/workflows/orchestration'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('RevertToDeploymentVersionAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; version: string }> }) => {
    const requestId = generateRequestId()
    let workflowIdForLog = 'unknown'
    let versionForLog: string | number = 'unknown'

    try {
      const authSession = await getSession()
      if (!authSession?.user?.id) {
        return createErrorResponse('Unauthorized', 401)
      }

      const parsed = await parseRequest(revertToDeploymentVersionContract, request, context)
      if (!parsed.success) return parsed.response

      const { id, version } = parsed.data.params
      workflowIdForLog = id
      versionForLog = version

      const {
        error,
        session,
        workflow: workflowRecord,
      } = await validateWorkflowPermissions(id, requestId, 'admin')
      if (error) {
        return createErrorResponse(error.message, error.status)
      }
      await assertWorkflowMutable(id)

      const result = await performRevertToVersion({
        workflowId: id,
        version,
        userId: session!.user.id,
        workflow: (workflowRecord ?? {}) as Record<string, unknown>,
        request,
        actorName: session!.user.name ?? undefined,
        actorEmail: session!.user.email ?? undefined,
      })

      if (!result.success) {
        return createErrorResponse(
          result.error || 'Failed to revert',
          result.errorCode === 'not_found' ? 404 : 500
        )
      }

      return createSuccessResponse({
        message: 'Reverted to deployment version',
        lastSaved: result.lastSaved,
      })
    } catch (error: any) {
      if (error instanceof WorkflowLockedError) {
        return createErrorResponse(error.message, error.status)
      }

      logger.error(
        `Error reverting workflow ${workflowIdForLog} to deployment version ${versionForLog}`,
        error
      )
      return createErrorResponse(error.message || 'Failed to revert', 500)
    }
  }
)
