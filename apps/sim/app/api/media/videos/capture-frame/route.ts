import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { captureWorkspaceVideoFrameContract } from '@/lib/api/contracts/media-videos'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureWorkspaceVideoFrame } from '@/lib/generated-media/video/video-frame-capture-service'
import type { StorageContext } from '@/lib/uploads'
import { inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import { verifyFileAccess } from '@/app/api/files/authorization'

export const dynamic = 'force-dynamic'

const logger = createLogger('MediaVideosCaptureFrameAPI')
const STORAGE_CONTEXTS = new Set<StorageContext>([
  'knowledge-base',
  'chat',
  'copilot',
  'mothership',
  'execution',
  'workspace',
  'profile-pictures',
  'og-images',
  'logs',
  'workspace-logos',
])

function normalizeSourceContext(value: string | undefined, key: string): StorageContext {
  if (value && STORAGE_CONTEXTS.has(value as StorageContext)) {
    return value as StorageContext
  }
  return inferContextFromKey(key)
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const validation = await parseRequest(captureWorkspaceVideoFrameContract, request, {}, {})
  if (!validation.success) return validation.response

  const { workspaceId, sourceFile, timeSeconds, mode } = validation.data.body
  const workspaceAccess = await checkWorkspaceAccess(workspaceId, auth.userId)
  if (!workspaceAccess.hasAccess || !workspaceAccess.canWrite) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const hasSourceAccess = await verifyFileAccess(
    sourceFile.key,
    auth.userId,
    undefined,
    normalizeSourceContext(sourceFile.context, sourceFile.key),
    false
  )
  if (!hasSourceAccess) {
    return NextResponse.json({ error: 'Source video not found' }, { status: 404 })
  }

  try {
    const result = await captureWorkspaceVideoFrame({
      workspaceId,
      userId: auth.userId,
      sourceFile,
      timeSeconds,
      mode,
    })

    return NextResponse.json({
      success: true,
      file: result.file,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Video frame capture failed.'
    logger.error('Video frame capture failed', {
      workspaceId,
      userId: auth.userId,
      error: message,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
})
