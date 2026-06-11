import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  createProductionShowcaseItemContract,
  listProductionShowcaseItemsContract,
} from '@/lib/api/contracts/production-showcase-items'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createProductionShowcaseItem,
  listProductionShowcaseItems,
} from '@/lib/production-tasks/service'
import {
  getProductionTaskSessionUserId,
  productionTaskErrorResponse,
} from '@/app/api/production-tasks/_utils'

const logger = createLogger('ProductionShowcaseItemsAPI')

export const GET = withRouteHandler(async (request) => {
  const userId = await getProductionTaskSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(listProductionShowcaseItemsContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    const items = await listProductionShowcaseItems({
      userId,
      workspaceId: parsed.data.query.workspaceId,
      category: parsed.data.query.category,
      includeWithdrawn: parsed.data.query.includeWithdrawn,
      limit: parsed.data.query.limit,
    })
    return NextResponse.json({ items })
  } catch (error) {
    return productionTaskErrorResponse(logger, 'Failed to list production showcase items', error)
  }
})

export const POST = withRouteHandler(async (request) => {
  const userId = await getProductionTaskSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(createProductionShowcaseItemContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    const item = await createProductionShowcaseItem({
      userId,
      workspaceId: parsed.data.body.workspaceId,
      title: parsed.data.body.title,
      description: parsed.data.body.description,
      category: parsed.data.body.category,
      content: parsed.data.body.content,
      taskId: parsed.data.body.taskId,
      submissionId: parsed.data.body.submissionId,
      attachments: parsed.data.body.attachments,
    })
    return NextResponse.json({ item })
  } catch (error) {
    return productionTaskErrorResponse(logger, 'Failed to create production showcase item', error)
  }
})
