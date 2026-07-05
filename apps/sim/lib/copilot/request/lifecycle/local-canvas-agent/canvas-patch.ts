import { generateId } from '@sim/utils/id'
import { getCanvasNodeAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters'
import type {
  CanvasNodeRecord,
  CanvasSnapshot,
  LocalCanvasAddContentReferenceOperation,
  LocalCanvasConnectOperation,
  LocalCanvasDeleteNodeOperation,
  LocalCanvasLayoutOperation,
  LocalCanvasPatch,
  LocalCanvasPatchOperation,
  LocalCanvasRemoveContentReferenceOperation,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import type { EditWorkflowOperation } from '@/lib/copilot/tools/server/workflow/edit-workflow/types'
import type {
  VideoMediaFileSlot,
  VideoMediaType,
} from '@/lib/generated-media/video/video-generation-utils'
import {
  removeVideoMediaFileForType,
  upsertVideoMediaFile,
} from '@/lib/generated-media/video/video-generation-utils'
import {
  CONTENT_REFERENCE_SOURCE_HANDLE_PREFIX,
  type ContentReferenceAutoLinkType,
  getContentReferenceAnchorForTarget,
  getContentReferenceSourceHandleId,
  getContentReferenceTargetHandleId,
  getOrdinaryContentReferenceHandles,
} from '@/lib/workflows/content-reference-edges'
import {
  type ContentNodeVariant,
  type ContentReferenceRecord,
  type ContentReferenceRole,
  getModelDisabledReason,
  normalizeContentReferences,
  removeContentReference,
  upsertContentReference,
} from '@/lib/workflows/content-references'

const NODE_GAP_X = 360
const NODE_GAP_Y = 220
const SUPPORTED_PATCH_OPERATION_TYPES = new Set([
  'create_node',
  'update_node',
  'delete_node',
  'connect',
  'add_content_reference',
  'remove_content_reference',
  'layout_nodes',
])

type CanvasEdge = CanvasSnapshot['edges'][number]
type ConnectionTarget = {
  block: string
  handle: string
  autoLinkType?: ContentReferenceAutoLinkType
}
type ConnectionMap = Record<string, ConnectionTarget | ConnectionTarget[]>
type ResolvedReferenceOperation =
  | {
      mode: 'add'
      consumer: CanvasNodeRecord
      source: CanvasNodeRecord
      consumerId: string
      sourceId: string
      sourceVariant: ContentNodeVariant
      role: ContentReferenceRole
    }
  | {
      mode: 'remove'
      consumer: CanvasNodeRecord
      source: CanvasNodeRecord
      consumerId: string
      sourceId: string
      sourceVariant: ContentNodeVariant
      role?: ContentReferenceRole
    }

function resolveNodeId(rawId: string, idMap: Map<string, string>): string {
  return idMap.get(rawId) ?? rawId
}

function isContentVariant(kind: string): kind is ContentNodeVariant {
  return (
    kind === 'text' ||
    kind === 'image' ||
    kind === 'video' ||
    kind === 'audio' ||
    kind === 'presentation'
  )
}

function isContentReferenceRole(value: unknown): value is ContentReferenceRole {
  return (
    value === 'text_context' ||
    value === 'image_reference' ||
    value === 'video_first_frame' ||
    value === 'video_last_frame' ||
    value === 'audio_reference'
  )
}

function readContentReferences(node: CanvasNodeRecord): ContentReferenceRecord[] {
  return normalizeContentReferences(node.values.contentReferences)
}

function readVideoMediaValue(value: unknown): Array<VideoMediaFileSlot<Record<string, unknown>>> {
  const rawItems = Array.isArray(value) ? value : []
  const parsedItems =
    typeof value === 'string' && value.trim()
      ? (() => {
          try {
            const parsed = JSON.parse(value) as unknown
            return Array.isArray(parsed) ? parsed : []
          } catch {
            return []
          }
        })()
      : rawItems
  return parsedItems.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    const type = record.type
    const file = record.file
    if (type !== 'first_frame' && type !== 'last_frame') return []
    if (!file || typeof file !== 'object' || Array.isArray(file)) return []
    return [{ type, file: file as Record<string, unknown> }]
  })
}

