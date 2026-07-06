import { generateId } from '@sim/utils/id'
import type {
  HermesCanvasNodeRef,
  HermesCanvasResourceRef,
  HermesCanvasTaskPayload,
  HermesCanvasTaskRunResponse,
  ParsedHermesCanvasTaskRunBody,
} from '@/lib/api/contracts/internal/hermes-canvas-task'
import { runLocalCanvasAgentHeadless } from '@/lib/copilot/request/lifecycle/local-canvas-agent'
import {
  buildCanvasSummaryTextFromParts,
  loadCanvasSnapshot,
  readCanvasNodeDetail,
  searchCanvasNodes,
  summarizeCanvas,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-context'
import { validateLocalCanvasPatch } from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-patch'
import { resolveLocalAgentContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/context-manager'
import {
  getCanvasNodeAdapter,
  getCanvasNodeAdapters,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters'
import {
  consumeLocalAgentPreviewPlan,
  executeConfirmedLocalAgentPlan,
  putLocalAgentPendingPlan,
  putLocalAgentPreviewPlan,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/pending-plan'
import { patchRequiresDeleteConfirmation } from '@/lib/copilot/request/lifecycle/local-canvas-agent/safety'
import type {
  CanvasNodeDetail,
  CanvasSnapshot,
  LocalAgentContext,
  LocalAgentObservation,
  LocalAgentPlan,
  LocalAgentRisk,
  LocalCanvasGenerationTarget,
  LocalCanvasNodeKind,
  LocalCanvasPatch,
  LocalCanvasPatchOperation,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import { TraceCollector } from '@/lib/copilot/request/trace'
import type { ExecutionContext, StreamingContext } from '@/lib/copilot/request/types'
import { SHOW_PLANNING_WORKFLOW_PRESET } from '@/lib/hermes/show-planning-skill'
import {
  buildShowPlanningScaffoldGenerationTargets,
  buildShowPlanningScaffoldOperations,
  isShowPlanningPreset,
  readShowPlanningCheckpoint,
} from '@/lib/hermes/show-planning-workflow'

const CONTENT_NODE_KINDS = new Set(['text', 'image', 'video', 'audio', 'presentation'])
const NODE_GAP_Y = 220
const SHOW_PLANNING_SCAFFOLD_NODE_IDS = [
  'planning-positioning',
  'planning-concept',
  'planning-structure',
  'planning-programs',
  'planning-lineup',
  'planning-visual',
  'planning-summary',
] as const

const SHOW_PLANNING_INTENT_PATTERNS = [
  /策划案/,
  /(?:晚会|演出|活动|节庆|盛典|发布会|品牌活动|文旅|城市).{0,12}(?:方案|策划|提案|创意|概念)/,
  /(?:方案|策划|提案|创意|概念).{0,12}(?:晚会|演出|活动|节庆|盛典|发布会|品牌活动|文旅|城市)/,
  /\b(?:gala|event|show|festival|ceremony|brand activation|city event)\b.{0,80}\b(?:proposal|planning|plan|concept|deck)\b/i,
  /\b(?:proposal|planning|plan|concept|deck)\b.{0,80}\b(?:gala|event|show|festival|ceremony|brand activation|city event)\b/i,
] as const

const PRESENTATION_ONLY_PATTERNS = [
  /(?:生成|制作|做|美化|润色|修改|整理).{0,12}(?:PPT|ppt|幻灯片|slides?|deck)/,
  /\b(?:make|create|generate|polish|revise|format)\b.{0,40}\b(?:ppt|slides?|deck)\b/i,
] as const

type TaskNode = HermesCanvasTaskPayload['nodes'][number]
type TaskUpdate = HermesCanvasTaskPayload['updates'][number]
type TaskContent = NonNullable<HermesCanvasTaskPayload['content']>
type TaskFields = Record<string, unknown>
type TaskConnection = HermesCanvasTaskPayload['connections'][number]
type TaskReference = HermesCanvasTaskPayload['references'][number]
type TaskTargetRef = NonNullable<HermesCanvasTaskPayload['generation']>['targets'][number]
type TaskArrangement = NonNullable<HermesCanvasTaskPayload['arrangement']>
type TaskArrangementPlacement = TaskArrangement['placements'][number]
type TaskArrangementZone = TaskArrangement['zones'][number]
type ExternalResourceRef = Exclude<HermesCanvasResourceRef, { type: 'node_output' }>

interface CompiledCanvasTask {
  patch?: LocalCanvasPatch
  generateNodeIds?: string[]
  generationTargets?: LocalCanvasGenerationTarget[]
  proposedPatchSummary: string
}

function hasShowPlanningIntent(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return false

  const hasPlanningSignal = SHOW_PLANNING_INTENT_PATTERNS.some((pattern) =>
    pattern.test(normalized)
  )
  if (!hasPlanningSignal) return false

  const hasPresentationOnlySignal = PRESENTATION_ONLY_PATTERNS.some((pattern) =>
    pattern.test(normalized)
  )
  const hasProposalSignal =
    /策划案|方案|活动方案|晚会方案|演出方案|event proposal|show proposal|gala proposal|planning/i.test(
      normalized
    )

  return hasProposalSignal || !hasPresentationOnlySignal
}

function taskTextForIntent(params: {
  body: ParsedHermesCanvasTaskRunBody
  task: HermesCanvasTaskPayload
}): string {
  return [
    params.body.message,
    params.task.goal,
    params.task.content?.text,
    params.task.content?.prompt,
    params.task.content?.presentationPrompt,
    ...params.task.constraints,
    ...params.task.expectedChanges,
    ...params.task.userPreferences,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
}

function hasShowPlanningScaffold(snapshot: CanvasSnapshot): boolean {
  const nodeIds = new Set(snapshot.nodes.map((node) => node.id))
  return SHOW_PLANNING_SCAFFOLD_NODE_IDS.every((nodeId) => nodeIds.has(nodeId))
}

function validateShowPlanningFirstWrite(params: {
  body: ParsedHermesCanvasTaskRunBody
  task: HermesCanvasTaskPayload
  snapshot: CanvasSnapshot
}): string | null {
  if (!hasShowPlanningIntent(taskTextForIntent(params))) return null
  if (hasShowPlanningScaffold(params.snapshot)) return null
  if (params.task.taskType === 'create_chain' && isShowPlanningPreset(params.task.fields)) {
    return null
  }

  return `Show-planning proposal workflows must start by creating the standard scaffold: taskType="create_chain" with fields.workflowPreset="${SHOW_PLANNING_WORKFLOW_PRESET}". Use this only for event/show/activity proposal planning, not ordinary PPT-only generation.`
}

function createTaskStreamContext(params: { chatId?: string; traceId?: string }): StreamingContext {
  return {
    chatId: params.chatId,
    requestId: params.traceId,
    messageId: generateId(),
    accumulatedContent: '',
    contentBlocks: [],
    toolCalls: new Map(),
    pendingToolPromises: new Map(),
    currentThinkingBlock: null,
    currentSubagentThinkingBlock: null,
    isInThinkingBlock: false,
    subAgentParentStack: [],
    subAgentContent: {},
    subAgentToolCalls: {},
    pendingContent: '',
    streamComplete: false,
    wasAborted: false,
    errors: [],
    trace: new TraceCollector(),
  }
}

function buildExecutionContext(
  body: ParsedHermesCanvasTaskRunBody,
  abortSignal?: AbortSignal
): ExecutionContext {
  return {
    userId: body.userId,
    workspaceId: body.workspaceId,
    workflowId: body.workflowId,
    chatId: body.chatId,
    messageId: generateId(),
    abortSignal,
    copilotToolExecution: true,
  }
}

async function resolveTaskContext(params: {
  body: ParsedHermesCanvasTaskRunBody
  abortSignal?: AbortSignal
}): Promise<LocalAgentContext> {
  return resolveLocalAgentContext({
    requestPayload: {
      message: params.body.message,
      workspaceId: params.body.workspaceId,
      workflowId: params.body.workflowId,
      chatId: params.body.chatId,
      selectedNodeIds: params.body.selectedNodeIds,
      confirmationMode: 'manual',
      hermesCanvasTaskGateway: true,
    },
    execContext: buildExecutionContext(params.body, params.abortSignal),
    streamContext: createTaskStreamContext({
      chatId: params.body.chatId,
      traceId: params.body.traceId,
    }),
    options: { abortSignal: params.abortSignal },
  })
}

function errorResponse(params: {
  body: ParsedHermesCanvasTaskRunBody
  auditId: string
  errorCode:
    | 'INVALID_TASK'
    | 'CONFIRMATION_REQUIRED'
    | 'CONFIRMATION_EXPIRED'
    | 'CONFIRMATION_SUPERSEDED'
    | 'USER_PERMISSION_DENIED'
    | 'TOOL_EXECUTION_FAILED'
  error: string
  risk?: LocalAgentRisk
  answer?: string
}): HermesCanvasTaskRunResponse {
  return {
    success: false,
    operation: params.body.operation,
    answer: params.answer ?? '',
    auditId: params.auditId,
    traceId: params.body.traceId,
    errorCode: params.errorCode,
    error: params.error,
    risk: params.risk,
  }
}

function asObservationRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function addString(value: unknown, ids: Set<string>): void {
  if (typeof value === 'string' && value.trim()) ids.add(value)
}

function collectChangedNodeIds(observations: LocalAgentObservation[]): string[] {
  const ids = new Set<string>()
  for (const observation of observations) {
    if (observation.toolName !== 'canvas.apply_patch') continue
    const output = asObservationRecord(observation.output)
    const machineSummary = asObservationRecord(output.machineSummary)
    const createdNodeMap = {
      ...asObservationRecord(output.createdNodeMap),
      ...asObservationRecord(machineSummary.createdNodeMap),
    }
    for (const value of Object.values(createdNodeMap)) addString(value, ids)
    for (const nodeId of readStringArray(machineSummary.deletedNodeIds)) addString(nodeId, ids)
    for (const nodeId of readStringArray(machineSummary.movedNodeIds)) addString(nodeId, ids)
    const writeBackFields = Array.isArray(machineSummary.writeBackFields)
      ? machineSummary.writeBackFields.map(asObservationRecord)
      : []
    for (const item of writeBackFields) addString(item.nodeId, ids)
  }
  return [...ids]
}

function collectCreatedNodeMap(observations: LocalAgentObservation[]): Record<string, string> {
  const createdNodeMap: Record<string, string> = {}
  for (const observation of observations) {
    if (observation.toolName !== 'canvas.apply_patch') continue
    const output = asObservationRecord(observation.output)
    const machineSummary = asObservationRecord(output.machineSummary)
    for (const [key, value] of Object.entries({
      ...asObservationRecord(output.createdNodeMap),
      ...asObservationRecord(machineSummary.createdNodeMap),
    })) {
      if (typeof value === 'string' && value.trim()) createdNodeMap[key] = value
    }
  }
  return createdNodeMap
}

function collectGeneratedOutputs(observations: LocalAgentObservation[]): Record<string, unknown>[] {
  return observations
    .filter((observation) => observation.toolName === 'canvas.generate_node_output')
    .map((observation) => asObservationRecord(observation.output))
    .filter((output) => typeof output.nodeId === 'string')
}

function collectGeneratedNodeIds(observations: LocalAgentObservation[]): string[] {
  const ids = new Set<string>()
  for (const output of collectGeneratedOutputs(observations)) addString(output.nodeId, ids)
  return [...ids]
}

function buildVerificationSummary(observations: LocalAgentObservation[]): string | undefined {
  const lines = observations
    .filter(
      (observation) =>
        observation.toolName === 'canvas.apply_patch' ||
        observation.toolName === 'canvas.verify_patch' ||
        observation.toolName === 'canvas.generate_node_output'
    )
    .map(
      (observation) =>
        `${observation.toolName}: ${observation.success ? 'success' : 'failed'} - ${
          observation.summary
        }`
    )
  return lines.length ? lines.join('\n') : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNodeKind(value: unknown): LocalCanvasNodeKind | null {
  return typeof value === 'string' && CONTENT_NODE_KINDS.has(value)
    ? (value as LocalCanvasNodeKind)
    : null
}

function lookupNodeKind(snapshot: CanvasSnapshot, nodeId: string): LocalCanvasNodeKind | null {
  return snapshot.nodes.find((node) => node.id === nodeId)?.kind ?? null
}

function getTaskNodeClientId(node: TaskNode, index: number): string {
  return node.clientNodeId ?? node.clientId ?? `node_${index + 1}`
}

function resolveNodeRef(params: { ref: HermesCanvasNodeRef; selectedNodeIds: string[] }): string {
  if (params.ref.type === 'existing_node') return params.ref.nodeId
  if (params.ref.type === 'created_node') return params.ref.clientNodeId
  if (params.ref.type === 'selected_node') {
    const nodeId = params.selectedNodeIds[params.ref.index ?? 0]
    if (!nodeId) throw new Error(`Selected node index ${params.ref.index ?? 0} was not found`)
    return nodeId
  }
  throw new Error(
    `previous_tool_result node refs are not supported by the SIM canvas task gateway yet`
  )
}

function resolveNodeLikeRef(params: {
  value: string | HermesCanvasNodeRef
  selectedNodeIds: string[]
}): string {
  return typeof params.value === 'string'
    ? params.value
    : resolveNodeRef({ ref: params.value, selectedNodeIds: params.selectedNodeIds })
}

function resolveResourceAsNodeId(params: {
  resource: string | HermesCanvasNodeRef | HermesCanvasResourceRef
  selectedNodeIds: string[]
  materializedResourceNodeIds?: Map<string, string>
}): string {
  if (typeof params.resource === 'string') return params.resource
  if (
    'nodeId' in params.resource ||
    'clientNodeId' in params.resource ||
    params.resource.type === 'selected_node'
  ) {
    return resolveNodeRef({
      ref: params.resource as HermesCanvasNodeRef,
      selectedNodeIds: params.selectedNodeIds,
    })
  }
  if (params.resource.type === 'node_output') {
    return resolveNodeRef({ ref: params.resource.node, selectedNodeIds: params.selectedNodeIds })
  }
  if (params.resource.type === 'previous_tool_result') {
    return resolveNodeRef({ ref: params.resource, selectedNodeIds: params.selectedNodeIds })
  }
  const materialized = params.materializedResourceNodeIds?.get(resourceRefKey(params.resource))
  if (materialized) return materialized
  throw new Error(
    `Resource reference type "${params.resource.type}" must be materialized into a SIM canvas node before it can be used as a canvas content reference`
  )
}

function resourceRefKey(resource: ExternalResourceRef): string {
  if (resource.type === 'url') return `url:${resource.url}`
  if (resource.type === 'uploaded_attachment') return `uploaded_attachment:${resource.attachmentId}`
  return `${resource.type}:${resource.fileId}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function resourceName(resource: ExternalResourceRef, index: number): string {
  if (resource.type === 'url') return resource.url
  if ('name' in resource && typeof resource.name === 'string' && resource.name.trim()) {
    return resource.name.trim()
  }
  if (resource.type === 'uploaded_attachment') return `Uploaded attachment ${index + 1}`
  return `${resource.type.toUpperCase()} reference ${index + 1}`
}

function resourceMediaType(resource: ExternalResourceRef): string {
  if ('mediaType' in resource && typeof resource.mediaType === 'string' && resource.mediaType) {
    return resource.mediaType
  }
  if (resource.type === 'image') return 'image/*'
  if (resource.type === 'pdf') return 'application/pdf'
  return ''
}

function resourceFileFields(resource: ExternalResourceRef, name: string): Record<string, unknown> {
  if (resource.type === 'url') return {}
  const fileId = resource.type === 'uploaded_attachment' ? resource.attachmentId : resource.fileId
  return {
    id: fileId,
    name,
    type: resourceMediaType(resource) || 'application/octet-stream',
    ...(resource.key ? { key: resource.key } : {}),
    ...(resource.url ? { url: resource.url } : {}),
  }
}

function isImageResource(resource: ExternalResourceRef): boolean {
  if (resource.type === 'image') return true
  return resourceMediaType(resource).toLowerCase().startsWith('image/')
}

function isExternalResourceRef(value: unknown): value is ExternalResourceRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const type = (value as { type?: unknown }).type
  return type === 'uploaded_attachment' || type === 'url' || type === 'pdf' || type === 'image'
}

function collectExternalResourceRefs(task: HermesCanvasTaskPayload): ExternalResourceRef[] {
  const resources: ExternalResourceRef[] = []
  const add = (resource: HermesCanvasResourceRef) => {
    if (!isExternalResourceRef(resource)) return
    resources.push(resource)
  }
  for (const reference of task.references) {
    if (isExternalResourceRef(reference.source)) add(reference.source)
  }
  for (const reference of task.generation?.references ?? []) add(reference)
  for (const reference of task.resourceRefs) add(reference)

  const seen = new Set<string>()
  return resources.filter((resource) => {
    const key = resourceRefKey(resource)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildMaterializedResourceOperations(params: { task: HermesCanvasTaskPayload }): {
  operations: LocalCanvasPatchOperation[]
  resourceNodeIds: Map<string, string>
} {
  const resourceNodeIds = new Map<string, string>()
  const operations = collectExternalResourceRefs(params.task).map((resource, index) => {
    const safeResourceKey = resourceRefKey(resource)
      .replace(/[^\w:-]/g, '_')
      .slice(0, 80)
    const clientNodeId = `resource:${index + 1}:${safeResourceKey}`
    resourceNodeIds.set(resourceRefKey(resource), clientNodeId)
    const name = resourceName(resource, index)
    if (isImageResource(resource)) {
      return {
        type: 'create_node',
        operationId: `materialize_resource:${index + 1}`,
        clientNodeId,
        kind: 'image',
        title: name.slice(0, 200),
        fields: {
          file: resourceFileFields(resource, name),
          aiPrompt: '',
        },
      } satisfies LocalCanvasPatchOperation
    }

    const href = resource.type === 'url' ? resource.url : 'url' in resource ? resource.url : ''
    const body = [
      `<p>External resource supplied to Hermes/SIM: ${escapeHtml(name)}</p>`,
      resource.type === 'url'
        ? `<p>URL: <a href="${escapeHtml(resource.url)}">${escapeHtml(resource.url)}</a></p>`
        : '',
      href && resource.type !== 'url'
        ? `<p>Source URL: <a href="${escapeHtml(href)}">${escapeHtml(href)}</a></p>`
        : '',
      resource.type !== 'url'
        ? `<p>File id: ${escapeHtml(resource.type === 'uploaded_attachment' ? resource.attachmentId : resource.fileId)}</p>`
        : '',
      resourceMediaType(resource)
        ? `<p>Media type: ${escapeHtml(resourceMediaType(resource))}</p>`
        : '',
    ]
      .filter(Boolean)
      .join('')

    return {
      type: 'create_node',
      operationId: `materialize_resource:${index + 1}`,
      clientNodeId,
      kind: 'text',
      title: name.slice(0, 200),
      fields: {
        contentHtml: body,
      },
    } satisfies LocalCanvasPatchOperation
  })
  return { operations, resourceNodeIds }
}

function targetNodeIds(params: {
  task: HermesCanvasTaskPayload
  selectedNodeIds: string[]
  snapshot: CanvasSnapshot
}): string[] {
  const target = params.task.target
  if (target?.mode === 'selected') return params.selectedNodeIds
  if (target?.mode === 'node_ids') return target.nodeIds ?? []
  if (target?.mode === 'search' && target.query) {
    return searchCanvasNodes({
      snapshot: params.snapshot,
      query: target.query,
      selectedNodeIds: params.selectedNodeIds,
    }).map((node) => node.id)
  }
  return []
}

function normalizeTextHtml(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/<[a-z][\s\S]*>/i.test(trimmed)) return trimmed
  return `<p>${trimmed}</p>`
}

function mergeContentFields(params: {
  kind: LocalCanvasNodeKind
  content?: TaskContent
  fields?: TaskFields
}): Record<string, unknown> {
  const content = params.content ?? {}
  const fields = params.fields ?? {}
  const output: Record<string, unknown> = {}
  const direct = (key: string) => fields[key]
  const contentString = (...keys: string[]) => {
    for (const key of keys) {
      const value = stringValue((content as Record<string, unknown>)[key])
      if (value) return value
    }
    return ''
  }

  if (params.kind === 'text') {
    const html = contentString('textHtml', 'html') || stringValue(direct('contentHtml'))
    const text = contentString('text') || stringValue(direct('text'))
    if (html) output.contentHtml = html
    else if (text) output.contentHtml = normalizeTextHtml(text)
    const prompt = contentString('aiPrompt', 'prompt') || stringValue(direct('aiPrompt'))
    if (prompt) output.aiPrompt = prompt
    for (const key of ['aiModel', 'blockStyle', 'backgroundColor', 'fontSize', 'width', 'height']) {
      if (fields[key] !== undefined) output[key] = fields[key]
    }
    return output
  }

  if (params.kind === 'image') {
    const prompt =
      contentString('imagePrompt', 'aiPrompt', 'prompt') || stringValue(direct('aiPrompt'))
    if (prompt) output.aiPrompt = prompt
    for (const key of ['aiModel', 'aiAspectRatio']) {
      const value = (content as Record<string, unknown>)[key] ?? fields[key]
      if (value !== undefined) output[key] = value
    }
    return output
  }

  if (params.kind === 'video') {
    const prompt = contentString('videoPrompt', 'prompt') || stringValue(direct('videoPrompt'))
    if (prompt) output.videoPrompt = prompt
    for (const key of ['videoModelFamily', 'videoParameters', 'videoFrameAspectRatioPreset']) {
      const value = (content as Record<string, unknown>)[key] ?? fields[key]
      if (value !== undefined) output[key] = value
    }
    return output
  }

  if (params.kind === 'audio') {
    const prompt = contentString('audioPrompt', 'prompt') || stringValue(direct('audioPrompt'))
    if (prompt) output.audioPrompt = prompt
    for (const key of ['audioModel', 'audioParameters']) {
      const value = (content as Record<string, unknown>)[key] ?? fields[key]
      if (value !== undefined) output[key] = value
    }
    return output
  }

  if (params.kind === 'presentation') {
    const contentRecord = content as Record<string, unknown>
    const prompt =
      contentString('presentationPrompt', 'prompt') || stringValue(direct('presentationPrompt'))
    if (prompt) output.presentationPrompt = prompt

    const rawSlideCount =
      contentRecord.presentationSlideCount ??
      contentRecord.slideCount ??
      fields.presentationSlideCount
    const slideCount =
      typeof rawSlideCount === 'number'
        ? rawSlideCount
        : typeof rawSlideCount === 'string'
          ? Number(rawSlideCount)
          : null
    if (typeof slideCount === 'number' && Number.isFinite(slideCount)) {
      output.presentationSlideCount = Math.max(1, Math.min(200, Math.round(slideCount)))
    }
    const rawSlideCountMode =
      contentRecord.presentationSlideCountMode ??
      contentRecord.slideCountMode ??
      fields.presentationSlideCountMode
    if (rawSlideCountMode === 'auto' || rawSlideCountMode === 'manual') {
      output.presentationSlideCountMode = rawSlideCountMode
    }

    for (const key of [
      'presentationStatus',
      'presentationError',
      'presentationArtifact',
      'file',
      'contentReferences',
    ]) {
      const value = contentRecord[key] ?? fields[key]
      if (value !== undefined) output[key] = value
    }
  }

  return output
}

function generationTargetClientNodeIds(task: HermesCanvasTaskPayload): Set<string> {
  const ids = new Set<string>()
  for (const target of task.generation?.targets ?? []) {
    if (typeof target === 'string') ids.add(target)
    else if (target.type === 'created_node') ids.add(target.clientNodeId)
  }
  for (const ref of task.nodeRefs) {
    if (ref.type === 'created_node') ids.add(ref.clientNodeId)
  }
  return ids
}

function compileCreateNodeOperations(params: {
  nodes: TaskNode[]
  task: HermesCanvasTaskPayload
}): LocalCanvasPatchOperation[] {
  const generatedClientNodeIds = generationTargetClientNodeIds(params.task)
  return params.nodes.map((node, index) => {
    const clientNodeId = getTaskNodeClientId(node, index)
    const fields = mergeContentFields({
      kind: node.kind,
      content: node.content,
      fields: node.fields,
    })
    if (
      node.kind === 'image' &&
      generatedClientNodeIds.has(clientNodeId) &&
      taskHasImageGenerationReference(params.task) &&
      fields.aiModel === undefined
    ) {
      fields.aiModel = 'gemini-3.1-flash-image-preview'
    }
    return {
      type: 'create_node',
      operationId: `create:${clientNodeId}`,
      clientNodeId,
      ...(node.nodeId ? { nodeId: node.nodeId } : {}),
      kind: node.kind,
      title: node.title,
      ...(node.position ? { position: node.position } : {}),
      fields,
    }
  })
}

function compileUpdateOperations(params: {
  task: HermesCanvasTaskPayload
  snapshot: CanvasSnapshot
  selectedNodeIds: string[]
}): LocalCanvasPatchOperation[] {
  const explicitUpdates = params.task.updates.flatMap((update) => {
    const nodeId = update.target
      ? resolveNodeRef({ ref: update.target, selectedNodeIds: params.selectedNodeIds })
      : (update.nodeId ?? update.clientId)
    if (!nodeId) return []
    const kind = update.kindHint ?? lookupNodeKind(params.snapshot, nodeId)
    if (!kind) return []
    const fields = mergeContentFields({
      kind,
      content: update.content,
      fields: update.fields,
    })
    if (Object.keys(fields).length === 0) return []
    return [
      {
        type: 'update_node',
        operationId: `update:${nodeId}`,
        nodeId,
        fields,
      } satisfies LocalCanvasPatchOperation,
    ]
  })

  if (explicitUpdates.length > 0 || (!params.task.content && !params.task.fields)) {
    return explicitUpdates
  }

  return targetNodeIds(params).flatMap((nodeId) => {
    const kind = lookupNodeKind(params.snapshot, nodeId)
    if (!kind) return []
    const fields = mergeContentFields({
      kind,
      content: params.task.content,
      fields: params.task.fields,
    })
    if (Object.keys(fields).length === 0) return []
    return [
      {
        type: 'update_node',
        operationId: `update:${nodeId}`,
        nodeId,
        fields,
      } satisfies LocalCanvasPatchOperation,
    ]
  })
}

function compileDeleteOperations(params: {
  task: HermesCanvasTaskPayload
  selectedNodeIds: string[]
  snapshot: CanvasSnapshot
}): LocalCanvasPatchOperation[] {
  if (
    params.task.taskType !== 'delete_nodes' &&
    params.task.taskType !== 'node_delete' &&
    params.task.deleteNodeIds.length === 0
  ) {
    return []
  }
  const ids = params.task.deleteNodeIds.length ? params.task.deleteNodeIds : targetNodeIds(params)
  return ids.map((nodeId) => ({
    type: 'delete_node',
    operationId: `delete:${nodeId}`,
    nodeId,
  }))
}

function compileConnectionOperations(params: {
  task: HermesCanvasTaskPayload
  selectedNodeIds: string[]
}): LocalCanvasPatchOperation[] {
  return params.task.connections.map((connection: TaskConnection, index) => ({
    type: 'connect',
    operationId: `connect:${index + 1}`,
    sourceNodeId: connection.sourceNode
      ? resolveNodeRef({ ref: connection.sourceNode, selectedNodeIds: params.selectedNodeIds })
      : (connection.source ?? ''),
    targetNodeId: connection.targetNode
      ? resolveNodeRef({ ref: connection.targetNode, selectedNodeIds: params.selectedNodeIds })
      : (connection.target ?? ''),
  }))
}

function compileReferenceOperations(params: {
  task: HermesCanvasTaskPayload
  selectedNodeIds: string[]
  materializedResourceNodeIds: Map<string, string>
}): LocalCanvasPatchOperation[] {
  return params.task.references.map((reference: TaskReference, index) => ({
    type:
      params.task.taskType === 'content_reference_remove'
        ? 'remove_content_reference'
        : 'add_content_reference',
    operationId: `reference:${index + 1}`,
    consumerNodeId: resolveNodeLikeRef({
      value: reference.consumer,
      selectedNodeIds: params.selectedNodeIds,
    }),
    sourceNodeId: resolveResourceAsNodeId({
      resource: reference.source,
      selectedNodeIds: params.selectedNodeIds,
      materializedResourceNodeIds: params.materializedResourceNodeIds,
    }),
    role: reference.role,
  }))
}

function compileLayoutOperation(params: {
  task: HermesCanvasTaskPayload
  selectedNodeIds: string[]
  snapshot: CanvasSnapshot
}): LocalCanvasPatchOperation[] {
  if (!params.task.layout) return []
  const nodeIds = params.task.layout.nodeIds?.length
    ? params.task.layout.nodeIds
    : [
        ...params.task.nodes.map((node, index) => getTaskNodeClientId(node, index)),
        ...targetNodeIds(params),
      ]
  if (nodeIds.length === 0) return []
  return [
    {
      type: 'layout_nodes',
      operationId: 'layout',
      nodeIds: nodeIds.map((nodeId) =>
        resolveNodeLikeRef({ value: nodeId, selectedNodeIds: params.selectedNodeIds })
      ),
      direction: params.task.layout.direction,
    },
  ]
}

function resolveArrangementNodeRef(params: {
  value: string | HermesCanvasNodeRef
  selectedNodeIds: string[]
}): string {
  return resolveNodeLikeRef({
    value: params.value,
    selectedNodeIds: params.selectedNodeIds,
  })
}

function compileAbsoluteArrangementOperations(params: {
  placements: TaskArrangementPlacement[]
  selectedNodeIds: string[]
}): LocalCanvasPatchOperation[] {
  return params.placements.map((placement, index) => ({
    type: 'move_node',
    operationId: `arrange:absolute:${index + 1}`,
    nodeId: resolveArrangementNodeRef({
      value: placement.node,
      selectedNodeIds: params.selectedNodeIds,
    }),
    position: {
      x: placement.x,
      y: placement.y,
    },
  }))
}

function compileStructuredArrangementOperations(params: {
  arrangement: TaskArrangement
  selectedNodeIds: string[]
}): LocalCanvasPatchOperation[] {
  const operations: LocalCanvasPatchOperation[] = []

  params.arrangement.zones.forEach((zone: TaskArrangementZone, zoneIndex) => {
    const originY = zone.origin?.y ?? 0
    const verticalGap = zone.verticalGap ?? NODE_GAP_Y

    zone.columns.forEach((column, columnIndex) => {
      column.nodeIds.forEach((nodeRef, rowIndex) => {
        operations.push({
          type: 'move_node',
          operationId: `arrange:structured:${zone.zoneId ?? zoneIndex + 1}:${columnIndex + 1}:${rowIndex + 1}`,
          nodeId: resolveArrangementNodeRef({
            value: nodeRef,
            selectedNodeIds: params.selectedNodeIds,
          }),
          position: {
            x: column.x,
            y: originY + rowIndex * verticalGap,
          },
        })
      })
    })
  })

  return operations
}

function compilePresetArrangementOperations(params: {
  arrangement: TaskArrangement
  task: HermesCanvasTaskPayload
  selectedNodeIds: string[]
  snapshot: CanvasSnapshot
}): LocalCanvasPatchOperation[] {
  const targetNodeRefs = params.arrangement.targetNodeIds.length
    ? params.arrangement.targetNodeIds
    : [
        ...params.task.nodes.map((node, index) => getTaskNodeClientId(node, index)),
        ...targetNodeIds(params),
      ]
  if (targetNodeRefs.length === 0) return []
  return [
    {
      type: 'layout_nodes',
      operationId: 'arrange:preset',
      nodeIds: targetNodeRefs.map((nodeRef) =>
        resolveArrangementNodeRef({ value: nodeRef, selectedNodeIds: params.selectedNodeIds })
      ),
      direction: params.arrangement.preset ?? 'horizontal',
    },
  ]
}

function compileArrangeOperations(params: {
  task: HermesCanvasTaskPayload
  selectedNodeIds: string[]
  snapshot: CanvasSnapshot
}): LocalCanvasPatchOperation[] {
  if (!params.task.arrangement) return []

  if (params.task.arrangement.layoutMode === 'absolute') {
    return compileAbsoluteArrangementOperations({
      placements: params.task.arrangement.placements,
      selectedNodeIds: params.selectedNodeIds,
    })
  }

  if (params.task.arrangement.layoutMode === 'structured') {
    return compileStructuredArrangementOperations({
      arrangement: params.task.arrangement,
      selectedNodeIds: params.selectedNodeIds,
    })
  }

  return compilePresetArrangementOperations({
    arrangement: params.task.arrangement,
    task: params.task,
    selectedNodeIds: params.selectedNodeIds,
    snapshot: params.snapshot,
  })
}

function resolveGenerationTarget(params: {
  target: TaskTargetRef
  task: HermesCanvasTaskPayload
  selectedNodeIds: string[]
}): LocalCanvasGenerationTarget | string {
  if (typeof params.target !== 'string') {
    if (params.target.type === 'created_node') {
      const clientNodeId = params.target.clientNodeId
      const node = params.task.nodes.find(
        (item, index) => getTaskNodeClientId(item, index) === clientNodeId
      )
      return {
        clientNodeId,
        ...(node ? { kind: node.kind } : {}),
        reason: 'Generate output for the created canvas node after confirmation.',
      }
    }
    return resolveNodeRef({ ref: params.target, selectedNodeIds: params.selectedNodeIds })
  }

  const createdClientIds = new Set(params.task.nodes.map(getTaskNodeClientId))
  if (createdClientIds.has(params.target)) {
    const node = params.task.nodes.find(
      (item, index) => getTaskNodeClientId(item, index) === params.target
    )
    return {
      clientNodeId: params.target,
      ...(node ? { kind: node.kind } : {}),
      reason: 'Generate output for the created canvas node after confirmation.',
    }
  }
  return params.target
}

function compileGenerationTargets(params: {
  task: HermesCanvasTaskPayload
  selectedNodeIds: string[]
}): {
  generateNodeIds: string[]
  generationTargets: LocalCanvasGenerationTarget[]
} {
  const targets =
    params.task.generation?.targets.length || params.task.taskType !== 'output_generate'
      ? (params.task.generation?.targets ?? [])
      : params.task.nodeRefs
  const generateNodeIds: string[] = []
  const generationTargets: LocalCanvasGenerationTarget[] = []

  for (const target of targets) {
    const resolved = resolveGenerationTarget({
      target,
      task: params.task,
      selectedNodeIds: params.selectedNodeIds,
    })
    if (typeof resolved === 'string') {
      generateNodeIds.push(resolved)
    } else {
      generationTargets.push(resolved)
    }
  }

  if (targets.length === 0 && params.task.taskType === 'create_chain') {
    for (const node of params.task.nodes) {
      if (node.kind === 'image' || node.kind === 'video' || node.kind === 'audio') {
        generationTargets.push({
          clientNodeId: getTaskNodeClientId(node, params.task.nodes.indexOf(node)),
          kind: node.kind,
          reason: 'Generate output for the created media node after confirmation.',
        })
      }
    }
  }

  return {
    generateNodeIds: generateNodeIds.filter(
      (nodeId, index, items) => items.indexOf(nodeId) === index
    ),
    generationTargets: generationTargets.filter((target) => target.clientNodeId || target.nodeId),
  }
}

function outputTypeToNodeKind(
  outputType:
    | HermesCanvasTaskPayload['outputType']
    | NonNullable<HermesCanvasTaskPayload['generation']>['outputType']
): LocalCanvasNodeKind | null {
  if (
    outputType === 'text' ||
    outputType === 'image' ||
    outputType === 'video' ||
    outputType === 'audio'
  ) {
    return outputType
  }
  return null
}

function taskHasImageGenerationReference(task: HermesCanvasTaskPayload): boolean {
  return (task.generation?.references ?? []).some(
    (reference) =>
      reference.type === 'image' ||
      (reference.type !== 'node_output' && resourceMediaType(reference).startsWith('image/')) ||
      reference.type === 'node_output'
  )
}

function compileGenerationPromptUpdateOperations(params: {
  task: HermesCanvasTaskPayload
  selectedNodeIds: string[]
  snapshot: CanvasSnapshot
}): LocalCanvasPatchOperation[] {
  const prompt =
    stringValue(params.task.generation?.prompt) || stringValue(params.task.content?.prompt)
  if (!prompt) return []
  const outputKind = outputTypeToNodeKind(
    params.task.generation?.outputType ?? params.task.outputType
  )
  const targets =
    params.task.generation?.targets.length || params.task.taskType !== 'output_generate'
      ? (params.task.generation?.targets ?? [])
      : params.task.nodeRefs
  return targets.flatMap((target) => {
    const nodeId =
      typeof target === 'string'
        ? target
        : resolveNodeRef({ ref: target, selectedNodeIds: params.selectedNodeIds })
    const kind = outputKind ?? lookupNodeKind(params.snapshot, nodeId)
    if (!kind) return []
    const generationParams = {
      ...(params.task.generation?.params ?? {}),
      ...(kind === 'image' &&
      taskHasImageGenerationReference(params.task) &&
      params.task.generation?.params?.aiModel === undefined
        ? { aiModel: 'gemini-3.1-flash-image-preview' }
        : {}),
    }
    const fields = mergeContentFields({
      kind,
      content: { prompt },
      fields: generationParams,
    })
    return Object.keys(fields).length
      ? [
          {
            type: 'update_node',
            operationId: `generation_prompt:${nodeId}`,
            nodeId,
            fields,
          } satisfies LocalCanvasPatchOperation,
        ]
      : []
  })
}

function referenceRoleForGeneration(params: {
  targetKind: LocalCanvasNodeKind | null
  sourceKind: LocalCanvasNodeKind | null
}): TaskReference['role'] {
  if (params.targetKind === 'video' && params.sourceKind === 'image') return 'video_first_frame'
  if (params.targetKind === 'image' && params.sourceKind === 'image') return 'image_reference'
  if (params.targetKind === 'audio') return 'text_context'
  return 'text_context'
}

function kindForResourceReference(
  reference: HermesCanvasResourceRef,
  snapshot: CanvasSnapshot,
  sourceNodeId: string
): LocalCanvasNodeKind | null {
  if (reference.type !== 'node_output') return isImageResource(reference) ? 'image' : 'text'
  return lookupNodeKind(snapshot, sourceNodeId)
}

function compileGenerationReferenceOperations(params: {
  task: HermesCanvasTaskPayload
  selectedNodeIds: string[]
  snapshot: CanvasSnapshot
  materializedResourceNodeIds: Map<string, string>
}): LocalCanvasPatchOperation[] {
  const references = params.task.generation?.references ?? []
  if (!references.length) return []
  const targets =
    params.task.generation?.targets.length || params.task.taskType !== 'output_generate'
      ? (params.task.generation?.targets ?? [])
      : params.task.nodeRefs
  const outputKind = outputTypeToNodeKind(
    params.task.generation?.outputType ?? params.task.outputType
  )
  const operations: LocalCanvasPatchOperation[] = []

  for (const target of targets) {
    const consumerNodeId =
      typeof target === 'string'
        ? target
        : resolveNodeRef({ ref: target, selectedNodeIds: params.selectedNodeIds })
    const targetKind = outputKind ?? lookupNodeKind(params.snapshot, consumerNodeId)
    for (const [index, reference] of references.entries()) {
      const sourceNodeId = resolveResourceAsNodeId({
        resource: reference,
        selectedNodeIds: params.selectedNodeIds,
        materializedResourceNodeIds: params.materializedResourceNodeIds,
      })
      const sourceKind = kindForResourceReference(reference, params.snapshot, sourceNodeId)
      operations.push({
        type: 'add_content_reference',
        operationId: `generation_reference:${consumerNodeId}:${index + 1}`,
        consumerNodeId,
        sourceNodeId,
        role: referenceRoleForGeneration({ targetKind, sourceKind }),
      })
    }
  }

  return operations
}

function summarizeCompiledTask(params: {
  task: HermesCanvasTaskPayload
  patch?: LocalCanvasPatch
  generateNodeIds?: string[]
  generationTargets?: LocalCanvasGenerationTarget[]
}): string {
  const operations = params.patch?.operations ?? []
  const lines = [
    `任务类型：${params.task.taskType}`,
    params.task.goal ? `目标：${params.task.goal}` : '',
    operations.length ? `画布修改：${operations.length} 个 patch operation` : '',
    ...(operations.length
      ? operations.map((operation, index) => `- ${index + 1}. ${operation.type}`)
      : []),
    params.generateNodeIds?.length ? `生成已有节点：${params.generateNodeIds.join(', ')}` : '',
    params.generationTargets?.length
      ? `生成新建节点：${params.generationTargets
          .map((target) => target.clientNodeId ?? target.nodeId)
          .filter(Boolean)
          .join(', ')}`
      : '',
  ].filter(Boolean)
  return lines.join('\n')
}

function compileCanvasTask(params: {
  task: HermesCanvasTaskPayload
  selectedNodeIds: string[]
  snapshot: CanvasSnapshot
}): CompiledCanvasTask {
  if (isShowPlanningPreset(params.task.fields) && params.task.taskType === 'create_chain') {
    const patch = {
      operations: buildShowPlanningScaffoldOperations(),
      reason: params.task.goal || 'Create the standard show-planning canvas scaffold.',
    } satisfies LocalCanvasPatch
    return {
      patch,
      generateNodeIds: [],
      generationTargets: buildShowPlanningScaffoldGenerationTargets(),
      proposedPatchSummary: summarizeCompiledTask({
        task: params.task,
        patch,
        generateNodeIds: [],
        generationTargets: [],
      }),
    }
  }

  const materializedResources = buildMaterializedResourceOperations({ task: params.task })
  const operations: LocalCanvasPatchOperation[] = [
    ...materializedResources.operations,
    ...compileCreateNodeOperations({ nodes: params.task.nodes, task: params.task }),
    ...compileUpdateOperations(params),
    ...compileArrangeOperations(params),
    ...compileDeleteOperations(params),
    ...compileConnectionOperations({ task: params.task, selectedNodeIds: params.selectedNodeIds }),
    ...compileReferenceOperations({
      task: params.task,
      selectedNodeIds: params.selectedNodeIds,
      materializedResourceNodeIds: materializedResources.resourceNodeIds,
    }),
    ...compileGenerationPromptUpdateOperations(params),
    ...compileGenerationReferenceOperations({
      ...params,
      materializedResourceNodeIds: materializedResources.resourceNodeIds,
    }),
    ...compileLayoutOperation(params),
  ]
  const patch = operations.length
    ? ({
        operations,
        reason: params.task.goal || `Compile SIM canvas task ${params.task.taskType}`,
      } satisfies LocalCanvasPatch)
    : undefined
  const generation = compileGenerationTargets({
    task: params.task,
    selectedNodeIds: params.selectedNodeIds,
  })
  return {
    patch,
    ...generation,
    proposedPatchSummary: summarizeCompiledTask({
      task: params.task,
      patch,
      ...generation,
    }),
  }
}

function buildPlan(params: {
  task: HermesCanvasTaskPayload
  compiled: CompiledCanvasTask
}): LocalAgentPlan {
  const hasGeneration =
    Boolean(params.compiled.generateNodeIds?.length) ||
    Boolean(params.compiled.generationTargets?.length)
  const steps = [
    ...(params.compiled.patch
      ? [
          {
            id: 'apply_patch',
            title: 'Apply SIM-compiled canvas patch',
            intent: 'update' as const,
            toolHints: ['canvas.apply_patch' as const],
            expectedObservation: 'Canvas patch is applied and verified.',
          },
        ]
      : []),
    ...(hasGeneration
      ? [
          {
            id: 'generate_outputs',
            title: 'Generate selected canvas node outputs',
            intent: 'generate' as const,
            toolHints: ['canvas.generate_node_output' as const],
            expectedObservation: 'Generated media or content is written back to the node.',
          },
        ]
      : []),
    {
      id: 'verify',
      title: 'Verify SIM canvas task result',
      intent: 'verify' as const,
      toolHints: ['canvas.verify_patch' as const],
      expectedObservation: 'SIM verifies the canvas writeback before final response.',
    },
  ]
  const requiresDeleteConfirmation = patchRequiresDeleteConfirmation(params.compiled.patch)

  return {
    goal: params.task.goal || 'Apply the SIM canvas task requested by Hermes.',
    risk: requiresDeleteConfirmation ? 'high' : params.task.risk,
    userIntent: hasGeneration ? 'generate_output' : 'mutate_canvas',
    mutationPolicy: requiresDeleteConfirmation ? 'propose_only' : 'allow_mutation',
    canvasReadPolicy: 'required',
    requiresUserConfirmation: requiresDeleteConfirmation,
    requiresClarification: false,
    steps,
    successCriteria: params.task.expectedChanges.length
      ? params.task.expectedChanges
      : ['The SIM canvas task is applied, generated if requested, and verified.'],
    ...(params.task.fields ? { checkpoint: readShowPlanningCheckpoint(params.task.fields) } : {}),
    ...(params.compiled.patch ? { patch: params.compiled.patch } : {}),
    ...(params.compiled.generateNodeIds?.length
      ? { generateNodeIds: params.compiled.generateNodeIds }
      : {}),
    ...(params.compiled.generationTargets?.length
      ? { generationTargets: params.compiled.generationTargets }
      : {}),
  }
}

function schemaForKind(kind: LocalCanvasNodeKind) {
  const adapter = getCanvasNodeAdapter(kind)
  return {
    kind,
    blockType: adapter.blockType,
    capabilities: {
      canRead: adapter.capabilities.canRead,
      canWrite: adapter.capabilities.canWrite,
      canGenerate: adapter.capabilities.canGenerate,
      canReferenceFile: adapter.capabilities.canReferenceFile,
    },
    writableFields: adapter.getEditableFields().map((field) => field.id),
    editableFields: adapter.getEditableFields().map((field) => ({ ...field })),
    generation: {
      supported: adapter.capabilities.canGenerate,
      inputFields:
        kind === 'text'
          ? ['contentHtml', 'aiPrompt']
          : kind === 'image'
            ? ['aiPrompt']
            : kind === 'video'
              ? ['videoPrompt', 'videoMedia', 'videoParameters']
              : kind === 'audio'
                ? ['audioPrompt', 'audioParameters']
                : kind === 'presentation'
                  ? [
                      'presentationPrompt',
                      'presentationSlideCountMode',
                      'presentationSlideCount',
                      'contentReferences',
                    ]
                  : [],
      outputField: adapter.capabilities.canGenerate ? 'file' : null,
      externalArtifactTool:
        kind === 'presentation' ? 'codex-ppt-skill + sim_presentation_artifact_upload' : null,
    },
  }
}

function buildCapabilityManifest() {
  const adapters = getCanvasNodeAdapters()
  return {
    contractVersion: '2026-06-15',
    supportedNodeTypes: adapters.map((adapter) => adapter.kind),
    writableNodeTypes: adapters
      .filter((adapter) => adapter.capabilities.canWrite)
      .map((adapter) => adapter.kind),
    generatableNodeTypes: adapters
      .filter((adapter) => adapter.capabilities.canGenerate)
      .map((adapter) => adapter.kind),
    supportedOutputTypes: ['text', 'image', 'video', 'audio'],
    externalArtifactOutputTypes: ['presentation'],
    supportedReferenceTypes: [
      'node_output',
      'uploaded_attachment',
      'url',
      'pdf',
      'image',
      'existing_node',
      'created_node',
      'selected_node',
    ],
    supportedTasks: [
      'canvas_query',
      'node_create',
      'node_update',
      'node_delete',
      'edge_connect',
      'content_reference_attach',
      'content_reference_remove',
      'output_generate',
      'workflow_run',
      'layout_nodes',
      'arrange_nodes',
      'batch',
      'preview_create',
      'preview_update',
      'preview_commit',
      'preview_discard',
      'create_nodes',
      'update_nodes',
      'delete_nodes',
      'connect_nodes',
      'reference_nodes',
      'create_chain',
      'generate_outputs',
    ],
    preview: {
      supported: true,
      currentBehavior:
        'preview_create stores a previewActionId for the current canvas session; preview_commit executes the validated SIM plan after user approval; preview_discard expires the stored preview.',
    },
    confirmationRequiredFor: ['delete_node', 'clear_canvas'],
  }
}

function queryAnswer(queryType: ParsedHermesCanvasTaskRunBody['queryType']): string {
  return `已完成 SIM 画布查询：${queryType}。`
}

async function runQuery(params: {
  body: ParsedHermesCanvasTaskRunBody
  auditId: string
  context: LocalAgentContext
}): Promise<HermesCanvasTaskRunResponse> {
  if (!params.context.permissions.canRead) {
    return {
      success: false,
      operation: 'query',
      answer: '',
      auditId: params.auditId,
      traceId: params.body.traceId,
      errorCode: 'USER_PERMISSION_DENIED',
      error: params.context.permissions.readonlyReason ?? 'Canvas access denied',
    }
  }

  const snapshot = await loadCanvasSnapshot({
    workflowId: params.context.workflowId,
    workspaceId: params.context.workspaceId,
  })
  const queryType = params.body.queryType
  const base = {
    queryType,
    workflowId: params.context.workflowId,
    workspaceId: params.context.workspaceId,
    nodeCount: snapshot.nodes.length,
    edgeCount: snapshot.edges.length,
  }
  let queryResult: NonNullable<
    Extract<HermesCanvasTaskRunResponse, { success: true }>['queryResult']
  >

  if (queryType === 'read_node') {
    const nodeId = params.body.nodeId
    const node = nodeId
      ? readCanvasNodeDetail(snapshot, nodeId, params.context.selectedNodeIds)
      : null
    queryResult = { ...base, node }
  } else if (queryType === 'read_selected') {
    const selectedNodeDetails = params.context.selectedNodeIds
      .map((nodeId) => readCanvasNodeDetail(snapshot, nodeId, params.context.selectedNodeIds))
      .filter((node): node is CanvasNodeDetail => Boolean(node))
    queryResult = { ...base, selectedNodeDetails }
  } else if (queryType === 'search_nodes') {
    const nodes = searchCanvasNodes({
      snapshot,
      query: params.body.query ?? params.body.message,
      selectedNodeIds: params.context.selectedNodeIds,
    })
    queryResult = { ...base, nodes }
  } else if (queryType === 'inspect_schema') {
    const kind = asNodeKind(params.body.query) ?? asNodeKind(params.body.nodeId) ?? 'text'
    queryResult = { ...base, schema: schemaForKind(kind) }
  } else if (queryType === 'inspect_capabilities') {
    queryResult = { ...base, capabilityManifest: buildCapabilityManifest() }
  } else {
    const nodes = summarizeCanvas(snapshot, params.context.selectedNodeIds)
    queryResult = {
      ...base,
      nodes,
      selectedNodeDetails: params.context.selectedNodeIds
        .map((nodeId) => readCanvasNodeDetail(snapshot, nodeId, params.context.selectedNodeIds))
        .filter((node): node is CanvasNodeDetail => Boolean(node)),
      summaryText: buildCanvasSummaryTextFromParts({
        workflowId: params.context.workflowId,
        nodes,
        edges: snapshot.edges,
      }),
    }
  }

  return {
    success: true,
    operation: 'query',
    answer: queryAnswer(queryType),
    requiresConfirmation: false,
    auditId: params.auditId,
    traceId: params.body.traceId,
    queryResult,
  }
}

async function runPropose(params: {
  body: ParsedHermesCanvasTaskRunBody
  auditId: string
  context: LocalAgentContext
}): Promise<HermesCanvasTaskRunResponse> {
  if (!params.context.permissions.canRead) {
    return {
      success: false,
      operation: 'propose',
      answer: '',
      auditId: params.auditId,
      traceId: params.body.traceId,
      errorCode: 'USER_PERMISSION_DENIED',
      error: params.context.permissions.readonlyReason ?? 'Canvas access denied',
    }
  }
  if (!params.body.task) {
    return errorResponse({
      body: params.body,
      auditId: params.auditId,
      errorCode: 'INVALID_TASK',
      error: 'task is required for propose operation',
    })
  }

  const prepared = await preparePlanFromTask(params)
  if (!prepared.success) return prepared.response
  const { compiled, plan } = prepared

  if (!plan.requiresUserConfirmation) {
    if (!params.context.permissions.canWrite) {
      return {
        success: false,
        operation: 'propose',
        answer: '',
        auditId: params.auditId,
        traceId: params.body.traceId,
        errorCode: 'USER_PERMISSION_DENIED',
        error: params.context.permissions.readonlyReason ?? 'Canvas write access denied',
      }
    }

    const observations = await executeConfirmedLocalAgentPlan(params.context, plan)
    const failedObservation = observations.find((observation) => !observation.success)
    const changedNodeIds = collectChangedNodeIds(observations)
    const generatedNodeIds = collectGeneratedNodeIds(observations)
    const verificationSummary = buildVerificationSummary(observations)
    const createdNodeMap = collectCreatedNodeMap(observations)
    const generatedOutputs = collectGeneratedOutputs(observations)

    if (failedObservation) {
      return {
        success: false,
        operation: 'propose',
        answer: `SIM 画布任务执行失败：${failedObservation.summary}`,
        risk: plan.risk,
        requiresConfirmation: false,
        proposedPatchSummary: compiled.proposedPatchSummary,
        changedNodeIds,
        generatedNodeIds,
        createdNodeMap,
        generatedOutputs,
        verificationSummary,
        auditId: params.auditId,
        traceId: params.body.traceId,
        errorCode: 'TOOL_EXECUTION_FAILED',
        error: failedObservation.summary,
      }
    }

    if (plan.checkpoint) {
      const pending = putLocalAgentPendingPlan({
        context: params.context,
        plan,
        source: 'hermes',
        kind: 'business_checkpoint',
      })

      return {
        success: true,
        operation: 'propose',
        answer: [
          'SIM 已完成当前策划阶段的写入与校验，正在等待结构化确认后再继续下一阶段。',
          plan.checkpoint.question,
          `执行摘要：\n${compiled.proposedPatchSummary}`,
        ].join('\n\n'),
        risk: plan.risk,
        requiresConfirmation: true,
        pendingActionId: pending.id,
        proposedPatchSummary: compiled.proposedPatchSummary,
        changedNodeIds,
        generatedNodeIds,
        createdNodeMap,
        generatedOutputs,
        verificationSummary,
        auditId: params.auditId,
        traceId: params.body.traceId,
      }
    }

    return {
      success: true,
      operation: 'propose',
      answer: [
        '已执行 Hermes 编译的 SIM 画布任务，并完成写入验证。',
        `执行摘要：\n${compiled.proposedPatchSummary}`,
      ].join('\n\n'),
      risk: plan.risk,
      requiresConfirmation: false,
      proposedPatchSummary: compiled.proposedPatchSummary,
      changedNodeIds,
      generatedNodeIds,
      createdNodeMap,
      generatedOutputs,
      verificationSummary,
      auditId: params.auditId,
      traceId: params.body.traceId,
    }
  }

  const pending = putLocalAgentPendingPlan({
    context: params.context,
    plan,
    source: 'hermes',
  })

  return {
    success: true,
    operation: 'propose',
    answer: [
      '已将 Hermes 删除/清空类画布任务编译为 SIM 可执行方案，等待用户确认后执行。',
      `建议摘要：\n${compiled.proposedPatchSummary}`,
      '当前没有执行任何画布写入。',
    ].join('\n\n'),
    risk: params.body.task.risk,
    requiresConfirmation: true,
    pendingActionId: pending.id,
    proposedPatchSummary: compiled.proposedPatchSummary,
    changedNodeIds: [],
    generatedNodeIds: [],
    verificationSummary: 'canvas-task proposal compiled and validated; no mutation executed.',
    auditId: params.auditId,
    traceId: params.body.traceId,
  }
}

async function preparePlanFromTask(params: {
  body: ParsedHermesCanvasTaskRunBody
  auditId: string
  context: LocalAgentContext
}): Promise<
  | { success: true; compiled: CompiledCanvasTask; plan: LocalAgentPlan }
  | { success: false; response: HermesCanvasTaskRunResponse }
> {
  if (!params.body.task) {
    return {
      success: false,
      response: errorResponse({
        body: params.body,
        auditId: params.auditId,
        errorCode: 'INVALID_TASK',
        error: 'task is required for canvas task compilation',
      }),
    }
  }

  const snapshot = await loadCanvasSnapshot({
    workflowId: params.context.workflowId,
    workspaceId: params.context.workspaceId,
  })
  const showPlanningFirstWriteError = validateShowPlanningFirstWrite({
    body: params.body,
    task: params.body.task,
    snapshot,
  })
  if (showPlanningFirstWriteError) {
    return {
      success: false,
      response: errorResponse({
        body: params.body,
        auditId: params.auditId,
        errorCode: 'INVALID_TASK',
        error: showPlanningFirstWriteError,
        answer: showPlanningFirstWriteError,
        risk: params.body.task.risk,
      }),
    }
  }

  let compiled: CompiledCanvasTask
  try {
    compiled = compileCanvasTask({
      task: params.body.task,
      selectedNodeIds: params.context.selectedNodeIds,
      snapshot,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SIM canvas task compilation failed'
    return {
      success: false,
      response: errorResponse({
        body: params.body,
        auditId: params.auditId,
        errorCode: 'INVALID_TASK',
        error: message,
        risk: params.body.task.risk,
      }),
    }
  }

  if (!compiled.patch && !compiled.generateNodeIds?.length && !compiled.generationTargets?.length) {
    return {
      success: false,
      response: errorResponse({
        body: params.body,
        auditId: params.auditId,
        errorCode: 'INVALID_TASK',
        error: 'SIM canvas task did not compile to a patch or generation target',
        risk: params.body.task.risk,
      }),
    }
  }

  if (compiled.patch) {
    const validation = validateLocalCanvasPatch(compiled.patch, snapshot)
    if (!validation.valid) {
      const error = validation.errors.join('; ')
      return {
        success: false,
        response: {
          success: false,
          operation: params.body.operation,
          answer: `SIM 画布任务未通过 patch 校验：${error}`,
          auditId: params.auditId,
          traceId: params.body.traceId,
          errorCode: 'PATCH_VALIDATION_FAILED',
          error,
          risk: params.body.task.risk,
          requiresConfirmation: false,
          proposedPatchSummary: compiled.proposedPatchSummary,
          changedNodeIds: [],
          generatedNodeIds: [],
          verificationSummary: `canvas-task validation failed: ${error}`,
        },
      }
    }
  }

  return {
    success: true,
    compiled,
    plan: buildPlan({
      task: params.body.task,
      compiled,
    }),
  }
}

async function runApplyPending(params: {
  body: ParsedHermesCanvasTaskRunBody
  auditId: string
  abortSignal?: AbortSignal
}): Promise<HermesCanvasTaskRunResponse> {
  if (!params.body.pendingActionId) {
    return errorResponse({
      body: params.body,
      auditId: params.auditId,
      errorCode: 'INVALID_TASK',
      error: 'pendingActionId is required for apply_pending operation',
    })
  }

  const result = await runLocalCanvasAgentHeadless({
    userId: params.body.userId,
    organizationId: params.body.organizationId,
    workspaceId: params.body.workspaceId,
    workflowId: params.body.workflowId,
    chatId: params.body.chatId,
    message: params.body.message,
    selectedNodeIds: params.body.selectedNodeIds,
    mode: 'apply_after_confirm',
    confirmationMode: 'manual',
    pendingActionId: params.body.pendingActionId,
    traceId: params.body.traceId,
    hermesRunId: params.body.hermesRunId,
    auditId: params.auditId,
    metadata: params.body.metadata,
    abortSignal: params.abortSignal,
  })

  return {
    success: result.success,
    operation: 'apply_pending',
    answer: result.answer,
    risk: result.risk,
    requiresConfirmation: result.requiresConfirmation,
    pendingActionId: result.pendingActionId,
    proposedPatchSummary: result.proposedPatchSummary,
    changedNodeIds: result.changedNodeIds,
    generatedNodeIds: result.generatedNodeIds,
    verificationSummary: result.verificationSummary,
    auditId: result.auditId,
    traceId: result.traceId,
    ...(result.success
      ? {}
      : {
          errorCode: result.errorCode,
          error: result.error,
        }),
  } as HermesCanvasTaskRunResponse
}

async function runPreviewCreate(params: {
  body: ParsedHermesCanvasTaskRunBody
  auditId: string
  context: LocalAgentContext
}): Promise<HermesCanvasTaskRunResponse> {
  if (!params.context.permissions.canRead) {
    return errorResponse({
      body: params.body,
      auditId: params.auditId,
      errorCode: 'USER_PERMISSION_DENIED',
      error: params.context.permissions.readonlyReason ?? 'Canvas access denied',
    })
  }
  const prepared = await preparePlanFromTask(params)
  if (!prepared.success) return prepared.response
  const preview = putLocalAgentPreviewPlan({
    context: params.context,
    plan: prepared.plan,
  })
  return {
    success: true,
    operation: params.body.operation,
    answer: [
      '已创建 SIM 画布预览方案，当前没有提交正式画布写入。',
      `预览摘要：\n${prepared.compiled.proposedPatchSummary}`,
      '如用户确认保留该方案，请调用 preview_commit；如用户取消，请调用 preview_discard。',
    ].join('\n\n'),
    risk: params.body.task?.risk,
    requiresConfirmation: true,
    previewActionId: preview.id,
    proposedPatchSummary: prepared.compiled.proposedPatchSummary,
    changedNodeIds: [],
    generatedNodeIds: [],
    verificationSummary: 'preview stored; no canvas mutation executed.',
    auditId: params.auditId,
    traceId: params.body.traceId,
  }
}

async function runPreviewDiscard(params: {
  body: ParsedHermesCanvasTaskRunBody
  auditId: string
  context: LocalAgentContext
}): Promise<HermesCanvasTaskRunResponse> {
  if (!params.body.previewActionId) {
    return errorResponse({
      body: params.body,
      auditId: params.auditId,
      errorCode: 'CONFIRMATION_REQUIRED',
      error: 'previewActionId is required for preview_discard operation',
      answer: '丢弃预览前需要 previewActionId。',
    })
  }
  const consumed = consumeLocalAgentPreviewPlan({
    context: params.context,
    previewActionId: params.body.previewActionId,
  })
  if (consumed.status !== 'found') {
    return errorResponse({
      body: params.body,
      auditId: params.auditId,
      errorCode:
        consumed.status === 'id_mismatch' ? 'CONFIRMATION_SUPERSEDED' : 'CONFIRMATION_EXPIRED',
      error:
        consumed.status === 'id_mismatch'
          ? 'Preview action id does not match the latest preview for the current canvas session'
          : 'Preview action was not found for the current canvas session',
      answer:
        consumed.status === 'id_mismatch'
          ? '这个预览已被更新的预览方案替代，请使用最新的 previewActionId。'
          : '这个预览已经过期或不属于当前画布会话，请重新生成预览方案。',
    })
  }
  return {
    success: true,
    operation: params.body.operation,
    answer: '已丢弃当前 SIM 画布预览方案，没有执行画布写入。',
    requiresConfirmation: false,
    previewActionId: params.body.previewActionId,
    changedNodeIds: [],
    generatedNodeIds: [],
    auditId: params.auditId,
    traceId: params.body.traceId,
    verificationSummary: 'preview discarded.',
  }
}

async function runPreviewCommit(params: {
  body: ParsedHermesCanvasTaskRunBody
  auditId: string
  context: LocalAgentContext
}): Promise<HermesCanvasTaskRunResponse> {
  if (!params.body.previewActionId) {
    return errorResponse({
      body: params.body,
      auditId: params.auditId,
      errorCode: 'CONFIRMATION_REQUIRED',
      error: 'previewActionId is required for preview_commit operation',
      answer: '提交预览前需要 previewActionId。',
    })
  }
  if (!params.context.permissions.canRead || !params.context.permissions.canWrite) {
    return errorResponse({
      body: params.body,
      auditId: params.auditId,
      errorCode: 'USER_PERMISSION_DENIED',
      error: params.context.permissions.readonlyReason ?? 'Canvas write access denied',
    })
  }

  const consumed = consumeLocalAgentPreviewPlan({
    context: params.context,
    previewActionId: params.body.previewActionId,
  })
  if (consumed.status !== 'found') {
    return errorResponse({
      body: params.body,
      auditId: params.auditId,
      errorCode:
        consumed.status === 'id_mismatch' ? 'CONFIRMATION_SUPERSEDED' : 'CONFIRMATION_EXPIRED',
      error:
        consumed.status === 'id_mismatch'
          ? 'Preview action id does not match the latest preview for the current canvas session'
          : 'Preview action was not found for the current canvas session',
      answer:
        consumed.status === 'id_mismatch'
          ? '这个预览已被更新的预览方案替代，请使用最新的 previewActionId。'
          : '这个预览已经过期或不属于当前画布会话，请重新生成预览方案。',
    })
  }

  const observations = await executeConfirmedLocalAgentPlan(params.context, consumed.pending.plan)
  const failedObservation = observations.find((observation) => !observation.success)
  const changedNodeIds = collectChangedNodeIds(observations)
  const generatedNodeIds = collectGeneratedNodeIds(observations)
  const verificationSummary = buildVerificationSummary(observations)
  const createdNodeMap = collectCreatedNodeMap(observations)
  const generatedOutputs = collectGeneratedOutputs(observations)

  if (failedObservation) {
    return {
      success: false,
      operation: params.body.operation,
      answer: `预览提交失败：${failedObservation.summary}`,
      risk: consumed.pending.plan.risk,
      requiresConfirmation: false,
      previewActionId: params.body.previewActionId,
      changedNodeIds,
      generatedNodeIds,
      createdNodeMap,
      generatedOutputs,
      verificationSummary,
      auditId: params.auditId,
      traceId: params.body.traceId,
      errorCode: 'TOOL_EXECUTION_FAILED',
      error: failedObservation.summary,
    }
  }

  return {
    success: true,
    operation: params.body.operation,
    answer: '已提交 SIM 画布预览方案，并完成写入与验证。',
    risk: consumed.pending.plan.risk,
    requiresConfirmation: false,
    previewActionId: params.body.previewActionId,
    changedNodeIds,
    generatedNodeIds,
    createdNodeMap,
    generatedOutputs,
    verificationSummary,
    auditId: params.auditId,
    traceId: params.body.traceId,
  }
}

export async function runHermesCanvasTaskGateway(params: {
  body: ParsedHermesCanvasTaskRunBody
  auditId: string
  abortSignal?: AbortSignal
}): Promise<HermesCanvasTaskRunResponse> {
  if (params.body.operation === 'apply_pending') {
    return runApplyPending(params)
  }

  const context = await resolveTaskContext({
    body: params.body,
    abortSignal: params.abortSignal,
  })

  if (params.body.operation === 'query') {
    return runQuery({ body: params.body, auditId: params.auditId, context })
  }

  if (params.body.operation === 'preview_create' || params.body.operation === 'preview_update') {
    return runPreviewCreate({ body: params.body, auditId: params.auditId, context })
  }

  if (params.body.operation === 'preview_discard') {
    return runPreviewDiscard({ body: params.body, auditId: params.auditId, context })
  }

  if (params.body.operation === 'preview_commit') {
    return runPreviewCommit({ body: params.body, auditId: params.auditId, context })
  }

  return runPropose({ body: params.body, auditId: params.auditId, context })
}
