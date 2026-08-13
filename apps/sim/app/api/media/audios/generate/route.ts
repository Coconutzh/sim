import { type NextRequest, NextResponse } from 'next/server'
import { generateWorkspaceAudioContract } from '@/lib/api/contracts/media-audios'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { generateWorkspaceAudioFromPrompt } from '@/lib/generated-media/audio/audio-generation-service'
import { InsufficientCreditsError } from '@/lib/credits/wallet'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

export const dynamic = 'force-dynamic'

function getAudioGenerationErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Audio generation failed'

  if (error instanceof InsufficientCreditsError) {
    return NextResponse.json({ error: message }, { status: 402 })
  }

  if (message.includes('not configured')) {
    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json({ error: message }, { status: 502 })
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const validation = await parseRequest(generateWorkspaceAudioContract, request, {}, {})
  if (!validation.success) return validation.response

  const { workspaceId, model, prompt, parameters, referenceContext } = validation.data.body
  const workspaceAccess = await checkWorkspaceAccess(workspaceId, auth.userId)
  if (!workspaceAccess.hasAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let result
  try {
    result = await generateWorkspaceAudioFromPrompt({
      workspaceId,
      userId: auth.userId,
      model,
      prompt,
      parameters,
      referenceContext,
    })
  } catch (error) {
    return getAudioGenerationErrorResponse(error)
  }

  return NextResponse.json({
    success: true,
    file: result.file,
    metadata: result.metadata,
  })
})