function readFileValue(node: CanvasNodeRecord): Record<string, unknown> | null {
  const raw = node.values.file
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as Record<string, unknown>
}

function resolveReferenceModel(node: CanvasNodeRecord): string {
  if (node.kind === 'image') {
    return typeof node.values.aiModel === 'string' && node.values.aiModel.trim()
      ? node.values.aiModel
      : 'jimeng-4.5'
  }
  if (node.kind === 'audio') {
    return typeof node.values.audioModel === 'string' && node.values.audioModel.trim()
      ? node.values.audioModel
      : 'suno-v5-beta'
  }
  if (node.kind === 'video') {
    return node.values.videoModelFamily === 'wan2.7' ? 'wan2.7-i2v' : 'wan2.6-i2v-flash'
  }
  return typeof node.values.aiModel === 'string' && node.values.aiModel.trim()
    ? node.values.aiModel
    : 'gemini-3.1-flash-lite-preview'
}

function videoMediaTypeForRole(role: ContentReferenceRole): VideoMediaType | null {
  if (role === 'video_first_frame') return 'first_frame'
  if (role === 'video_last_frame') return 'last_frame'
  return null
}

function autoLinkTypeForRole(
  role?: ContentReferenceRole
): ContentReferenceAutoLinkType | undefined {
  if (role === 'video_first_frame' || role === 'video_last_frame') return role
  return undefined
}

function readAutoLinkType(value: unknown): ContentReferenceAutoLinkType | undefined {
  return value === 'video_first_frame' || value === 'video_last_frame' ? value : undefined
}

function buildContentReferenceEdgeEndpoints(params: {
  consumerId: string
  sourceId: string
  role?: ContentReferenceRole
}): { edgeSourceId: string; edgeTargetId: string } {
  const isVideoFrame = params.role === 'video_first_frame' || params.role === 'video_last_frame'
  return isVideoFrame
    ? { edgeSourceId: params.sourceId, edgeTargetId: params.consumerId }
    : { edgeSourceId: params.consumerId, edgeTargetId: params.sourceId }
}

function appendConnectionTarget(
  connections: ConnectionMap,
  sourceHandle: string,
  target: ConnectionTarget
): void {
  const current = connections[sourceHandle]
  const values = Array.isArray(current) ? current : current ? [current] : []
  if (
    values.some(
      (item) =>
        item.block === target.block &&
        item.handle === target.handle &&
        item.autoLinkType === target.autoLinkType
    )
  ) {
    return
  }
  connections[sourceHandle] = values.length ? [...values, target] : target
}

function buildExistingConnections(sourceId: string, edges: CanvasEdge[]): ConnectionMap {
  const connections: ConnectionMap = {}
  for (const edge of edges) {
    if (edge.source !== sourceId) continue
    const autoLinkType = readAutoLinkType(edge.data?.autoLinkType)
    appendConnectionTarget(connections, edge.sourceHandle ?? 'source', {
      block: edge.target,
      handle: edge.targetHandle ?? 'target',
      ...(autoLinkType ? { autoLinkType } : {}),
    })
  }
  return connections
}

function buildContentConnection(
  source: CanvasNodeRecord,
  target: CanvasNodeRecord,
  role?: ContentReferenceRole
): { sourceHandle: string; target: ConnectionTarget } {
  if (
    role &&
    role !== 'video_first_frame' &&
    role !== 'video_last_frame' &&
    role !== 'video_frame_capture'
  ) {
    const ordinaryHandles = getOrdinaryContentReferenceHandles()
    return {
      sourceHandle: ordinaryHandles.sourceHandle,
      target: {
        block: target.id,
        handle: ordinaryHandles.targetHandle,
      },
    }
  }

  const sourceAnchor = target.position.x >= source.position.x ? 'right' : 'left'
  const targetAnchor = getContentReferenceAnchorForTarget({
    sourceX: source.position.x,
    targetX: target.position.x,
  })
  return {
    sourceHandle: getContentReferenceSourceHandleId(sourceAnchor),
    target: {
      block: target.id,
      handle: getContentReferenceTargetHandleId(targetAnchor),
    },
  }
}

