import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { z } from 'zod'
import { getContentCanvasModelAvailabilityForRuntime } from '@/lib/content-canvas/service-config'
import {
  executeContentCanvasTextRequest,
  generateContentCanvasText,
} from '@/lib/content-canvas/text-executor'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
  MothershipStreamV1ToolExecutor,
  MothershipStreamV1ToolMode,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { EditWorkflow } from '@/lib/copilot/generated/tool-catalog-v1'
import { setTerminalToolCallState } from '@/lib/copilot/request/tool-call-state'
import type {
  ActionEventName,
  ExecutionContext,
  OptionItem,
  OrchestratorOptions,
  StreamingContext,
  ToolCallState,
} from '@/lib/copilot/request/types'
import { editWorkflowServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow'
import type {
  EditWorkflowOperation,
  EditWorkflowParams,
} from '@/lib/copilot/tools/server/workflow/edit-workflow/types'
import { generateWorkspaceAudioFromPrompt } from '@/lib/generated-media/audio/audio-generation-service'
import {
  DEFAULT_AUDIO_MODEL,
  DEFAULT_AUDIO_PARAMETERS,
} from '@/lib/generated-media/audio/audio-generation-utils'
import { generateWorkspaceImageFromPrompt } from '@/lib/generated-media/image/image-generation-service'
import { generateWorkspaceVideoFromPrompt } from '@/lib/generated-media/video/video-generation-service'
import {
  DEFAULT_VIDEO_DURATION_SECONDS,
  DEFAULT_VIDEO_FRAME_ASPECT_RATIO_PRESET,
  DEFAULT_VIDEO_MODEL_FAMILY,
  DEFAULT_VIDEO_RESOLUTION,
  resolveVideoGenerationModelId,
} from '@/lib/generated-media/video/video-generation-utils'
import { type ContentNodeVariant, getContentNodePreset } from '@/lib/product/content-node-presets'
import { getOrdinaryContentReferenceHandles } from '@/lib/workflows/content-reference-edges'
import {
  buildTextNodeAiSystemPrompt,
  convertGeneratedTextToContentHtml,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/text-content-ai-utils'
import { normalizeName, RESERVED_BLOCK_NAMES } from '@/executor/constants'
import type { ProviderResponse } from '@/providers/types'
import { extractAndParseJSON } from '@/providers/utils'

const logger = createLogger('ContentCanvasAgent')

const TEXT_MODEL_FALLBACK = 'gemini-3.1-flash-lite-preview'
const IMAGE_MODEL_FALLBACK = 'jimeng-4.5'
const DEFAULT_CONFIRM_MESSAGES = /^(确认|继续|执行|开始执行|可以执行|yes|confirm|go ahead|run it)$/i
const PENDING_PLAN_TTL_MS = 30 * 60 * 1000
const NODE_GAP_X = 360
const NODE_GAP_Y = 220
const DEFAULT_CONFIRM_MESSAGES_V2 =
  /^(确认|继续|执行|开始执行|可以执行|yes|confirm|go ahead|run it)$/i
const CONFIRM_COMMAND_PREFIX = '__content_canvas_confirm__:'
const REVISE_COMMAND_PREFIX = '__content_canvas_revise__:'
const CONFIRM_MESSAGE_PATTERN =
  /^(\u786e\u8ba4|\u7ee7\u7eed|\u6267\u884c|\u5f00\u59cb\u6267\u884c|\u53ef\u4ee5\u6267\u884c|yes|confirm|go ahead|run it)$/i

type AgentOptions = Pick<OrchestratorOptions, 'abortSignal' | 'onEvent'>

interface ContentCanvasBlockSnapshot {
  id: string
  name: string
  type: 'content'
  variant: ContentNodeVariant
  position: { x: number; y: number }
  values: Record<string, unknown>
}

interface ContentCanvasSnapshot {
  blocks: ContentCanvasBlockSnapshot[]
  edges: Array<{
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
  }>
}

interface EditWorkflowExecutionOutput {
  success?: boolean
  workflowState?: Record<string, unknown>
  skippedItems?: string[]
  skippedItemsMessage?: string
  inputValidationErrors?: string[]
  inputValidationMessage?: string
}

interface PlannerMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

const planActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add_node'),
    clientNodeId: z.string().min(1),
    nodeType: z.enum(['text', 'image', 'video', 'audio']),
    title: z.string().optional(),
    contentText: z.string().optional(),
    prompt: z.string().optional(),
    targetBlockId: z.string().optional(),
  }),
  z.object({
    type: z.literal('update_node'),
    blockId: z.string().min(1),
    title: z.string().optional(),
    contentText: z.string().optional(),
    prompt: z.string().optional(),
  }),
  z.object({
    type: z.literal('delete_node'),
    blockId: z.string().min(1),
  }),
  z.object({
    type: z.literal('connect_nodes'),
    sourceBlockId: z.string().min(1),
    targetBlockId: z.string().min(1),
  }),
  z.object({
    type: z.literal('layout_nodes'),
    direction: z.enum(['horizontal', 'vertical', 'grid']).default('horizontal'),
    blockIds: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal('generate_node_output'),
    blockId: z.string().min(1),
    textApplyMode: z.enum(['replace', 'append']).optional(),
  }),
])

const legacyContentCanvasPlanSchema = z.object({
  assistantText: z.string().catch(''),
  summary: z.string().catch(''),
  actions: z.array(planActionSchema).catch([]),
})

type LegacyContentCanvasPlan = z.infer<typeof legacyContentCanvasPlanSchema>
type ContentCanvasPlanAction = LegacyContentCanvasPlan['actions'][number]

const contentCanvasTaskIntentSchema = z.object({
  mode: z
    .enum([
      'analyze',
      'build_from_scratch',
      'modify_existing',
      'extend_selection',
      'layout_local_cluster',
    ])
    .catch('modify_existing'),
  summary: z.string().catch(''),
  shouldExecute: z.boolean().catch(true),
  risk: z.enum(['low', 'high']).catch('low'),
})

const contentCanvasTaskStepSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('create_node'),
    clientNodeId: z.string().min(1),
    nodeType: z.enum(['text', 'image', 'video', 'audio']),
    title: z.string().optional(),
    contentText: z.string().optional(),
    prompt: z.string().optional(),
    targetBlockId: z.string().optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('update_node'),
    blockId: z.string().min(1),
    title: z.string().optional(),
    contentText: z.string().optional(),
    prompt: z.string().optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('connect_nodes'),
    sourceBlockId: z.string().min(1),
    targetBlockId: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('layout_nodes'),
    direction: z.enum(['horizontal', 'vertical', 'grid']).default('horizontal'),
    blockIds: z.array(z.string()).optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('generate_output'),
    blockId: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('writeback_output'),
    blockId: z.string().min(1),
    textApplyMode: z.enum(['replace', 'append']).optional(),
  }),
])

const contentCanvasTaskPlanSchema = z.object({
  assistantText: z.string().catch(''),
  summary: z.string().catch(''),
  intent: contentCanvasTaskIntentSchema.catch({
    mode: 'modify_existing',
    summary: '',
    shouldExecute: true,
    risk: 'low',
  }),
  steps: z.array(contentCanvasTaskStepSchema).catch([]),
})

type ContentCanvasTaskIntent = z.infer<typeof contentCanvasTaskIntentSchema>
type ContentCanvasTaskStep = z.infer<typeof contentCanvasTaskStepSchema>
type ContentCanvasTaskPlan = z.infer<typeof contentCanvasTaskPlanSchema>

const contentCanvasActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_node'),
    clientNodeId: z.string().min(1),
    nodeType: z.enum(['text', 'image', 'video', 'audio']),
    title: z.string().optional(),
    contentText: z.string().optional(),
    prompt: z.string().optional(),
    targetBlockId: z.string().optional(),
  }),
  z.object({
    type: z.literal('update_node'),
    blockId: z.string().min(1),
    title: z.string().optional(),
    contentText: z.string().optional(),
    prompt: z.string().optional(),
  }),
  z.object({
    type: z.literal('connect_nodes'),
    sourceBlockId: z.string().min(1),
    targetBlockId: z.string().min(1),
  }),
  z.object({
    type: z.literal('layout_nodes'),
    direction: z.enum(['horizontal', 'vertical', 'grid']).default('horizontal'),
    blockIds: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal('generate_output'),
    blockId: z.string().min(1),
  }),
  z.object({
    type: z.literal('writeback_output'),
    blockId: z.string().min(1),
    textApplyMode: z.enum(['replace', 'append']).optional(),
  }),
])
type ContentCanvasAction = z.infer<typeof contentCanvasActionSchema>

const contentCanvasActionBatchSchema = z.object({
  assistantText: z.string().catch(''),
  shouldContinue: z.boolean().catch(false),
  actions: z.array(contentCanvasActionSchema).max(3).catch([]),
  repairHint: z.string().optional(),
})

type ContentCanvasActionBatch = z.infer<typeof contentCanvasActionBatchSchema>

interface ContentCanvasActionDecision {
  batch: ContentCanvasActionBatch
  compatibilityPlan?: ContentCanvasTaskPlan
}

type ContentCanvasRequestKind =
  | 'create'
  | 'edit-selection'
  | 'edit-existing'
  | 'connect'
  | 'layout'
  | 'analyze-only'
  | 'out-of-scope'

interface ContentCanvasActorConfig {
  model: string
  mode: 'structured' | 'tool-call'
  useContentCanvasTextResolver?: boolean
}

type ContentCanvasActorFailureCode =
  | 'empty_actions'
  | 'invalid_action_schema'
  | 'missing_create_for_create_intent'
  | 'invalid_target_block'
  | 'missing_generate_pair'
  | 'missing_update_for_edit_intent'
  | 'missing_connect_for_connect_intent'
  | 'missing_layout_for_layout_intent'
  | 'analyze_only_with_actions'
  | 'out_of_scope_request'
  | 'invalid_selection_target'

class ContentCanvasActorError extends Error {
  code: ContentCanvasActorFailureCode

  constructor(code: ContentCanvasActorFailureCode, message: string) {
    super(message)
    this.code = code
    this.name = 'ContentCanvasActorError'
  }
}

type GenericGoalFallbackModality = Extract<ContentNodeVariant, 'image' | 'video' | 'audio'>

interface GenericGoalFallbackIntent {
  sourceGoal: string
  chinese: boolean
  requestedModalities: GenericGoalFallbackModality[]
}

interface GenericGoalFallbackChainNode {
  clientNodeId: string
  nodeType: ContentNodeVariant
  title: string
  prompt: string
}

interface DeterministicCreateFallbackNode {
  clientNodeId: string
  nodeType: ContentNodeVariant
  title: string
  prompt?: string
  contentText?: string
  shouldGenerate: boolean
}

