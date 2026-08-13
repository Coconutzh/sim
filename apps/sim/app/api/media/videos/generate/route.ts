import { type NextRequest, NextResponse } from 'next/server'
import { generateWorkspaceVideoContract } from '@/lib/api/contracts/media-videos'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { generateWorkspaceVideoFromPrompt } from '@/lib/generated-media/video/video-generation-service'
import { InsufficientCreditsError } from '@/lib/credits/wallet'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

export const dynamic = 'force-dynamic'

function getVideoGenerationErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Video generation failed'

  if (error instanceof InsufficientCreditsError) {
    return NextResponse.json({ error: message }, { status: 402 })
  }

  if (message.includes('not configured')) {
    return NextResponse.json({ error: message }, { status: 500 })
  }

  if (
    message.includes('publicly accessible image URLs') ||
    message.includes('HTTP or HTTPS image URLs') ||
    message.includes('valid HTTP or HTTPS URLs')
  ) {
    return NextResponse.json({ error: message }, { status: 400 })
  }

  return NextResponse.json({ error: message }, { status: 502 })
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const validation = await parseRequest(generateWorkspaceVideoContract, request, {}, {})
  if (!validation.success) return validation.response

  const { workspaceId, model, prompt, media, parameters } = validation.data.body
  const workspaceAccess = await checkWorkspaceAccess(workspaceId, auth.userId)
  if (!workspaceAccess.hasAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let result
  try {
    result = await generateWorkspaceVideoFromPrompt({
      workspaceId,
      userId: auth.userId,
      model,
      prompt,
      media,
      parameters,
    })
  } catch (error) {
    return getVideoGenerationErrorResponse(error)
  }

  return NextResponse.json({
    success: true,
    file: result.file,
    metadata: result.metadata,
  })
})