function buildConnectOperation(
  operation: LocalCanvasConnectOperation,
  snapshot: CanvasSnapshot,
  idMap: Map<string, string>
): EditWorkflowOperation {
  const sourceId = resolveNodeId(operation.sourceNodeId, idMap)
  const targetId = resolveNodeId(operation.targetNodeId, idMap)
  const source =
    snapshot.nodes.find((node) => node.id === sourceId) ??
    ({ id: sourceId, position: { x: 0, y: 0 }, kind: 'generic_workflow_block' } as CanvasNodeRecord)
  const target =
    snapshot.nodes.find((node) => node.id === targetId) ??
    ({
      id: targetId,
      position: { x: source.position.x + NODE_GAP_X, y: source.position.y },
      kind: 'generic_workflow_block',
    } as CanvasNodeRecord)
  const connections = buildExistingConnections(sourceId, snapshot.edges)
  if (source.blockType === 'content' || target.blockType === 'content') {
    const connection = buildContentConnection(source, target)
    appendConnectionTarget(connections, connection.sourceHandle, connection.target)
  } else {
    appendConnectionTarget(connections, 'source', { block: targetId, handle: 'target' })
  }
  return {
    operation_type: 'edit',
    block_id: sourceId,
    params: {
      connections,
    },
  }
}

function buildVirtualEdge(
  operation: LocalCanvasConnectOperation,
  snapshot: CanvasSnapshot,
  idMap: Map<string, string>
): CanvasEdge {
  const sourceId = resolveNodeId(operation.sourceNodeId, idMap)
  const targetId = resolveNodeId(operation.targetNodeId, idMap)
  const source = snapshot.nodes.find((node) => node.id === sourceId)
  const target = snapshot.nodes.find((node) => node.id === targetId)
  if (source && target && (source.blockType === 'content' || target.blockType === 'content')) {
    const connection = buildContentConnection(source, target)
    return {
      source: sourceId,
      target: targetId,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.target.handle,
    }
  }
  return { source: sourceId, target: targetId, sourceHandle: 'source', targetHandle: 'target' }
}

function resolveAddContentReferenceOperation(
  operation: LocalCanvasAddContentReferenceOperation,
  nodes: Map<string, CanvasNodeRecord>,
  idMap: Map<string, string>
): ResolvedReferenceOperation | null {
  const consumerId = resolveNodeId(operation.consumerNodeId, idMap)
  const sourceId = resolveNodeId(operation.sourceNodeId, idMap)
  const consumer = nodes.get(consumerId)
  const source = nodes.get(sourceId)
  if (!consumer || !source || !isContentVariant(consumer.kind) || !isContentVariant(source.kind)) {
    return null
  }
  return {
    mode: 'add',
    consumer,
    source,
    consumerId,
    sourceId,
    sourceVariant: source.kind,
    role: operation.role,
  }
}

function resolveRemoveContentReferenceOperation(
  operation: LocalCanvasRemoveContentReferenceOperation,
  nodes: Map<string, CanvasNodeRecord>,
  idMap: Map<string, string>
): ResolvedReferenceOperation | null {
  const consumerId = resolveNodeId(operation.consumerNodeId, idMap)
  const sourceId = resolveNodeId(operation.sourceNodeId, idMap)
  const consumer = nodes.get(consumerId)
  const source = nodes.get(sourceId)
  if (!consumer || !source || !isContentVariant(consumer.kind) || !isContentVariant(source.kind)) {
    return null
  }
  return {
    mode: 'remove',
    consumer,
    source,
    consumerId,
    sourceId,
    sourceVariant: source.kind,
    role: operation.role,
  }
}

