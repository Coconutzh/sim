import { loadCanvasSnapshot } from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-context'
import { getValue } from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/shared'
import { redactAgentVisibleFileContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/redaction'
import type {
  CanvasNodeRecord,
  CanvasSnapshot,
  LocalCanvasAddContentReferenceOperation,
  LocalCanvasCreateNodeOperation,
  LocalCanvasDeleteNodeOperation,
  LocalCanvasLayoutOperation,
  LocalCanvasPatch,
  LocalCanvasPatchOperation,
  LocalCanvasRemoveContentReferenceOperation,
  LocalCanvasUpdateNodeOperation,
  LocalCanvasVerifyOperationResult,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import {
  CONTENT_REFERENCE_SOURCE_HANDLE_PREFIX,
  CONTENT_REFERENCE_TARGET_HANDLE_PREFIX,
} from '@/lib/workflows/content-reference-edges'
import {
  type ContentNodeVariant,
  type ContentReferenceRole,
  normalizeContentReferences,
} from '@/lib/workflows/content-references'

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

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function normalizeContentHtmlText(value: string): string {
  return decodeBasicHtmlEntities(
    value
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim()
}

function fieldMatches(actual: unknown, expected: unknown, field?: string): boolean {
  if (field === 'contentHtml' && typeof actual === 'string' && typeof expected === 'string') {
    return normalizeContentHtmlText(actual) === normalizeContentHtmlText(expected)
  }
  if (typeof actual === 'string' && expected && typeof expected === 'object') {
    try {
      return stableStringify(JSON.parse(actual) as unknown) === stableStringify(expected)
    } catch {}
  }
  return stableStringify(actual) === stableStringify(expected)
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

function videoMediaTypeForRole(role: ContentReferenceRole): 'first_frame' | 'last_frame' | null {
  if (role === 'video_first_frame') return 'first_frame'
  if (role === 'video_last_frame') return 'last_frame'
  return null
}

function autoLinkTypeForRole(
  role?: ContentReferenceRole
): 'video_first_frame' | 'video_last_frame' | null {
  if (role === 'video_first_frame' || role === 'video_last_frame') return role
  return null
}

function edgeMatchesAutoLinkType(params: {
  edge: CanvasSnapshot['edges'][number]
  role?: ContentReferenceRole
  shouldExist: boolean
}): boolean {
  const expectedAutoLinkType = autoLinkTypeForRole(params.role)
  if (!expectedAutoLinkType) return true
  if (params.edge.data?.autoLinkType === expectedAutoLinkType) return true
  return params.shouldExist && params.edge.data?.autoLinkType == null
}

function readArrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? parsed : []
    } catch {}
  }
  return []
}

function getFileKey(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const key = (value as Record<string, unknown>).key
  return typeof key === 'string' && key.trim() ? key : null
}

function buildContentReferenceEdgeEndpoints(params: {
  consumerNodeId: string
  sourceNodeId: string
  role?: ContentReferenceRole
}): { edgeSourceId: string; edgeTargetId: string } {
  const isVideoFrame = params.role === 'video_first_frame' || params.role === 'video_last_frame'
  return isVideoFrame
    ? { edgeSourceId: params.sourceNodeId, edgeTargetId: params.consumerNodeId }
    : { edgeSourceId: params.consumerNodeId, edgeTargetId: params.sourceNodeId }
}

function getOperationId(operation: LocalCanvasPatchOperation, index: number): string {
  return operation.operationId ?? `${operation.type}:${index + 1}`
}

function verifyDeletedNode(params: {
  snapshot: CanvasSnapshot
  operation: LocalCanvasDeleteNodeOperation
  operationId: string
  references: Map<string, string>
  errors: string[]
  operationResults: LocalCanvasVerifyOperationResult[]
}): void {
  const nodeId = resolvePatchNodeId(params.operation.nodeId, params.references)
  const node = params.snapshot.nodes.find((item) => item.id === nodeId)
  const connectedEdges = params.snapshot.edges.filter(
    (edge) => edge.source === nodeId || edge.target === nodeId
  )
  if (node || connectedEdges.length > 0) {
    const error = node
      ? `Deleted node "${params.operation.nodeId}" still exists after patch`
      : `Deleted node "${params.operation.nodeId}" still has ${connectedEdges.length} connected edge(s) after patch`
    params.errors.push(error)
    params.operationResults.push({
      operationId: params.operationId,
      operationType: params.operation.type,
      nodeId,
      expected: 'missing-node',
      actual: node
        ? { kind: node.kind, title: node.name }
        : { connectedEdges: connectedEdges.length },
      success: false,
      error,
    })
    return
  }
  params.operationResults.push({
    operationId: params.operationId,
    operationType: params.operation.type,
    nodeId,
    expected: 'missing-node',
    actual: 'missing-node',
    success: true,
  })
}

function sanitizeVerificationValue(value: unknown): unknown {
  if (typeof value === 'string') return redactAgentVisibleFileContext(value)
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sanitizeVerificationValue)
  const record = value as Record<string, unknown>
  const hasSensitiveFileLocator =
    'key' in record ||
    'storageKey' in record ||
    'storage_key' in record ||
    'path' in record ||
    'url' in record ||
    'context' in record
  const looksLikeFileMetadata =
    'name' in record && ('size' in record || 'type' in record || hasSensitiveFileLocator)
  if (looksLikeFileMetadata || hasSensitiveFileLocator) {
    return {
      ...(typeof record.name === 'string' ? { name: record.name } : {}),
      ...(typeof record.type === 'string' ? { type: record.type } : {}),
      ...(typeof record.size === 'number' ? { size: record.size } : {}),
    }
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, sanitizeVerificationValue(item)])
  )
}

