import { loadCanvasSnapshot } from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-context'
import { getValue } from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/shared'
import type {
  CanvasNodeRecord,
  CanvasSnapshot,
  LocalCanvasCreateNodeOperation,
  LocalCanvasLayoutOperation,
  LocalCanvasPatch,
  LocalCanvasUpdateNodeOperation,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const NODE_GAP_X = 360
const NODE_GAP_Y = 220

function findCreatedNode(
  snapshot: CanvasSnapshot,
  operation: LocalCanvasCreateNodeOperation
): CanvasNodeRecord | undefined {
  if (operation.nodeId) {
    const byId = snapshot.nodes.find((node) => node.id === operation.nodeId)
    if (byId) return byId
  }

  return snapshot.nodes.find(
    (node) => node.name === operation.title && node.kind === operation.kind
  )
}

function buildPatchReferenceMap(
  snapshot: CanvasSnapshot,
  patch?: LocalCanvasPatch
): Map<string, string> {
  const references = new Map<string, string>()
  for (const operation of patch?.operations ?? []) {
    if (operation.type !== 'create_node') continue
    const created = findCreatedNode(snapshot, operation)
    if (!created) continue
    if (operation.clientNodeId) references.set(operation.clientNodeId, created.id)
    if (operation.nodeId) references.set(operation.nodeId, created.id)
  }
  return references
}

function resolvePatchNodeId(nodeId: string, references: Map<string, string>): string {
  return references.get(nodeId) ?? nodeId
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`
}

function fieldMatches(actual: unknown, expected: unknown): boolean {
  if (typeof actual === 'string' && expected && typeof expected === 'object') {
    try {
      return stableStringify(JSON.parse(actual) as unknown) === stableStringify(expected)
    } catch {}
  }
  return stableStringify(actual) === stableStringify(expected)
}

function verifyFields(params: {
  node: CanvasNodeRecord
  operation: LocalCanvasCreateNodeOperation | LocalCanvasUpdateNodeOperation
  errors: string[]
}): void {
  for (const [field, expected] of Object.entries(params.operation.fields ?? {})) {
    const actual = getValue(params.node.values, field, undefined)
    if (!fieldMatches(actual, expected)) {
      params.errors.push(`Field "${field}" was not written on node "${params.node.id}"`)
    }
  }
}

function verifyLayout(params: {
  snapshot: CanvasSnapshot
  operation: LocalCanvasLayoutOperation
  references: Map<string, string>
  errors: string[]
}): void {
  const nodeIds = params.operation.nodeIds?.length
    ? params.operation.nodeIds.map((nodeId) => resolvePatchNodeId(nodeId, params.references))
    : params.snapshot.nodes.map((node) => node.id)
  const nodes = nodeIds
    .map((nodeId) => params.snapshot.nodes.find((node) => node.id === nodeId))
    .filter((node): node is CanvasNodeRecord => Boolean(node))
  if (nodes.length !== nodeIds.length) {
    const foundIds = new Set(nodes.map((node) => node.id))
    for (const nodeId of nodeIds) {
      if (!foundIds.has(nodeId))
        params.errors.push(`Layout node "${nodeId}" was not found after patch`)
    }
    return
  }
  if (nodes.length <= 1) return
  const startX = Math.min(...nodes.map((node) => node.position.x), 0)
  const startY = Math.min(...nodes.map((node) => node.position.y), 0)
  nodes.forEach((node, index) => {
    const row =
      params.operation.direction === 'grid'
        ? Math.floor(index / 3)
        : params.operation.direction === 'vertical'
          ? index
          : 0
    const col =
      params.operation.direction === 'grid'
        ? index % 3
        : params.operation.direction === 'horizontal'
          ? index
          : 0
    const expected =
      params.operation.direction === 'vertical'
        ? { x: startX, y: startY + index * NODE_GAP_Y }
        : { x: startX + col * NODE_GAP_X, y: startY + row * NODE_GAP_Y }
    if (node.position.x !== expected.x || node.position.y !== expected.y) {
      params.errors.push(`Layout position for node "${node.id}" was not written after patch`)
    }
  })
}

export async function verifyLocalCanvasPatch(params: {
  workflowId: string
  workspaceId: string
  patch?: LocalCanvasPatch
  generation?: {
    nodeId: string
    field: string
  }
  selectedNodeIds: string[]
}): Promise<{
  success: boolean
  snapshot: CanvasSnapshot
  summary: string
  errors: string[]
}> {
  const snapshot = await loadCanvasSnapshot({
    workflowId: params.workflowId,
    workspaceId: params.workspaceId,
  })
  const errors: string[] = []
  const patchReferences = buildPatchReferenceMap(snapshot, params.patch)

  if (params.generation) {
    const node = snapshot.nodes.find((item) => item.id === params.generation?.nodeId)
    if (!node) {
      errors.push(`Generated node "${params.generation.nodeId}" was not found after writeback`)
    } else {
      const actual = getValue<unknown>(node.values, params.generation.field, undefined)
      const hasValue =
        actual !== undefined &&
        actual !== null &&
        (!(typeof actual === 'string') || actual.trim().length > 0)
      if (!hasValue) {
        errors.push(
          `Generated field "${params.generation.field}" was not written on node "${params.generation.nodeId}"`
        )
      }
    }
  }

  for (const operation of params.patch?.operations ?? []) {
    if (operation.type === 'create_node') {
      const created = findCreatedNode(snapshot, operation)
      if (!created) {
        errors.push(`Created ${operation.kind} node "${operation.title}" was not found after patch`)
      } else {
        verifyFields({ node: created, operation, errors })
      }
    }
    if (operation.type === 'update_node') {
      const nodeId = resolvePatchNodeId(operation.nodeId, patchReferences)
      const node = snapshot.nodes.find((item) => item.id === nodeId)
      if (!node) {
        errors.push(`Updated node "${operation.nodeId}" was not found after patch`)
      } else {
        verifyFields({ node, operation, errors })
      }
    }
    if (operation.type === 'connect') {
      const sourceNodeId = resolvePatchNodeId(operation.sourceNodeId, patchReferences)
      const targetNodeId = resolvePatchNodeId(operation.targetNodeId, patchReferences)
      const exists = snapshot.edges.some(
        (edge) => edge.source === sourceNodeId && edge.target === targetNodeId
      )
      if (!exists) {
        errors.push(`Connection ${sourceNodeId} -> ${targetNodeId} was not found after patch`)
      }
    }
    if (operation.type === 'layout_nodes') {
      verifyLayout({ snapshot, operation, references: patchReferences, errors })
    }
  }

  return {
    success: errors.length === 0,
    snapshot,
    summary:
      errors.length === 0
        ? `Verified canvas with ${snapshot.nodes.length} nodes and ${snapshot.edges.length} edges`
        : errors.join('; '),
    errors,
  }
}