function buildContentReferenceInputFields(
  resolved: ResolvedReferenceOperation
): Record<string, unknown> {
  const currentReferences = readContentReferences(resolved.consumer)
  if (resolved.mode === 'add') {
    const nextReferences = upsertContentReference(currentReferences, {
      sourceBlockId: resolved.sourceId,
      sourceVariant: resolved.sourceVariant,
      role: resolved.role,
    })
    const fields: Record<string, unknown> = { contentReferences: nextReferences }
    const mediaType = videoMediaTypeForRole(resolved.role)
    const sourceFile = readFileValue(resolved.source)
    if (mediaType && sourceFile) {
      fields.videoMedia = upsertVideoMediaFile(
        readVideoMediaValue(resolved.consumer.values.videoMedia),
        mediaType,
        sourceFile
      )
    }
    return fields
  }

  const roles = resolved.role
    ? [resolved.role]
    : currentReferences
        .filter((reference) => reference.sourceBlockId === resolved.sourceId)
        .map((reference) => reference.role)
  let nextReferences = currentReferences
  for (const role of roles) {
    nextReferences = removeContentReference(nextReferences, {
      sourceBlockId: resolved.sourceId,
      sourceVariant: resolved.sourceVariant,
      role,
    })
  }
  const fields: Record<string, unknown> = { contentReferences: nextReferences }
  for (const role of roles) {
    const mediaType = videoMediaTypeForRole(role)
    if (mediaType) {
      fields.videoMedia = removeVideoMediaFileForType(
        readVideoMediaValue(fields.videoMedia ?? resolved.consumer.values.videoMedia),
        mediaType
      )
    }
  }
  return fields
}

function buildContentReferenceInputsOperation(
  resolved: ResolvedReferenceOperation
): EditWorkflowOperation {
  return getCanvasNodeAdapter(resolved.consumer.kind).buildUpdateOperation({
    type: 'update_node',
    nodeId: resolved.consumerId,
    fields: buildContentReferenceInputFields(resolved),
  })
}

function buildContentReferenceEdgeOperation(
  resolved: ResolvedReferenceOperation,
  snapshot: CanvasSnapshot
): EditWorkflowOperation | null {
  const { edgeSourceId, edgeTargetId } = buildContentReferenceEdgeEndpoints(resolved)
  const edgeSource = snapshot.nodes.find((node) => node.id === edgeSourceId)
  const edgeTarget = snapshot.nodes.find((node) => node.id === edgeTargetId)
  if (!edgeSource || !edgeTarget) return null

  if (resolved.mode === 'remove') {
    const matchingEdges = snapshot.edges.filter(
      (edge) =>
        edge.source === edgeSourceId &&
        edge.target === edgeTargetId &&
        typeof edge.sourceHandle === 'string' &&
        edge.sourceHandle.startsWith(CONTENT_REFERENCE_SOURCE_HANDLE_PREFIX)
    )
    if (!matchingEdges.length) return null
    return {
      operation_type: 'edit',
      block_id: edgeSourceId,
      params: {
        removeEdges: matchingEdges.map((edge) => ({
          targetBlockId: edge.target,
          sourceHandle: edge.sourceHandle,
        })),
      },
    }
  }

  const connections = buildExistingConnections(edgeSourceId, snapshot.edges)
  const connection = buildContentConnection(edgeSource, edgeTarget, resolved.role)
  appendConnectionTarget(connections, connection.sourceHandle, {
    ...connection.target,
    ...(autoLinkTypeForRole(resolved.role)
      ? { autoLinkType: autoLinkTypeForRole(resolved.role) }
      : {}),
  })
  return {
    operation_type: 'edit',
    block_id: edgeSourceId,
    params: { connections },
  }
}

function buildVirtualContentReferenceEdge(resolved: ResolvedReferenceOperation): CanvasEdge {
  const { edgeSourceId, edgeTargetId } = buildContentReferenceEdgeEndpoints(resolved)
  const source = resolved.mode === 'add' ? resolved.source : resolved.source
  const target = resolved.consumer
  const edgeSource = edgeSourceId === resolved.sourceId ? source : target
  const edgeTarget = edgeTargetId === resolved.sourceId ? source : target
  const connection = buildContentConnection(edgeSource, edgeTarget, resolved.role)
  return {
    source: edgeSourceId,
    target: edgeTargetId,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.target.handle,
    data: {
      kind: 'content_reference',
      ...(autoLinkTypeForRole(resolved.role)
        ? { autoLinkType: autoLinkTypeForRole(resolved.role) }
        : {}),
    },
  }
}

