import { type NextRequest, NextResponse } from 'next/server'
import { buildTextNodeAiSystemPrompt } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/text-content-ai-utils'
import { generateContentCanvasTextContract } from '@/lib/api/contracts/content-canvas'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { getContentCanvasModel } from '@/lib/content-canvas/model-catalog'
import { generateContentCanvasText } from '@/lib/content-canvas/text-executor'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(generateContentCanvasTextContract, request, {})
  if (!parsed.success) return parsed.response

  const workspaceAccess = await checkWorkspaceAccess(parsed.data.body.workspaceId, auth.userId)
  if (!workspaceAccess.hasAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const model = getContentCanvasModel(parsed.data.body.model)
  if (!model || model.capability !== 'text') {
    return NextResponse.json({ error: 'Unsupported text model' }, { status: 400 })
  }

  const content = await generateContentCanvasText({
    workspaceId: parsed.data.body.workspaceId,
    model: parsed.data.body.model,
    systemPrompt: buildTextNodeAiSystemPrompt(),
    prompt: parsed.data.body.prompt,
    referenceContextText: parsed.data.body.referenceContextText,
    referenceImages: parsed.data.body.referenceImages,
  })

  return NextResponse.json({ content })
})
