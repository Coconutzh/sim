import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { generateContentCanvasText } from '@/lib/content-canvas/text-executor'
import {
  applyCanvasSummaryCacheSelection,
  buildCanvasSummaryTextFromParts,
  loadCanvasSnapshot,
  loadOrCreateCanvasSummaryCache,
  readCanvasNodeDetail,
  searchCanvasNodes,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-context'
import {
  buildEditWorkflowOperationsFromPatch,
  validateLocalCanvasPatch,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-patch'
import { verifyLocalCanvasPatch } from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-verify'
import { getCanvasNodeAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters'
import {
  getFileValue,
  getObjectValue,
  getValue,
  stripHtml,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/shared'
import type {
  CanvasNodeDetail,
  CanvasNodeRecord,
  LocalAgentContext,
  LocalAgentToolResult,
  LocalCanvasNodeKind,
  LocalCanvasPatch,
  LocalCanvasPatchOperation,
  LocalCanvasToolName,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import { editWorkflowServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow'
import { resolveUserFileUrl, type UserFileLike } from '@/lib/core/utils/user-file'
import { generateWorkspaceAudioFromPrompt } from '@/lib/generated-media/audio/audio-generation-service'
import {
  DEFAULT_AUDIO_MODEL,
  DEFAULT_AUDIO_PARAMETERS,
} from '@/lib/generated-media/audio/audio-generation-utils'
import { generateWorkspaceImageFromPrompt } from '@/lib/generated-media/image/image-generation-service'
import type {
  ImageAspectRatioValue,
  ImageGenerationModelId,
} from '@/lib/generated-media/image/image-generation-utils'
import { generateWorkspaceVideoFromPrompt } from '@/lib/generated-media/video/video-generation-service'
import {
  DEFAULT_VIDEO_DURATION_SECONDS,
  DEFAULT_VIDEO_FRAME_ASPECT_RATIO_PRESET,
  DEFAULT_VIDEO_MODEL_FAMILY,
  DEFAULT_VIDEO_RESOLUTION,
  getVideoMediaFileForType,
  resolveVideoGenerationModelId,
} from '@/lib/generated-media/video/video-generation-utils'
import { resolveStorageKeyFromFileInput } from '@/lib/uploads/utils/file-utils'
import {
  buildContentReferencePromptContext,
  buildStructuredContentReferenceContext,
  type ContentNodeVariant,
  normalizeContentReferences,
  type PromptContextReferencedNode,
} from '@/lib/workflows/content-references'
import { convertGeneratedTextToContentHtml } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/text-content-ai-utils'

interface LocalCanvasToolCall {
  name: LocalCanvasToolName
  input: Record<string, unknown>
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required`)
  }
  return value
}

function parseLegacyPatchItem(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === 'object' ? asRecord(parsed) : null
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' ? asRecord(value) : null
}

function legacyBlockTypeToKind(blockType: unknown): LocalCanvasNodeKind {
  if (blockType === 'image_generation' || blockType === 'image') return 'image'
  if (blockType === 'video_generation' || blockType === 'video') return 'video'
  if (blockType === 'audio_generation' || blockType === 'audio') return 'audio'
  if (blockType === 'presentation' || blockType === 'ppt' || blockType === 'pptx') {
    return 'presentation'
  }
  if (blockType === 'document') return 'document'
  if (blockType === 'table') return 'table'
  if (blockType === 'image_editor') return 'image_editor'
  return 'text'
}

function normalizeLegacyCanvasPatch(patch: Record<string, unknown>): LocalCanvasPatch | null {
  const operations: LocalCanvasPatchOperation[] = []
  const addNodes = [
    ...(Array.isArray(patch.addNodes) ? patch.addNodes : []),
    ...(Array.isArray(patch.nodes) ? patch.nodes : []),
    ...(Array.isArray(patch.createNodes) ? patch.createNodes : []),
  ]
  const addEdges = [
    ...(Array.isArray(patch.addEdges) ? patch.addEdges : []),
    ...(Array.isArray(patch.edges) ? patch.edges : []),
    ...(Array.isArray(patch.connectEdges) ? patch.connectEdges : []),
  ]

  for (const item of addNodes) {
    const node = parseLegacyPatchItem(item)
    if (!node) continue
    const id =
      typeof node.clientNodeId === 'string' && node.clientNodeId.trim()
        ? node.clientNodeId
        : typeof node.id === 'string' && node.id.trim()
          ? node.id
          : ''
    const title =
      typeof node.title === 'string' && node.title.trim()
        ? node.title
        : typeof node.name === 'string' && node.name.trim()
          ? node.name
          : id || '内容节点'
    const rawPosition = asRecord(node.position)
    const x = typeof rawPosition.x === 'number' ? rawPosition.x : 0
    const y = typeof rawPosition.y === 'number' ? rawPosition.y : 0
    const rawFields =
      node.fields && typeof node.fields === 'object'
        ? node.fields
        : node.data && typeof node.data === 'object'
          ? node.data
          : {}
    operations.push({
      type: 'create_node',
      ...(id ? { clientNodeId: id } : {}),
      kind: legacyBlockTypeToKind(node.kind ?? node.type ?? node.blockType),
      title,
      position: { x, y },
      fields: asRecord(rawFields),
    })
  }

  for (const item of addEdges) {
    const edge = parseLegacyPatchItem(item)
    if (!edge) continue
    const sourceNodeId =
      typeof edge.sourceNodeId === 'string'
        ? edge.sourceNodeId
        : typeof edge.source === 'string'
          ? edge.source
          : typeof edge.sourceId === 'string'
            ? edge.sourceId
            : typeof edge.from === 'string'
              ? edge.from
              : ''
    const targetNodeId =
      typeof edge.targetNodeId === 'string'
        ? edge.targetNodeId
        : typeof edge.target === 'string'
          ? edge.target
          : typeof edge.targetId === 'string'
            ? edge.targetId
            : typeof edge.to === 'string'
              ? edge.to
              : ''
    if (!sourceNodeId || !targetNodeId) continue
    operations.push({ type: 'connect', sourceNodeId, targetNodeId })
  }

  return operations.length ? { operations } : null
}

function normalizeLegacyFields(patch: Record<string, unknown>): Record<string, unknown> {
  if (patch.fields && typeof patch.fields === 'object' && !Array.isArray(patch.fields)) {
    return asRecord(patch.fields)
  }
  const fieldNames = Array.isArray(patch.fields)
    ? patch.fields.filter(
        (field): field is string => typeof field === 'string' && field.trim().length > 0
      )
    : []
  const values = Array.isArray(patch.values) ? patch.values : []
  return Object.fromEntries(fieldNames.map((field, index) => [field, values[index]]))
}

function normalizeDirectCanvasPatchOperation(
  patch: Record<string, unknown>
): LocalCanvasPatch | null {
  if (patch.type === 'delete_node') {
    const nodeId = typeof patch.nodeId === 'string' ? patch.nodeId : ''
    return nodeId ? { operations: [{ type: 'delete_node', nodeId }] } : null
  }
  if (patch.type === 'update_node') {
    const nodeId = typeof patch.nodeId === 'string' ? patch.nodeId : ''
    if (!nodeId) return null
    return {
      operations: [
        {
          type: 'update_node',
          nodeId,
          fields: normalizeLegacyFields(patch),
        },
      ],
    }
  }
  if (patch.type === 'connect') {
    const sourceNodeId =
      typeof patch.sourceNodeId === 'string'
        ? patch.sourceNodeId
        : typeof patch.source === 'string'
          ? patch.source
          : ''
    const targetNodeId =
      typeof patch.targetNodeId === 'string'
        ? patch.targetNodeId
        : typeof patch.target === 'string'
          ? patch.target
          : ''
    return sourceNodeId && targetNodeId
      ? { operations: [{ type: 'connect', sourceNodeId, targetNodeId }] }
      : null
  }
  if (patch.type === 'create_node') {
    const kind = legacyBlockTypeToKind(patch.kind ?? patch.blockType)
    const title =
      typeof patch.title === 'string' && patch.title.trim()
        ? patch.title
        : typeof patch.name === 'string' && patch.name.trim()
          ? patch.name
          : '内容节点'
    const rawPosition = asRecord(patch.position)
    return {
      operations: [
        {
          type: 'create_node',
          ...(typeof patch.nodeId === 'string' ? { nodeId: patch.nodeId } : {}),
          ...(typeof patch.clientNodeId === 'string' ? { clientNodeId: patch.clientNodeId } : {}),
          kind,
          title,
          position: {
            x: typeof rawPosition.x === 'number' ? rawPosition.x : 0,
            y: typeof rawPosition.y === 'number' ? rawPosition.y : 0,
          },
          fields: asRecord(patch.fields),
        },
      ],
    }
  }
  return null
}

function inferKindFromTitle(title: string): LocalCanvasNodeKind {
  const normalized = title.toLowerCase()
  if (/主视觉|视觉|图片|image|key visual/.test(normalized)) return 'image'
  if (/视频|video|影片|短片/.test(normalized)) return 'video'
  if (/配乐|音频|音乐|soundtrack|audio|music/.test(normalized)) return 'audio'
  if (/ppt|pptx|presentation|slides|deck|演示|答辩|汇报/.test(normalized)) {
    return 'presentation'
  }
  return 'text'
}

function defaultFieldsForInstructionNode(
  kind: LocalCanvasNodeKind,
  title: string
): Record<string, unknown> {
  const prompt = `请生成${title}。`
  if (kind === 'text') {
    return {
      aiPrompt: prompt,
      contentHtml: `<p>${title}</p>`,
    }
  }
  if (kind === 'image') return { aiPrompt: prompt }
  if (kind === 'video') return { videoPrompt: prompt }
  if (kind === 'audio') return { audioPrompt: prompt }
  if (kind === 'presentation') {
    return { presentationPrompt: prompt, presentationSlideCountMode: 'auto' }
  }
  return {}
}

function extractQuotedInstructionTitles(instructions: string): string[] {
  const titles = new Set<string>()
  const patterns = [/'([^']+)'/g, /"([^"]+)"/g, /“([^”]+)”/g, /‘([^’]+)’/g]
  for (const pattern of patterns) {
    for (const match of instructions.matchAll(pattern)) {
      const title = match[1]?.trim()
      if (title) titles.add(title)
    }
  }
  return [...titles]
}

function normalizeInstructionCanvasPatch(patch: Record<string, unknown>): LocalCanvasPatch | null {
  const instructions = typeof patch.instructions === 'string' ? patch.instructions.trim() : ''
  if (!instructions) return null

  const titles = extractQuotedInstructionTitles(instructions)
  const shouldCreateChain =
    titles.length >= 2 &&
    /create|add|新增|创建|建立/i.test(instructions) &&
    /connect|连接|sequential|顺序|依次/i.test(instructions)

  if (!shouldCreateChain) return null

  const operations: LocalCanvasPatchOperation[] = titles.map((title, index) => {
    const kind = inferKindFromTitle(title)
    const clientNodeId = `instruction_node_${index + 1}`
    return {
      type: 'create_node',
      clientNodeId,
      kind,
      title,
      position: { x: 360 * (index + 1), y: 0 },
      fields: defaultFieldsForInstructionNode(kind, title),
    }
  })

  const startMatch = instructions.match(/\bStart\s*\(([^)]+)\)/i)
  const firstSourceNodeId = startMatch?.[1]?.trim()
  if (firstSourceNodeId) {
    operations.push({
      type: 'connect',
      sourceNodeId: firstSourceNodeId,
      targetNodeId: 'instruction_node_1',
    })
  }

  for (let index = 0; index < titles.length - 1; index += 1) {
    operations.push({
      type: 'connect',
      sourceNodeId: `instruction_node_${index + 1}`,
      targetNodeId: `instruction_node_${index + 2}`,
    })
  }

  return { operations }
}

function normalizeCanvasPatchLike(value: unknown, depth = 0): LocalCanvasPatch | null {
  if (depth > 3) return null
  if (!value || typeof value !== 'object') return null
  const patchRecord = asRecord(value)
  if (Array.isArray((value as LocalCanvasPatch | undefined)?.operations)) {
    return {
      ...(value as LocalCanvasPatch),
      operations: normalizePatchOperations((value as LocalCanvasPatch).operations),
    }
  }
  const normalized =
    normalizeLegacyCanvasPatch(patchRecord) ??
    normalizeDirectCanvasPatchOperation(patchRecord) ??
    normalizeInstructionCanvasPatch(patchRecord)
  if (normalized) return normalized
  for (const key of ['patch', 'canvasPatch', 'workflowPatch', 'plan', 'input']) {
    if (key in patchRecord) {
      const nested = normalizeCanvasPatchLike(patchRecord[key], depth + 1)
      if (nested) return nested
    }
  }
  return null
}

function normalizePatchOperations(operations: unknown[]): LocalCanvasPatchOperation[] {
  return operations
    .map((operation) => {
      if (typeof operation === 'string') {
        try {
          return JSON.parse(operation) as unknown
        } catch {
          return null
        }
      }
      return operation
    })
    .filter((operation): operation is LocalCanvasPatchOperation =>
      Boolean(operation && typeof operation === 'object' && 'type' in operation)
    )
}

function requirePatch(input: Record<string, unknown>): LocalCanvasPatch {
  const normalized = normalizeCanvasPatchLike(input.patch ?? input)
  if (!normalized) {
    throw new Error(
      'A canvas patch with operations, nodes/edges, addNodes/addEdges, or instructions is required'
    )
  }
  return normalized
}

function normalizeNodeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase()
}

function getUniqueCreateNodeTitle(title: string, usedTitles: Set<string>): string {
  const baseTitle = title.trim() || '内容节点'
  let candidate = baseTitle
  let suffix = 2
  while (usedTitles.has(normalizeNodeTitle(candidate))) {
    candidate = `${baseTitle} ${suffix}`
    suffix += 1
  }
  usedTitles.add(normalizeNodeTitle(candidate))
  return candidate
}

function materializeCreateNodeOperations(
  patch: LocalCanvasPatch,
  snapshot: { nodes: CanvasNodeRecord[] }
): LocalCanvasPatch {
  const usedTitles = new Set(snapshot.nodes.map((node) => normalizeNodeTitle(node.name)))
  return {
    ...patch,
    operations: patch.operations.map((operation) => {
      if (operation.type !== 'create_node') return operation
      return {
        ...operation,
        nodeId: operation.nodeId ?? generateId(),
        title: getUniqueCreateNodeTitle(operation.title, usedTitles),
      }
    }),
  }
}

function splitDeferredLayoutPatch(patch: LocalCanvasPatch): {
  mutationPatch: LocalCanvasPatch
  layoutPatch: LocalCanvasPatch | null
} {
  const layoutOperations = patch.operations.filter((operation) => operation.type === 'layout_nodes')
  if (layoutOperations.length === 0 || layoutOperations.length === patch.operations.length) {
    return { mutationPatch: patch, layoutPatch: null }
  }
  return {
    mutationPatch: {
      ...patch,
      operations: patch.operations.filter((operation) => operation.type !== 'layout_nodes'),
    },
    layoutPatch: {
      ...patch,
      operations: layoutOperations,
    },
  }
}

function resolveDeferredLayoutPatch(
  patch: LocalCanvasPatch | null,
  idMap: Map<string, string>
): LocalCanvasPatch | null {
  if (!patch) return null
  return {
    ...patch,
    operations: patch.operations.map((operation) =>
      operation.type === 'layout_nodes' && operation.nodeIds?.length
        ? {
            ...operation,
            nodeIds: operation.nodeIds.map((nodeId) => idMap.get(nodeId) ?? nodeId),
          }
        : operation
    ),
  }
}

function throwIfAborted(context: LocalAgentContext): void {
  if (context.options.abortSignal?.aborted) {
    throw new Error('Request was cancelled')
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
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
  return stableStringify(actual) === stableStringify(expected)
}

function fileNameOnly(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value)
  return typeof record.name === 'string' && record.name.trim() ? { name: record.name } : null
}

function sanitizeCanvasNodeDetailForAgent(detail: CanvasNodeDetail): CanvasNodeDetail {
  const file = fileNameOnly(detail.file)
  const fieldFile = fileNameOnly(detail.fields.file)
  return {
    ...detail,
    file,
    fields: {
      ...detail.fields,
      ...(fieldFile || 'file' in detail.fields ? { file: fieldFile } : {}),
    },
  }
}

function summarizeOutput(toolName: LocalCanvasToolName, value: unknown): string {
  if (!value) return ''
  if (toolName === 'canvas.read_summary') {
    const record = asRecord(value)
    const nodeCount = Array.isArray(record.nodes) ? record.nodes.length : 0
    const edgeCount = Array.isArray(record.edges) ? record.edges.length : 0
    return `Read canvas summary with ${nodeCount} nodes and ${edgeCount} connections`
  }
  if (toolName === 'canvas.read_selected_nodes') {
    return `Read ${Array.isArray(value) ? value.length : 0} selected node detail(s)`
  }
  if (toolName === 'canvas.read_node') {
    const record = asRecord(value)
    return `Read node ${typeof record.name === 'string' ? record.name : 'detail'}`
  }
  if (toolName === 'canvas.apply_patch') {
    const record = asRecord(value)
    if (typeof record.userSummary === 'string') return record.userSummary
    const verification = asRecord(record.verification)
    return typeof verification.summary === 'string'
      ? `Applied canvas patch. ${verification.summary}`
      : 'Applied canvas patch'
  }
  if (toolName === 'canvas.propose_patch') {
    const validation = asRecord(asRecord(value).validation)
    return validation.valid === true
      ? 'Prepared canvas patch proposal'
      : 'Prepared canvas patch proposal with validation errors'
  }
  if (toolName === 'canvas.verify_patch') {
    const record = asRecord(value)
    return typeof record.summary === 'string' ? record.summary : 'Verified canvas patch'
  }
  if (toolName === 'canvas.generate_node_output') {
    const record = asRecord(value)
    const kind = typeof record.kind === 'string' ? record.kind : 'node'
    return `Generated output for ${kind} node`
  }
  if (toolName === 'canvas.inspect_schema') {
    const record = asRecord(value)
    return `Inspected schema for ${typeof record.kind === 'string' ? record.kind : 'node'}`
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 500 ? `${text.slice(0, 500)}...` : text
}

function getVerificationFailureSummary(
  toolName: LocalCanvasToolName,
  value: unknown
): string | null {
  if (toolName === 'canvas.apply_patch') {
    const verification = asRecord(asRecord(value).verification)
    if (verification.success === false) {
      return typeof verification.summary === 'string'
        ? verification.summary
        : 'Canvas patch verification failed'
    }
  }
  if (toolName === 'canvas.verify_patch') {
    const verification = asRecord(value)
    if (verification.success === false) {
      return typeof verification.summary === 'string'
        ? verification.summary
        : 'Canvas patch verification failed'
    }
  }
  return null
}

function getPatchOperationId(operation: LocalCanvasPatchOperation, index: number): string {
  return operation.operationId ?? `${operation.type}:${index + 1}`
}

function isGenerationCandidateKind(kind: unknown): kind is LocalCanvasNodeKind {
  return kind === 'text' || kind === 'image' || kind === 'video' || kind === 'audio'
}

function isGenerationInputField(kind: LocalCanvasNodeKind, field: string): boolean {
  if (kind === 'text') return field === 'aiPrompt' || field === 'aiModel'
  if (kind === 'image')
    return field === 'aiPrompt' || field === 'aiModel' || field === 'aiAspectRatio'
  if (kind === 'video') {
    return (
      field === 'videoPrompt' ||
      field === 'videoModelFamily' ||
      field === 'videoMedia' ||
      field === 'videoParameters' ||
      field === 'videoFrameAspectRatioPreset'
    )
  }
  if (kind === 'audio') {
    return field === 'audioPrompt' || field === 'audioModel' || field === 'audioParameters'
  }
  return false
}

function buildPatchMachineSummary(params: {
  patch: LocalCanvasPatch
  snapshot: { nodes: CanvasNodeRecord[] }
  verification: {
    operationResults?: unknown
    success?: unknown
  }
}): {
  userSummary: string
  machineSummary: Record<string, unknown>
  writeBackFields: Array<Record<string, unknown>>
  createdNodeMap: Record<string, string>
  requiresFollowup: boolean
} {
  const operationResults = Array.isArray(params.verification.operationResults)
    ? params.verification.operationResults.map(asRecord)
    : []
  const createdNodeMap: Record<string, string> = {}
  const writeBackFields: Array<Record<string, unknown>> = []
  const referenceChanges: Array<Record<string, unknown>> = []
  const deletedNodeIds: string[] = []
  params.patch.operations.forEach((operation, index) => {
    const operationId = getPatchOperationId(operation, index)
    const result = operationResults.find((item) => item.operationId === operationId)
    if (operation.type === 'create_node' && operation.clientNodeId) {
      const nodeId = typeof result?.nodeId === 'string' ? result.nodeId : operation.nodeId
      if (nodeId) createdNodeMap[operation.clientNodeId] = nodeId
    }
    if (operation.type === 'create_node' || operation.type === 'update_node') {
      for (const field of Object.keys(operation.fields ?? {})) {
        writeBackFields.push({
          operationId,
          nodeId:
            operation.type === 'update_node'
              ? operation.nodeId
              : typeof result?.nodeId === 'string'
                ? result.nodeId
                : operation.nodeId,
          field,
          status: operationResults.some(
            (item) => item.operationId === operationId && item.field === field && item.success
          )
            ? 'verified'
            : 'pending_or_failed',
        })
      }
    }
    if (operation.type === 'delete_node') {
      deletedNodeIds.push(operation.nodeId)
    }
    if (
      operation.type === 'add_content_reference' ||
      operation.type === 'remove_content_reference'
    ) {
      referenceChanges.push({
        operationId,
        type: operation.type,
        consumerNodeId: operation.consumerNodeId,
        sourceNodeId: operation.sourceNodeId,
        role: operation.type === 'add_content_reference' ? operation.role : operation.role,
      })
    }
  })
  const generatedCandidates = params.patch.operations.flatMap((operation) => {
    if (operation.type === 'create_node') {
      const nodeId = operation.clientNodeId
        ? createdNodeMap[operation.clientNodeId]
        : (operation.nodeId ?? '')
      return nodeId && isGenerationCandidateKind(operation.kind)
        ? [{ nodeId, kind: operation.kind, clientNodeId: operation.clientNodeId }]
        : []
    }
    if (operation.type !== 'update_node') return []
    const node = params.snapshot.nodes.find((item) => item.id === operation.nodeId)
    if (!node || !isGenerationCandidateKind(node.kind)) return []
    const fields = Object.keys(operation.fields ?? {})
    const updatesGenerationInput = fields.some((field) => isGenerationInputField(node.kind, field))
    return updatesGenerationInput ? [{ nodeId: operation.nodeId, kind: node.kind }] : []
  })
  const fieldChecks = operationResults.flatMap((item) => {
    const nodeId = typeof item.nodeId === 'string' ? item.nodeId : undefined
    const field = typeof item.field === 'string' ? item.field : undefined
    if (!nodeId || !field) return []
    return [`node.${nodeId}.${field} ${item.success ? 'verified' : 'failed'}`]
  })
  const machineSummary = {
    action: 'canvas_patch',
    success: params.verification.success === true,
    createdNodeMap,
    writeBackFields,
    deletedNodeIds,
    referenceChanges,
    generationCandidates: generatedCandidates,
    fieldChecks,
    requiresFollowup: false,
  }
  return {
    userSummary: '画布修改已写入并完成字段级验证。',
    machineSummary,
    writeBackFields,
    createdNodeMap,
    requiresFollowup: false,
  }
}

function getReadableFieldsForKind(kind: Parameters<typeof getCanvasNodeAdapter>[0]): string[] {
  if (kind === 'text') {
    return [
      'contentHtml',
      'blockStyle',
      'backgroundColor',
      'fontSize',
      'width',
      'height',
      'aiPrompt',
      'aiModel',
    ]
  }
  if (kind === 'image') return ['file', 'aiPrompt', 'aiModel', 'aiAspectRatio']
  if (kind === 'video') {
    return [
      'file',
      'videoPrompt',
      'videoModelFamily',
      'videoResolution',
      'videoDuration',
      'videoParameters',
      'referencedMedia',
    ]
  }
  if (kind === 'audio') return ['file', 'audioPrompt', 'audioModel', 'audioParameters']
  if (kind === 'presentation') {
    return [
      'presentationPrompt',
      'presentationSlideCountMode',
      'presentationSlideCount',
      'presentationStatus',
      'presentationArtifact',
      'file',
      'contentReferences',
    ]
  }
  if (kind === 'document') return ['title', 'description', 'file']
  if (kind === 'table') return ['columns', 'rowCount', 'sampleRows']
  if (kind === 'image_editor') return ['sourceImage', 'editPrompt', 'outputFile']
  return ['summary']
}

function getGenerationSchemaForKind(kind: Parameters<typeof getCanvasNodeAdapter>[0]) {
  if (kind === 'text') {
    return { supported: true, inputFields: ['aiPrompt'], outputField: 'contentHtml' }
  }
  if (kind === 'image') {
    return { supported: true, inputFields: ['aiPrompt', 'aiAspectRatio'], outputField: 'file' }
  }
  if (kind === 'video') {
    return {
      supported: true,
      inputFields: ['videoPrompt', 'videoModelFamily', 'videoParameters', 'referencedMedia'],
      outputField: 'file',
    }
  }
  if (kind === 'audio') {
    return { supported: true, inputFields: ['audioPrompt', 'audioParameters'], outputField: 'file' }
  }
  return { supported: false, inputFields: [], outputField: null }
}

function getIncomingImageFile(
  block: CanvasNodeRecord,
  snapshotEdges: Array<{ source: string; target: string }>,
  nodes: CanvasNodeRecord[]
): UserFileLike | null {
  const incoming = snapshotEdges.find((edge) => edge.target === block.id)
  if (!incoming) return null
  const source = nodes.find((node) => node.id === incoming.source && node.kind === 'image')
  if (!source) return null
  return toUserFileLike(getFileValue(source.values), `${source.name}.png`)
}

function toUserFileLike(value: unknown, fallbackName: string): UserFileLike | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const file = value as Record<string, unknown>
  const url =
    resolveUserFileUrl(file) ||
    (typeof file.path === 'string' ? file.path : typeof file.url === 'string' ? file.url : '')
  const resolvedKey = resolveStorageKeyFromFileInput({
    key: typeof file.key === 'string' ? file.key : undefined,
    path: typeof file.path === 'string' ? file.path : undefined,
    url,
  })
  const key = resolvedKey || url || ''
  if (!key) return null
  return {
    id: typeof file.id === 'string' ? file.id : key,
    name: typeof file.name === 'string' ? file.name : fallbackName,
    url,
    key,
    size: typeof file.size === 'number' ? file.size : 0,
    type: typeof file.type === 'string' ? file.type : 'image/png',
    context: typeof file.context === 'string' ? file.context : undefined,
  }
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

function toPromptContextFile(node: CanvasNodeRecord): PromptContextReferencedNode['file'] {
  return toUserFileLike(getFileValue(node.values), node.name)
}

function buildReferenceContextForNode(
  node: CanvasNodeRecord,
  snapshot: {
    nodes: CanvasNodeRecord[]
  }
) {
  const references = normalizeContentReferences(getValue(node.values, 'contentReferences', []))
  const referencedNodes: Record<string, PromptContextReferencedNode> = {}
  for (const reference of references) {
    const referencedNode = snapshot.nodes.find((item) => item.id === reference.sourceBlockId)
    if (!referencedNode || !isContentVariant(referencedNode.kind)) continue
    referencedNodes[reference.sourceBlockId] = {
      name: referencedNode.name,
      variant: referencedNode.kind,
      textContent:
        referencedNode.kind === 'text'
          ? stripHtml(getValue<string>(referencedNode.values, 'contentHtml', ''))
          : null,
      file: toPromptContextFile(referencedNode),
    }
  }
  return {
    references,
    referencedNodes,
    promptText: buildContentReferencePromptContext({ references, referencedNodes }),
    structured: buildStructuredContentReferenceContext({ references, referencedNodes }),
  }
}

function buildGenerationReferenceContext(
  node: CanvasNodeRecord,
  snapshot: { nodes: CanvasNodeRecord[] }
): { text: string[]; images: UserFileLike[] } {
  const structured = buildReferenceContextForNode(node, snapshot).structured
  return {
    text: structured.text,
    images: structured.images.flatMap((image) => {
      const file = toUserFileLike(image, image.name)
      return file ? [file] : []
    }),
  }
}

function buildReferencedVideoMedia(
  node: CanvasNodeRecord,
  snapshot: { nodes: CanvasNodeRecord[]; edges: Array<{ source: string; target: string }> }
) {
  const referenceContext = buildReferenceContextForNode(node, snapshot)
  const fromVideoMedia = getValue<Array<{ type: 'first_frame' | 'last_frame'; file: unknown }>>(
    node.values,
    'videoMedia',
    []
  )
  const media = Array.isArray(fromVideoMedia)
    ? fromVideoMedia.flatMap((item) => {
        if (item.type !== 'first_frame' && item.type !== 'last_frame') return []
        const file = toUserFileLike(item.file, node.name)
        if (!file) return []
        return [{ type: item.type, file }]
      })
    : []
  for (const reference of referenceContext.references) {
    if (reference.role !== 'video_first_frame' && reference.role !== 'video_last_frame') continue
    const mediaType = reference.role === 'video_first_frame' ? 'first_frame' : 'last_frame'
    if (media.some((item) => item.type === mediaType)) {
      continue
    }
    const source = snapshot.nodes.find(
      (item) => item.id === reference.sourceBlockId && item.kind === 'image'
    )
    if (!source) continue
    const file = toPromptContextFile(source)
    if (!file) continue
    media.push({ type: mediaType, file })
  }
  const firstFrame = getVideoMediaFileForType(media, 'first_frame')
  if (!firstFrame) {
    const incoming = getIncomingImageFile(node, snapshot.edges, snapshot.nodes)
    if (incoming) media.push({ type: 'first_frame', file: incoming })
  }
  return {
    media,
    promptText: referenceContext.promptText,
  }
}

function normalizeGeneratedFileForWriteback(file: unknown): Record<string, unknown> {
  const record = asRecord(file)
  const path =
    typeof record.path === 'string'
      ? record.path
      : typeof record.url === 'string'
        ? record.url
        : undefined
  return {
    ...record,
    ...(path ? { path } : {}),
  }
}

function buildTextGenerationSystemPrompt(): string {
  return [
    'You generate content for a local canvas text node.',
    'Follow the node prompt and return only the content that should be written into the node.',
    'Do not introduce yourself, do not role-play an agent persona, and do not speak as a director or team broadcaster.',
  ].join('\n')
}

async function updateNodeAfterGeneration(params: {
  context: LocalAgentContext
  nodeId: string
  fields: Record<string, unknown>
}) {
  return editWorkflowServerTool.execute(
    {
      workflowId: params.context.workflowId,
      operations: [
        {
          operation_type: 'edit',
          block_id: params.nodeId,
          params: {
            inputs: params.fields,
          },
        },
      ],
    },
    {
      userId: params.context.userId,
      workspaceId: params.context.workspaceId,
      chatId: params.context.chatId,
      abortSignal: params.context.options.abortSignal,
    }
  )
}

async function assertGeneratedFieldWritten(params: {
  context: LocalAgentContext
  nodeId: string
  field: string
  value: unknown
}): Promise<void> {
  const snapshot = await loadCanvasSnapshot({
    workflowId: params.context.workflowId,
    workspaceId: params.context.workspaceId,
  })
  const node = snapshot.nodes.find((item) => item.id === params.nodeId)
  if (!node) throw new Error(`Generated node "${params.nodeId}" was not found after writeback`)
  const actual = getValue(node.values, params.field, undefined)
  if (!fieldMatches(actual, params.value)) {
    throw new Error(`Generated field "${params.field}" was not written on node "${params.nodeId}"`)
  }
}

async function generateNodeOutput(context: LocalAgentContext, nodeId: string) {
  throwIfAborted(context)
  const snapshot = await loadCanvasSnapshot({
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
  })
  throwIfAborted(context)
  const node = snapshot.nodes.find((item) => item.id === nodeId)
  if (!node) throw new Error(`Node "${nodeId}" was not found`)
  if (!getCanvasNodeAdapter(node.kind).capabilities.canGenerate) {
    throw new Error(`${node.kind} nodes do not support generation`)
  }

  if (node.kind === 'text') {
    const prompt = getValue<string>(node.values, 'aiPrompt', '') || `Write content for ${node.name}`
    const model = getValue<string>(node.values, 'aiModel', 'gemini-3.1-flash-lite-preview')
    const referenceContext = buildReferenceContextForNode(node, snapshot)
    const generatedText = await generateContentCanvasText({
      workspaceId: context.workspaceId,
      model,
      prompt,
      referenceContextText: referenceContext.promptText,
      systemPrompt: buildTextGenerationSystemPrompt(),
      abortSignal: context.options.abortSignal,
    })
    throwIfAborted(context)
    const contentHtml = convertGeneratedTextToContentHtml(generatedText)
    await updateNodeAfterGeneration({ context, nodeId, fields: { contentHtml } })
    await assertGeneratedFieldWritten({ context, nodeId, field: 'contentHtml', value: contentHtml })
    return { nodeId, kind: node.kind, verifiedField: 'contentHtml', contentHtml }
  }

  if (node.kind === 'image') {
    const prompt =
      getValue<string>(node.values, 'aiPrompt', '') || `Create an image for ${node.name}`
    const model = getValue<string>(node.values, 'aiModel', 'jimeng-4.5') as ImageGenerationModelId
    const aspectRatio = getValue<string>(
      node.values,
      'aiAspectRatio',
      'auto'
    ) as ImageAspectRatioValue
    const result = await generateWorkspaceImageFromPrompt({
      workspaceId: context.workspaceId,
      userId: context.userId,
      model,
      prompt,
      aspectRatio,
      referenceContext: buildGenerationReferenceContext(node, snapshot),
      abortSignal: context.options.abortSignal,
    })
    throwIfAborted(context)
    const file = normalizeGeneratedFileForWriteback(result.file)
    await updateNodeAfterGeneration({ context, nodeId, fields: { file } })
    await assertGeneratedFieldWritten({ context, nodeId, field: 'file', value: file })
    return {
      nodeId,
      kind: node.kind,
      verifiedField: 'file',
      file,
      metadata: result.metadata,
    }
  }

  if (node.kind === 'video') {
    const referenceMedia = buildReferencedVideoMedia(node, snapshot)
    const basePrompt =
      getValue<string>(node.values, 'videoPrompt', '') || `Create a video for ${node.name}`
    const prompt = [basePrompt, referenceMedia.promptText].filter(Boolean).join('\n\n')
    const firstFrame = getVideoMediaFileForType(referenceMedia.media, 'first_frame')
    const modelFamily = getValue<'wan2.7' | 'wan2.6'>(
      node.values,
      'videoModelFamily',
      firstFrame ? DEFAULT_VIDEO_MODEL_FAMILY : 'wan2.6'
    )
    const videoParameters = getObjectValue(node.values, 'videoParameters', {
      resolution: DEFAULT_VIDEO_RESOLUTION,
      duration: DEFAULT_VIDEO_DURATION_SECONDS,
    })
    const model = resolveVideoGenerationModelId({ modelFamily, hasFirstFrame: Boolean(firstFrame) })
    const result = await generateWorkspaceVideoFromPrompt({
      workspaceId: context.workspaceId,
      userId: context.userId,
      model,
      prompt,
      media: referenceMedia.media,
      parameters: {
        aspectRatioPreset: getValue(
          node.values,
          'videoFrameAspectRatioPreset',
          DEFAULT_VIDEO_FRAME_ASPECT_RATIO_PRESET
        ),
        resolution: videoParameters.resolution ?? DEFAULT_VIDEO_RESOLUTION,
        duration: videoParameters.duration ?? DEFAULT_VIDEO_DURATION_SECONDS,
        promptExtend: true,
        watermark: false,
      },
      abortSignal: context.options.abortSignal,
    })
    throwIfAborted(context)
    const file = normalizeGeneratedFileForWriteback(result.file)
    await updateNodeAfterGeneration({ context, nodeId, fields: { file } })
    await assertGeneratedFieldWritten({ context, nodeId, field: 'file', value: file })
    return {
      nodeId,
      kind: node.kind,
      verifiedField: 'file',
      file,
      metadata: result.metadata,
    }
  }

  const referenceContext = buildReferenceContextForNode(node, snapshot)
  const prompt = getValue<string>(node.values, 'audioPrompt', '') || `Create audio for ${node.name}`
  const result = await generateWorkspaceAudioFromPrompt({
    workspaceId: context.workspaceId,
    userId: context.userId,
    model: getValue(node.values, 'audioModel', DEFAULT_AUDIO_MODEL),
    prompt,
    parameters: getObjectValue(node.values, 'audioParameters', DEFAULT_AUDIO_PARAMETERS),
    referenceContext: { text: referenceContext.structured.text },
    abortSignal: context.options.abortSignal,
  })
  throwIfAborted(context)
  const file = normalizeGeneratedFileForWriteback(result.file)
  await updateNodeAfterGeneration({ context, nodeId, fields: { file } })
  await assertGeneratedFieldWritten({ context, nodeId, field: 'file', value: file })
  return {
    nodeId,
    kind: node.kind,
    verifiedField: 'file',
    file,
    metadata: result.metadata,
  }
}

export async function executeCanvasTool(
  context: LocalAgentContext,
  call: LocalCanvasToolCall
): Promise<LocalAgentToolResult> {
  try {
    const output = await executeCanvasToolUnchecked(context, call)
    const verificationFailure = getVerificationFailureSummary(call.name, output)
    if (verificationFailure) {
      return {
        name: call.name,
        success: false,
        output,
        error: verificationFailure,
        summary: verificationFailure,
      }
    }
    return {
      name: call.name,
      success: true,
      output,
      summary: summarizeOutput(call.name, output),
    }
  } catch (error) {
    return {
      name: call.name,
      success: false,
      error: toError(error).message,
      summary: toError(error).message,
    }
  }
}

async function executeCanvasToolUnchecked(
  context: LocalAgentContext,
  call: LocalCanvasToolCall
): Promise<unknown> {
  const snapshot = await loadCanvasSnapshot({
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
  })

  if (call.name === 'canvas.read_summary') {
    const summaryCache = await loadOrCreateCanvasSummaryCache(snapshot)
    const nodes = applyCanvasSummaryCacheSelection(summaryCache, context.selectedNodeIds)
    return {
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      nodes,
      edges: summaryCache.edges,
      summaryText: buildCanvasSummaryTextFromParts({
        workflowId: context.workflowId,
        nodes,
        edges: summaryCache.edges,
      }),
    }
  }

  if (call.name === 'canvas.read_node') {
    const nodeId = requireString(call.input, 'nodeId')
    const detail = readCanvasNodeDetail(snapshot, nodeId, context.selectedNodeIds)
    if (!detail) throw new Error(`Node "${nodeId}" was not found`)
    return sanitizeCanvasNodeDetailForAgent(detail)
  }

  if (call.name === 'canvas.read_selected_nodes') {
    const details = context.selectedNodeIds
      .map((nodeId) => readCanvasNodeDetail(snapshot, nodeId, context.selectedNodeIds))
      .filter((detail): detail is CanvasNodeDetail => Boolean(detail))
    if (context.selectedNodeIds.length > 0 && details.length === 0) {
      throw new Error('Selected node details were not found in the current canvas')
    }
    return details.map(sanitizeCanvasNodeDetailForAgent)
  }

  if (call.name === 'canvas.search_nodes') {
    return searchCanvasNodes({
      snapshot,
      query: typeof call.input.query === 'string' ? call.input.query : '',
      selectedNodeIds: context.selectedNodeIds,
    })
  }

  if (call.name === 'canvas.inspect_schema') {
    const kind = requireString(call.input, 'kind') as Parameters<typeof getCanvasNodeAdapter>[0]
    const adapter = getCanvasNodeAdapter(kind)
    const editableFields = adapter.getEditableFields()
    return {
      kind,
      blockType: adapter.blockType,
      capabilities: adapter.capabilities,
      readableFields: getReadableFieldsForKind(kind),
      writableFields: editableFields.map((field) => field.id),
      editableFields,
      generation: getGenerationSchemaForKind(kind),
    }
  }

  if (call.name === 'canvas.propose_patch') {
    const patch = materializeCreateNodeOperations(requirePatch(call.input), snapshot)
    const validation = validateLocalCanvasPatch(patch, snapshot)
    const { operations } = validation.valid
      ? buildEditWorkflowOperationsFromPatch({ patch, snapshot })
      : { operations: [] }
    return {
      patch,
      validation,
      operationCount: operations.length,
      summary: validation.valid
        ? `Patch proposal is valid and would produce ${operations.length} workflow operation(s).`
        : `Patch proposal is invalid: ${validation.errors.join('; ')}`,
    }
  }

  if (call.name === 'canvas.apply_patch') {
    if (!context.permissions.canWrite) {
      throw new Error(context.permissions.readonlyReason ?? 'Canvas is read-only')
    }
    const patch = materializeCreateNodeOperations(requirePatch(call.input), snapshot)
    const validation = validateLocalCanvasPatch(patch, snapshot)
    if (!validation.valid) throw new Error(validation.errors.join('; '))
    const { mutationPatch, layoutPatch } = splitDeferredLayoutPatch(patch)
    const { operations, idMap } = buildEditWorkflowOperationsFromPatch({
      patch: mutationPatch,
      snapshot,
    })
    if (operations.length === 0) throw new Error('Patch did not produce executable operations')
    const editOutputs: unknown[] = []
    const output = await editWorkflowServerTool.execute(
      {
        workflowId: context.workflowId,
        operations,
      },
      {
        userId: context.userId,
        workspaceId: context.workspaceId,
        chatId: context.chatId,
        abortSignal: context.options.abortSignal,
      }
    )
    editOutputs.push(output)
    const resolvedLayoutPatch = resolveDeferredLayoutPatch(layoutPatch, idMap)
    if (resolvedLayoutPatch) {
      const layoutSnapshot = await loadCanvasSnapshot({
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
      })
      const { operations: layoutOperations } = buildEditWorkflowOperationsFromPatch({
        patch: resolvedLayoutPatch,
        snapshot: layoutSnapshot,
      })
      if (layoutOperations.length > 0) {
        editOutputs.push(
          await editWorkflowServerTool.execute(
            {
              workflowId: context.workflowId,
              operations: layoutOperations,
            },
            {
              userId: context.userId,
              workspaceId: context.workspaceId,
              chatId: context.chatId,
              abortSignal: context.options.abortSignal,
            }
          )
        )
      }
    }
    const verification = await verifyLocalCanvasPatch({
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      patch,
      selectedNodeIds: context.selectedNodeIds,
    })
    const structuredResult = buildPatchMachineSummary({ patch, snapshot, verification })
    return {
      edit: editOutputs.length === 1 ? output : { steps: editOutputs },
      patch,
      verification,
      ...structuredResult,
    }
  }

  if (call.name === 'canvas.verify_patch') {
    const patch = call.input.patch === undefined ? undefined : requirePatch(call.input)
    if (patch) {
      const validation = validateLocalCanvasPatch(patch, snapshot)
      if (!validation.valid) throw new Error(validation.errors.join('; '))
    }
    return verifyLocalCanvasPatch({
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      patch,
      generation: call.input.generation as { nodeId: string; field: string } | undefined,
      selectedNodeIds: context.selectedNodeIds,
    })
  }

  if (call.name === 'canvas.generate_node_output') {
    if (!context.permissions.canWrite) {
      throw new Error(context.permissions.readonlyReason ?? 'Canvas is read-only')
    }
    return generateNodeOutput(context, requireString(call.input, 'nodeId'))
  }

  const exhaustive: never = call.name satisfies never
  throw new Error(`Unsupported canvas tool: ${exhaustive}`)
}

export const CANVAS_TOOL_TITLES: Record<LocalCanvasToolName, string> = {
  'canvas.read_summary': '读取画布',
  'canvas.read_node': '读取节点',
  'canvas.read_selected_nodes': '读取选中节点',
  'canvas.search_nodes': '搜索画布节点',
  'canvas.inspect_schema': '检查节点结构',
  'canvas.propose_patch': '准备画布修改方案',
  'canvas.apply_patch': '更新画布',
  'canvas.verify_patch': '验证画布',
  'canvas.generate_node_output': '生成节点内容',
}