function buildLayoutOperations(
  operation: LocalCanvasLayoutOperation,
  snapshot: CanvasSnapshot,
  idMap: Map<string, string>
): EditWorkflowOperation[] {
  const ids = (
    operation.nodeIds?.length ? operation.nodeIds : snapshot.nodes.map((node) => node.id)
  ).map((id) => resolveNodeId(id, idMap))
  const nodes = ids
    .map((id) => snapshot.nodes.find((node) => node.id === id))
    .filter((node): node is CanvasNodeRecord => Boolean(node))
  const startX = Math.min(...nodes.map((node) => node.position.x), 0)
  const startY = Math.min(...nodes.map((node) => node.position.y), 0)
  return ids.map((id, index) => {
    const row =
      operation.direction === 'grid'
        ? Math.floor(index / 3)
        : operation.direction === 'vertical'
          ? index
          : 0
    const col =
      operation.direction === 'grid' ? index % 3 : operation.direction === 'horizontal' ? index : 0
    const position =
      operation.direction === 'vertical'
        ? { x: startX, y: startY + index * NODE_GAP_Y }
        : { x: startX + col * NODE_GAP_X, y: startY + row * NODE_GAP_Y }
    return {
      operation_type: 'edit',
      block_id: id,
      params: { position },
    }
  })
}

function validateContentReferenceOperation(
  operation: LocalCanvasAddContentReferenceOperation | LocalCanvasRemoveContentReferenceOperation,
  knownNodes: Map<string, CanvasNodeRecord>,
  idMap: Map<string, string>,
  errors: string[]
): void {
  const consumerId = resolveNodeId(operation.consumerNodeId, idMap)
  const sourceId = resolveNodeId(operation.sourceNodeId, idMap)
  const consumer = knownNodes.get(consumerId)
  const source = knownNodes.get(sourceId)
  if (!consumer) errors.push(`Consumer node "${operation.consumerNodeId}" was not found`)
  if (!source) errors.push(`Source node "${operation.sourceNodeId}" was not found`)
  if (!consumer || !source) return
  if (consumerId === sourceId) {
    errors.push('Content reference source and consumer must be different nodes')
  }
  if (!isContentVariant(consumer.kind)) {
    errors.push(`Consumer node "${operation.consumerNodeId}" is not a content node`)
  }
  if (!isContentVariant(source.kind)) {
    errors.push(`Source node "${operation.sourceNodeId}" is not a content node`)
  }
  if (operation.type === 'add_content_reference' && isContentVariant(consumer.kind)) {
    if (!isContentReferenceRole(operation.role)) {
      errors.push(`Invalid content reference role "${String(operation.role)}"`)
      return
    }
    const disabledReason = getModelDisabledReason({
      targetVariant: consumer.kind,
      model: resolveReferenceModel(consumer),
      references: [
        ...readContentReferences(consumer),
        {
          sourceBlockId: sourceId,
          sourceVariant: isContentVariant(source.kind) ? source.kind : 'text',
          role: operation.role,
        },
      ],
    })
    if (disabledReason) errors.push(disabledReason)
  }
}

function validateDeleteNodeOperation(
  operation: LocalCanvasDeleteNodeOperation,
  knownNodes: Map<string, CanvasNodeRecord>,
  idMap: Map<string, string>,
  errors: string[]
): string | null {
  const nodeId = resolveNodeId(operation.nodeId, idMap)
  if (!knownNodes.has(nodeId)) {
    errors.push(`Node "${operation.nodeId}" was not found`)
    return null
  }
  knownNodes.delete(nodeId)
  return nodeId
}

