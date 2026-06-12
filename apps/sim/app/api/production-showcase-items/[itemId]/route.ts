import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  getProductionShowcaseItemContract,
  updateProductionShowcaseItemContract,
  withdrawProductionShowcaseItemContract,
} from '@/lib/api/contracts/production-showcase-items'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  getProductionShowcaseItem,
  updateProductionShowcaseItem,
  withdrawProductionShowcaseItem,
} from '@/lib/production-tasks/service'
import {
  getProductionTaskSessionUserId,
  productionTaskErrorResponse,
} from '@/app/api/production-tasks/_utils'

const logger = createLogger('ProductionShowcaseItemDetailAPI')

export const GET = withRouteHandler(async (request, context) => {
  const userId = await getProductionTaskSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(getProductionShowcaseItemContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const item = await getProductionShowcaseItem({
      userId,
      workspaceId: parsed.data.query.workspaceId,
      itemId: parsed.data.params.itemId,
    })
    return NextResponse.json({ item })
  } catch (error) {
    return productionTaskErrorResponse(logger, 'Failed to get production showcase item', error)
  }
})

export const PATCH = withRouteHandler(async (request, context) => {
  const userId = await getProductionTaskSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(updateProductionShowcaseItemContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const item = await updateProductionShowcaseItem({
      userId,
      workspaceId: parsed.data.body.workspaceId,
      itemId: parsed.data.params.itemId,
      title: parsed.data.body.title,
      description: parsed.data.body.description,
      category: parsed.data.body.category,
      content: parsed.data.body.content,
      attachments: parsed.data.body.attachments,
    })
    return NextResponse.json({ item })
  } catch (error) {
    return productionTaskErrorResponse(logger, 'Failed to update production showcase item', error)
  }
})

export const DELETE = withRouteHandler(async (request, context) => {
  const userId = await getProductionTaskSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(withdrawProductionShowcaseItemContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const item = await withdrawProductionShowcaseItem({
      userId,
      workspaceId: parsed.data.body.workspaceId,
      itemId: parsed.data.params.itemId,
    })
    return NextResponse.json({ item })
  } catch (error) {
    return productionTaskErrorResponse(logger, 'Failed to withdraw production showcase item', error)
  }
})
