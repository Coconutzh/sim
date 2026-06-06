import { type NextRequest, NextResponse } from 'next/server'
import { generateWorkspaceImageContract } from '@/lib/api/contracts/media-images'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { generateWorkspaceImageFromPrompt } from '@/lib/generated-media/image/image-generation-service'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const validation = await parseRequest(generateWorkspaceImageContract, request, {}, {})
  if (!validation.success) return validation.response

  const { workspaceId, model, prompt, aspectRatio, referenceContext } = validation.data.body
  const workspaceAccess = await checkWorkspaceAccess(workspaceId, auth.userId)
  if (!workspaceAccess.hasAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const result = await generateWorkspaceImageFromPrompt({
    workspaceId,
    userId: auth.userId,
    model,
    prompt,
    aspectRatio,
    referenceContext,
  })

  return NextResponse.json({
    success: true,
    file: result.file,
    metadata: result.metadata,
  })
})
