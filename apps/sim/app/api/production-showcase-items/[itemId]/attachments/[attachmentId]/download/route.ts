import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { createFileResponse } from '@/app/api/files/utils'
import {
  getProductionTaskSessionUserId,
  productionTaskErrorResponse,
} from '@/app/api/production-tasks/_utils'
import { downloadProductionShowcaseAttachmentContract } from '@/lib/api/contracts/production-showcase-items'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { downloadProductionShowcaseAttachment } from '@/lib/production-tasks/service'

const logger = createLogger('ProductionShowcaseAttachmentDownloadAPI')

export const GET = withRouteHandler(async (request, context) => {
  const userId = await getProductionTaskSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(downloadProductionShowcaseAttachmentContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const file = await downloadProductionShowcaseAttachment({
      userId,
      itemId: parsed.data.params.itemId,
      attachmentId: parsed.data.params.attachmentId,
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
      'Failed to download production showcase attachment',
      error
    )
  }
})
