import { type NextRequest, NextResponse } from 'next/server'
import { getContentCanvasModelsContract } from '@/lib/api/contracts/content-canvas'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { getContentCanvasModelAvailabilityForRuntime } from '@/lib/content-canvas/service-config'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

export const dynamic = 'force-dynamic'

export const GET = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(getContentCanvasModelsContract, request, {})
  if (!parsed.success) return parsed.response

  const workspaceAccess = await checkWorkspaceAccess(parsed.data.query.workspaceId, auth.userId)
  if (!workspaceAccess.hasAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    success: true,
    models: await getContentCanvasModelAvailabilityForRuntime(),
  })
})
