import { db } from '@sim/db'
import { workflowBlocks, workflowEdges } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { authorizeWorkflowByWorkspacePermission, resolveCanvasScope } from '@sim/workflow-authz'
import { and, eq, inArray } from 'drizzle-orm'
import type { CopySelectionBody } from '@/lib/api/contracts/collaboration'
import { sanitizeWorkflowSnapshot } from '@/lib/collaboration/snapshot-sanitizer'
import { copyWorkspaceFileReferences } from '@/lib/workflows/workspace-file-copy'

export interface CopySelectionResult {
  inserted: { blockIds: string[]; edgeIds: string[] }
  mappings: { blockIds: Record<string, string>; edgeIds: Record<string, string> }
}

export class CopySelectionError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'CopySelectionError'
  }
}

interface CopySelectionParams {
  actorUserId: string
  sourceWorkflowId: string
  body: CopySelectionBody
  signal?: AbortSignal
}

/**
 * Copies selected blocks and their contained workspace files between canvases.
 * Authorization is evaluated at execution time so queued work cannot outlive a
 * member's current workspace permissions.
 */
export async function copyWorkflowSelection({
  actorUserId,
  sourceWorkflowId,
  body,
  signal,
}: CopySelectionParams): Promise<CopySelectionResult> {
  if (signal?.aborted) throw new Error('Copy task was cancelled')
  if (body.source.workflowId && body.source.workflowId !== sourceWorkflowId) {
    throw new CopySelectionError('Source workflow mismatch', 400)
  }

  const targetWorkflowId = body.target.workflowId
  const blockIds = [...new Set(body.selection.blockIds)]
  const [sourceAccess, targetAccess] = await Promise.all([
    authorizeWorkflowByWorkspacePermission({
      workflowId: sourceWorkflowId,
      userId: actorUserId,
      action: 'read',
    }),
    authorizeWorkflowByWorkspacePermission({
      workflowId: targetWorkflowId,
      userId: actorUserId,
      action: 'write',
    }),
  ])
  if (!sourceAccess.allowed || !targetAccess.allowed) {
    throw new CopySelectionError('Copy selection access denied', 403)
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
  if (sourceScope !== body.source.type || targetScope !== body.target.type) {
    throw new CopySelectionError('Copy selection canvas type mismatch', 403)
  }
  if (targetAccess.workflow?.workspaceId !== body.target.workspaceId) {
    throw new CopySelectionError('Target workflow does not belong to target workspace', 403)
  }
  if (blockIds.length === 0) {
    return { inserted: { blockIds: [], edgeIds: [] }, mappings: { blockIds: {}, edgeIds: {} } }
  }

  const blocks = await db
    .select()
    .from(workflowBlocks)
    .where(
      and(eq(workflowBlocks.workflowId, sourceWorkflowId), inArray(workflowBlocks.id, blockIds))
    )
  if (signal?.aborted) throw new Error('Copy task was cancelled')

  const selectedBlockIds = new Set(blocks.map((block) => block.id))
  const explicitEdgeIds = [...new Set(body.selection.edgeIds)]
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
  const placement = {
    offsetX: body.placement?.offsetX ?? 80,
    offsetY: body.placement?.offsetY ?? 80,
  }
  const insertedEdges = edges.filter(
    (edge) => selectedBlockIds.has(edge.sourceBlockId) && selectedBlockIds.has(edge.targetBlockId)
  )
  const edgeIdMap = new Map(insertedEdges.map((edge) => [edge.id, generateId()]))
  const shouldCopyWorkspaceFiles = sourceScope === 'personal' && targetScope === 'team'
  const sourceWorkspaceId = sourceAccess.workflow?.workspaceId
  const targetWorkspaceId = targetAccess.workflow?.workspaceId
  if (shouldCopyWorkspaceFiles && (!sourceWorkspaceId || !targetWorkspaceId)) {
    throw new CopySelectionError('Canvas workspace could not be resolved', 400)
  }

  const blocksWithCopiedFiles = await Promise.all(
    blocks.map(async (block) => {
      if (!shouldCopyWorkspaceFiles || !sourceWorkspaceId || !targetWorkspaceId) return block
      const copiedValues = await copyWorkspaceFileReferences({
        sourceWorkspaceId,
        targetWorkspaceId,
        targetUserId: actorUserId,
        value: { subBlocks: block.subBlocks, outputs: block.outputs, data: block.data },
      })
      return { ...block, ...copiedValues }
    })
  )
  if (signal?.aborted) throw new Error('Copy task was cancelled')

  const now = new Date()
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

  return {
    inserted: { blockIds: [...idMap.values()], edgeIds: [...edgeIdMap.values()] },
    mappings: { blockIds: Object.fromEntries(idMap), edgeIds: Object.fromEntries(edgeIdMap) },
  }
}
