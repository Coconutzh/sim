import { type NextRequest, NextResponse } from 'next/server'
import { pausedWorkflowExecutionByIdContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withRouteHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string; executionId: string }> }
  ) => {
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(pausedWorkflowExecutionByIdContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workflowId, executionId } = parsed.data.params

    const access = await validateWorkflowAccess(request, workflowId, false)
    if (access.error) {
      return NextResponse.json({ error: access.error.message }, { status: access.error.status })
    }

    const detail = await PauseResumeManager.getPausedExecutionDetail({
      workflowId,
      executionId,
    })

    if (!detail) {
      return NextResponse.json({ error: 'Paused execution not found' }, { status: 404 })
    }

    return NextResponse.json(detail)
  }
)