interface PendingPlanEntry {
  pendingPlanId: string
  chatKey: string
  workflowId: string
  plan: ContentCanvasTaskPlan
  sourceMessage: string
  createdAt: number
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

const pendingPlans = new Map<string, PendingPlanEntry>()

function isChineseMessage(message: string): boolean {
  return /[\u4e00-\u9fff]/.test(message)
}

function isConfirmationMessage(message: string): boolean {
  return (
    DEFAULT_CONFIRM_MESSAGES.test(message.trim()) ||
    DEFAULT_CONFIRM_MESSAGES_V2.test(message.trim()) ||
    CONFIRM_MESSAGE_PATTERN.test(message.trim())
  )
}

function parsePendingPlanCommand(
  message: string
): { action: 'confirm' | 'revise'; pendingPlanId: string } | null {
  const trimmed = message.trim()
  if (trimmed.startsWith(CONFIRM_COMMAND_PREFIX)) {
    return {
      action: 'confirm',
      pendingPlanId: trimmed.slice(CONFIRM_COMMAND_PREFIX.length),
    }
  }
  if (trimmed.startsWith(REVISE_COMMAND_PREFIX)) {
    return {
      action: 'revise',
      pendingPlanId: trimmed.slice(REVISE_COMMAND_PREFIX.length),
    }
  }
  return null
}

function buildPendingPlanCommand(action: 'confirm' | 'revise', pendingPlanId: string): string {
  return `${action === 'confirm' ? CONFIRM_COMMAND_PREFIX : REVISE_COMMAND_PREFIX}${pendingPlanId}`
}

function getPendingPlan(chatKey: string): PendingPlanEntry | null {
  const current = pendingPlans.get(chatKey)
  if (!current) return null
  if (Date.now() - current.createdAt > PENDING_PLAN_TTL_MS) {
    pendingPlans.delete(chatKey)
    return null
  }
  return current
}

function setPendingPlan(entry: PendingPlanEntry) {
  pendingPlans.set(entry.chatKey, entry)
}

function clearPendingPlan(chatKey: string) {
  pendingPlans.delete(chatKey)
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getNumberValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function getRecordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined
  return (value as Record<string, unknown>)[key]
}

function getValue<T>(values: Record<string, unknown>, key: string, fallback: T): T {
  return (values[key] ?? fallback) as T
}

function extractSubBlockValues(block: Record<string, unknown>): Record<string, unknown> {
  const subBlocks = getRecordValue(block, 'subBlocks')
  if (!subBlocks || typeof subBlocks !== 'object') {
    return {}
  }

  return Object.fromEntries(
    Object.entries(subBlocks as Record<string, unknown>)
      .map(([key, subBlock]) => [key, getRecordValue(subBlock, 'value')])
      .filter(([, value]) => value !== undefined)
  )
}

function getPositionValue(value: unknown): { x: number; y: number } {
  if (!value || typeof value !== 'object') {
    return { x: 0, y: 0 }
  }

  return {
    x: getNumberValue(getRecordValue(value, 'x')) ?? 0,
    y: getNumberValue(getRecordValue(value, 'y')) ?? 0,
  }
}

function parseContentCanvasSnapshot(rawBlocks: unknown, rawEdges: unknown): ContentCanvasSnapshot {
  const blocks =
    rawBlocks && typeof rawBlocks === 'object'
      ? Object.entries(rawBlocks as Record<string, unknown>).flatMap(([id, rawBlock]) => {
          if (!rawBlock || typeof rawBlock !== 'object') return []
          const block = rawBlock as Record<string, unknown>
          if (getStringValue(getRecordValue(block, 'type')) !== 'content') return []
          const values = extractSubBlockValues(block)
          const variant = getStringValue(values.contentVariant)
          if (
            variant !== 'text' &&
            variant !== 'image' &&
            variant !== 'video' &&
            variant !== 'audio'
          ) {
            return []
          }

          return [
            {
              id,
              name: getStringValue(getRecordValue(block, 'name')) ?? `Content ${id.slice(0, 6)}`,
              type: 'content',
              variant,
              position: getPositionValue(getRecordValue(block, 'position')),
              values,
            } satisfies ContentCanvasBlockSnapshot,
          ]
        })
      : []

  const edges = Array.isArray(rawEdges)
    ? rawEdges.flatMap((edge) => {
        if (!edge || typeof edge !== 'object') return []
        const source = getStringValue(getRecordValue(edge, 'source'))
        const target = getStringValue(getRecordValue(edge, 'target'))
        if (!source || !target) return []
        return [
          {
            source,
            target,
            sourceHandle: getStringValue(getRecordValue(edge, 'sourceHandle')),
            targetHandle: getStringValue(getRecordValue(edge, 'targetHandle')),
          },
        ]
      })
    : []

  return { blocks, edges }
}

function snapshotFromWorkflowState(workflowState: unknown): ContentCanvasSnapshot {
  const blocks = getRecordValue(workflowState, 'blocks')
  const edges = getRecordValue(workflowState, 'edges')
  return parseContentCanvasSnapshot(blocks, edges)
}

async function loadContentCanvasSnapshot(workflowId: string): Promise<ContentCanvasSnapshot> {
  const { loadWorkflowFromNormalizedTables } = await import('@/lib/workflows/persistence/utils')
  const normalized = await loadWorkflowFromNormalizedTables(workflowId)
  return parseContentCanvasSnapshot(normalized?.blocks, normalized?.edges)
}

function extractConversationHistory(value: unknown): PlannerMessage[] {
  if (!Array.isArray(value)) return []

  return value
    .map((message) => {
      if (!message || typeof message !== 'object') return null
      const role = getStringValue(getRecordValue(message, 'role'))
      const content = getStringValue(getRecordValue(message, 'content'))
      if (!content || (role !== 'user' && role !== 'assistant' && role !== 'system')) {
        return null
      }
      return { role, content }
    })
    .filter((message): message is PlannerMessage => message !== null)
}

function blockPreviewText(block: ContentCanvasBlockSnapshot): string {
  if (block.variant === 'text') {
    return String(getValue(block.values, 'contentHtml', ''))
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
  if (block.variant === 'image') {
    return (
      getStringValue(block.values.aiPrompt) ??
      getStringValue(getRecordValue(block.values.file, 'name')) ??
      ''
    )
  }
  if (block.variant === 'video') {
    return (
      getStringValue(block.values.videoPrompt) ??
      getStringValue(block.values.aiPrompt) ??
      getStringValue(getRecordValue(block.values.file, 'name')) ??
      ''
    )
  }
  return (
    getStringValue(block.values.audioPrompt) ??
    getStringValue(getRecordValue(block.values.file, 'name')) ??
    ''
  )
}

function buildSnapshotPrompt(
  snapshot: ContentCanvasSnapshot,
  autoSelectionBlockIds: string[]
): string {
  if (snapshot.blocks.length === 0) {
    return 'Current content canvas is empty.'
  }

  const selectedSet = new Set(autoSelectionBlockIds)
  const blockLines = snapshot.blocks.map((block) => {
    const preview = blockPreviewText(block)
    return [
      `- id=${block.id}`,
      `name="${block.name}"`,
      `variant=${block.variant}`,
      `position=(${block.position.x},${block.position.y})`,
      selectedSet.has(block.id) ? 'selected=true' : 'selected=false',
      preview ? `preview="${preview.slice(0, 120)}"` : null,
    ]
      .filter(Boolean)
      .join(', ')
  })

  const edgeLines =
    snapshot.edges.length > 0
      ? snapshot.edges.map((edge) => `- ${edge.source} -> ${edge.target}`).join('\n')
      : '- none'

  return ['Blocks:', ...blockLines, '', 'Edges:', edgeLines].join('\n')
}

async function resolveContentCanvasActorConfig(): Promise<ContentCanvasActorConfig> {
  const availability = await getContentCanvasModelAvailabilityForRuntime()
  const model = availability.text.defaultModelId
  if (!model) {
    throw new Error('平台管理员尚未配置画布文本模型与 API Key')
  }

  return {
    model,
    mode: 'structured',
    useContentCanvasTextResolver: true,
  }
}

function buildActorSystemPrompt(
  thinkingLevel: 'standard' | 'extra',
  requestKind: ContentCanvasRequestKind
): string {
  const kindSpecificInstructions: Record<ContentCanvasRequestKind, string[]> = {
    create: ['For create requests, include at least one create_node action.'],
    'edit-selection': [
      'This is a selection-scoped edit request. Return at least one update_node action and only target selected block IDs from the snapshot.',
      'Do not create new nodes for this request kind.',
      'Few-shot example: {"assistantText":"我先压缩当前选中文案。","shouldContinue":false,"actions":[{"type":"update_node","blockId":"text-1","contentText":"一句话版本"}]}',
    ],
    'edit-existing': [
      'This is an edit-existing request. Prefer update_node actions and do not create new nodes unless the user explicitly asks to add one.',
      'Few-shot example: {"assistantText":"我先把文案改得更抓人。","shouldContinue":false,"actions":[{"type":"update_node","blockId":"text-1","contentText":"3 秒抓住注意力的爆款开场"}]}',
    ],
    connect: [
      'This is a connect request. Return connect_nodes actions only. Do not create, delete, or rewrite nodes.',
      'Few-shot example: {"assistantText":"我先把节点连起来。","shouldContinue":false,"actions":[{"type":"connect_nodes","sourceBlockId":"text-1","targetBlockId":"image-1"},{"type":"connect_nodes","sourceBlockId":"image-1","targetBlockId":"video-1"}]}',
    ],
    layout: [
      'This is a layout request. Return layout_nodes actions only. Do not create nodes or rewrite content.',
      'Few-shot example: {"assistantText":"我先整理成纵向布局。","shouldContinue":false,"actions":[{"type":"layout_nodes","direction":"vertical","blockIds":["text-1","image-1","video-1"]}]}',
    ],
    'analyze-only': [
      'This is an analyze-only request. Return no actions and shouldContinue=false.',
      'Few-shot example: {"assistantText":"当前画布主要是在讲一条图文到视频的内容链。","shouldContinue":false,"actions":[]}',
    ],
    'out-of-scope': [
      'This request is out of scope for the content canvas. Return no actions and explain the limitation briefly.',
      'Few-shot example: {"assistantText":"这个请求超出了内容画布 Copilot 当前能操作的范围。","shouldContinue":false,"actions":[]}',
    ],
  }
  return [
    'You are the Sim content canvas Copilot for TapNow-style content nodes.',
    'Only operate on content canvas nodes of type: text, image, video, audio.',
    'Return only the next small batch of canvas actions, never a full long-range plan.',
    'Valid action types are: create_node, update_node, connect_nodes, layout_nodes, generate_output, writeback_output.',
    'Return at most 3 actions in one response.',
    'If the user only wants analysis or Q&A, return no actions and shouldContinue=false.',
    'Use exact existing block IDs from the snapshot when editing existing nodes.',
    'For new nodes, assign a stable clientNodeId such as new_text_1 and reference it later.',
    'If the user asks to create, add, or generate a new node, you must include at least one create_node action.',
    'Only use update_node when the user clearly wants to modify an existing node or selected node.',
    'If the user directly supplies final copy, prefer create_node/update_node contentText over generation.',
    'If the user asks AI to write, draw, create video, or create audio, include generate_output followed by writeback_output for that node.',
    'If information is incomplete, prefer the smallest safe action batch instead of returning nothing.',
    'Selection conflicts with explicit wording should favor the wording.',
    `Current request kind: ${requestKind}.`,
    ...kindSpecificInstructions[requestKind],
    'Respond with a JSON object containing assistantText, shouldContinue, actions, and optional repairHint.',
    'Few-shot example 1: {"assistantText":"先加一个图片节点。","shouldContinue":false,"actions":[{"type":"create_node","clientNodeId":"new_image_1","nodeType":"image","title":"图片节点","prompt":"极简咖啡海报"}]}',
    'Few-shot example 2: {"assistantText":"先补一段文案并生成。","shouldContinue":false,"actions":[{"type":"create_node","clientNodeId":"new_text_1","nodeType":"text","title":"文案节点","prompt":"写一句夏日饮品标题"},{"type":"generate_output","blockId":"new_text_1"},{"type":"writeback_output","blockId":"new_text_1","textApplyMode":"replace"}]}',
    thinkingLevel === 'extra'
      ? 'Spend extra effort resolving ambiguity while still returning only the next small action batch.'
      : 'Prefer a concise action batch.',
    'Return JSON only.',
  ].join('\n')
}

function isExplicitCreateIntent(message: string): boolean {
  const normalized = message.trim().toLowerCase()
  if (!normalized) return false

  const createPattern =
    /(\u65b0\u5efa|\u65b0\u589e|\u52a0\u4e00\u4e2a|\u521b\u5efa|\u518d\u6765|\u751f\u6210\u4e00\u5f20|\u751f\u6210\u4e00\u6bb5|\u751f\u6210\u4e00\u4e2a|\u753b\u4e00\u5f20|\u5199\u4e00\u6bb5)/.test(
      normalized
    ) || /\b(new|create|add|another|generate a|generate an|draw a|write a)\b/.test(normalized)
  const updatePattern =
    /(\u4fee\u6539|\u66ff\u6362|\u91cd\u5199|\u4f18\u5316|\u5728\u8fd9\u5f20|\u57fa\u4e8e\u8fd9\u5f20|\u91cd\u753b|\u7ee7\u7eed\u6539)/.test(
      normalized
    ) || /\b(update|modify|edit|rewrite|improve|replace|based on this)\b/.test(normalized)

  return createPattern && !updatePattern
}

function buildUniqueNodeName(
  requestedName: string,
  takenNormalizedNames: Set<string>,
  reservedNormalizedNames: Set<string>
): string {
  const trimmed = requestedName.trim() || 'Content'
  let candidate = trimmed
  let suffix = 2

  while (true) {
    const normalized = normalizeName(candidate)
    if (
      normalized &&
      !takenNormalizedNames.has(normalized) &&
      !reservedNormalizedNames.has(normalized)
    ) {
      takenNormalizedNames.add(normalized)
      return candidate
    }
    candidate = `${trimmed} ${suffix++}`
  }
}

function normalizePlanForExplicitCreateIntent(params: {
  message: string
  plan: LegacyContentCanvasPlan
  snapshot: ContentCanvasSnapshot
  autoSelectionBlockIds: string[]
}): LegacyContentCanvasPlan {
  if (!isExplicitCreateIntent(params.message)) {
    return params.plan
  }
  if (params.plan.actions.some((action) => action.type === 'add_node')) {
    return params.plan
  }

  const selectedIds = new Set(params.autoSelectionBlockIds)
  const selectedBlocksById = new Map(
    getSelectedBlocks(params.snapshot, params.autoSelectionBlockIds).map((block) => [
      block.id,
      block,
    ])
  )
  const replacementNodeIds = new Map<string, string>()
  let replacementIndex = 1
  let didRewrite = false

  const nextActions: ContentCanvasPlanAction[] = []
  for (const action of params.plan.actions) {
    if (
      action.type === 'update_node' &&
      selectedIds.has(action.blockId) &&
      (action.prompt || action.contentText)
    ) {
      const selectedBlock = selectedBlocksById.get(action.blockId)
      if (!selectedBlock) {
        nextActions.push(action)
        continue
      }

      const clientNodeId = `new_${selectedBlock.variant}_${replacementIndex++}`
      replacementNodeIds.set(action.blockId, clientNodeId)
      nextActions.push({
        type: 'add_node',
        clientNodeId,
        nodeType: selectedBlock.variant,
        ...(action.prompt ? { prompt: action.prompt } : {}),
        ...(action.contentText ? { contentText: action.contentText } : {}),
      })
      didRewrite = true
      continue
    }

    if (action.type === 'generate_node_output') {
      const replacementId = replacementNodeIds.get(action.blockId)
      if (replacementId) {
        nextActions.push({
          ...action,
          blockId: replacementId,
        })
        didRewrite = true
        continue
      }
    }

    nextActions.push(action)
  }

  return didRewrite
    ? {
        ...params.plan,
        actions: nextActions,
      }
    : params.plan
}

function getNodeVariantLabel(
  variant: ContentNodeVariant | 'text' | 'image' | 'video' | 'audio',
  chinese: boolean
): string {
  if (!chinese) return variant
  if (variant === 'text') return '文本'
  if (variant === 'image') return '图片'
  if (variant === 'video') return '视频'
  return '音频'
}

function getActionTargetLabel(
  snapshot: ContentCanvasSnapshot,
  blockId: string,
  chinese: boolean
): string {
  const block = snapshot.blocks.find((entry) => entry.id === blockId)
  if (!block) {
    return chinese ? `节点 ${blockId}` : `node ${blockId}`
  }
  return `"${block.name || getNodeVariantLabel(block.variant, chinese)}"`
}

function buildPlanActionSummary(params: {
  plan: LegacyContentCanvasPlan
  snapshot: ContentCanvasSnapshot
  message: string
}): string {
  const chinese = isChineseMessage(params.message)
  const lines = params.plan.actions.map((action, index) => {
    const prefix = `${index + 1}. `
    if (action.type === 'add_node') {
      const label = getNodeVariantLabel(action.nodeType, chinese)
      const title = action.title?.trim() ? `“${action.title.trim()}”` : ''
      return `${prefix}${chinese ? '新增' : 'Add'} ${title ? `${title} ` : ''}${label}${chinese ? '节点' : ' node'}`
    }
    if (action.type === 'update_node') {
      return `${prefix}${chinese ? '修改' : 'Update'} ${getActionTargetLabel(params.snapshot, action.blockId, chinese)}`
    }
    if (action.type === 'delete_node') {
      return `${prefix}${chinese ? '删除' : 'Delete'} ${getActionTargetLabel(params.snapshot, action.blockId, chinese)}`
    }
    if (action.type === 'connect_nodes') {
      return `${prefix}${chinese ? '连接' : 'Connect'} ${getActionTargetLabel(params.snapshot, action.sourceBlockId, chinese)} ${chinese ? '到' : 'to'} ${getActionTargetLabel(params.snapshot, action.targetBlockId, chinese)}`
    }
    if (action.type === 'layout_nodes') {
      const layoutLabel =
        action.direction === 'vertical'
          ? chinese
            ? '纵向排版'
            : 'vertical layout'
          : action.direction === 'grid'
            ? chinese
              ? '网格排版'
              : 'grid layout'
            : chinese
              ? '横向排版'
              : 'horizontal layout'
      return `${prefix}${layoutLabel}`
    }
    return `${prefix}${chinese ? '触发生成' : 'Generate output for'} ${getActionTargetLabel(params.snapshot, action.blockId, chinese)}`
  })

  return [
    chinese ? '我准备执行这些内容画布操作：' : 'I am ready to apply these canvas actions:',
    ...lines,
  ].join('\n')
}

function buildNoActionFallback(message: string): string {
  return isChineseMessage(message)
    ? '我暂时没有需要替你执行的画布操作。你可以继续描述想新增、修改或生成的文本、图片、视频或音频节点。'
    : 'I do not have any content canvas changes to apply yet. You can describe the text, image, video, or audio nodes you want me to add, edit, or generate.'
}

function buildInvalidPendingPlanMessage(message: string): string {
  return isChineseMessage(message)
    ? '当前确认已失效，请重新发送你的需求，我会重新整理一份待执行方案。'
    : 'That confirmation is no longer valid. Send your request again and I will prepare a fresh plan.'
}

function buildRevisePendingPlanMessage(message: string): string {
  return isChineseMessage(message)
    ? '我已保留当前待执行方案。你可以继续补充修改要求，我会据此重新整理。'
    : 'I kept the pending plan. You can send more changes and I will revise it.'
}

function buildManualConfirmationHint(message: string): string {
  return isChineseMessage(message)
    ? '点击下方按钮确认执行，或继续补充修改要求。'
    : 'Use the buttons below to confirm execution, or send more changes.'
}

function buildManualConfirmationOptions(pendingPlanId: string): OptionItem[] {
  return [
    {
      id: buildPendingPlanCommand('confirm', pendingPlanId),
      label: '确认执行',
      value: buildPendingPlanCommand('confirm', pendingPlanId),
    },
    {
      id: buildPendingPlanCommand('revise', pendingPlanId),
      label: '继续修改',
      value: buildPendingPlanCommand('revise', pendingPlanId),
    },
  ]
}

function buildOptionsTag(options: OptionItem[]): string {
  return `<options>${JSON.stringify(
    Object.fromEntries(
      options.map((option) => [
        option.value ?? option.id,
        {
          title: option.label,
          description: '',
        },
      ])
    )
  )}</options>`
}

function getNodeVariantLabelV2(
  variant: ContentNodeVariant | 'text' | 'image' | 'video' | 'audio',
  chinese: boolean
): string {
  if (!chinese) return variant
  if (variant === 'text') return '\u6587\u672c'
  if (variant === 'image') return '\u56fe\u7247'
  if (variant === 'video') return '\u89c6\u9891'
  return '\u97f3\u9891'
}

function getActionTargetLabelV2(
  snapshot: ContentCanvasSnapshot,
  blockId: string,
  chinese: boolean
): string {
  const block = snapshot.blocks.find((entry) => entry.id === blockId)
  if (!block) {
    return chinese ? `\u8282\u70b9 ${blockId}` : `node ${blockId}`
  }
  return `"${block.name || getNodeVariantLabelV2(block.variant, chinese)}"`
}

function buildPlanActionSummaryV2(params: {
  plan: LegacyContentCanvasPlan
  snapshot: ContentCanvasSnapshot
  message: string
}): string {
  const chinese = isChineseMessage(params.message)
  const lines = params.plan.actions.map((action, index) => {
    const prefix = `${index + 1}. `
    if (action.type === 'add_node') {
      const title = action.title?.trim() ? `"${action.title.trim()}" ` : ''
      return `${prefix}${chinese ? '\u65b0\u589e' : 'Add'} ${title}${getNodeVariantLabelV2(action.nodeType, chinese)}${chinese ? '\u8282\u70b9' : ' node'}`
    }
    if (action.type === 'update_node') {
      return `${prefix}${chinese ? '\u4fee\u6539' : 'Update'} ${getActionTargetLabelV2(params.snapshot, action.blockId, chinese)}`
    }
    if (action.type === 'delete_node') {
      return `${prefix}${chinese ? '\u5220\u9664' : 'Delete'} ${getActionTargetLabelV2(params.snapshot, action.blockId, chinese)}`
    }
    if (action.type === 'connect_nodes') {
      return `${prefix}${chinese ? '\u8fde\u7ebf' : 'Connect'} ${getActionTargetLabelV2(params.snapshot, action.sourceBlockId, chinese)} ${chinese ? '\u5230' : 'to'} ${getActionTargetLabelV2(params.snapshot, action.targetBlockId, chinese)}`
    }
    if (action.type === 'layout_nodes') {
      const layoutLabel =
        action.direction === 'vertical'
          ? chinese
            ? '\u7eb5\u5411\u6392\u7248'
            : 'vertical layout'
          : action.direction === 'grid'
            ? chinese
              ? '\u7f51\u683c\u6392\u7248'
              : 'grid layout'
            : chinese
              ? '\u6a2a\u5411\u6392\u7248'
              : 'horizontal layout'
      return `${prefix}${layoutLabel}`
    }

    return `${prefix}${chinese ? '\u751f\u6210' : 'Generate output for'} ${getActionTargetLabelV2(params.snapshot, action.blockId, chinese)}`
  })

  return [
    chinese
      ? '\u6211\u51c6\u5907\u6267\u884c\u8fd9\u4e9b\u5185\u5bb9\u753b\u5e03\u64cd\u4f5c\uff1a'
      : 'I am ready to apply these canvas actions:',
    ...lines,
  ].join('\n')
}

function buildNoActionFallbackV2(message: string): string {
  return isChineseMessage(message)
    ? '\u6211\u6682\u65f6\u6ca1\u6709\u9700\u8981\u66ff\u4f60\u6267\u884c\u7684\u753b\u5e03\u64cd\u4f5c\u3002\u4f60\u53ef\u4ee5\u7ee7\u7eed\u63cf\u8ff0\u60f3\u65b0\u589e\u3001\u4fee\u6539\u6216\u751f\u6210\u7684\u6587\u672c\u3001\u56fe\u7247\u3001\u89c6\u9891\u6216\u97f3\u9891\u8282\u70b9\u3002'
    : 'I do not have any content canvas changes to apply yet. You can describe the text, image, video, or audio nodes you want me to add, edit, or generate.'
}

function buildInvalidPendingPlanMessageV2(message: string): string {
  return isChineseMessage(message)
    ? '\u5f53\u524d\u786e\u8ba4\u5df2\u5931\u6548\uff0c\u8bf7\u91cd\u65b0\u53d1\u9001\u4f60\u7684\u9700\u6c42\uff0c\u6211\u4f1a\u91cd\u65b0\u6574\u7406\u4e00\u4efd\u5f85\u6267\u884c\u65b9\u6848\u3002'
    : 'That confirmation is no longer valid. Send your request again and I will prepare a fresh plan.'
}

function buildRevisePendingPlanMessageV2(message: string): string {
  return isChineseMessage(message)
    ? '\u6211\u5df2\u4fdd\u7559\u5f53\u524d\u5f85\u6267\u884c\u65b9\u6848\u3002\u4f60\u53ef\u4ee5\u7ee7\u7eed\u8865\u5145\u4fee\u6539\u8981\u6c42\uff0c\u6211\u4f1a\u636e\u6b64\u91cd\u65b0\u6574\u7406\u3002'
    : 'I kept the pending plan. You can send more changes and I will revise it.'
}

function buildManualConfirmationHintV2(message: string): string {
  return isChineseMessage(message)
    ? '\u70b9\u51fb\u4e0b\u65b9\u6309\u94ae\u786e\u8ba4\u6267\u884c\uff0c\u6216\u7ee7\u7eed\u8865\u5145\u4fee\u6539\u8981\u6c42\u3002'
    : 'Use the buttons below to confirm execution, or send more changes.'
}

function buildManualConfirmationOptionsV2(pendingPlanId: string): OptionItem[] {
  return [
    {
      id: buildPendingPlanCommand('confirm', pendingPlanId),
      label: '\u786e\u8ba4\u6267\u884c',
      value: buildPendingPlanCommand('confirm', pendingPlanId),
    },
    {
      id: buildPendingPlanCommand('revise', pendingPlanId),
      label: '\u7ee7\u7eed\u4fee\u6539',
      value: buildPendingPlanCommand('revise', pendingPlanId),
    },
  ]
}

function buildPlannerUserPrompt(params: {
  message: string
  snapshot: ContentCanvasSnapshot
  conversationHistory: PlannerMessage[]
  autoSelectionBlockIds: string[]
}): string {
  const history = params.conversationHistory
    .slice(-6)
    .map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`)
    .join('\n')

  return [
    'Plan content canvas actions for the request below.',
    '',
    history ? `Recent conversation:\n${history}\n` : '',
    `Auto-selected block ids: ${params.autoSelectionBlockIds.length > 0 ? params.autoSelectionBlockIds.join(', ') : 'none'}`,
    '',
    buildSnapshotPrompt(params.snapshot, params.autoSelectionBlockIds),
    '',
    'User request:',
    params.message,
  ]
    .filter(Boolean)
    .join('\n')
}

function getSelectedBlocks(
  snapshot: ContentCanvasSnapshot,
  autoSelectionBlockIds: string[]
): ContentCanvasBlockSnapshot[] {
  if (autoSelectionBlockIds.length === 0) return []
  const selectedIds = new Set(autoSelectionBlockIds)
  return snapshot.blocks.filter((block) => selectedIds.has(block.id))
}

function isImageToTextIntent(message: string): boolean {
  const normalized = message.trim().toLowerCase()
  if (!normalized) return false

  const referencesImage =
    /(\u56fe\u7247|\u56fe\u50cf|\u8fd9\u5f20\u56fe|\u8fd9\u5e45\u56fe|\u7167\u7247|\u63d2\u753b)/.test(
      normalized
    ) || /\b(image|photo|picture)\b/.test(normalized)
  const asksForText =
    /(\u751f\u6210|\u5199|\u63cf\u8ff0|\u4ecb\u7ecd|\u6587\u5b57|\u6587\u6848|\u6587\u672c|\u6bb5\u6587\u5b57|\u4e00\u6bb5\u6587\u5b57)/.test(
      normalized
    ) || /\b(write|caption|describe|description|copy|text)\b/.test(normalized)

  return referencesImage && asksForText
}

function buildImageToTextFallbackPlan(params: {
  message: string
  snapshot: ContentCanvasSnapshot
  autoSelectionBlockIds: string[]
}): LegacyContentCanvasPlan | null {
  const selectedBlocks = getSelectedBlocks(params.snapshot, params.autoSelectionBlockIds)
  if (selectedBlocks.length !== 1) return null

  const selectedBlock = selectedBlocks[0]
  if (selectedBlock.variant !== 'image') return null
  if (!isImageToTextIntent(params.message)) return null

  const chinese = isChineseMessage(params.message)
  const sourceHint = blockPreviewText(selectedBlock) || selectedBlock.name
  const prompt = chinese
    ? `请根据这张图片写一段自然、具体的中文描述文字。已知图片线索：${sourceHint}`
    : `Write a natural, specific description paragraph for this image. Known image hints: ${sourceHint}`

  return {
    assistantText: '',
    summary: '',
    actions: [
      {
        type: 'add_node',
        clientNodeId: 'auto_text_from_selected_image_1',
        nodeType: 'text',
        title: chinese ? '\u56fe\u7247\u63cf\u8ff0' : 'Image description',
        prompt,
        targetBlockId: selectedBlock.id,
      },
      {
        type: 'generate_node_output',
        blockId: 'auto_text_from_selected_image_1',
        textApplyMode: 'replace',
      },
    ],
  }
}

function buildDefaultTaskIntent(
  overrides?: Partial<ContentCanvasTaskIntent>
): ContentCanvasTaskIntent {
  return {
    mode: 'modify_existing',
    summary: '',
    shouldExecute: true,
    risk: 'low',
    ...overrides,
  }
}

function legacyPlanToTaskPlan(plan: LegacyContentCanvasPlan): ContentCanvasTaskPlan {
  const steps: ContentCanvasTaskStep[] = []
  let stepIndex = 1

  for (const action of plan.actions) {
    if (action.type === 'add_node') {
      steps.push({
        id: `step-${stepIndex++}`,
        type: 'create_node',
        clientNodeId: action.clientNodeId,
        nodeType: action.nodeType,
        ...(action.title ? { title: action.title } : {}),
        ...(action.contentText ? { contentText: action.contentText } : {}),
        ...(action.prompt ? { prompt: action.prompt } : {}),
        ...(action.targetBlockId ? { targetBlockId: action.targetBlockId } : {}),
      })
      continue
    }
    if (action.type === 'update_node') {
      steps.push({
        id: `step-${stepIndex++}`,
        type: 'update_node',
        blockId: action.blockId,
        ...(action.title ? { title: action.title } : {}),
        ...(action.contentText ? { contentText: action.contentText } : {}),
        ...(action.prompt ? { prompt: action.prompt } : {}),
      })
      continue
    }
    if (action.type === 'connect_nodes') {
      steps.push({
        id: `step-${stepIndex++}`,
        type: 'connect_nodes',
        sourceBlockId: action.sourceBlockId,
        targetBlockId: action.targetBlockId,
      })
      continue
    }
    if (action.type === 'layout_nodes') {
      steps.push({
        id: `step-${stepIndex++}`,
        type: 'layout_nodes',
        direction: action.direction,
        ...(action.blockIds ? { blockIds: action.blockIds } : {}),
      })
      continue
    }
    if (action.type === 'generate_node_output') {
      steps.push({
        id: `step-${stepIndex++}`,
        type: 'generate_output',
        blockId: action.blockId,
      })
      steps.push({
        id: `step-${stepIndex++}`,
        type: 'writeback_output',
        blockId: action.blockId,
        ...(action.textApplyMode ? { textApplyMode: action.textApplyMode } : {}),
      })
    }
  }

  const hasCreate = plan.actions.some((action) => action.type === 'add_node')
  const hasLayoutOnly =
    plan.actions.length > 0 && plan.actions.every((action) => action.type === 'layout_nodes')

  return {
    assistantText: plan.assistantText,
    summary: plan.summary,
    intent: buildDefaultTaskIntent({
      mode: hasLayoutOnly
        ? 'layout_local_cluster'
        : hasCreate
          ? 'build_from_scratch'
          : 'modify_existing',
      shouldExecute: steps.length > 0,
    }),
    steps,
  }
}

function taskStepToAction(step: ContentCanvasTaskStep): ContentCanvasAction {
  const { id: _id, ...action } = step
  return action
}

function actionToTaskStep(action: ContentCanvasAction, index: number): ContentCanvasTaskStep {
  return {
    id: `action-step-${index + 1}`,
    ...action,
  } as ContentCanvasTaskStep
}

function actionBatchToTaskPlan(batch: ContentCanvasActionBatch): ContentCanvasTaskPlan {
  const steps = batch.actions.map((action, index) => actionToTaskStep(action, index))
  return {
    assistantText: batch.assistantText,
    summary: batch.assistantText,
    intent: buildDefaultTaskIntent({
      mode: steps.some((step) => step.type === 'create_node')
        ? 'build_from_scratch'
        : 'modify_existing',
      summary: batch.assistantText,
      shouldExecute: steps.length > 0,
      risk: 'low',
    }),
    steps,
  }
}

function taskPlanToActionBatch(plan: ContentCanvasTaskPlan): ContentCanvasActionBatch {
  const actions = plan.steps.slice(0, 3).map(taskStepToAction)
  return {
    assistantText: plan.assistantText || plan.intent.summary || plan.summary,
    shouldContinue: plan.steps.length > actions.length,
    actions,
  }
}

function legacyPlanToActionBatch(plan: LegacyContentCanvasPlan): ContentCanvasActionBatch {
  return taskPlanToActionBatch(legacyPlanToTaskPlan(plan))
}

function normalizeTaskPlanForExplicitCreateIntent(params: {
  message: string
  plan: ContentCanvasTaskPlan
  snapshot: ContentCanvasSnapshot
  autoSelectionBlockIds: string[]
}): ContentCanvasTaskPlan {
  if (!isExplicitCreateIntent(params.message)) {
    return params.plan
  }
  if (params.plan.steps.some((step) => step.type === 'create_node')) {
    return params.plan
  }

  const selectedIds = new Set(params.autoSelectionBlockIds)
  const selectedBlocksById = new Map(
    getSelectedBlocks(params.snapshot, params.autoSelectionBlockIds).map((block) => [
      block.id,
      block,
    ])
  )
  const replacementNodeIds = new Map<string, string>()
  let replacementIndex = 1
  let didRewrite = false

  const steps = params.plan.steps.map((step) => {
    if (
      step.type === 'update_node' &&
      selectedIds.has(step.blockId) &&
      (step.prompt || step.contentText)
    ) {
      const selectedBlock = selectedBlocksById.get(step.blockId)
      if (!selectedBlock) {
        return step
      }

      const clientNodeId = `new_${selectedBlock.variant}_${replacementIndex++}`
      replacementNodeIds.set(step.blockId, clientNodeId)
      didRewrite = true
      return {
        id: step.id,
        type: 'create_node',
        clientNodeId,
        nodeType: selectedBlock.variant,
        ...(step.title ? { title: step.title } : {}),
        ...(step.prompt ? { prompt: step.prompt } : {}),
        ...(step.contentText ? { contentText: step.contentText } : {}),
      } satisfies ContentCanvasTaskStep
    }

    if (step.type === 'generate_output' || step.type === 'writeback_output') {
      const replacementId = replacementNodeIds.get(step.blockId)
      if (replacementId) {
        didRewrite = true
        return {
          ...step,
          blockId: replacementId,
        }
      }
    }

    if (step.type === 'connect_nodes') {
      const sourceBlockId = replacementNodeIds.get(step.sourceBlockId) ?? step.sourceBlockId
      const targetBlockId = replacementNodeIds.get(step.targetBlockId) ?? step.targetBlockId
      if (sourceBlockId !== step.sourceBlockId || targetBlockId !== step.targetBlockId) {
        didRewrite = true
        return {
          ...step,
          sourceBlockId,
          targetBlockId,
        }
      }
    }

    return step
  })

  return didRewrite
    ? {
        ...params.plan,
        steps,
      }
    : params.plan
}

function buildImageToTextFallbackTaskPlan(params: {
  message: string
  snapshot: ContentCanvasSnapshot
  autoSelectionBlockIds: string[]
}): ContentCanvasTaskPlan | null {
  const legacyPlan = buildImageToTextFallbackPlan(params)
  return legacyPlan ? legacyPlanToTaskPlan(legacyPlan) : null
}

function isAnalysisOnlyRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase()
  if (!normalized) return false

  return (
    /(\u5148\u522b\u6539|\u4e0d\u8981\u6539|\u63cf\u8ff0\u4e00\u4e0b|\u4ecb\u7ecd\u4e00\u4e0b|\u5206\u6790\u4e00\u4e0b|\u770b\u770b\u5f53\u524d|\u5f53\u524d\u753b\u5e03\u91cc\u6709\u4ec0\u4e48|\u8bb2\u8bb2\u5f53\u524d)/.test(
      message
    ) ||
    /\b(describe|analysis|analyze|what(?:'s| is) on|summari[sz]e|explain the current|tell me about the current)\b/.test(
      normalized
    )
  )
}

function isSelectionScopedModifyRequest(message: string, autoSelectionBlockIds: string[]): boolean {
  if (autoSelectionBlockIds.length === 0) {
    return false
  }

  const normalized = message.trim().toLowerCase()
  if (!normalized) return false

  return (
    /(\u628a\u8fd9\u4e2a|\u628a\u5f53\u524d|\u57fa\u4e8e\u6211\u9009\u4e2d\u7684|\u6211\u9009\u4e2d\u7684|\u6539\u4e00\u4e0b|\u4fee\u6539\u4e00\u4e0b|\u8c03\u6574\u4e00\u4e0b|\u4f18\u5316\u4e00\u4e0b|\u6539\u5f97)/.test(
      message
    ) ||
    /\b(selected|selection|this node|this block|update|modify|edit|rewrite|adjust|improve)\b/.test(
      normalized
    )
  )
}

function isConnectRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase()
  if (!normalized) return false

  return (
    /(\u8fde\u5230|\u8fde\u7ebf|\u4e32\u8d77\u6765|\u63a5\u5230|\u5206\u652f\u51fa\u53bb|\u5206\u652f\u5230|\u540c\u4e00\u4e2a.*\u8282\u70b9|\u8fd8\u6ca1\u8fde\u7ebf)/.test(
      message
    ) || /\b(connect|link|branch|wire|chain together)\b/.test(normalized)
  )
}

function isLayoutRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase()
  if (!normalized) return false

  return (
    /(\u6a2a\u5411\u6392\u5f00|\u7eb5\u5411\u6392\u7248|\u7f51\u683c\u5e03\u5c40|\u6574\u7406\u4f4d\u7f6e|\u53ea\u79fb\u52a8\u4f4d\u7f6e|\u6392\u7248|\u5e03\u5c40|\u6574\u9f50\u4e00\u70b9)/.test(
      message
    ) || /\b(horizontal|vertical|grid|layout|arrange|rearrange|position)\b/.test(normalized)
  )
}

function isOutOfScopeRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase()
  if (!normalized) return false

  return (
    /(\u6570\u636e\u5e93\u914d\u7f6e|slack \u8282\u70b9|\u53d1\u5e03\u51fa\u53bb|\u53d1\u5e03\u9879\u76ee|\u6574\u4e2a workflow|\u5220\u9664\u6240\u6709)/i.test(
      message
    ) || /\b(database|sql|slack|publish|deploy|workflow config|delete all)\b/.test(normalized)
  )
}

function isEditExistingRequest(message: string, autoSelectionBlockIds: string[]): boolean {
  const normalized = message.trim().toLowerCase()
  if (!normalized) return false
  if (isExplicitCreateIntent(message)) return false
  if (isSelectionScopedModifyRequest(message, autoSelectionBlockIds)) return false
  if (isConnectRequest(message) || isLayoutRequest(message) || isAnalysisOnlyRequest(message))
    return false

  return (
    /(\u90a3\u4e2a\u8282\u70b9|\u521a\u624d\u90a3\u5f20\u56fe|\u89c6\u9891\u8282\u70b9|\u4fee\u6539|\u6539\u5f97|\u98ce\u683c\u6539\u6210|\u538b\u7f29\u6210|\u66ff\u6362\u6210|\u4f18\u5316\u4e00\u4e0b)/.test(
      message
    ) || /\b(update|modify|edit|rewrite|improve|compress|change the style)\b/.test(normalized)
  )
}

function classifyContentCanvasRequest(params: {
  message: string
  autoSelectionBlockIds: string[]
}): ContentCanvasRequestKind {
  const { message, autoSelectionBlockIds } = params
  if (isOutOfScopeRequest(message)) return 'out-of-scope'
  if (isAnalysisOnlyRequest(message)) return 'analyze-only'
  if (isConnectRequest(message)) return 'connect'
  if (isLayoutRequest(message)) return 'layout'
  if (autoSelectionBlockIds.length > 0 && isImageToTextIntent(message)) return 'create'
  if (
    isExplicitCreateIntent(message) ||
    isHighLevelGoalRequest({ message, autoSelectionBlockIds })
  ) {
    return 'create'
  }
  if (isSelectionScopedModifyRequest(message, autoSelectionBlockIds)) return 'edit-selection'
  if (isEditExistingRequest(message, autoSelectionBlockIds)) return 'edit-existing'
  return autoSelectionBlockIds.length > 0 ? 'edit-selection' : 'edit-existing'
}

function buildOutOfScopeResponse(message: string): string {
  return isChineseMessage(message)
    ? '这个请求超出了内容画布 Copilot 当前能操作的范围。我只能处理文本、图片、视频、音频节点的创建、修改、连线、排版和生成。'
    : 'That request is outside the current content-canvas Copilot scope. I can only create, edit, connect, lay out, and generate text, image, video, or audio nodes.'
}

function stripOuterQuotes(message: string): string {
  return message
    .trim()
    .replace(/^[“”"'‘’`]+|[“”"'‘’`]+$/g, '')
    .trim()
}

function hasNoGenerateSignal(message: string): boolean {
  return /(\u5148\u4e0d\u8981\u751f\u6210|\u5148\u522b\u751f\u6210|\u4e0d\u8981\u751f\u6210|\u53ea\u628a\u9700\u6c42\u5199\u8fdb\u53bb|\u53ea\u628a\u8981\u6c42\u5199\u8fdb\u53bb|\u53ea\u5199\u9700\u6c42|\u53ea\u5199 prompt|\u53ea\u586b prompt|\u5148\u53ea\u5199|\u4e0d\u8981\u51fa\u56fe|\u4e0d\u8981\u51fa\u89c6\u9891|\u4e0d\u8981\u51fa\u97f3\u9891)/i.test(
    message
  )
}

function isDeterministicCreateFallbackCandidate(params: {
  message: string
  autoSelectionBlockIds: string[]
}): boolean {
  const { message, autoSelectionBlockIds } = params
  const normalized = stripOuterQuotes(message).toLowerCase()
  if (!normalized) return false
  if (isAnalysisOnlyRequest(message)) return false
  if (isSelectionScopedModifyRequest(message, autoSelectionBlockIds)) return false

  const hasCreateSignal =
    isExplicitCreateIntent(message) ||
    /(\u52a0\u4e00\u4e2a|\u52a0\u4e2a|\u65b0\u589e|\u65b0\u5efa|\u521b\u5efa|\u7ed9\u6211\u52a0|\u5e2e\u6211\u505a|\u505a\u4e00\u4e2a|\u505a\u4e2a|\u751f\u6210|\u5199\u4e00\u53e5|\u5199\u4e00\u6bb5|\u642d\u4e00\u4e2a|\u642d\u4e2a)/.test(
      message
    ) ||
    /\b(add|create|new|make|build|generate|write|draft)\b/.test(normalized)

  if (!hasCreateSignal) {
    return false
  }

  return (
    /(\u8282\u70b9|\u5185\u5bb9\u6d41|\u5185\u5bb9\u94fe|pipeline|\u6587\u6848|\u6587\u5b57|\u6587\u672c|\u914d\u56fe|\u56fe\u7247|\u77ed\u89c6\u9891|\u89c6\u9891|\u97f3\u9891|\u65c1\u767d)/.test(
      message
    ) ||
    /\b(node|content flow|content chain|pipeline|copy|text|image|video|audio|voiceover|narration)\b/.test(
      normalized
    )
  )
}

function detectRequestedNodeType(message: string): ContentNodeVariant | null {
  if (
    /(\u89c6\u9891|\u77ed\u89c6\u9891|\u52a8\u753b|\u8f6c\u573a|\bvideo\b|\bclip\b|\banimation\b)/i.test(
      message
    )
  ) {
    return 'video'
  }
  if (
    /(\u97f3\u9891|\u65c1\u767d|\u914d\u97f3|\u97f3\u4e50|\baudio\b|\bvoice(?:over)?\b|\bnarration\b|\bmusic\b)/i.test(
      message
    )
  ) {
    return 'audio'
  }
  if (
    /(\u56fe\u7247|\u914d\u56fe|\u6d77\u62a5|\u5c01\u9762|\u63d2\u753b|\u56fe\u50cf|\bimage\b|\bpicture\b|\bposter\b|\bcover\b|\billustration\b)/i.test(
      message
    )
  ) {
    return 'image'
  }
  if (
    /(\u6587\u6848|\u6587\u5b57|\u6587\u672c|\u6807\u9898|\u811a\u672c|\u4ecb\u7ecd|\u8bf4\u660e|\bcopy\b|\btext\b|\bheadline\b|\bscript\b)/i.test(
      message
    )
  ) {
    return 'text'
  }
  return null
}

function buildFallbackNodeTitle(
  nodeType: ContentNodeVariant,
  prompt: string,
  index: number
): string {
  if (nodeType === 'text') {
    return /\u6587\u6848|\u6807\u9898|\u6587\u5b57|\u6587\u672c/.test(prompt)
      ? '文案节点'
      : `文本节点 ${index}`
  }
  if (nodeType === 'image') {
    return /\u914d\u56fe/.test(prompt) ? '配图节点' : '图片节点'
  }
  if (nodeType === 'video') {
    return /\u77ed\u89c6\u9891/.test(prompt) ? '短视频节点' : '视频节点'
  }
  return /\u65c1\u767d/.test(prompt) ? '旁白节点' : '音频节点'
}

function cleanupFallbackPrompt(message: string, nodeType: ContentNodeVariant): string {
  let prompt = stripOuterQuotes(message)
  prompt = prompt.replace(/^[“”"'‘’`\s]+|[“”"'‘’`\s]+$/g, '')
  prompt = prompt.replace(/^[：:\-\s]+/, '')
  prompt = prompt.replace(
    /(\u5148\u4e0d\u8981\u751f\u6210|\u5148\u522b\u751f\u6210|\u4e0d\u8981\u751f\u6210|\u53ea\u628a\u9700\u6c42\u5199\u8fdb\u53bb|\u53ea\u628a\u8981\u6c42\u5199\u8fdb\u53bb|\u53ea\u5199\u9700\u6c42|\u53ea\u5199 prompt|\u53ea\u586b prompt|\u5148\u53ea\u5199|\u4e0d\u8981\u51fa\u56fe|\u4e0d\u8981\u51fa\u89c6\u9891|\u4e0d\u8981\u51fa\u97f3\u9891)/gi,
    ''
  )
  prompt = prompt.replace(
    /^(\u5e2e\u6211|\u7ed9\u6211|\u8bf7|\u8bf7\u4f60|\u9ebb\u70e6|\u6211\u60f3|\u6211\u8981)\s*/,
    ''
  )
  prompt = prompt.replace(
    /^(\u505a\u4e00\u4e2a|\u505a\u4e2a|\u52a0\u4e00\u4e2a|\u52a0\u4e2a|\u65b0\u589e\u4e00\u4e2a|\u65b0\u589e\u4e2a|\u65b0\u5efa\u4e00\u4e2a|\u65b0\u5efa\u4e2a|\u521b\u5efa\u4e00\u4e2a|\u521b\u5efa\u4e2a|\u751f\u6210\u4e00\u4e2a|\u751f\u6210\u4e2a)\s*/,
    ''
  )
  prompt = prompt.replace(
    /^(?:\d+\s*\u8282\u70b9)?(?:\u5185\u5bb9\u6d41|\u5185\u5bb9\u94fe|pipeline)[：:]?\s*/i,
    ''
  )
  prompt = prompt.replace(/^(?:\u5148|\u7136\u540e|\u63a5\u7740|\u518d|\u6700\u540e)\s*/, '')

  if (nodeType === 'image') {
    prompt = prompt.replace(
      /^(?:\u56fe\u7247|\u56fe\u50cf|\u914d\u56fe|image|picture)\s*\u8282\u70b9[，,\s]*/i,
      ''
    )
    prompt = prompt.replace(
      /^(?:\u52a0|\u65b0\u589e|\u65b0\u5efa|\u521b\u5efa|\u751f\u6210)(?:\u4e00\u4e2a|\u4e2a)?(?:\u56fe\u7247|\u56fe\u50cf|\u914d\u56fe|image|picture)\s*\u8282\u70b9[，,\s]*/i,
      ''
    )
    const themeMatch = prompt.match(/(?:\u4e3b\u9898\u662f|\u4e3b\u9898\u4e3a)([^，。,；;]+)/)
    if (themeMatch?.[1]) {
      prompt = themeMatch[1]
    }
  } else if (nodeType === 'audio') {
    prompt = prompt.replace(/^(?:\u97f3\u9891|audio)\s*\u8282\u70b9[，,\s]*/i, '')
    prompt = prompt.replace(
      /^(?:\u52a0|\u65b0\u589e|\u65b0\u5efa|\u521b\u5efa|\u751f\u6210)(?:\u4e00\u4e2a|\u4e2a)?(?:\u97f3\u9891|audio)\s*\u8282\u70b9[，,\s]*/i,
      ''
    )
  } else if (nodeType === 'video') {
    prompt = prompt.replace(/^(?:\u89c6\u9891|video)\s*\u8282\u70b9[，,\s]*/i, '')
    prompt = prompt.replace(
      /^(?:\u52a0|\u65b0\u589e|\u65b0\u5efa|\u521b\u5efa|\u751f\u6210)(?:\u4e00\u4e2a|\u4e2a)?(?:\u89c6\u9891|video)\s*\u8282\u70b9[，,\s]*/i,
      ''
    )
  } else {
    prompt = prompt.replace(
      /^(?:\u6587\u672c|\u6587\u5b57|\u6587\u6848|text)\s*\u8282\u70b9[，,\s]*/i,
      ''
    )
    prompt = prompt.replace(
      /^(?:\u52a0|\u65b0\u589e|\u65b0\u5efa|\u521b\u5efa|\u751f\u6210)(?:\u4e00\u4e2a|\u4e2a)?(?:\u6587\u672c|\u6587\u5b57|\u6587\u6848|text)\s*\u8282\u70b9[，,\s]*/i,
      ''
    )
  }

  return prompt.replace(/^[，,:：\s]+|[，。,；;:\s]+$/g, '').trim()
}

function parseOrderedDeterministicCreateNodes(message: string): DeterministicCreateFallbackNode[] {
  const matches = [
    ...stripOuterQuotes(message).matchAll(/(?:先|然后|接着|再|最后)\s*([^，。,；;]+)/g),
  ]
  if (matches.length < 2) {
    return []
  }

  const nodes = matches
    .map((match, index) => {
      const clause = match[1]?.trim()
      if (!clause) return null
      const nodeType = detectRequestedNodeType(clause)
      if (!nodeType) return null
      const prompt = cleanupFallbackPrompt(clause, nodeType)
      if (!prompt) return null
      return {
        clientNodeId: `fallback_${nodeType}_${index + 1}`,
        nodeType,
        title: buildFallbackNodeTitle(nodeType, prompt, index + 1),
        prompt,
        shouldGenerate: !hasNoGenerateSignal(clause),
      } satisfies DeterministicCreateFallbackNode
    })
    .filter(isPresent)

  return nodes.length >= 2 ? nodes : []
}

function parseSingleDeterministicCreateNode(
  message: string
): DeterministicCreateFallbackNode | null {
  const nodeType = detectRequestedNodeType(message)
  if (!nodeType) return null

  const prompt = cleanupFallbackPrompt(message, nodeType)
  if (!prompt) return null

  return {
    clientNodeId: `fallback_${nodeType}_1`,
    nodeType,
    title: buildFallbackNodeTitle(nodeType, prompt, 1),
    prompt,
    shouldGenerate: !hasNoGenerateSignal(message),
  }
}

function buildDeterministicCreateFallbackTaskPlan(params: {
  message: string
  plan: ContentCanvasTaskPlan
  autoSelectionBlockIds: string[]
}): ContentCanvasTaskPlan | null {
  const plannerAlreadyExecutable =
    params.plan.steps.length > 0 && params.plan.intent.shouldExecute !== false
  if (plannerAlreadyExecutable) {
    return null
  }

  if (!isDeterministicCreateFallbackCandidate(params)) {
    return null
  }

  const parsedNodes =
    parseOrderedDeterministicCreateNodes(params.message) ||
    ([] as DeterministicCreateFallbackNode[])
  const nodes =
    parsedNodes.length > 0
      ? parsedNodes
      : [parseSingleDeterministicCreateNode(params.message)].filter(isPresent)

  if (nodes.length === 0) {
    return null
  }

  const steps: ContentCanvasTaskStep[] = []
  let stepIndex = 1

  for (const node of nodes) {
    steps.push({
      id: `step-${stepIndex++}`,
      type: 'create_node',
      clientNodeId: node.clientNodeId,
      nodeType: node.nodeType,
      title: node.title,
      ...(node.prompt ? { prompt: node.prompt } : {}),
      ...(node.contentText ? { contentText: node.contentText } : {}),
    })
  }

  for (let index = 0; index < nodes.length - 1; index += 1) {
    steps.push({
      id: `step-${stepIndex++}`,
      type: 'connect_nodes',
      sourceBlockId: nodes[index].clientNodeId,
      targetBlockId: nodes[index + 1].clientNodeId,
    })
  }

  for (const node of nodes) {
    if (!node.shouldGenerate) continue
    steps.push({
      id: `step-${stepIndex++}`,
      type: 'generate_output',
      blockId: node.clientNodeId,
    })
    steps.push({
      id: `step-${stepIndex++}`,
      type: 'writeback_output',
      blockId: node.clientNodeId,
      ...(node.nodeType === 'text' ? { textApplyMode: 'replace' as const } : {}),
    })
  }

  const summary = isChineseMessage(params.message)
    ? '已将普通创建请求整理为可执行的内容节点草案'
    : 'Turned the request into an executable content-node draft.'

  return {
    assistantText: summary,
    summary,
    intent: buildDefaultTaskIntent({
      mode: 'build_from_scratch',
      summary,
      shouldExecute: true,
      risk: 'low',
    }),
    steps,
  }
}

function extractRequestedModalities(message: string): GenericGoalFallbackModality[] {
  const patterns: Array<{ modality: GenericGoalFallbackModality; pattern: RegExp }> = [
    {
      modality: 'image',
      pattern:
        /(\u56fe\u7247|\u914d\u56fe|\u5c01\u9762|\u63d2\u753b|\u56fe|\bimage\b|\bpicture\b|\bcover\b|\billustration\b)/i,
    },
    {
      modality: 'video',
      pattern: /(\u89c6\u9891|\u77ed\u7247|\u52a8\u753b|\bvideo\b|\bclip\b|\banimation\b)/i,
    },
    {
      modality: 'audio',
      pattern:
        /(\u97f3\u9891|\u914d\u97f3|\u65c1\u767d|\u97f3\u4e50|\baudio\b|\bvoice(?:over)?\b|\bnarration\b|\bmusic\b)/i,
    },
  ]

  return patterns
    .map(({ modality, pattern }) => ({ modality, index: message.search(pattern) }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.modality)
    .filter((modality, index, items) => items.indexOf(modality) === index)
    .slice(0, 2)
}

function isHighLevelGoalRequest(params: {
  message: string
  autoSelectionBlockIds: string[]
}): boolean {
  const { message, autoSelectionBlockIds } = params
  const normalized = message.trim().toLowerCase()
  if (!normalized) return false
  if (isAnalysisOnlyRequest(message)) return false
  if (isSelectionScopedModifyRequest(message, autoSelectionBlockIds)) return false

  const hasCreateSignal =
    isExplicitCreateIntent(message) ||
    /(\u5e2e\u6211|\u505a\u4e00|\u505a\u4e2a|\u642d\u4e00|\u642d\u4e2a|\u642d\u5efa|\u521b\u5efa|\u751f\u6210|\u6574\u4e00\u4e2a)/.test(
      message
    ) ||
    /\b(build|make|create|generate|draft)\b/.test(normalized)

  if (!hasCreateSignal) {
    return false
  }

  const hasHolisticSignal =
    /(\u5168\u5957|\u4e00\u5957|pipeline|\u5185\u5bb9\u94fe|\u5185\u5bb9\u6d41|\u5185\u5bb9\u5305|\u5b8c\u6574|\u8349\u6848|\u5927\u7eb2|\u811a\u672c|\u4ecb\u7ecd\u5185\u5bb9|\u65b9\u6848)/.test(
      message
    ) ||
    /\b(pipeline|content chain|content flow|content pack|package|full set|complete|outline|draft|script|deck|presentation|brief)\b/.test(
      normalized
    )

  const directNodeOnly =
    /(\u8282\u70b9|text node|image node|video node|audio node)/i.test(message) && !hasHolisticSignal

  if (directNodeOnly) {
    return false
  }

  return hasHolisticSignal || autoSelectionBlockIds.length === 0
}

function buildTextFirstContentChain(
  intent: GenericGoalFallbackIntent
): GenericGoalFallbackChainNode[] {
  const { chinese, sourceGoal, requestedModalities } = intent
  const nodes: GenericGoalFallbackChainNode[] = [
    {
      clientNodeId: 'goal_breakdown_text_1',
      nodeType: 'text',
      title: chinese ? '\u76ee\u6807\u62c6\u89e3' : 'Goal breakdown',
      prompt: chinese
        ? `\u7528\u6237\u7684\u9ad8\u5c42\u76ee\u6807\u662f\uff1a\u201c${sourceGoal}\u201d\u3002\u8bf7\u628a\u5b83\u62c6\u6210\u4e00\u53e5\u6e05\u6670\u3001\u53ef\u6267\u884c\u7684\u5185\u5bb9\u4efb\u52a1\u8bf4\u660e\uff0c\u7a81\u51fa\u76ee\u6807\u3001\u53d7\u4f17\u548c\u4ea4\u4ed8\u7269\uff0c\u4fdd\u6301\u7b80\u6d01\u3002`
        : `The user's high-level goal is: "${sourceGoal}". Rewrite it as one clear, actionable content task statement with the goal, audience, and deliverable. Keep it concise.`,
    },
    {
      clientNodeId: 'structure_outline_text_1',
      nodeType: 'text',
      title: chinese ? '\u7ed3\u6784\u5927\u7eb2' : 'Structure outline',
      prompt: chinese
        ? `\u57fa\u4e8e\u8fd9\u4e2a\u9ad8\u5c42\u76ee\u6807\uff1a\u201c${sourceGoal}\u201d\u3002\u8bf7\u7ed9\u51fa\u4e00\u4e2a\u8f7b\u91cf\u5185\u5bb9\u7ed3\u6784\u5927\u7eb2\uff0c\u5217\u51fa 3 \u5230 6 \u4e2a\u6a21\u5757\u6216\u7ae0\u8282\u987a\u5e8f\uff0c\u9002\u5408\u4f5c\u4e3a\u540e\u7eed\u5185\u5bb9\u94fe\u9aa8\u67b6\u3002`
        : `Based on this high-level goal: "${sourceGoal}". Draft a lightweight content outline with 3 to 6 ordered sections or modules that can serve as the chain backbone.`,
    },
    {
      clientNodeId: 'content_draft_text_1',
      nodeType: 'text',
      title: chinese ? '\u5185\u5bb9\u8349\u7a3f' : 'Content draft',
      prompt: chinese
        ? `\u57fa\u4e8e\u8fd9\u4e2a\u9ad8\u5c42\u76ee\u6807\uff1a\u201c${sourceGoal}\u201d\u3002\u8bf7\u5148\u5199\u51fa\u7b2c\u4e00\u7248\u5185\u5bb9\u8349\u7a3f\uff0c\u8bed\u6c14\u81ea\u7136\uff0c\u7ed3\u6784\u6e05\u695a\uff0c\u4e3a\u540e\u7eed\u6269\u5c55\u7559\u51fa\u7a7a\u95f4\u3002`
        : `Based on this high-level goal: "${sourceGoal}". Write a first-pass content draft with a clear structure, natural tone, and room for later expansion.`,
    },
  ]

  for (const modality of requestedModalities) {
    if (modality === 'image') {
      nodes.push({
        clientNodeId: 'supporting_image_1',
        nodeType: 'image',
        title: chinese ? '\u914d\u56fe\u8349\u6848' : 'Image draft',
        prompt: chinese
          ? `\u57fa\u4e8e\u8fd9\u4e2a\u9ad8\u5c42\u76ee\u6807\uff1a\u201c${sourceGoal}\u201d\u3002\u8bf7\u751f\u6210\u4e00\u5f20\u80fd\u6982\u62ec\u8be5\u5185\u5bb9\u4e3b\u9898\u7684\u89c6\u89c9\u8349\u6848\uff0c\u753b\u9762\u6e05\u6670\uff0c\u9002\u5408\u4f5c\u4e3a\u914d\u56fe\u6216\u5c01\u9762\u3002`
          : `Based on this high-level goal: "${sourceGoal}". Generate a visual draft that captures the theme clearly and can work as a supporting image or cover.`,
      })
      continue
    }

    if (modality === 'video') {
      nodes.push({
        clientNodeId: 'supporting_video_1',
        nodeType: 'video',
        title: chinese ? '\u89c6\u9891\u8349\u6848' : 'Video draft',
        prompt: chinese
          ? `\u57fa\u4e8e\u8fd9\u4e2a\u9ad8\u5c42\u76ee\u6807\uff1a\u201c${sourceGoal}\u201d\u3002\u8bf7\u751f\u6210\u4e00\u4e2a\u7b80\u77ed\u89c6\u9891\u8349\u6848\u7684\u63d0\u793a\u8bcd\uff0c\u7a81\u51fa\u6838\u5fc3\u4fe1\u606f\u3001\u955c\u5934\u8282\u594f\u548c\u753b\u9762\u4e3b\u9898\u3002`
          : `Based on this high-level goal: "${sourceGoal}". Generate a short video draft prompt that highlights the core message, pacing, and visual theme.`,
      })
      continue
    }

    nodes.push({
      clientNodeId: 'supporting_audio_1',
      nodeType: 'audio',
      title: chinese ? '\u97f3\u9891\u8349\u6848' : 'Audio draft',
      prompt: chinese
        ? `\u57fa\u4e8e\u8fd9\u4e2a\u9ad8\u5c42\u76ee\u6807\uff1a\u201c${sourceGoal}\u201d\u3002\u8bf7\u751f\u6210\u4e00\u7248\u9002\u5408\u8be5\u5185\u5bb9\u4e3b\u9898\u7684\u97f3\u9891\u8349\u6848\uff0c\u7a81\u51fa\u65c1\u767d\u6216\u6c1b\u56f4\u97f3\u4e50\u65b9\u5411\u3002`
        : `Based on this high-level goal: "${sourceGoal}". Generate an audio draft suitable for this theme, including a direction for narration or background music.`,
    })
  }

  return nodes
}

function buildGenericGoalFallbackTaskPlan(params: {
  message: string
  plan: ContentCanvasTaskPlan
  autoSelectionBlockIds: string[]
}): ContentCanvasTaskPlan | null {
  const plannerAlreadyExecutable =
    params.plan.steps.length > 0 && params.plan.intent.shouldExecute !== false
  if (plannerAlreadyExecutable) {
    return null
  }

  if (!isHighLevelGoalRequest(params)) {
    return null
  }

  const chinese = isChineseMessage(params.message)
  const fallbackIntent: GenericGoalFallbackIntent = {
    sourceGoal: params.message.trim(),
    chinese,
    requestedModalities: extractRequestedModalities(params.message),
  }

  const nodes = buildTextFirstContentChain(fallbackIntent)
  const summary = chinese
    ? '\u5df2\u5c06\u9ad8\u5c42\u76ee\u6807\u7ffb\u8bd1\u4e3a\u4e00\u4e2a\u8f7b\u91cf\u5185\u5bb9\u94fe\u8349\u6848'
    : 'Translated the high-level goal into a lightweight content chain draft.'

  const steps: ContentCanvasTaskStep[] = []
  let stepIndex = 1

  for (const node of nodes) {
    steps.push({
      id: `step-${stepIndex++}`,
      type: 'create_node',
      clientNodeId: node.clientNodeId,
      nodeType: node.nodeType,
      title: node.title,
      prompt: node.prompt,
    })
  }

  for (let index = 0; index < nodes.length - 1; index += 1) {
    steps.push({
      id: `step-${stepIndex++}`,
      type: 'connect_nodes',
      sourceBlockId: nodes[index].clientNodeId,
      targetBlockId: nodes[index + 1].clientNodeId,
    })
  }

  for (const node of nodes) {
    steps.push({
      id: `step-${stepIndex++}`,
      type: 'generate_output',
      blockId: node.clientNodeId,
    })
    steps.push({
      id: `step-${stepIndex++}`,
      type: 'writeback_output',
      blockId: node.clientNodeId,
      ...(node.nodeType === 'text' ? { textApplyMode: 'replace' as const } : {}),
    })
  }

  return {
    assistantText: summary,
    summary,
    intent: buildDefaultTaskIntent({
      mode: 'build_from_scratch',
      summary,
      shouldExecute: true,
      risk: 'low',
    }),
    steps,
  }
}

function validateActionBatchForRequest(params: {
  message: string
  batch: ContentCanvasActionBatch
  autoSelectionBlockIds: string[]
  requestKind: ContentCanvasRequestKind
}): void {
  const { message, batch, autoSelectionBlockIds, requestKind } = params
  if (batch.actions.length === 0) {
    if (
      requestKind === 'create' ||
      requestKind === 'edit-selection' ||
      requestKind === 'edit-existing' ||
      requestKind === 'connect' ||
      requestKind === 'layout'
    ) {
      throw new ContentCanvasActorError('empty_actions', 'Content canvas actor returned no actions')
    }
    return
  }

  if (requestKind === 'analyze-only') {
    throw new ContentCanvasActorError(
      'analyze_only_with_actions',
      'Content canvas actor returned actions for an analyze-only request'
    )
  }

  if (requestKind === 'out-of-scope') {
    throw new ContentCanvasActorError(
      'out_of_scope_request',
      'Content canvas actor returned actions for an out-of-scope request'
    )
  }

  if (requestKind === 'create' && !batch.actions.some((action) => action.type === 'create_node')) {
    throw new ContentCanvasActorError(
      'missing_create_for_create_intent',
      'Content canvas actor omitted create_node for an explicit create request'
    )
  }

  if (requestKind === 'edit-selection' || requestKind === 'edit-existing') {
    const updateActions = batch.actions.filter(
      (action): action is Extract<ContentCanvasAction, { type: 'update_node' }> =>
        action.type === 'update_node'
    )
    if (
      updateActions.length === 0 ||
      batch.actions.some((action) => action.type === 'create_node')
    ) {
      throw new ContentCanvasActorError(
        'missing_update_for_edit_intent',
        'Content canvas actor omitted update_node for an edit request'
      )
    }
    if (
      requestKind === 'edit-selection' &&
      updateActions.some((action) => !autoSelectionBlockIds.includes(action.blockId))
    ) {
      throw new ContentCanvasActorError(
        'invalid_selection_target',
        'Content canvas actor targeted a block outside the current selection'
      )
    }
  }

  if (
    requestKind === 'connect' &&
    (batch.actions.some((action) => action.type !== 'connect_nodes') ||
      !batch.actions.some((action) => action.type === 'connect_nodes'))
  ) {
    throw new ContentCanvasActorError(
      'missing_connect_for_connect_intent',
      'Content canvas actor omitted connect_nodes for a connect request'
    )
  }

  if (
    requestKind === 'layout' &&
    (batch.actions.some((action) => action.type !== 'layout_nodes') ||
      !batch.actions.some((action) => action.type === 'layout_nodes'))
  ) {
    throw new ContentCanvasActorError(
      'missing_layout_for_layout_intent',
      'Content canvas actor omitted layout_nodes for a layout request'
    )
  }

  const generatedBlockIds = new Set(
    batch.actions
      .filter(
        (action): action is Extract<ContentCanvasAction, { type: 'generate_output' }> =>
          action.type === 'generate_output'
      )
      .map((action) => action.blockId)
  )
  for (const blockId of generatedBlockIds) {
    const hasWriteback = batch.actions.some(
      (action) => action.type === 'writeback_output' && action.blockId === blockId
    )
    if (!hasWriteback) {
      throw new ContentCanvasActorError(
        'missing_generate_pair',
        `Content canvas actor omitted writeback_output for generated block ${blockId}`
      )
    }
  }
}

function buildActorUserPrompt(params: {
  message: string
  thinkingLevel: 'standard' | 'extra'
  snapshot: ContentCanvasSnapshot
  conversationHistory: PlannerMessage[]
  autoSelectionBlockIds: string[]
  repairContext?: string
}): string {
  return [
    buildPlannerUserPrompt(params),
    params.repairContext ? `\nRepair context:\n${params.repairContext}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function looksLikeTaskPlanPayload(value: unknown): boolean {
  const steps = getRecordValue(value, 'steps')
  const intent = getRecordValue(value, 'intent')
  return Array.isArray(steps) || Boolean(intent)
}

function looksLikeLegacyActionPayload(value: unknown): boolean {
  const actions = getRecordValue(value, 'actions')
  if (!Array.isArray(actions)) return false
  return actions.some((action) => {
    const type = getStringValue(getRecordValue(action, 'type'))
    return type === 'add_node' || type === 'generate_node_output' || type === 'delete_node'
  })
}

function parseActorBatchResponse(content: string): ContentCanvasActionDecision {
  try {
    const parsed = extractAndParseJSON(content || '')
    if (parsed && typeof parsed === 'object') {
      if (looksLikeTaskPlanPayload(parsed)) {
        const taskPlanResult = contentCanvasTaskPlanSchema.safeParse(parsed)
        if (taskPlanResult.success) {
          return {
            batch: taskPlanToActionBatch(taskPlanResult.data),
            compatibilityPlan: taskPlanResult.data,
          }
        }
      }

      if (looksLikeLegacyActionPayload(parsed)) {
        const legacyResult = legacyContentCanvasPlanSchema.safeParse(parsed)
        if (legacyResult.success) {
          const compatibilityPlan = legacyPlanToTaskPlan(legacyResult.data)
          return {
            batch: taskPlanToActionBatch(compatibilityPlan),
            compatibilityPlan,
          }
        }
      }

      const batchResult = contentCanvasActionBatchSchema.safeParse(parsed)
      if (batchResult.success) {
        return { batch: batchResult.data }
      }
    }
  } catch (error) {
    throw new ContentCanvasActorError(
      'invalid_action_schema',
      toError(error).message || 'Content canvas actor returned invalid JSON'
    )
  }

  throw new ContentCanvasActorError(
    'invalid_action_schema',
    'Content canvas actor returned invalid JSON'
  )
}

async function decideNextCanvasActions(params: {
  message: string
  thinkingLevel: 'standard' | 'extra'
  snapshot: ContentCanvasSnapshot
  conversationHistory: PlannerMessage[]
  autoSelectionBlockIds: string[]
  requestKind: ContentCanvasRequestKind
  abortSignal?: AbortSignal
  repairContext?: string
}): Promise<ContentCanvasActionDecision> {
  const config = await resolveContentCanvasActorConfig()

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const repairContext =
      attempt === 0
        ? params.repairContext
        : (params.repairContext ??
          'The previous response was not executable. Return the smallest valid action batch that safely moves the request forward.')

    const request = {
      model: config.model,
      systemPrompt: buildActorSystemPrompt(params.thinkingLevel, params.requestKind),
      messages: [
        {
          role: 'user' as const,
          content: buildActorUserPrompt({
            message: params.message,
            thinkingLevel: params.thinkingLevel,
            snapshot: params.snapshot,
            conversationHistory: params.conversationHistory,
            autoSelectionBlockIds: params.autoSelectionBlockIds,
            repairContext,
          }),
        },
      ],
      temperature: params.thinkingLevel === 'extra' ? 0.15 : 0.1,
      maxTokens: params.thinkingLevel === 'extra' ? 2000 : 1200,
      responseFormat: {
        name: 'content_canvas_action_batch',
        schema: z.toJSONSchema(contentCanvasActionBatchSchema),
        strict: true,
      },
      abortSignal: params.abortSignal,
    }

    const response = await executeContentCanvasTextRequest({
      workspaceId: '',
      model: request.model,
      systemPrompt: request.systemPrompt,
      prompt: String(request.messages[0]?.content ?? ''),
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      responseFormat: request.responseFormat,
    })

    try {
      let decision = parseActorBatchResponse(response?.content || '')
      if (decision.compatibilityPlan) {
        const normalizedPlan = normalizeTaskPlanForExplicitCreateIntent({
          message: params.message,
          plan: decision.compatibilityPlan,
          snapshot: params.snapshot,
          autoSelectionBlockIds: params.autoSelectionBlockIds,
        })
        if (normalizedPlan !== decision.compatibilityPlan) {
          decision = {
            batch: taskPlanToActionBatch(normalizedPlan),
            compatibilityPlan: normalizedPlan,
          }
        }
      }
      validateActionBatchForRequest({
        message: params.message,
        batch: decision.batch,
        autoSelectionBlockIds: params.autoSelectionBlockIds,
        requestKind: params.requestKind,
      })
      return decision
    } catch (error) {
      if (attempt === 1 || !(error instanceof ContentCanvasActorError)) {
        throw error
      }
      params = {
        ...params,
        repairContext: `${error.code}: ${error.message}`,
      }
    }
  }

  return {
    batch: {
      assistantText: '',
      shouldContinue: false,
      actions: [],
    },
  }
}

async function planContentCanvas(params: {
  message: string
  thinkingLevel: 'standard' | 'extra'
  snapshot: ContentCanvasSnapshot
  conversationHistory: PlannerMessage[]
  autoSelectionBlockIds: string[]
  requestKind?: ContentCanvasRequestKind
  abortSignal?: AbortSignal
}): Promise<ContentCanvasTaskPlan> {
  const decision = await decideNextCanvasActions({
    ...params,
    requestKind:
      params.requestKind ??
      classifyContentCanvasRequest({
        message: params.message,
        autoSelectionBlockIds: params.autoSelectionBlockIds,
      }),
  })
  return decision.compatibilityPlan ?? actionBatchToTaskPlan(decision.batch)
}

function buildVariantTitle(variant: ContentNodeVariant, count: number): string {
  const base = getContentNodePreset(variant)?.label ?? variant
  return `${base} ${count}`
}

function buildContentReferenceConnections(params: {
  sourceBlock: ContentCanvasBlockSnapshot
  targetBlock: ContentCanvasBlockSnapshot
}): Record<string, { block: string; handle: string }> {
  const ordinaryHandles = getOrdinaryContentReferenceHandles()

  return {
    [ordinaryHandles.sourceHandle]: {
      block: params.targetBlock.id,
      handle: ordinaryHandles.targetHandle,
    },
  }
}

function buildAddNodeOperation(params: {
  action: Extract<ContentCanvasPlanAction, { type: 'add_node' }>
  snapshot: ContentCanvasSnapshot
  index: number
  generatedBlockId: string
  resolveBlockId: (rawId: string) => string
  resolvedTitle: string
  targetBlock?: ContentCanvasBlockSnapshot
}): { operation: EditWorkflowOperation; block: ContentCanvasBlockSnapshot } {
  const variant = params.action.nodeType
  const preset = getContentNodePreset(variant)
  const lastBlock = params.snapshot.blocks.at(-1)
  const position = lastBlock
    ? {
        x: lastBlock.position.x + NODE_GAP_X,
        y: params.index % 2 === 0 ? lastBlock.position.y : lastBlock.position.y + NODE_GAP_Y / 2,
      }
    : { x: params.index * NODE_GAP_X, y: 0 }

  const inputs: Record<string, unknown> = {
    ...(preset?.presetSubBlockValues ?? {}),
    contentVariant: variant,
  }

  if (variant === 'text' && params.action.contentText) {
    inputs.contentHtml = convertGeneratedTextToContentHtml(params.action.contentText)
  }
  if (variant === 'text' && params.action.prompt) {
    inputs.aiPrompt = params.action.prompt
    inputs.aiModel = getValue(inputs, 'aiModel', TEXT_MODEL_FALLBACK)
  }
  if (variant === 'image' && params.action.prompt) {
    inputs.aiPrompt = params.action.prompt
    inputs.aiModel = getValue(inputs, 'aiModel', IMAGE_MODEL_FALLBACK)
  }
  if (variant === 'video' && params.action.prompt) {
    inputs.videoPrompt = params.action.prompt
    inputs.videoModelFamily = DEFAULT_VIDEO_MODEL_FAMILY
    inputs.videoFrameAspectRatioPreset = DEFAULT_VIDEO_FRAME_ASPECT_RATIO_PRESET
  }
  if (variant === 'audio' && params.action.prompt) {
    inputs.audioPrompt = params.action.prompt
    inputs.audioModel = DEFAULT_AUDIO_MODEL
    inputs.audioParameters = DEFAULT_AUDIO_PARAMETERS
  }

  const addedBlock: ContentCanvasBlockSnapshot = {
    id: params.generatedBlockId,
    name: params.resolvedTitle,
    type: 'content',
    variant,
    position,
    values: inputs,
  }

  const operation: EditWorkflowOperation = {
    operation_type: 'add',
    block_id: params.generatedBlockId,
    params: {
      type: 'content',
      name: params.resolvedTitle,
      position,
      inputs,
    },
  }

  if (params.action.targetBlockId) {
    operation.params = {
      ...operation.params,
      connections: params.targetBlock
        ? buildContentReferenceConnections({
            sourceBlock: addedBlock,
            targetBlock: params.targetBlock,
          })
        : {
            source: params.resolveBlockId(params.action.targetBlockId),
          },
    }
  }

  return {
    operation,
    block: addedBlock,
  }
}

function buildUpdateInputs(
  block: ContentCanvasBlockSnapshot,
  action: Extract<ContentCanvasPlanAction, { type: 'update_node' }>
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}

  if (block.variant === 'text' && action.contentText) {
    inputs.contentHtml = convertGeneratedTextToContentHtml(action.contentText)
  }
  if (block.variant === 'text' && action.prompt) {
    inputs.aiPrompt = action.prompt
  }
  if (block.variant === 'image' && action.prompt) {
    inputs.aiPrompt = action.prompt
  }
  if (block.variant === 'video' && action.prompt) {
    inputs.videoPrompt = action.prompt
  }
  if (block.variant === 'audio' && action.prompt) {
    inputs.audioPrompt = action.prompt
  }

  return inputs
}

function compileEditWorkflowOperations(params: {
  plan: LegacyContentCanvasPlan
  snapshot: ContentCanvasSnapshot
  existingBlockIdMap?: Map<string, string>
}): {
  operations: EditWorkflowOperation[]
  blockIdMap: Map<string, string>
} {
  const blockIdMap = new Map<string, string>(params.existingBlockIdMap ?? [])
  const knownBlocks = new Map(
    params.snapshot.blocks.map(
      (block) => [block.id, block] satisfies [string, ContentCanvasBlockSnapshot]
    )
  )
  const operations: EditWorkflowOperation[] = []
  const resolveBlockId = (rawId: string) => blockIdMap.get(rawId) ?? rawId
  const takenNormalizedNames = new Set(
    params.snapshot.blocks
      .map((block) => normalizeName(block.name || ''))
      .filter((name) => name.length > 0)
  )
  const reservedNormalizedNames = new Set(
    RESERVED_BLOCK_NAMES.map((name) => normalizeName(name)).filter((name) => name.length > 0)
  )

  for (const action of params.plan.actions) {
    if (action.type === 'add_node') {
      if (!blockIdMap.has(action.clientNodeId)) {
        blockIdMap.set(action.clientNodeId, generateId())
      }
    }
  }

  let addIndex = 0
  for (const action of params.plan.actions) {
    if (action.type !== 'add_node') continue
    const existingCount = params.snapshot.blocks.filter(
      (block) => block.variant === action.nodeType
    ).length
    const baseTitle =
      action.title?.trim() || buildVariantTitle(action.nodeType, existingCount + addIndex + 1)
    const resolvedTitle = buildUniqueNodeName(
      baseTitle,
      takenNormalizedNames,
      reservedNormalizedNames
    )
    const targetBlock = action.targetBlockId
      ? knownBlocks.get(resolveBlockId(action.targetBlockId))
      : undefined
    const { operation, block } = buildAddNodeOperation({
      action,
      snapshot: params.snapshot,
      index: addIndex++,
      generatedBlockId: resolveBlockId(action.clientNodeId),
      resolveBlockId,
      resolvedTitle,
      targetBlock,
    })
    operations.push(operation)
    knownBlocks.set(block.id, block)
  }

  for (const action of params.plan.actions) {
    if (action.type === 'update_node') {
      const blockId = resolveBlockId(action.blockId)
      const block = knownBlocks.get(blockId)
      if (!block) continue
      const inputs = buildUpdateInputs(block, action)
      operations.push({
        operation_type: 'edit',
        block_id: blockId,
        params: {
          ...(action.title ? { name: action.title } : {}),
          ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
        },
      })
      knownBlocks.set(blockId, {
        ...block,
        name: action.title ?? block.name,
        values: Object.keys(inputs).length > 0 ? { ...block.values, ...inputs } : block.values,
      })
      continue
    }

    if (action.type === 'delete_node') {
      knownBlocks.delete(resolveBlockId(action.blockId))
      operations.push({
        operation_type: 'delete',
        block_id: resolveBlockId(action.blockId),
      })
      continue
    }

    if (action.type === 'connect_nodes') {
      const sourceBlockId = resolveBlockId(action.sourceBlockId)
      const targetBlockId = resolveBlockId(action.targetBlockId)
      const sourceBlock = knownBlocks.get(sourceBlockId)
      const targetBlock = knownBlocks.get(targetBlockId)
      operations.push({
        operation_type: 'edit',
        block_id: sourceBlockId,
        params: {
          connections:
            sourceBlock && targetBlock
              ? buildContentReferenceConnections({
                  sourceBlock,
                  targetBlock,
                })
              : {
                  source: targetBlockId,
                },
        },
      })
      continue
    }

    if (action.type === 'layout_nodes') {
      const targetIds =
        action.blockIds && action.blockIds.length > 0
          ? action.blockIds.map(resolveBlockId)
          : [
              ...params.snapshot.blocks.map((block) => block.id),
              ...Array.from(blockIdMap.values()).filter(
                (blockId) => !params.snapshot.blocks.some((block) => block.id === blockId)
              ),
            ]

      targetIds.forEach((blockId, index) => {
        const position =
          action.direction === 'vertical'
            ? { x: 0, y: index * NODE_GAP_Y }
            : action.direction === 'grid'
              ? { x: (index % 2) * NODE_GAP_X, y: Math.floor(index / 2) * NODE_GAP_Y }
              : { x: index * NODE_GAP_X, y: 0 }

        operations.push({
          operation_type: 'edit',
          block_id: blockId,
          params: { position },
        })
        const block = knownBlocks.get(blockId)
        if (block) {
          knownBlocks.set(blockId, {
            ...block,
            position,
          })
        }
      })
    }
  }

  return { operations, blockIdMap }
}

function createToolCallState(input: {
  toolCallId: string
  workflowId: string
  operations: EditWorkflowOperation[]
}): ToolCallState {
  return {
    id: input.toolCallId,
    name: EditWorkflow.id,
    status: 'executing',
    params: {
      workflowId: input.workflowId,
      operations: input.operations,
    },
    startTime: Date.now(),
  }
}

async function emitAssistantText(
  context: StreamingContext,
  options: AgentOptions,
  text: string
): Promise<void> {
  if (!text) return

  context.accumulatedContent = text
  context.contentBlocks.push({
    type: 'text',
    content: text,
    timestamp: Date.now(),
    endedAt: Date.now(),
  })

  await options.onEvent?.({
    type: MothershipStreamV1EventType.text,
    payload: {
      channel: MothershipStreamV1TextChannel.assistant,
      text,
    },
  })
}

async function emitAssistantResponse(params: {
  context: StreamingContext
  options: AgentOptions
  text: string
  optionItems?: OptionItem[]
}): Promise<void> {
  const { context, options, text, optionItems } = params
  const renderedText =
    optionItems && optionItems.length > 0
      ? `${text.trim() ? `${text}\n\n` : ''}${buildOptionsTag(optionItems)}`
      : text

  context.accumulatedContent = renderedText
  context.contentBlocks = []

  if (text.trim()) {
    context.contentBlocks.push({
      type: 'text',
      content: text,
      timestamp: Date.now(),
      endedAt: Date.now(),
    })
  }

  if (optionItems && optionItems.length > 0) {
    context.contentBlocks.push({
      type: 'options',
      options: optionItems,
      timestamp: Date.now(),
      endedAt: Date.now(),
    })
  }

  await options.onEvent?.({
    type: MothershipStreamV1EventType.text,
    payload: {
      channel: MothershipStreamV1TextChannel.assistant,
      text: renderedText,
    },
  })
}

async function emitActionEvent(params: {
  context: StreamingContext
  name: ActionEventName
  text: string
  status?: 'info' | 'success' | 'warning' | 'error'
}): Promise<void> {
  params.context.contentBlocks.push({
    type: 'action_event',
    actionEvent: {
      name: params.name,
      text: params.text,
      status: params.status,
    },
    timestamp: Date.now(),
    endedAt: Date.now(),
  })
}

async function executeEditWorkflowOperations(params: {
  workflowId: string
  operations: EditWorkflowOperation[]
  context: StreamingContext
  execContext: ExecutionContext
  options: AgentOptions
}): Promise<EditWorkflowExecutionOutput | unknown> {
  const toolCallId = generateId()
  const toolCall = createToolCallState({
    toolCallId,
    workflowId: params.workflowId,
    operations: params.operations,
  })

  params.context.toolCalls.set(toolCallId, toolCall)
  params.context.contentBlocks.push({
    type: 'tool_call',
    toolCall,
    timestamp: Date.now(),
  })

  await params.options.onEvent?.({
    type: MothershipStreamV1EventType.tool,
    payload: {
      toolCallId,
      toolName: EditWorkflow.id,
      executor: MothershipStreamV1ToolExecutor.sim,
      mode: MothershipStreamV1ToolMode.async,
      phase: MothershipStreamV1ToolPhase.call,
      status: 'executing',
      arguments: {
        workflowId: params.workflowId,
        operations: params.operations,
      },
    },
  })

  try {
    const output = await editWorkflowServerTool.execute(
      {
        workflowId: params.workflowId,
        operations: params.operations,
      } satisfies EditWorkflowParams,
      {
        userId: params.execContext.userId,
        workspaceId: params.execContext.workspaceId,
        chatId: params.execContext.chatId,
        messageId: params.execContext.messageId,
        abortSignal: params.options.abortSignal,
      }
    )

    setTerminalToolCallState(toolCall, {
      status: MothershipStreamV1ToolOutcome.success,
      output,
    })

    await params.options.onEvent?.({
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId,
        toolName: EditWorkflow.id,
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.result,
        status: MothershipStreamV1ToolOutcome.success,
        success: true,
        output,
      },
    })
    return output
  } catch (error) {
    const errorMessage = toError(error).message
    setTerminalToolCallState(toolCall, {
      status: MothershipStreamV1ToolOutcome.error,
      error: errorMessage,
    })
    params.context.errors.push(errorMessage)

    await params.options.onEvent?.({
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId,
        toolName: EditWorkflow.id,
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.result,
        status: MothershipStreamV1ToolOutcome.error,
        success: false,
        error: errorMessage,
        output: { error: errorMessage },
      },
    })

    throw error
  }
}

function getEditWorkflowExecutionOutput(value: unknown): EditWorkflowExecutionOutput | null {
  if (!value || typeof value !== 'object') return null
  return value as EditWorkflowExecutionOutput
}

function verifyPlannedStructureApplied(params: {
  plan: LegacyContentCanvasPlan
  snapshotAfterStructure: ContentCanvasSnapshot
  blockIdMap: Map<string, string>
  structureOutput: unknown
}): void {
  const missingAddedBlocks = params.plan.actions
    .filter(
      (action): action is Extract<ContentCanvasPlanAction, { type: 'add_node' }> =>
        action.type === 'add_node'
    )
    .filter((action) => {
      const blockId = params.blockIdMap.get(action.clientNodeId)
      return !blockId || !params.snapshotAfterStructure.blocks.some((block) => block.id === blockId)
    })

  const missingGenerateTargets = params.plan.actions
    .filter(
      (action): action is Extract<ContentCanvasPlanAction, { type: 'generate_node_output' }> =>
        action.type === 'generate_node_output'
    )
    .filter((action) => {
      const blockId = params.blockIdMap.get(action.blockId) ?? action.blockId
      return !params.snapshotAfterStructure.blocks.some((block) => block.id === blockId)
    })

  if (missingAddedBlocks.length === 0 && missingGenerateTargets.length === 0) {
    return
  }

  const output = getEditWorkflowExecutionOutput(params.structureOutput)
  const details = [
    ...(output?.skippedItems ?? []),
    ...(output?.inputValidationErrors ?? []),
    ...(output?.skippedItemsMessage ? [output.skippedItemsMessage] : []),
    ...(output?.inputValidationMessage ? [output.inputValidationMessage] : []),
  ].filter((entry) => entry && entry.trim().length > 0)

  const missingAddLabels = missingAddedBlocks.map((action) => action.title || action.clientNodeId)
  const missingGenerateLabels = missingGenerateTargets.map((action) => action.blockId)
  const failureSummary = [
    missingAddLabels.length > 0 ? `missing added nodes: ${missingAddLabels.join(', ')}` : null,
    missingGenerateLabels.length > 0
      ? `missing generation targets: ${missingGenerateLabels.join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join('; ')

  throw new Error(
    `content canvas structure verification failed: ${failureSummary}${
      details.length > 0 ? `. Details: ${details.join('; ')}` : ''
    }`
  )
}

async function generateTextOutput(params: {
  block: ContentCanvasBlockSnapshot
  workspaceId: string
}): Promise<string> {
  const model = getStringValue(params.block.values.aiModel) ?? TEXT_MODEL_FALLBACK
  const prompt = getStringValue(params.block.values.aiPrompt)
  if (!prompt) {
    throw new Error(`Text node "${params.block.name}" is missing an AI prompt`)
  }

  return generateContentCanvasText({
    workspaceId: params.workspaceId,
    model,
    systemPrompt: buildTextNodeAiSystemPrompt(),
    prompt,
    maxTokens: 1800,
  })
}

async function generateImageOutput(params: {
  block: ContentCanvasBlockSnapshot
  workspaceId: string
  userId: string
}) {
  const prompt = getStringValue(params.block.values.aiPrompt)
  if (!prompt) {
    throw new Error(`Image node "${params.block.name}" is missing an AI prompt`)
  }

  return generateWorkspaceImageFromPrompt({
    workspaceId: params.workspaceId,
    userId: params.userId,
    model:
      (getStringValue(params.block.values.aiModel) as 'jimeng-4.0' | 'jimeng-4.5' | undefined) ??
      IMAGE_MODEL_FALLBACK,
    prompt,
    aspectRatio:
      (getStringValue(params.block.values.aiAspectRatio) as
        | 'auto'
        | '1:1'
        | '4:3'
        | '3:4'
        | '16:9'
        | '9:16'
        | '3:2'
        | '2:3'
        | '21:9'
        | undefined) ?? 'auto',
  })
}

async function generateAudioOutput(params: {
  block: ContentCanvasBlockSnapshot
  workspaceId: string
  userId: string
}) {
  const prompt = getStringValue(params.block.values.audioPrompt)
  if (!prompt) {
    throw new Error(`Audio node "${params.block.name}" is missing an audio prompt`)
  }

  return generateWorkspaceAudioFromPrompt({
    workspaceId: params.workspaceId,
    userId: params.userId,
    model:
      (getStringValue(params.block.values.audioModel) as
        | 'suno-v5-beta'
        | 'suno-v4.5-beta'
        | 'suno-v4-beta'
        | undefined) ?? DEFAULT_AUDIO_MODEL,
    prompt,
    parameters:
      (params.block.values.audioParameters as typeof DEFAULT_AUDIO_PARAMETERS | undefined) ??
      DEFAULT_AUDIO_PARAMETERS,
  })
}

function findIncomingImageFile(
  block: ContentCanvasBlockSnapshot,
  snapshot: ContentCanvasSnapshot
): {
  id: string
  name: string
  url: string
  key: string
  size: number
  type: string
  context?: string
} | null {
  const incoming = snapshot.edges.find((edge) => edge.target === block.id)
  if (!incoming) return null

  const source = snapshot.blocks.find(
    (candidate) => candidate.id === incoming.source && candidate.variant === 'image'
  )
  if (!source) return null

  const file = getRecordValue(source.values, 'file')
  const url =
    getStringValue(getRecordValue(file, 'path')) ?? getStringValue(getRecordValue(file, 'url'))
  const key = getStringValue(getRecordValue(file, 'key'))
  if (!url || !key) return null

  return {
    id: getStringValue(getRecordValue(file, 'id')) ?? key,
    name: getStringValue(getRecordValue(file, 'name')) ?? `${source.name}.png`,
    url,
    key,
    size: getNumberValue(getRecordValue(file, 'size')) ?? 0,
    type: getStringValue(getRecordValue(file, 'type')) ?? 'image/png',
    context: getStringValue(getRecordValue(file, 'context')),
  }
}

async function generateVideoOutput(params: {
  block: ContentCanvasBlockSnapshot
  snapshot: ContentCanvasSnapshot
  workspaceId: string
  userId: string
}) {
  const prompt = getStringValue(params.block.values.videoPrompt)
  if (!prompt) {
    throw new Error(`Video node "${params.block.name}" is missing a video prompt`)
  }

  const firstFrame = findIncomingImageFile(params.block, params.snapshot)
  const modelFamily =
    (getStringValue(params.block.values.videoModelFamily) as 'wan2.7' | 'wan2.6' | undefined) ??
    (firstFrame ? DEFAULT_VIDEO_MODEL_FAMILY : 'wan2.6')
  const resolvedModel = resolveVideoGenerationModelId({
    modelFamily,
    hasFirstFrame: Boolean(firstFrame),
  })

  return generateWorkspaceVideoFromPrompt({
    workspaceId: params.workspaceId,
    userId: params.userId,
    model: resolvedModel,
    prompt,
    media: firstFrame ? [{ type: 'first_frame' as const, file: firstFrame }] : [],
    parameters: {
      aspectRatioPreset:
        (getStringValue(params.block.values.videoFrameAspectRatioPreset) as
          | '16:9'
          | '9:16'
          | '1:1'
          | undefined) ?? DEFAULT_VIDEO_FRAME_ASPECT_RATIO_PRESET,
      resolution:
        (getRecordValue(params.block.values.videoParameters, 'resolution') as
          | '720P'
          | '1080P'
          | undefined) ?? DEFAULT_VIDEO_RESOLUTION,
      duration:
        getNumberValue(getRecordValue(params.block.values.videoParameters, 'duration')) ??
        DEFAULT_VIDEO_DURATION_SECONDS,
      promptExtend: true,
      watermark: false,
    },
  })
}

async function buildWritebackOperations(params: {
  plan: LegacyContentCanvasPlan
  snapshot: ContentCanvasSnapshot
  blockIdMap: Map<string, string>
  workspaceId: string
  userId: string
}): Promise<EditWorkflowOperation[]> {
  const operations: EditWorkflowOperation[] = []
  const resolveBlockId = (rawId: string) => params.blockIdMap.get(rawId) ?? rawId

  for (const action of params.plan.actions) {
    if (action.type !== 'generate_node_output') continue

    const blockId = resolveBlockId(action.blockId)
    const block = params.snapshot.blocks.find((entry) => entry.id === blockId)
    if (!block) continue

    if (block.variant === 'text') {
      const generatedText = await generateTextOutput({
        block,
        workspaceId: params.workspaceId,
      })
      operations.push({
        operation_type: 'edit',
        block_id: block.id,
        params: {
          inputs: {
            contentHtml:
              action.textApplyMode === 'append'
                ? `${String(getValue(block.values, 'contentHtml', '<p></p>'))}${convertGeneratedTextToContentHtml(generatedText)}`
                : convertGeneratedTextToContentHtml(generatedText),
          },
        },
      })
      continue
    }

    if (block.variant === 'image') {
      const result = await generateImageOutput({
        block,
        workspaceId: params.workspaceId,
        userId: params.userId,
      })
      operations.push({
        operation_type: 'edit',
        block_id: block.id,
        params: {
          inputs: {
            file: {
              id: result.file.id,
              name: result.file.name,
              path: result.file.url,
              key: result.file.key,
              size: result.file.size,
              type: result.file.type,
              context: result.file.context,
            },
          },
        },
      })
      continue
    }

    if (block.variant === 'video') {
      const result = await generateVideoOutput({
        block,
        snapshot: params.snapshot,
        workspaceId: params.workspaceId,
        userId: params.userId,
      })
      operations.push({
        operation_type: 'edit',
        block_id: block.id,
        params: {
          inputs: {
            file: {
              id: result.file.id,
              name: result.file.name,
              path: result.file.url,
              key: result.file.key,
              size: result.file.size,
              type: result.file.type,
              context: result.file.context,
            },
          },
        },
      })
      continue
    }

    const result = await generateAudioOutput({
      block,
      workspaceId: params.workspaceId,
      userId: params.userId,
    })
    operations.push({
      operation_type: 'edit',
      block_id: block.id,
      params: {
        inputs: {
          file: {
            id: result.file.id,
            name: result.file.name,
            path: result.file.url,
            key: result.file.key,
            size: result.file.size,
            type: result.file.type,
            context: result.file.context,
          },
        },
      },
    })
  }

  return operations
}

type GeneratedOutputValue =
  | {
      kind: 'text'
      text: string
    }
  | {
      kind: 'file'
      file: {
        id: string
        name: string
        url: string
        key: string
        size: number
        type: string
        context?: string
      }
    }

interface ContentCanvasExecutionRuntime {
  blockIdMap: Map<string, string>
  generatedOutputs: Map<string, GeneratedOutputValue>
  createStepsByRef: Map<string, Extract<ContentCanvasTaskStep, { type: 'create_node' }>>
}

function assertNonStreamingProviderResponse(
  response: ProviderResponse | ReadableStream | { stream: unknown; execution: unknown }
): ProviderResponse {
  if (
    !response ||
    typeof response !== 'object' ||
    response instanceof ReadableStream ||
    'stream' in response
  ) {
    throw new Error('Expected a non-streaming provider response')
  }

  return response as ProviderResponse
}

function resolveTaskBlockId(blockId: string, runtime: ContentCanvasExecutionRuntime): string {
  return runtime.blockIdMap.get(blockId) ?? blockId
}

function buildTaskStepLegacyPlan(step: ContentCanvasTaskStep): LegacyContentCanvasPlan {
  switch (step.type) {
    case 'create_node':
      return {
        assistantText: '',
        summary: '',
        actions: [
          {
            type: 'add_node',
            clientNodeId: step.clientNodeId,
            nodeType: step.nodeType,
            ...(step.title ? { title: step.title } : {}),
            ...(step.contentText ? { contentText: step.contentText } : {}),
            ...(step.prompt ? { prompt: step.prompt } : {}),
            ...(step.targetBlockId ? { targetBlockId: step.targetBlockId } : {}),
          },
        ],
      }
    case 'update_node':
      return {
        assistantText: '',
        summary: '',
        actions: [
          {
            type: 'update_node',
            blockId: step.blockId,
            ...(step.title ? { title: step.title } : {}),
            ...(step.contentText ? { contentText: step.contentText } : {}),
            ...(step.prompt ? { prompt: step.prompt } : {}),
          },
        ],
      }
    case 'connect_nodes':
      return {
        assistantText: '',
        summary: '',
        actions: [
          {
            type: 'connect_nodes',
            sourceBlockId: step.sourceBlockId,
            targetBlockId: step.targetBlockId,
          },
        ],
      }
    case 'layout_nodes':
      return {
        assistantText: '',
        summary: '',
        actions: [
          {
            type: 'layout_nodes',
            direction: step.direction,
            ...(step.blockIds ? { blockIds: step.blockIds } : {}),
          },
        ],
      }
    default:
      return {
        assistantText: '',
        summary: '',
        actions: [],
      }
  }
}

async function buildGeneratedOutput(params: {
  block: ContentCanvasBlockSnapshot
  snapshot: ContentCanvasSnapshot
  workspaceId: string
  userId: string
}): Promise<GeneratedOutputValue> {
  if (params.block.variant === 'text') {
    const text = await generateTextOutput({
      block: params.block,
      workspaceId: params.workspaceId,
    })
    return { kind: 'text', text }
  }

  if (params.block.variant === 'image') {
    const result = await generateImageOutput({
      block: params.block,
      workspaceId: params.workspaceId,
      userId: params.userId,
    })
    return {
      kind: 'file',
      file: {
        id: result.file.id,
        name: result.file.name,
        url: result.file.url,
        key: result.file.key,
        size: result.file.size,
        type: result.file.type,
        context: result.file.context,
      },
    }
  }

  if (params.block.variant === 'video') {
    const result = await generateVideoOutput({
      block: params.block,
      snapshot: params.snapshot,
      workspaceId: params.workspaceId,
      userId: params.userId,
    })
    return {
      kind: 'file',
      file: {
        id: result.file.id,
        name: result.file.name,
        url: result.file.url,
        key: result.file.key,
        size: result.file.size,
        type: result.file.type,
        context: result.file.context,
      },
    }
  }

  const result = await generateAudioOutput({
    block: params.block,
    workspaceId: params.workspaceId,
    userId: params.userId,
  })
  return {
    kind: 'file',
    file: {
      id: result.file.id,
      name: result.file.name,
      url: result.file.url,
      key: result.file.key,
      size: result.file.size,
      type: result.file.type,
      context: result.file.context,
    },
  }
}

function buildWritebackOperationForGeneratedOutput(params: {
  block: ContentCanvasBlockSnapshot
  generatedOutput: GeneratedOutputValue
  textApplyMode?: 'replace' | 'append'
}): EditWorkflowOperation {
  if (params.generatedOutput.kind === 'text') {
    return {
      operation_type: 'edit',
      block_id: params.block.id,
      params: {
        inputs: {
          contentHtml:
            params.textApplyMode === 'append'
              ? `${String(getValue(params.block.values, 'contentHtml', '<p></p>'))}${convertGeneratedTextToContentHtml(params.generatedOutput.text)}`
              : convertGeneratedTextToContentHtml(params.generatedOutput.text),
        },
      },
    }
  }

  return {
    operation_type: 'edit',
    block_id: params.block.id,
    params: {
      inputs: {
        file: {
          id: params.generatedOutput.file.id,
          name: params.generatedOutput.file.name,
          path: params.generatedOutput.file.url,
          key: params.generatedOutput.file.key,
          size: params.generatedOutput.file.size,
          type: params.generatedOutput.file.type,
          context: params.generatedOutput.file.context,
        },
      },
    },
  }
}

function hasSnapshotConnection(
  snapshot: ContentCanvasSnapshot,
  sourceBlockId: string,
  targetBlockId: string
): boolean {
  return snapshot.edges.some(
    (edge) => edge.source === sourceBlockId && edge.target === targetBlockId
  )
}

function applyWritebackToSnapshot(params: {
  snapshot: ContentCanvasSnapshot
  blockId: string
  operation: EditWorkflowOperation
}): ContentCanvasSnapshot {
  return {
    ...params.snapshot,
    blocks: params.snapshot.blocks.map((block) => {
      if (block.id !== params.blockId) {
        return block
      }
      const inputs = getRecordValue(params.operation.params, 'inputs')
      return {
        ...block,
        values:
          inputs && typeof inputs === 'object'
            ? {
                ...block.values,
                ...(inputs as Record<string, unknown>),
              }
            : block.values,
      }
    }),
  }
}

function verifyTaskStepApplied(params: {
  step: ContentCanvasTaskStep
  snapshot: ContentCanvasSnapshot
  runtime: ContentCanvasExecutionRuntime
}): void {
  const { step, snapshot, runtime } = params
  if (step.type === 'create_node') {
    const blockId = resolveTaskBlockId(step.clientNodeId, runtime)
    if (!snapshot.blocks.some((block) => block.id === blockId)) {
      throw new Error(`missing created node: ${step.clientNodeId}`)
    }
    return
  }

  if (step.type === 'update_node') {
    const blockId = resolveTaskBlockId(step.blockId, runtime)
    const block = snapshot.blocks.find((entry) => entry.id === blockId)
    if (!block) {
      throw new Error(`missing updated node: ${step.blockId}`)
    }
    if (step.title && block.name !== step.title) {
      throw new Error(`updated node title mismatch: ${step.blockId}`)
    }
    return
  }

  if (step.type === 'connect_nodes') {
    const sourceBlockId = resolveTaskBlockId(step.sourceBlockId, runtime)
    const targetBlockId = resolveTaskBlockId(step.targetBlockId, runtime)
    if (!hasSnapshotConnection(snapshot, sourceBlockId, targetBlockId)) {
      throw new Error(`missing connection: ${step.sourceBlockId}->${step.targetBlockId}`)
    }
    return
  }

  if (step.type === 'layout_nodes') {
    const blockIds =
      step.blockIds?.map((blockId) => resolveTaskBlockId(blockId, runtime)) ??
      snapshot.blocks.map((block) => block.id)
    const missingBlockId = blockIds.find(
      (blockId) => !snapshot.blocks.some((block) => block.id === blockId)
    )
    if (missingBlockId) {
      throw new Error(`missing layout target: ${missingBlockId}`)
    }
    return
  }

  if (step.type === 'generate_output') {
    const blockId = resolveTaskBlockId(step.blockId, runtime)
    if (!snapshot.blocks.some((block) => block.id === blockId)) {
      throw new Error(`missing generation target: ${step.blockId}`)
    }
    if (!runtime.generatedOutputs.has(blockId)) {
      throw new Error(`missing generated output: ${step.blockId}`)
    }
    return
  }

  const blockId = resolveTaskBlockId(step.blockId, runtime)
  const block = snapshot.blocks.find((entry) => entry.id === blockId)
  if (!block) {
    throw new Error(`missing generation target: ${step.blockId}`)
  }
  if (block.variant === 'text') {
    const contentHtml = getStringValue(block.values.contentHtml)
    if (!contentHtml) {
      throw new Error(`missing writeback output: ${step.blockId}`)
    }
    return
  }
  const file = getRecordValue(block.values, 'file')
  const filePath =
    getStringValue(getRecordValue(file, 'path')) ?? getStringValue(getRecordValue(file, 'url'))
  if (!filePath) {
    throw new Error(`missing writeback output: ${step.blockId}`)
  }
}

function buildTaskStepSummary(params: {
  message: string
  step: ContentCanvasTaskStep
  snapshot: ContentCanvasSnapshot
  runtime?: ContentCanvasExecutionRuntime
}): string {
  const chinese = isChineseMessage(params.message)
  const runtime = params.runtime

  if (params.step.type === 'create_node') {
    const label = getNodeVariantLabelV2(params.step.nodeType, chinese)
    return chinese ? `已新建${label}节点` : `Created ${label} node`
  }
  if (params.step.type === 'update_node') {
    const blockId = runtime ? resolveTaskBlockId(params.step.blockId, runtime) : params.step.blockId
    return chinese
      ? `已更新 ${getActionTargetLabelV2(params.snapshot, blockId, chinese)}`
      : `Updated ${getActionTargetLabelV2(params.snapshot, blockId, chinese)}`
  }
  if (params.step.type === 'connect_nodes') {
    const sourceBlockId = runtime
      ? resolveTaskBlockId(params.step.sourceBlockId, runtime)
      : params.step.sourceBlockId
    const targetBlockId = runtime
      ? resolveTaskBlockId(params.step.targetBlockId, runtime)
      : params.step.targetBlockId
    return chinese
      ? `已连接 ${getActionTargetLabelV2(params.snapshot, sourceBlockId, chinese)} 到 ${getActionTargetLabelV2(params.snapshot, targetBlockId, chinese)}`
      : `Connected ${getActionTargetLabelV2(params.snapshot, sourceBlockId, chinese)} to ${getActionTargetLabelV2(params.snapshot, targetBlockId, chinese)}`
  }
  if (params.step.type === 'layout_nodes') {
    return chinese ? '已整理节点排布' : 'Re-arranged the selected nodes'
  }
  if (params.step.type === 'generate_output') {
    const blockId = runtime ? resolveTaskBlockId(params.step.blockId, runtime) : params.step.blockId
    return chinese
      ? `已生成 ${getActionTargetLabelV2(params.snapshot, blockId, chinese)} 的内容`
      : `Generated output for ${getActionTargetLabelV2(params.snapshot, blockId, chinese)}`
  }
  const blockId = runtime ? resolveTaskBlockId(params.step.blockId, runtime) : params.step.blockId
  return chinese
    ? `已写回 ${getActionTargetLabelV2(params.snapshot, blockId, chinese)}`
    : `Wrote output back to ${getActionTargetLabelV2(params.snapshot, blockId, chinese)}`
}

async function executeSingleTaskStep(params: {
  step: ContentCanvasTaskStep
  workflowId: string
  workspaceId: string
  userId: string
  snapshot: ContentCanvasSnapshot
  runtime: ContentCanvasExecutionRuntime
  context: StreamingContext
  execContext: ExecutionContext
  options: AgentOptions
}): Promise<ContentCanvasSnapshot> {
  const { step } = params
  if (
    step.type === 'create_node' ||
    step.type === 'update_node' ||
    step.type === 'connect_nodes' ||
    step.type === 'layout_nodes'
  ) {
    const { operations, blockIdMap } = compileEditWorkflowOperations({
      plan: buildTaskStepLegacyPlan(step),
      snapshot: params.snapshot,
      existingBlockIdMap: params.runtime.blockIdMap,
    })
    params.runtime.blockIdMap = blockIdMap
    const output = await executeEditWorkflowOperations({
      workflowId: params.workflowId,
      operations,
      context: params.context,
      execContext: params.execContext,
      options: params.options,
    })
    const result = getEditWorkflowExecutionOutput(output)
    return result?.workflowState
      ? snapshotFromWorkflowState(result.workflowState)
      : await loadContentCanvasSnapshot(params.workflowId)
  }

  if (step.type === 'generate_output') {
    const blockId = resolveTaskBlockId(step.blockId, params.runtime)
    const block = params.snapshot.blocks.find((entry) => entry.id === blockId)
    if (!block) {
      throw new Error(`missing generation target: ${step.blockId}`)
    }
    const generatedOutput = await buildGeneratedOutput({
      block,
      snapshot: params.snapshot,
      workspaceId: params.workspaceId,
      userId: params.userId,
    })
    params.runtime.generatedOutputs.set(blockId, generatedOutput)
    return params.snapshot
  }

  const blockId = resolveTaskBlockId(step.blockId, params.runtime)
  const block = params.snapshot.blocks.find((entry) => entry.id === blockId)
  if (!block) {
    throw new Error(`missing generation target: ${step.blockId}`)
  }
  const generatedOutput = params.runtime.generatedOutputs.get(blockId)
  if (!generatedOutput) {
    throw new Error(`missing generated output: ${step.blockId}`)
  }
  const writebackOperation = buildWritebackOperationForGeneratedOutput({
    block,
    generatedOutput,
    textApplyMode: step.textApplyMode,
  })
  const output = await executeEditWorkflowOperations({
    workflowId: params.workflowId,
    operations: [writebackOperation],
    context: params.context,
    execContext: params.execContext,
    options: params.options,
  })
  const result = getEditWorkflowExecutionOutput(output)
  return result?.workflowState
    ? snapshotFromWorkflowState(result.workflowState)
    : applyWritebackToSnapshot({
        snapshot: params.snapshot,
        blockId,
        operation: writebackOperation,
      })
}

async function repairTaskStepIfPossible(params: {
  step: ContentCanvasTaskStep
  workflowId: string
  workspaceId: string
  userId: string
  snapshot: ContentCanvasSnapshot
  runtime: ContentCanvasExecutionRuntime
  context: StreamingContext
  execContext: ExecutionContext
  options: AgentOptions
  message: string
  error: Error
}): Promise<ContentCanvasSnapshot | null> {
  const chinese = isChineseMessage(params.message)
  const errorMessage = params.error.message

  if (params.step.type === 'create_node' && errorMessage.includes('missing created node')) {
    await emitActionEvent({
      context: params.context,
      name: 'repaired_step',
      text: chinese
        ? '新节点第一次没有落盘，正在自动重试。'
        : 'The new node did not stick, retrying once.',
      status: 'warning',
    })
    return executeSingleTaskStep(params)
  }

  if (params.step.type === 'connect_nodes' && errorMessage.includes('missing connection')) {
    await emitActionEvent({
      context: params.context,
      name: 'repaired_step',
      text: chinese
        ? '连线没有成功，正在基于最新画布重试。'
        : 'The connection did not apply, retrying on the latest canvas.',
      status: 'warning',
    })
    return executeSingleTaskStep(params)
  }

  if (
    (params.step.type === 'generate_output' || params.step.type === 'writeback_output') &&
    errorMessage.includes('missing generation target')
  ) {
    const createStep = params.runtime.createStepsByRef.get(params.step.blockId)
    if (!createStep) {
      return null
    }
    await emitActionEvent({
      context: params.context,
      name: 'repaired_step',
      text: chinese
        ? '生成目标丢失，先补回结构再继续。'
        : 'The generation target is missing, repairing structure first.',
      status: 'warning',
    })
    const repairedSnapshot = await executeSingleTaskStep({
      ...params,
      step: createStep,
      snapshot: params.snapshot,
    })
    verifyTaskStepApplied({
      step: createStep,
      snapshot: repairedSnapshot,
      runtime: params.runtime,
    })
    return repairedSnapshot
  }

  return null
}

async function executeVerifiedTaskStep(params: {
  step: ContentCanvasTaskStep
  workflowId: string
  workspaceId: string
  userId: string
  snapshot: ContentCanvasSnapshot
  runtime: ContentCanvasExecutionRuntime
  context: StreamingContext
  execContext: ExecutionContext
  options: AgentOptions
  message: string
}): Promise<ContentCanvasSnapshot> {
  try {
    const snapshotAfterStep = await executeSingleTaskStep(params)
    verifyTaskStepApplied({
      step: params.step,
      snapshot: snapshotAfterStep,
      runtime: params.runtime,
    })
    return snapshotAfterStep
  } catch (error) {
    const repairedSnapshot = await repairTaskStepIfPossible({
      ...params,
      error: toError(error),
    })
    if (!repairedSnapshot) {
      throw error
    }
    const snapshotAfterRetry =
      params.step.type === 'generate_output' || params.step.type === 'writeback_output'
        ? await executeSingleTaskStep({
            ...params,
            snapshot: repairedSnapshot,
          })
        : repairedSnapshot
    verifyTaskStepApplied({
      step: params.step,
      snapshot: snapshotAfterRetry,
      runtime: params.runtime,
    })
    return snapshotAfterRetry
  }
}

function buildBlockedStepMessage(message: string, reason: string): string {
  return isChineseMessage(message)
    ? `这一步我自动修复后还是无法继续：${reason}`
    : `I could not safely continue after retrying this step: ${reason}`
}

async function executeTaskPlan(params: {
  workflowId: string
  workspaceId: string
  userId: string
  plan: ContentCanvasTaskPlan
  snapshot: ContentCanvasSnapshot
  context: StreamingContext
  execContext: ExecutionContext
  options: AgentOptions
  message: string
  thinkingLevel: 'standard' | 'extra'
  conversationHistory: PlannerMessage[]
  autoSelectionBlockIds: string[]
  allowReplan?: boolean
}): Promise<ContentCanvasSnapshot> {
  const runtime: ContentCanvasExecutionRuntime = {
    blockIdMap: new Map(),
    generatedOutputs: new Map(),
    createStepsByRef: new Map(
      params.plan.steps
        .filter(
          (step): step is Extract<ContentCanvasTaskStep, { type: 'create_node' }> =>
            step.type === 'create_node'
        )
        .map((step) => [step.clientNodeId, step])
    ),
  }

  let snapshot = params.snapshot
  let replanUsed = false
  const remainingSteps = [...params.plan.steps]

  await emitActionEvent({
    context: params.context,
    name: 'understood_request',
    text:
      params.plan.intent.summary ||
      params.plan.summary ||
      (isChineseMessage(params.message)
        ? '已理解你的要求，开始处理画布。'
        : 'Understood the request and started editing the canvas.'),
    status: 'info',
  })

  for (let index = 0; index < remainingSteps.length; index += 1) {
    const step = remainingSteps[index]
    try {
      snapshot = await executeVerifiedTaskStep({
        step,
        workflowId: params.workflowId,
        workspaceId: params.workspaceId,
        userId: params.userId,
        snapshot,
        runtime,
        context: params.context,
        execContext: params.execContext,
        options: params.options,
        message: params.message,
      })
    } catch (error) {
      const reason = toError(error).message
      if (params.allowReplan && !replanUsed && remainingSteps.length - index > 1) {
        replanUsed = true
        const replanned = await planContentCanvas({
          message: `${params.message}\n\nRepair context: continue from the latest canvas after this issue: ${reason}`,
          thinkingLevel: 'extra',
          snapshot,
          conversationHistory: params.conversationHistory,
          autoSelectionBlockIds: params.autoSelectionBlockIds,
          abortSignal: params.options.abortSignal,
        })
        if (replanned.steps.length > 0) {
          remainingSteps.splice(index, remainingSteps.length - index, ...replanned.steps)
          await emitActionEvent({
            context: params.context,
            name: 'repaired_step',
            text: isChineseMessage(params.message)
              ? '我按最新画布重新整理了后续步骤，继续执行。'
              : 'Adjusted the remaining steps on the latest canvas and continued.',
            status: 'warning',
          })
          index -= 1
          continue
        }
      }

      const blockedMessage = buildBlockedStepMessage(params.message, reason)
      await emitActionEvent({
        context: params.context,
        name: 'blocked_step',
        text: blockedMessage,
        status: 'error',
      })
      throw new Error(blockedMessage)
    }

    if (step.type === 'create_node') {
      await emitActionEvent({
        context: params.context,
        name: 'created_node',
        text: buildTaskStepSummary({
          message: params.message,
          step,
          snapshot,
          runtime,
        }),
        status: 'success',
      })
      continue
    }

    if (step.type === 'update_node' || step.type === 'layout_nodes') {
      await emitActionEvent({
        context: params.context,
        name: 'updated_node',
        text: buildTaskStepSummary({
          message: params.message,
          step,
          snapshot,
          runtime,
        }),
        status: 'success',
      })
      continue
    }

    if (step.type === 'connect_nodes') {
      await emitActionEvent({
        context: params.context,
        name: 'connected_nodes',
        text: buildTaskStepSummary({
          message: params.message,
          step,
          snapshot,
          runtime,
        }),
        status: 'success',
      })
      continue
    }

    if (step.type === 'writeback_output') {
      await emitActionEvent({
        context: params.context,
        name: 'generated_output',
        text: buildTaskStepSummary({
          message: params.message,
          step: {
            id: step.id,
            type: 'generate_output',
            blockId: step.blockId,
          },
          snapshot,
          runtime,
        }),
        status: 'success',
      })
    }
  }

  await emitActionEvent({
    context: params.context,
    name: 'completed_request',
    text: isChineseMessage(params.message)
      ? '本次画布请求已完成。'
      : 'Completed the content canvas request.',
    status: 'success',
  })

  return snapshot
}

async function executeActionLoop(params: {
  workflowId: string
  workspaceId: string
  userId: string
  initialBatch: ContentCanvasActionBatch
  requestKind: ContentCanvasRequestKind
  snapshot: ContentCanvasSnapshot
  context: StreamingContext
  execContext: ExecutionContext
  options: AgentOptions
  message: string
  thinkingLevel: 'standard' | 'extra'
  conversationHistory: PlannerMessage[]
  autoSelectionBlockIds: string[]
}): Promise<{ snapshot: ContentCanvasSnapshot; lastBatch: ContentCanvasActionBatch }> {
  let snapshot = params.snapshot
  let batch = params.initialBatch

  for (let round = 0; round < 6; round += 1) {
    if (batch.actions.length === 0) {
      return { snapshot, lastBatch: batch }
    }

    snapshot = await executeTaskPlan({
      workflowId: params.workflowId,
      workspaceId: params.workspaceId,
      userId: params.userId,
      plan: actionBatchToTaskPlan(batch),
      snapshot,
      context: params.context,
      execContext: params.execContext,
      options: params.options,
      message: params.message,
      thinkingLevel: params.thinkingLevel,
      conversationHistory: params.conversationHistory,
      autoSelectionBlockIds: params.autoSelectionBlockIds,
      allowReplan: false,
    })

    if (!batch.shouldContinue) {
      return { snapshot, lastBatch: batch }
    }

    const nextDecision = await decideNextCanvasActions({
      message: params.message,
      thinkingLevel: params.thinkingLevel,
      snapshot,
      conversationHistory: params.conversationHistory,
      autoSelectionBlockIds: params.autoSelectionBlockIds,
      requestKind: params.requestKind,
      abortSignal: params.options.abortSignal,
      repairContext: batch.repairHint,
    })
    if (nextDecision.compatibilityPlan) {
      snapshot = await executeTaskPlan({
        workflowId: params.workflowId,
        workspaceId: params.workspaceId,
        userId: params.userId,
        plan: nextDecision.compatibilityPlan,
        snapshot,
        context: params.context,
        execContext: params.execContext,
        options: params.options,
        message: params.message,
        thinkingLevel: params.thinkingLevel,
        conversationHistory: params.conversationHistory,
        autoSelectionBlockIds: params.autoSelectionBlockIds,
        allowReplan: false,
      })
      return {
        snapshot,
        lastBatch: taskPlanToActionBatch(nextDecision.compatibilityPlan),
      }
    }
    batch = nextDecision.batch
  }

  return { snapshot, lastBatch: batch }
}

function buildPreviewText(params: { message: string; plan: LegacyContentCanvasPlan }): string {
  const actionCount = params.plan.actions.length
  if (actionCount === 0) {
    return params.plan.assistantText
  }

  const defaultSummary = isChineseMessage(params.message)
    ? `我已经整理出 ${actionCount} 个待执行动作。确认后我会先改画布结构，再触发生成，最后把结果回写到节点。`
    : `I prepared ${actionCount} action(s). After confirmation I will update the canvas structure, run generation, and write results back to the nodes.`

  const confirmHint = isChineseMessage(params.message)
    ? '\n\n回复“确认”即可执行，或者继续补充修改要求。'
    : '\n\nReply with "confirm" to execute, or send more changes.'

  return `${params.plan.summary || params.plan.assistantText || defaultSummary}${confirmHint}`
}

function buildSuccessText(params: { message: string; plan: LegacyContentCanvasPlan }): string {
  if (params.plan.assistantText.trim()) {
    return params.plan.assistantText
  }

  return isChineseMessage(params.message)
    ? '内容画布已经按你的要求更新完成。'
    : 'The content canvas has been updated.'
}

function resolveChatKey(
  requestPayload: Record<string, unknown>,
  workflowId: string,
  execContext: ExecutionContext
) {
  return (
    (typeof requestPayload.chatId === 'string' && requestPayload.chatId) ||
    execContext.chatId ||
    workflowId
  )
}

function buildTaskPlanPreviewText(params: {
  message: string
  plan: ContentCanvasTaskPlan
}): string {
  const chinese = isChineseMessage(params.message)
  const header = chinese ? '我整理好了一个可执行草案。' : 'I prepared an executable draft.'
  const stepPreview = params.plan.steps
    .slice(0, 4)
    .map((step, index) => {
      if (step.type === 'create_node') {
        return `${index + 1}. ${chinese ? '新建' : 'Create'} ${getNodeVariantLabelV2(step.nodeType, chinese)}`
      }
      if (step.type === 'update_node') {
        return `${index + 1}. ${chinese ? '修改已有节点' : 'Update the selected node'}`
      }
      if (step.type === 'connect_nodes') {
        return `${index + 1}. ${chinese ? '连接节点' : 'Connect nodes'}`
      }
      if (step.type === 'layout_nodes') {
        return `${index + 1}. ${chinese ? '整理排布' : 'Adjust layout'}`
      }
      return `${index + 1}. ${chinese ? '生成内容' : 'Generate content'}`
    })
    .join('\n')
  return `${header}${stepPreview ? `\n\n${stepPreview}` : ''}\n\n${buildManualConfirmationHintV2(params.message)}`
}

function buildTaskPlanSuccessText(params: {
  message: string
  plan: ContentCanvasTaskPlan
}): string {
  const chinese = isChineseMessage(params.message)
  const createdVariants = params.plan.steps
    .filter(
      (step): step is Extract<ContentCanvasTaskStep, { type: 'create_node' }> =>
        step.type === 'create_node'
    )
    .map((step) => getNodeVariantLabelV2(step.nodeType, chinese))
  if (createdVariants.length > 0) {
    const labels = Array.from(new Set(createdVariants)).join(chinese ? '、' : ', ')
    return chinese ? `已完成 ${labels} 节点操作。` : `Completed ${labels} node updates.`
  }
  return chinese ? '内容画布已经按你的要求更新完成。' : 'The content canvas has been updated.'
}

function buildInvalidWorkflowEditMessage(message: string, rawMessage: string): string | null {
  const unsupportedTypes = Array.from(
    rawMessage.matchAll(/unknown block type '([^']+)'/g),
    (match) => match[1]
  )
  const hasDanglingEdges = rawMessage.includes('Edge references non-existent')

  if (unsupportedTypes.length === 0 && !hasDanglingEdges) {
    return null
  }

  const chinese = isChineseMessage(message)
  const detailParts: string[] = []

  if (unsupportedTypes.length > 0) {
    const uniqueTypes = Array.from(new Set(unsupportedTypes))
    detailParts.push(
      chinese
        ? `旧节点类型：${uniqueTypes.join('、')}`
        : `unsupported legacy node types: ${uniqueTypes.join(', ')}`
    )
  }

  if (hasDanglingEdges) {
    detailParts.push(
      chinese ? '存在指向不存在节点的无效连线' : 'there are invalid edges pointing to missing nodes'
    )
  }

  return chinese
    ? `当前画布中存在不受支持的旧节点或无效连线，Copilot 这次没有执行。请先清理这些问题后再重试。${detailParts.length > 0 ? `\n\n检测到：${detailParts.join('；')}` : ''}`
    : `The current canvas contains unsupported legacy nodes or invalid edges, so Copilot did not execute this request. Please clean them up and try again.${detailParts.length > 0 ? `\n\nDetected: ${detailParts.join('; ')}` : ''}`
}

function buildInvalidWorkflowEditMessageV2(message: string, rawMessage: string): string | null {
  const unsupportedTypes = Array.from(
    rawMessage.matchAll(/unknown block type '([^']+)'/g),
    (match) => match[1]
  )
  const hasDanglingEdges = rawMessage.includes('Edge references non-existent')

  if (unsupportedTypes.length === 0 && !hasDanglingEdges) {
    return null
  }

  const chinese = isChineseMessage(message)
  const detailParts: string[] = []

  if (unsupportedTypes.length > 0) {
    const uniqueTypes = Array.from(new Set(unsupportedTypes))
    detailParts.push(
      chinese
        ? `\u65e7\u8282\u70b9\u7c7b\u578b\uff1a${uniqueTypes.join('\u3001')}`
        : `unsupported legacy node types: ${uniqueTypes.join(', ')}`
    )
  }

  if (hasDanglingEdges) {
    detailParts.push(
      chinese
        ? '\u5b58\u5728\u6307\u5411\u4e0d\u5b58\u5728\u8282\u70b9\u7684\u65e0\u6548\u8fde\u7ebf'
        : 'there are invalid edges pointing to missing nodes'
    )
  }

  return chinese
    ? `\u5f53\u524d\u753b\u5e03\u4e2d\u5b58\u5728\u4e0d\u53d7\u652f\u6301\u7684\u65e7\u8282\u70b9\u6216\u65e0\u6548\u8fde\u7ebf\uff0cCopilot \u8fd9\u6b21\u6ca1\u6709\u6267\u884c\u3002\u8bf7\u5148\u6e05\u7406\u8fd9\u4e9b\u95ee\u9898\u540e\u518d\u91cd\u8bd5\u3002${detailParts.length > 0 ? `\n\n\u68c0\u6d4b\u5230\uff1a${detailParts.join('\uff1b')}` : ''}`
    : `The current canvas contains unsupported legacy nodes or invalid edges, so Copilot did not execute this request. Please clean them up and try again.${detailParts.length > 0 ? `\n\nDetected: ${detailParts.join('; ')}` : ''}`
}

function toUserFacingErrorMessage(message: string, error: unknown): string {
  const rawMessage = toError(error).message
  const chinese = isChineseMessage(message)
  const invalidWorkflowEditMessage = buildInvalidWorkflowEditMessageV2(message, rawMessage)

  if (invalidWorkflowEditMessage) {
    return invalidWorkflowEditMessage
  }

  if (rawMessage.includes('平台管理员尚未配置画布文本模型与 API Key')) {
    return chinese
      ? '平台管理员尚未配置画布文本模型与 API Key，请先在“模型服务配置”中启用画布文本模型并配置有效 Key。'
      : 'The platform administrator has not configured a canvas text model and active API key.'
  }
  if (rawMessage.includes('invalid JSON')) {
    return chinese
      ? `DeepSeek planner \u8fd4\u56de\u7684\u89c4\u5212\u7ed3\u679c\u65e0\u6cd5\u89e3\u6790\uff1a${rawMessage}`
      : `The DeepSeek planner returned an invalid plan: ${rawMessage}`
  }
  if (rawMessage.includes('planner request failed')) {
    return chinese
      ? `DeepSeek planner \u8bf7\u6c42\u5931\u8d25\uff1a${rawMessage}`
      : `The DeepSeek planner request failed: ${rawMessage}`
  }
  if (rawMessage.includes('workflow edit failed')) {
    return chinese
      ? `\u753b\u5e03\u64cd\u4f5c\u6267\u884c\u5931\u8d25\uff1a${rawMessage}`
      : `The canvas edit could not be applied: ${rawMessage}`
  }
  if (rawMessage.includes('content canvas structure verification failed')) {
    return chinese
      ? `\u753b\u5e03\u7ed3\u6784\u66f4\u65b0\u540e\uff0c\u6709\u8ba1\u5212\u4e2d\u7684\u65b0\u8282\u70b9\u6216\u751f\u6210\u76ee\u6807\u6ca1\u6709\u771f\u6b63\u843d\u5230\u753b\u5e03\u4e0a\uff1a${rawMessage}`
      : `Some planned nodes or generation targets were not actually created on the canvas: ${rawMessage}`
  }
  if (rawMessage.includes('pending plan token is invalid')) {
    return buildInvalidPendingPlanMessageV2(message)
  }
  return chinese
    ? `Content Canvas Copilot \u672a\u80fd\u5b8c\u6210\u8fd9\u6b21\u8bf7\u6c42\uff1a${rawMessage}`
    : `Content canvas Copilot could not complete this request: ${rawMessage}`
}

async function executePlanOperations(params: {
  workflowId: string
  workspaceId: string
  userId: string
  plan: LegacyContentCanvasPlan
  snapshot: ContentCanvasSnapshot
  context: StreamingContext
  execContext: ExecutionContext
  options: AgentOptions
}): Promise<ContentCanvasSnapshot> {
  const { operations, blockIdMap } = compileEditWorkflowOperations({
    plan: params.plan,
    snapshot: params.snapshot,
  })
  let structureOutput: unknown = null

  if (operations.length > 0) {
    try {
      structureOutput = await executeEditWorkflowOperations({
        workflowId: params.workflowId,
        operations,
        context: params.context,
        execContext: params.execContext,
        options: params.options,
      })
    } catch (error) {
      throw new Error(`workflow edit failed: ${toError(error).message}`)
    }
  }

  const structureResult = getEditWorkflowExecutionOutput(structureOutput)
  const snapshotAfterStructure = structureResult?.workflowState
    ? snapshotFromWorkflowState(structureResult.workflowState)
    : await loadContentCanvasSnapshot(params.workflowId)

  verifyPlannedStructureApplied({
    plan: params.plan,
    snapshotAfterStructure,
    blockIdMap,
    structureOutput,
  })

  const writebackOperations = await buildWritebackOperations({
    plan: params.plan,
    snapshot: snapshotAfterStructure,
    blockIdMap,
    workspaceId: params.workspaceId,
    userId: params.userId,
  })

  if (writebackOperations.length > 0) {
    try {
      await executeEditWorkflowOperations({
        workflowId: params.workflowId,
        operations: writebackOperations,
        context: params.context,
        execContext: params.execContext,
        options: params.options,
      })
    } catch (error) {
      throw new Error(`workflow edit failed: ${toError(error).message}`)
    }
  }

  return snapshotAfterStructure
}

/**
 * @deprecated Production `content_canvas_v1` requests are handled by
 * `runLocalCanvasAgent` in `local-canvas-agent`. This legacy runtime is kept
 * only for migration reference and legacy tests.
 */
export async function runContentCanvasAgent(params: {
  requestPayload: Record<string, unknown>
  context: StreamingContext
  execContext: ExecutionContext
  options: AgentOptions
}): Promise<void> {
  const { requestPayload, context, execContext, options } = params
  const message = typeof requestPayload.message === 'string' ? requestPayload.message : ''

  try {
    const workflowId =
      (typeof requestPayload.workflowId === 'string' && requestPayload.workflowId) ||
      execContext.workflowId
    const workspaceId =
      (typeof requestPayload.workspaceId === 'string' && requestPayload.workspaceId) ||
      execContext.workspaceId
    const confirmationMode =
      requestPayload.confirmationMode === 'auto' || requestPayload.confirmationMode === 'manual'
        ? requestPayload.confirmationMode
        : 'auto'
    const thinkingLevel =
      requestPayload.thinkingLevel === 'extra' || requestPayload.thinkingLevel === 'standard'
        ? requestPayload.thinkingLevel
        : 'extra'

    if (!workflowId) {
      throw new Error('Content canvas Copilot requires a workflowId')
    }
    if (!workspaceId) {
      throw new Error('Content canvas Copilot requires a workspaceId')
    }
    if (!execContext.userId) {
      throw new Error('Content canvas Copilot requires an authenticated user')
    }

    const chatKey = resolveChatKey(requestPayload, workflowId, execContext)
    const pendingPlan = getPendingPlan(chatKey)
    const pendingPlanCommand = parsePendingPlanCommand(message)

    if (pendingPlanCommand) {
      if (!pendingPlan || pendingPlan.pendingPlanId !== pendingPlanCommand.pendingPlanId) {
        await emitAssistantText(
          context,
          options,
          buildInvalidPendingPlanMessageV2(pendingPlan?.sourceMessage ?? message)
        )
        context.streamComplete = true
        return
      }

      if (pendingPlanCommand.action === 'revise') {
        await emitAssistantText(
          context,
          options,
          buildRevisePendingPlanMessageV2(pendingPlan.sourceMessage)
        )
        context.streamComplete = true
        return
      }
    }

    if (
      pendingPlan &&
      (pendingPlanCommand?.action === 'confirm' || isConfirmationMessage(message))
    ) {
      const snapshotBefore = await loadContentCanvasSnapshot(workflowId)
      const snapshotAfter = await executeTaskPlan({
        workflowId,
        workspaceId,
        userId: execContext.userId,
        plan: pendingPlan.plan,
        snapshot: snapshotBefore,
        context,
        execContext,
        options,
        message: pendingPlan.sourceMessage,
        thinkingLevel,
        conversationHistory: [],
        autoSelectionBlockIds: [],
        allowReplan: false,
      })

      clearPendingPlan(chatKey)
      await emitAssistantText(
        context,
        options,
        buildTaskPlanSuccessText({
          message: pendingPlan.sourceMessage,
          plan: pendingPlan.plan,
        })
      )
      context.streamComplete = true
      return
    }

    const snapshot = await loadContentCanvasSnapshot(workflowId)
    const conversationHistory = extractConversationHistory(requestPayload.conversationHistory)
    const autoSelectionContexts = Array.isArray(requestPayload.autoSelectionContexts)
      ? requestPayload.autoSelectionContexts
      : []
    const autoSelectionBlockIds = autoSelectionContexts.flatMap((entry) =>
      Array.isArray((entry as { blockIds?: unknown }).blockIds)
        ? ((entry as { blockIds: string[] }).blockIds ?? [])
        : []
    )
    const requestKind = classifyContentCanvasRequest({
      message,
      autoSelectionBlockIds,
    })

    if (requestKind === 'out-of-scope') {
      await emitAssistantText(context, options, buildOutOfScopeResponse(message))
      context.streamComplete = true
      return
    }

    let initialDecision: ContentCanvasActionDecision = {
      batch: {
        assistantText: '',
        shouldContinue: false,
        actions: [],
      },
    }
    let actorError: unknown = null
    try {
      initialDecision = await decideNextCanvasActions({
        message,
        thinkingLevel,
        snapshot,
        conversationHistory,
        autoSelectionBlockIds,
        requestKind,
        abortSignal: options.abortSignal,
      })
    } catch (error) {
      actorError = error
      if (!(error instanceof ContentCanvasActorError)) {
        if (toError(error).message.includes('invalid JSON')) {
          throw error
        }
        throw new Error(`planner request failed: ${toError(error).message}`)
      }
    }

    const initialBatch = initialDecision.batch
    let plan = normalizeTaskPlanForExplicitCreateIntent({
      message,
      plan: initialDecision.compatibilityPlan ?? actionBatchToTaskPlan(initialBatch),
      snapshot,
      autoSelectionBlockIds,
    })

    if (
      plan.steps.length > 0 &&
      (requestKind === 'edit-selection' ||
        requestKind === 'edit-existing' ||
        requestKind === 'connect' ||
        requestKind === 'layout')
    ) {
      plan = {
        ...plan,
        intent: {
          ...plan.intent,
          shouldExecute: true,
        },
      }
    }

    if (requestKind === 'create' && plan.steps.length === 0) {
      const fallbackPlan = buildImageToTextFallbackTaskPlan({
        message,
        snapshot,
        autoSelectionBlockIds,
      })
      if (fallbackPlan) {
        logger.info('Using selected-image to text fallback plan', {
          workflowId,
          autoSelectionBlockIds,
        })
        plan = fallbackPlan
      }
    }

    if (requestKind === 'create') {
      const deterministicCreateFallbackPlan = buildDeterministicCreateFallbackTaskPlan({
        message,
        plan,
        autoSelectionBlockIds,
      })
      if (deterministicCreateFallbackPlan) {
        logger.info('Using deterministic content-create fallback plan', {
          workflowId,
          autoSelectionBlockIds,
        })
        plan = deterministicCreateFallbackPlan
      }

      const genericFallbackPlan = buildGenericGoalFallbackTaskPlan({
        message,
        plan,
        autoSelectionBlockIds,
      })
      if (genericFallbackPlan) {
        logger.info('Using generic goal-to-content-chain fallback plan', {
          workflowId,
          autoSelectionBlockIds,
        })
        plan = genericFallbackPlan
      }
    }

    if (plan.steps.length === 0 || plan.intent.shouldExecute === false) {
      await emitAssistantText(
        context,
        options,
        plan.assistantText.trim() ||
          (actorError instanceof ContentCanvasActorError && actorError.code === 'empty_actions'
            ? buildNoActionFallbackV2(message)
            : buildNoActionFallbackV2(message))
      )
      context.streamComplete = true
      return
    }

    if (confirmationMode === 'manual') {
      const pendingPlanId = generateId()
      const optionItems = buildManualConfirmationOptionsV2(pendingPlanId)
      setPendingPlan({
        pendingPlanId,
        chatKey,
        workflowId,
        plan,
        sourceMessage: message,
        createdAt: Date.now(),
      })
      await emitAssistantResponse({
        context,
        options,
        text: buildTaskPlanPreviewText({ message, plan }),
        optionItems,
      })
      context.streamComplete = true
      return
    }

    const shouldUseActionLoop =
      actorError === null &&
      !initialDecision.compatibilityPlan &&
      initialBatch.actions.length > 0 &&
      plan.steps.length > 0 &&
      JSON.stringify(taskPlanToActionBatch(plan).actions) === JSON.stringify(initialBatch.actions)

    if (shouldUseActionLoop) {
      await executeActionLoop({
        workflowId,
        workspaceId,
        userId: execContext.userId,
        initialBatch,
        requestKind,
        snapshot,
        context,
        execContext,
        options,
        message,
        thinkingLevel,
        conversationHistory,
        autoSelectionBlockIds,
      })
    } else {
      await executeTaskPlan({
        workflowId,
        workspaceId,
        userId: execContext.userId,
        plan,
        snapshot,
        context,
        execContext,
        options,
        message,
        thinkingLevel,
        conversationHistory,
        autoSelectionBlockIds,
      })
    }
    await emitAssistantText(context, options, buildTaskPlanSuccessText({ message, plan }))
    context.streamComplete = true
  } catch (error) {
    const userFacingMessage = toUserFacingErrorMessage(message, error)

    if (userFacingMessage && context.accumulatedContent !== userFacingMessage) {
      await emitAssistantText(context, options, userFacingMessage)
    }

    logger.error('Content canvas agent failed', {
      error: toError(error).message,
      userFacingMessage,
    })
    throw new Error(userFacingMessage)
  }
}

export const __contentCanvasAgentTestUtils = {
  buildNoActionFallbackV2,
  buildPlanActionSummaryV2,
  buildTaskPlanPreviewText,
  compileEditWorkflowOperations,
  isConfirmationMessage,
  parsePendingPlanCommand,
  resolveContentCanvasActorConfig,
}