function verifyFields(params: {
  node: CanvasNodeRecord
  operation: LocalCanvasCreateNodeOperation | LocalCanvasUpdateNodeOperation
  errors: string[]
  operationId: string
  operationType: 'create_node' | 'update_node'
  operationResults: LocalCanvasVerifyOperationResult[]
}): void {
  for (const [field, expected] of Object.entries(params.operation.fields ?? {})) {
    const actual = getValue(params.node.values, field, undefined)
    const success = fieldMatches(actual, expected, field)
    const error = success
      ? undefined
      : `Field "${field}" was not written on node "${params.node.id}"`
    if (error) params.errors.push(error)
    params.operationResults.push({
      operationId: params.operationId,
      operationType: params.operationType,
      nodeId: params.node.id,
      field,
      expected: sanitizeVerificationValue(expected),
      actual: sanitizeVerificationValue(actual),
      success,
      ...(error ? { error } : {}),
    })
  }
}

function verifyLayout(params: {
  snapshot: CanvasSnapshot
  operation: LocalCanvasLayoutOperation
  references: Map<string, string>
  errors: string[]
}): { success: boolean; actual: unknown; error?: string } {
  const usesPatchCreatedNodes = params.operation.nodeIds?.length
    ? params.operation.nodeIds.some((nodeId) => params.references.has(nodeId))
    : params.references.size > 0
  const nodeIds = params.operation.nodeIds?.length
    ? params.operation.nodeIds.map((nodeId) => resolvePatchNodeId(nodeId, params.references))
    : params.snapshot.nodes.map((node) => node.id)
  const nodes = nodeIds
    .map((nodeId) => params.snapshot.nodes.find((node) => node.id === nodeId))
    .filter((node): node is CanvasNodeRecord => Boolean(node))
  if (nodes.length !== nodeIds.length) {
    const foundIds = new Set(nodes.map((node) => node.id))
    const missing: string[] = []
    for (const nodeId of nodeIds) {
      if (!foundIds.has(nodeId)) {
        missing.push(nodeId)
        params.errors.push(`Layout node "${nodeId}" was not found after patch`)
      }
    }
    return {
      success: false,
      actual: { missingNodeIds: missing },
      error: missing
        .map((nodeId) => `Layout node "${nodeId}" was not found after patch`)
        .join('; '),
    }
  }
  if (nodes.length <= 1) {
    return {
      success: true,
      actual: nodes.map((node) => ({ nodeId: node.id, position: node.position })),
    }
  }
  if (usesPatchCreatedNodes) {
    const failures: string[] = []
    const seenGridPositions = new Set<string>()
    const positions = nodes.map((node, index) => {
      const finitePosition = Number.isFinite(node.position.x) && Number.isFinite(node.position.y)
      let success = finitePosition
      if (index > 0 && finitePosition) {
        const previous = nodes[index - 1]
        if (params.operation.direction === 'vertical') {
          success = node.position.y > previous.position.y
        } else if (params.operation.direction === 'horizontal') {
          success = node.position.x > previous.position.x
        }
      }
      if (params.operation.direction === 'grid' && finitePosition) {
        const gridPositionKey = `${node.position.x}:${node.position.y}`
        success = !seenGridPositions.has(gridPositionKey)
        seenGridPositions.add(gridPositionKey)
      }
      const error = !finitePosition
        ? `Layout position for node "${node.id}" was not written after patch`
        : !success
          ? `Layout order for node "${node.id}" did not match ${params.operation.direction} layout after patch`
          : undefined
      if (error) failures.push(error)
      return {
        nodeId: node.id,
        expected: {
          direction: params.operation.direction,
          orderIndex: index,
          mode: 'directional_order',
        },
        actual: node.position,
        success,
        ...(error ? { error } : {}),
      }
    })
    params.errors.push(...failures)
    return {
      success: failures.length === 0,
      actual: positions,
      ...(failures.length ? { error: failures.join('; ') } : {}),
    }
  }
  const startX = Math.min(...nodes.map((node) => node.position.x), 0)
  const startY = Math.min(...nodes.map((node) => node.position.y), 0)
  const failures: string[] = []
  const positions: Array<{
    nodeId: string
    expected: { x: number; y: number }
    actual: { x: number; y: number }
    success: boolean
  }> = []
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
    const success = node.position.x === expected.x && node.position.y === expected.y
    positions.push({ nodeId: node.id, expected, actual: node.position, success })
    if (!success) failures.push(`Layout position for node "${node.id}" was not written after patch`)
  })
  params.errors.push(...failures)
  return {
    success: failures.length === 0,
    actual: positions,
    ...(failures.length ? { error: failures.join('; ') } : {}),
  }
}

