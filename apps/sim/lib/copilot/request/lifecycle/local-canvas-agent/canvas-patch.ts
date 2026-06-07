import { generateId } from '@sim/utils/id'
import { getCanvasNodeAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters'
import type {
  CanvasNodeRecord,
  CanvasSnapshot,
  LocalCanvasConnectOperation,
  LocalCanvasLayoutOperation,
  LocalCanvasPatch,
  LocalCanvasPatchOperation,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import type { EditWorkflowOperation } from '@/lib/copilot/tools/server/workflow/edit-workflow/types'
import {
  getContentReferenceAnchorForTarget,
  getContentReferenceSourceHandleId,
  getContentReferenceTargetHandleId,
} from '@/lib/workflows/content-reference-edges'

const NODE_GAP_X = 360
const NODE_GAP_Y = 220

type CanvasEdge = CanvasSnapshot['edges'][number]
type ConnectionTarget = { block: string; handle: string }
type ConnectionMap = Record<string, ConnectionTarget | ConnectionTarget[]>

function resolveNodeId(rawId: string, idMap: Map<string, string>): string {
  return idMap.get(rawId) ?? rawId
}

function appendConnectionTarget(
  connections: ConnectionMap,
  sourceHandle: string,
  target: ConnectionTarget
): void {
  const current = connections[sourceHandle]
  const values = Array.isArray(current) ? current : current ? [current] : []
  if (values.some((item) => item.block === target.block && item.handle === target.handle)) return
  connections[sourceHandle] = values.length ? [...values, target] : target
}

function buildExistingConnections(sourceId: string, edges: CanvasEdge[]): ConnectionMap {
  const connections: ConnectionMap = {}
  for (const edge of edges) {
    if (edge.source !== sourceId) continue
    appendConnectionTarget(connections, edge.sourceHandle ?? 'source', {
      block: edge.target,
      handle: edge.targetHandle ?? 'target',
    })
  }
  return connections
}

function buildContentConnection(
  source: CanvasNodeRecord,
  target: CanvasNodeRecord
): { sourceHandle: string; target: ConnectionTarget } {
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

export function validateLocalCanvasPatch(
  patch: LocalCanvasPatch,
  snapshot?: CanvasSnapshot
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const knownNodes = new Map(snapshot?.nodes.map((node) => [node.id, node]) ?? [])
  const idMap = new Map<string, string>()
  for (const operation of patch.operations) {
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

    if (patchOperation.type === 'layout_nodes') {
      const layoutOperations = buildLayoutOperations(
        patchOperation,
        { ...params.snapshot, nodes: [...knownNodes.values()] },
        idMap
      )
      operations.push(...layoutOperations)
      for (const operation of layoutOperations) {
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