export function validateLocalCanvasPatch(
  patch: LocalCanvasPatch,
  snapshot?: CanvasSnapshot
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const knownNodes = new Map(snapshot?.nodes.map((node) => [node.id, node]) ?? [])
  const idMap = new Map<string, string>()
  if (!Array.isArray(patch.operations) || patch.operations.length === 0) {
    errors.push('Patch must include at least one operation')
    return { valid: false, errors }
  }
  for (const operation of patch.operations) {
    if (!operation || typeof operation !== 'object' || !('type' in operation)) {
      errors.push('Patch operation must be an object with a type')
      continue
    }
    const operationType = (operation as { type?: unknown }).type
    if (typeof operationType !== 'string' || !SUPPORTED_PATCH_OPERATION_TYPES.has(operationType)) {
      errors.push(`Unsupported patch operation type "${String(operationType)}"`)
      continue
    }
    if (operation.type === 'create_node') {
      const adapter = getCanvasNodeAdapter(operation.kind)
      const result = adapter.validatePatch(operation as LocalCanvasPatchOperation)
      errors.push(...result.errors)
      const nodeId = operation.nodeId ?? operation.clientNodeId
      if (nodeId) {
        if (operation.clientNodeId) idMap.set(operation.clientNodeId, nodeId)
        knownNodes.set(nodeId, {
          id: nodeId,
          name: operation.title,
          blockType: adapter.blockType,
          kind: operation.kind,
          position: operation.position ?? { x: 0, y: 0 },
          values: operation.fields ?? {},
          raw: {},
        })
      }
      continue
    }
    if (operation.type === 'update_node') {
      const nodeId = resolveNodeId(operation.nodeId, idMap)
      const adapter = getCanvasNodeAdapter(knownNodes.get(nodeId)?.kind ?? 'generic_workflow_block')
      if (snapshot && !knownNodes.has(nodeId)) {
        errors.push(`Node "${operation.nodeId}" was not found`)
        continue
      }
      const result = adapter.validatePatch({ ...operation, nodeId } as LocalCanvasPatchOperation)
      errors.push(...result.errors)
    }
    if (operation.type === 'delete_node' && snapshot) {
      validateDeleteNodeOperation(operation, knownNodes, idMap, errors)
    }
    if (operation.type === 'connect' && snapshot) {
      const sourceNodeId = resolveNodeId(operation.sourceNodeId, idMap)
      const targetNodeId = resolveNodeId(operation.targetNodeId, idMap)
      if (!knownNodes.has(sourceNodeId)) {
        errors.push(`Source node "${operation.sourceNodeId}" was not found`)
      }
      if (!knownNodes.has(targetNodeId)) {
        errors.push(`Target node "${operation.targetNodeId}" was not found`)
      }
    }
    if (
      (operation.type === 'add_content_reference' ||
        operation.type === 'remove_content_reference') &&
      snapshot
    ) {
      validateContentReferenceOperation(operation, knownNodes, idMap, errors)
    }
    if (operation.type === 'layout_nodes' && snapshot && operation.nodeIds?.length) {
      for (const nodeId of operation.nodeIds) {
        if (!knownNodes.has(resolveNodeId(nodeId, idMap))) {
          errors.push(`Node "${nodeId}" was not found`)
        }
      }
    }
  }
  return { valid: errors.length === 0, errors }
}

function buildDeleteNodeOperation(nodeId: string): EditWorkflowOperation {
  return {
    operation_type: 'delete',
    block_id: nodeId,
  }
}

