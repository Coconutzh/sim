import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { createFileResponse } from '@/app/api/files/utils'
import {
  getProductionTaskSessionUserId,
  productionTaskErrorResponse,
} from '@/app/api/production-tasks/_utils'
import { downloadProductionTaskAttachmentContract } from '@/lib/api/contracts/production-tasks'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { downloadProductionTaskAttachment } from '@/lib/production-tasks/service'

const logger = createLogger('ProductionTaskAttachmentDownloadAPI')

export const GET = withRouteHandler(async (request, context) => {
  const userId = await getProductionTaskSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(downloadProductionTaskAttachmentContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const file = await downloadProductionTaskAttachment({
      userId,
      taskId: parsed.data.params.taskId,
      attachmentId: parsed.data.params.attachmentId,
      kind: parsed.data.query.kind,
    })

    return createFileResponse({
      buffer: file.buffer,
      contentType: file.contentType,
      filename: file.name,
      cacheControl: 'private, no-cache, must-revalidate',
    })
  } catch (error) {
    return productionTaskErrorResponse(
      logger,
      'Failed to download production task attachment',
      error
    )
  }
})