function verifyContentReferenceOperation(params: {
  snapshot: CanvasSnapshot
  operation: LocalCanvasAddContentReferenceOperation | LocalCanvasRemoveContentReferenceOperation
  operationId: string
  references: Map<string, string>
  errors: string[]
  operationResults: LocalCanvasVerifyOperationResult[]
}): void {
  const consumerNodeId = resolvePatchNodeId(params.operation.consumerNodeId, params.references)
  const sourceNodeId = resolvePatchNodeId(params.operation.sourceNodeId, params.references)
  const consumer = params.snapshot.nodes.find((node) => node.id === consumerNodeId)
  const source = params.snapshot.nodes.find((node) => node.id === sourceNodeId)
  const sourceVariant = source && isContentVariant(source.kind) ? source.kind : undefined
  const references = normalizeContentReferences(
    consumer ? getValue(consumer.values, 'contentReferences', []) : []
  )
  const role =
    params.operation.type === 'add_content_reference'
      ? params.operation.role
      : params.operation.role
  const referenceMatches = references.filter(
    (reference) =>
      reference.sourceBlockId === sourceNodeId &&
      (!role || reference.role === role) &&
      (!sourceVariant || reference.sourceVariant === sourceVariant)
  )
  const shouldExist = params.operation.type === 'add_content_reference'
  const referenceSuccess = shouldExist ? referenceMatches.length > 0 : referenceMatches.length === 0
  const referenceError = referenceSuccess
    ? undefined
    : shouldExist
      ? `Content reference ${consumerNodeId} -> ${sourceNodeId} (${role}) was not written`
      : `Content reference ${consumerNodeId} -> ${sourceNodeId} (${role ?? 'any role'}) still exists`
  if (referenceError) params.errors.push(referenceError)
  params.operationResults.push({
    operationId: params.operationId,
    operationType: params.operation.type,
    consumerNodeId,
    sourceNodeId,
    role,
    field: 'contentReferences',
    expected: shouldExist ? 'present' : 'absent',
    actual: sanitizeVerificationValue(referenceMatches),
    success: referenceSuccess,
    ...(referenceError ? { error: referenceError } : {}),
  })

  const { edgeSourceId, edgeTargetId } = buildContentReferenceEdgeEndpoints({
    consumerNodeId,
    sourceNodeId,
    role,
  })
  const matchingEdges = params.snapshot.edges.filter(
    (edge) =>
      edge.source === edgeSourceId &&
      edge.target === edgeTargetId &&
      typeof edge.sourceHandle === 'string' &&
      edge.sourceHandle.startsWith(CONTENT_REFERENCE_SOURCE_HANDLE_PREFIX) &&
      typeof edge.targetHandle === 'string' &&
      edge.targetHandle.startsWith(CONTENT_REFERENCE_TARGET_HANDLE_PREFIX) &&
      edgeMatchesAutoLinkType({ edge, role, shouldExist })
  )
  const edgeSuccess = shouldExist ? matchingEdges.length > 0 : matchingEdges.length === 0
  const edgeError = edgeSuccess
    ? undefined
    : shouldExist
      ? `Content reference edge ${edgeSourceId} -> ${edgeTargetId} was not found`
      : `Content reference edge ${edgeSourceId} -> ${edgeTargetId} still exists`
  if (edgeError) params.errors.push(edgeError)
  params.operationResults.push({
    operationId: `${params.operationId}:edge`,
    operationType: params.operation.type,
    consumerNodeId,
    sourceNodeId,
    targetNodeId: edgeTargetId,
    role,
    expected: {
      state: shouldExist ? 'edge-present' : 'edge-absent',
      edgeSourceId,
      edgeTargetId,
      ...(autoLinkTypeForRole(role) ? { autoLinkType: autoLinkTypeForRole(role) } : {}),
    },
    actual: sanitizeVerificationValue(matchingEdges),
    success: edgeSuccess,
    ...(edgeError ? { error: edgeError } : {}),
  })

  if (!role) return
  const videoMediaType = videoMediaTypeForRole(role)
  const sourceFileKey = source ? getFileKey(getValue(source.values, 'file', null)) : null
  if (!videoMediaType || !sourceFileKey || !consumer) return
  const media = readArrayValue(getValue(consumer.values, 'videoMedia', []))
  const mediaMatches = media.filter((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const record = item as Record<string, unknown>
    return record.type === videoMediaType && getFileKey(record.file) === sourceFileKey
  })
  const mediaSuccess = shouldExist ? mediaMatches.length > 0 : mediaMatches.length === 0
  const mediaError = mediaSuccess
    ? undefined
    : shouldExist
      ? `Video media ${videoMediaType} was not written for "${consumerNodeId}"`
      : `Video media ${videoMediaType} still exists for "${consumerNodeId}"`
  if (mediaError) params.errors.push(mediaError)
  params.operationResults.push({
    operationId: `${params.operationId}:videoMedia`,
    operationType: params.operation.type,
    consumerNodeId,
    sourceNodeId,
    role,
    field: 'videoMedia',
    expected: shouldExist ? 'matching-file-present' : 'matching-file-absent',
    actual: sanitizeVerificationValue(mediaMatches),
    success: mediaSuccess,
    ...(mediaError ? { error: mediaError } : {}),
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
  operationResults: LocalCanvasVerifyOperationResult[]
}> {
  const snapshot = await loadCanvasSnapshot({
    workflowId: params.workflowId,
    workspaceId: params.workspaceId,
  })
  const errors: string[] = []
  const operationResults: LocalCanvasVerifyOperationResult[] = []
  const patchReferences = buildPatchReferenceMap(snapshot, params.patch)

  if (params.generation) {
    const operationId = `generation:${params.generation.nodeId}:${params.generation.field}`
    const node = snapshot.nodes.find((item) => item.id === params.generation?.nodeId)
    if (!node) {
      const error = `Generated node "${params.generation.nodeId}" was not found after writeback`
      errors.push(error)
      operationResults.push({
        operationId,
        operationType: 'generation',
        nodeId: params.generation.nodeId,
        field: params.generation.field,
        expected: 'present',
        actual: 'missing-node',
        success: false,
        error,
      })
    } else {
      const actual = getValue<unknown>(node.values, params.generation.field, undefined)
      const hasValue =
        actual !== undefined &&
        actual !== null &&
        (!(typeof actual === 'string') || actual.trim().length > 0)
      if (!hasValue) {
        const error = `Generated field "${params.generation.field}" was not written on node "${params.generation.nodeId}"`
        errors.push(error)
        operationResults.push({
          operationId,
          operationType: 'generation',
          nodeId: params.generation.nodeId,
          field: params.generation.field,
          expected: 'present',
          actual: sanitizeVerificationValue(actual),
          success: false,
          error,
        })
      } else {
        operationResults.push({
          operationId,
          operationType: 'generation',
          nodeId: params.generation.nodeId,
          field: params.generation.field,
          expected: 'present',
          actual: sanitizeVerificationValue(actual),
          success: true,
        })
      }
    }
  }

  for (const [index, operation] of (params.patch?.operations ?? []).entries()) {
    const operationId = getOperationId(operation, index)
    if (operation.type === 'create_node') {
      const created = findCreatedNode(snapshot, operation)
      if (!created) {
        const error = `Created ${operation.kind} node "${operation.title}" was not found after patch`
        errors.push(error)
        operationResults.push({
          operationId,
          operationType: operation.type,
          nodeId: operation.nodeId ?? operation.clientNodeId,
          expected: { kind: operation.kind, title: operation.title },
          actual: 'missing-node',
          success: false,
          error,
        })
      } else {
        const createErrors: string[] = []
        if (created.kind !== operation.kind) {
          createErrors.push(
            `Created node "${created.id}" kind was "${created.kind}" instead of "${operation.kind}"`
          )
        }
        if (created.name !== operation.title) {
          createErrors.push(
            `Created node "${created.id}" title was "${created.name}" instead of "${operation.title}"`
          )
        }
        operationResults.push({
          operationId,
          operationType: operation.type,
          nodeId: created.id,
          expected: { kind: operation.kind, title: operation.title },
          actual: { kind: created.kind, title: created.name },
          success: createErrors.length === 0,
          ...(createErrors.length ? { error: createErrors.join('; ') } : {}),
        })
        errors.push(...createErrors)
        verifyFields({
          node: created,
          operation,
          errors,
          operationId,
          operationType: operation.type,
          operationResults,
        })
      }
    }
    if (operation.type === 'update_node') {
      const nodeId = resolvePatchNodeId(operation.nodeId, patchReferences)
      const node = snapshot.nodes.find((item) => item.id === nodeId)
      if (!node) {
        const error = `Updated node "${operation.nodeId}" was not found after patch`
        errors.push(error)
        operationResults.push({
          operationId,
          operationType: operation.type,
          nodeId: operation.nodeId,
          actual: 'missing-node',
          success: false,
          error,
        })
      } else {
        verifyFields({
          node,
          operation,
          errors,
          operationId,
          operationType: operation.type,
          operationResults,
        })
      }
    }
    if (operation.type === 'delete_node') {
      verifyDeletedNode({
        snapshot,
        operation,
        operationId,
        references: patchReferences,
        errors,
        operationResults,
      })
    }
    if (operation.type === 'connect') {
      const sourceNodeId = resolvePatchNodeId(operation.sourceNodeId, patchReferences)
      const targetNodeId = resolvePatchNodeId(operation.targetNodeId, patchReferences)
      const exists = snapshot.edges.some(
        (edge) => edge.source === sourceNodeId && edge.target === targetNodeId
      )
      if (!exists) {
        const error = `Connection ${sourceNodeId} -> ${targetNodeId} was not found after patch`
        errors.push(error)
        operationResults.push({
          operationId,
          operationType: operation.type,
          sourceNodeId,
          targetNodeId,
          expected: { sourceNodeId, targetNodeId },
          actual: 'missing-edge',
          success: false,
          error,
        })
      } else {
        operationResults.push({
          operationId,
          operationType: operation.type,
          sourceNodeId,
          targetNodeId,
          expected: { sourceNodeId, targetNodeId },
          actual: { sourceNodeId, targetNodeId },
          success: true,
        })
      }
    }
    if (
      operation.type === 'add_content_reference' ||
      operation.type === 'remove_content_reference'
    ) {
      verifyContentReferenceOperation({
        snapshot,
        operation,
        operationId,
        references: patchReferences,
        errors,
        operationResults,
      })
    }
    if (operation.type === 'layout_nodes') {
      const result = verifyLayout({
        snapshot,
        operation,
        references: patchReferences,
        errors,
      })
      operationResults.push({
        operationId,
        operationType: operation.type,
        expected: {
          direction: operation.direction,
          nodeIds: operation.nodeIds?.map((nodeId) => resolvePatchNodeId(nodeId, patchReferences)),
        },
        actual: result.actual,
        success: result.success,
        ...(result.error ? { error: result.error } : {}),
      })
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
    operationResults,
  }
}