export function buildEditWorkflowOperationsFromPatch(params: {
  patch: LocalCanvasPatch
  snapshot: CanvasSnapshot
}): { operations: EditWorkflowOperation[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>()
  const operations: EditWorkflowOperation[] = []
  const knownNodes = new Map(params.snapshot.nodes.map((node) => [node.id, node]))
  const virtualEdges = [...params.snapshot.edges]

  for (const patchOperation of params.patch.operations) {
    if (patchOperation.type === 'create_node') {
      const nodeId = patchOperation.nodeId ?? generateId()
      if (patchOperation.clientNodeId) idMap.set(patchOperation.clientNodeId, nodeId)
      const adapter = getCanvasNodeAdapter(patchOperation.kind)
      const createdNode: CanvasNodeRecord = {
        id: nodeId,
        name: patchOperation.title,
        blockType: adapter.blockType,
        kind: patchOperation.kind,
        position: patchOperation.position ?? { x: 0, y: 0 },
        values: patchOperation.fields ?? {},
        raw: {},
      }
      knownNodes.set(nodeId, createdNode)
      operations.push(
        adapter.buildCreateOperation({
          ...patchOperation,
          nodeId,
        })
      )
      continue
    }

    if (patchOperation.type === 'update_node') {
      const nodeId = resolveNodeId(patchOperation.nodeId, idMap)
      const node = knownNodes.get(nodeId)
      if (!node) continue
      operations.push(
        getCanvasNodeAdapter(node.kind).buildUpdateOperation({
          ...patchOperation,
          nodeId,
        })
      )
      knownNodes.set(nodeId, {
        ...node,
        values: { ...node.values, ...patchOperation.fields },
      })
      continue
    }

    if (patchOperation.type === 'delete_node') {
      const nodeId = resolveNodeId(patchOperation.nodeId, idMap)
      if (!knownNodes.has(nodeId)) continue
      operations.push(buildDeleteNodeOperation(nodeId))
      knownNodes.delete(nodeId)
      virtualEdges.splice(
        0,
        virtualEdges.length,
        ...virtualEdges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
      )
      continue
    }

    if (patchOperation.type === 'connect') {
      const snapshot = {
        ...params.snapshot,
        nodes: [...knownNodes.values()],
        edges: virtualEdges,
      }
      operations.push(buildConnectOperation(patchOperation, snapshot, idMap))
      const virtualEdge = buildVirtualEdge(patchOperation, snapshot, idMap)
      if (
        !virtualEdges.some(
          (edge) =>
            edge.source === virtualEdge.source &&
            edge.target === virtualEdge.target &&
            edge.sourceHandle === virtualEdge.sourceHandle &&
            edge.targetHandle === virtualEdge.targetHandle
        )
      ) {
        virtualEdges.push(virtualEdge)
      }
      continue
    }

    if (
      patchOperation.type === 'add_content_reference' ||
      patchOperation.type === 'remove_content_reference'
    ) {
      const resolved =
        patchOperation.type === 'add_content_reference'
          ? resolveAddContentReferenceOperation(patchOperation, knownNodes, idMap)
          : resolveRemoveContentReferenceOperation(patchOperation, knownNodes, idMap)
      if (!resolved) continue
      const snapshot = {
        ...params.snapshot,
        nodes: [...knownNodes.values()],
        edges: virtualEdges,
      }
      operations.push(buildContentReferenceInputsOperation(resolved))
      const edgeOperation = buildContentReferenceEdgeOperation(resolved, snapshot)
      if (edgeOperation) operations.push(edgeOperation)
      knownNodes.set(resolved.consumerId, {
        ...resolved.consumer,
        values: {
          ...resolved.consumer.values,
          ...buildContentReferenceInputFields(resolved),
        },
      })
      const virtualEdge = buildVirtualContentReferenceEdge(resolved)
      if (resolved.mode === 'add') {
        if (
          !virtualEdges.some(
            (edge) =>
              edge.source === virtualEdge.source &&
              edge.target === virtualEdge.target &&
              edge.sourceHandle === virtualEdge.sourceHandle &&
              edge.targetHandle === virtualEdge.targetHandle
          )
        ) {
          virtualEdges.push(virtualEdge)
        }
      } else {
        virtualEdges.splice(
          0,
          virtualEdges.length,
          ...virtualEdges.filter(
            (edge) =>
              !(
                edge.source === virtualEdge.source &&
                edge.target === virtualEdge.target &&
                edge.sourceHandle?.startsWith(CONTENT_REFERENCE_SOURCE_HANDLE_PREFIX)
              )
          )
        )
      }
      continue
    }

    if (patchOperation.type === 'layout_nodes') {
      const layoutOperations = buildLayoutOperations(
        patchOperation,
        { ...params.snapshot, nodes: [...knownNodes.values()] },
        idMap
      )
      for (const operation of layoutOperations) {
        const addOperation = operations.find(
          (candidate) =>
            candidate.operation_type === 'add' && candidate.block_id === operation.block_id
        )
        if (addOperation) {
          addOperation.params = {
            ...addOperation.params,
            position: operation.params?.position,
          }
        } else {
          operations.push(operation)
        }
        const node = knownNodes.get(operation.block_id)
        const position = operation.params?.position
        if (node && position && typeof position === 'object') {
          knownNodes.set(operation.block_id, {
            ...node,
            position: position as CanvasNodeRecord['position'],
          })
        }
      }
    }
  }

  return { operations, idMap }
}
