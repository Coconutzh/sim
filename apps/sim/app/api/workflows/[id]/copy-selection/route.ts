import { db } from '@sim/db'
import { workflowBlocks, workflowEdges } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { and, eq, inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { copySelectionContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { sanitizeWorkflowSnapshot } from '@/lib/collaboration/snapshot-sanitizer'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CopySelectionAPI')

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(copySelectionContract, request, context)
  if (!parsed.success) return parsed.response

  const sourceWorkflowId = parsed.data.body.source.workflowId ?? parsed.data.params.id
  const targetWorkflowId = parsed.data.body.target.workflowId
  const blockIds = [...new Set(parsed.data.body.selection.blockIds)]
  if (blockIds.length === 0) {
    return NextResponse.json({ inserted: { blockIds: [], edgeIds: [] } })
  }

  const [sourceAccess, targetAccess] = await Promise.all([
    authorizeWorkflowByWorkspacePermission({
      workflowId: sourceWorkflowId,
      userId: session.user.id,
      action: 'read',
    }),
    authorizeWorkflowByWorkspacePermission({
      workflowId: targetWorkflowId,
      userId: session.user.id,
      action: 'write',
    }),
  ])
  if (!sourceAccess.allowed || !targetAccess.allowed) {
    return NextResponse.json({ error: 'Copy selection access denied' }, { status: 403 })
  }

  try {
    const blocks = await db
      .select()
      .from(workflowBlocks)
      .where(
        and(eq(workflowBlocks.workflowId, sourceWorkflowId), inArray(workflowBlocks.id, blockIds))
      )
    const selectedBlockIds = new Set(blocks.map((block) => block.id))
    const explicitEdgeIds = [...new Set(parsed.data.body.selection.edgeIds)]
    const edges = await db
      .select()
      .from(workflowEdges)
      .where(
        explicitEdgeIds.length > 0
          ? and(
              eq(workflowEdges.workflowId, sourceWorkflowId),
              inArray(workflowEdges.id, explicitEdgeIds)
            )
          : eq(workflowEdges.workflowId, sourceWorkflowId)
      )
    const idMap = new Map(blocks.map((block) => [block.id, generateId()]))
    const now = new Date()
    const insertedBlockIds = blocks.map((block) => idMap.get(block.id) as string)
    const insertedEdges = edges.filter(
      (edge) => selectedBlockIds.has(edge.sourceBlockId) && selectedBlockIds.has(edge.targetBlockId)
    )
    const insertedEdgeIds = insertedEdges.map(() => generateId())

    await db.transaction(async (tx) => {
      if (blocks.length > 0) {
        await tx.insert(workflowBlocks).values(
          blocks.map((block) => ({
            id: idMap.get(block.id) as string,
            workflowId: targetWorkflowId,
            type: block.type,
            name: block.name,
            positionX: String(Number(block.positionX) + 80),
            positionY: String(Number(block.positionY) + 80),
            enabled: block.enabled,
            horizontalHandles: block.horizontalHandles,
            isWide: block.isWide,
            advancedMode: block.advancedMode,
            triggerMode: block.triggerMode,
            locked: false,
            height: block.height,
            subBlocks: sanitizeWorkflowSnapshot(block.subBlocks),
            outputs: sanitizeWorkflowSnapshot(block.outputs),
            data: sanitizeWorkflowSnapshot(block.data),
            createdAt: now,
            updatedAt: now,
          }))
        )
      }
      if (insertedEdges.length > 0) {
        await tx.insert(workflowEdges).values(
          insertedEdges.map((edge, index) => ({
            id: insertedEdgeIds[index],
            workflowId: targetWorkflowId,
            sourceBlockId: idMap.get(edge.sourceBlockId) as string,
            targetBlockId: idMap.get(edge.targetBlockId) as string,
            sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle,
            createdAt: now,
          }))
        )
      }
    })

    return NextResponse.json({ inserted: { blockIds: insertedBlockIds, edgeIds: insertedEdgeIds } })
  } catch (error) {
    logger.error('Failed to copy selection', error)
    return NextResponse.json({ error: 'Failed to copy selection' }, { status: 500 })
  }
})
