import { db } from '@sim/db'
import { workflowBlocks, workflowEdges } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { authorizeWorkflowByWorkspacePermission, resolveCanvasScope } from '@sim/workflow-authz'
import { and, eq, inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { copySelectionContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { sanitizeWorkflowSnapshot } from '@/lib/collaboration/snapshot-sanitizer'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { copyWorkspaceFileReferences } from '@/lib/workflows/workspace-file-copy'

const logger = createLogger('CopySelectionAPI')

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(copySelectionContract, request, context)
  if (!parsed.success) return parsed.response

  if (
    parsed.data.body.source.workflowId &&
    parsed.data.body.source.workflowId !== parsed.data.params.id
  ) {
    return NextResponse.json({ error: 'Source workflow mismatch' }, { status: 400 })
  }

  const sourceWorkflowId = parsed.data.params.id
  const targetWorkflowId = parsed.data.body.target.workflowId
  const blockIds = [...new Set(parsed.data.body.selection.blockIds)]

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

  const sourceScope = resolveCanvasScope({
    accessSource: sourceAccess.accessSource,
    workspaceMode: sourceAccess.workspaceMode,
    workspaceWorkgroupId: sourceAccess.workspaceWorkgroupId,
    workflowTrack: sourceAccess.workflow?.track,
  })
  const targetScope = resolveCanvasScope({
    accessSource: targetAccess.accessSource,
    workspaceMode: targetAccess.workspaceMode,
    workspaceWorkgroupId: targetAccess.workspaceWorkgroupId,
    workflowTrack: targetAccess.workflow?.track,
  })

  if (
    sourceScope !== parsed.data.body.source.type ||
    targetScope !== parsed.data.body.target.type
  ) {
    return NextResponse.json({ error: 'Copy selection canvas type mismatch' }, { status: 403 })
  }

  if (targetAccess.workflow?.workspaceId !== parsed.data.body.target.workspaceId) {
    return NextResponse.json(
      { error: 'Target workflow does not belong to target workspace' },
      { status: 403 }
    )
  }

  if (blockIds.length === 0) {
    return NextResponse.json({
      inserted: { blockIds: [], edgeIds: [] },
      mappings: { blockIds: {}, edgeIds: {} },
    })
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
    const edgeIdMap = new Map(insertedEdges.map((edge) => [edge.id, generateId()]))
    const insertedEdgeIds = insertedEdges.map((edge) => edgeIdMap.get(edge.id) as string)
    const placement = parsed.data.body.placement
    const shouldCopyWorkspaceFiles = sourceScope === 'personal' && targetScope === 'team'
    const sourceWorkspaceId = sourceAccess.workflow?.workspaceId
    const targetWorkspaceId = targetAccess.workflow?.workspaceId

    if (shouldCopyWorkspaceFiles && (!sourceWorkspaceId || !targetWorkspaceId)) {
      return NextResponse.json({ error: 'Canvas workspace could not be resolved' }, { status: 400 })
    }

    const blocksWithCopiedFiles = await Promise.all(
      blocks.map(async (block) => {
        if (!shouldCopyWorkspaceFiles || !sourceWorkspaceId || !targetWorkspaceId) {
          return block
        }
        const copiedValues = await copyWorkspaceFileReferences({
          sourceWorkspaceId,
          targetWorkspaceId,
          targetUserId: session.user.id,
          value: {
            subBlocks: block.subBlocks,
            outputs: block.outputs,
            data: block.data,
          },
        })
        return { ...block, ...copiedValues }
      })
    )

    await db.transaction(async (tx) => {
      if (blocksWithCopiedFiles.length > 0) {
        await tx.insert(workflowBlocks).values(
          blocksWithCopiedFiles.map((block) => ({
            id: idMap.get(block.id) as string,
            workflowId: targetWorkflowId,
            type: block.type,
            name: block.name,
            positionX: String(Number(block.positionX) + placement.offsetX),
            positionY: String(Number(block.positionY) + placement.offsetY),
            enabled: block.enabled,
            horizontalHandles: block.horizontalHandles,
            isWide: block.isWide,
            advancedMode: block.advancedMode,
            triggerMode: block.triggerMode,
            locked: false,
            height: block.height,
            subBlocks: sanitizeWorkflowSnapshot(block.subBlocks, {
              preserveWorkspaceFiles: shouldCopyWorkspaceFiles,
            }),
            outputs: sanitizeWorkflowSnapshot(block.outputs, {
              preserveWorkspaceFiles: shouldCopyWorkspaceFiles,
            }),
            data: sanitizeWorkflowSnapshot(block.data, {
              preserveWorkspaceFiles: shouldCopyWorkspaceFiles,
            }),
            createdAt: now,
            updatedAt: now,
          }))
        )
      }
      if (insertedEdges.length > 0) {
        await tx.insert(workflowEdges).values(
          insertedEdges.map((edge) => ({
            id: edgeIdMap.get(edge.id) as string,
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

    return NextResponse.json({
      inserted: { blockIds: insertedBlockIds, edgeIds: insertedEdgeIds },
      mappings: {
        blockIds: Object.fromEntries(idMap),
        edgeIds: Object.fromEntries(edgeIdMap),
      },
    })
  } catch (error) {
    logger.error('Failed to copy selection', error)
    return NextResponse.json({ error: 'Failed to copy selection' }, { status: 500 })
  }
})
