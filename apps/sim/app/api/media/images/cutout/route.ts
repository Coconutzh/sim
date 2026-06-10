import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { cutoutWorkspaceImageContract } from '@/lib/api/contracts/media-images'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { cutoutWorkspaceImage } from '@/lib/generated-media/image/image-generation-service'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('MediaImagesCutoutAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const validation = await parseRequest(cutoutWorkspaceImageContract, request, {}, {})
  if (!validation.success) return validation.response

  const { workspaceId, sourceImage } = validation.data.body
  const workspaceAccess = await checkWorkspaceAccess(workspaceId, auth.userId)
  if (!workspaceAccess.hasAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let result: Awaited<ReturnType<typeof cutoutWorkspaceImage>>
  try {
    result = await cutoutWorkspaceImage({
      workspaceId,
      userId: auth.userId,
      sourceImage,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image cutout failed.'
    logger.error('Image cutout failed', { workspaceId, userId: auth.userId, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    file: result.file,
    metadata: result.metadata,
  })
})
