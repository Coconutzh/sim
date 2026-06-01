import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { z } from 'zod'
import { buildTextNodeAiSystemPrompt, convertGeneratedTextToContentHtml } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/text-content-ai-utils'
import { getEnv } from '@/lib/core/config/env'
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
import {
  DEFAULT_AUDIO_MODEL,
  DEFAULT_AUDIO_PARAMETERS,
} from '@/lib/generated-media/audio/audio-generation-utils'
import { generateWorkspaceAudioFromPrompt } from '@/lib/generated-media/audio/audio-generation-service'
import { generateWorkspaceImageFromPrompt } from '@/lib/generated-media/image/image-generation-service'
import {
  DEFAULT_VIDEO_DURATION_SECONDS,
  DEFAULT_VIDEO_FRAME_ASPECT_RATIO_PRESET,
  DEFAULT_VIDEO_MODEL_FAMILY,
  DEFAULT_VIDEO_RESOLUTION,
  resolveVideoGenerationModelId,
} from '@/lib/generated-media/video/video-generation-utils'
import { generateWorkspaceVideoFromPrompt } from '@/lib/generated-media/video/video-generation-service'
import { getContentNodePreset, type ContentNodeVariant } from '@/lib/product/content-node-presets'
import { executeProviderRequest } from '@/providers'
import type { ProviderResponse } from '@/providers/types'
import { extractAndParseJSON, getProviderFromModel } from '@/providers/utils'

const logger = createLogger('ContentCanvasAgent')

const TEXT_MODEL_FALLBACK = 'gemini-3.1-flash-lite-preview'
const IMAGE_MODEL_FALLBACK = 'jimeng-4.5'
const DEFAULT_CONFIRM_MESSAGES = /^(确认|继续|执行|开始执行|可以执行|yes|confirm|go ahead|run it)$/i
const PENDING_PLAN_TTL_MS = 30 * 60 * 1000
const NODE_GAP_X = 360
const NODE_GAP_Y = 220
const DEFAULT_CONFIRM_MESSAGES_V2 = /^(确认|继续|执行|开始执行|可以执行|yes|confirm|go ahead|run it)$/i
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

const contentCanvasPlanSchema = z.object({
  assistantText: z.string().catch(''),
  summary: z.string().catch(''),
  actions: z.array(planActionSchema).catch([]),
})

type ContentCanvasPlan = z.infer<typeof contentCanvasPlanSchema>
type ContentCanvasPlanAction = ContentCanvasPlan['actions'][number]

interface PendingPlanEntry {
  pendingPlanId: string
  chatKey: string
  workflowId: string
  plan: ContentCanvasPlan
  sourceMessage: string
  createdAt: number
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

async function loadContentCanvasSnapshot(workflowId: string): Promise<ContentCanvasSnapshot> {
  const { loadWorkflowFromNormalizedTables } = await import('@/lib/workflows/persistence/utils')
  const normalized = await loadWorkflowFromNormalizedTables(workflowId)
  const rawBlocks = normalized?.blocks
  const rawEdges = normalized?.edges

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

function buildSnapshotPrompt(snapshot: ContentCanvasSnapshot, autoSelectionBlockIds: string[]): string {
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

function resolveContentCanvasPlannerConfig() {
  const provider = getEnv('LOCAL_COPILOT_PROVIDER')?.trim().toLowerCase()
  const model = getEnv('LOCAL_COPILOT_MODEL')?.trim()
  const apiKey = getEnv('DEEPSEEK_API_KEY')?.trim()

  if (provider !== 'deepseek') {
    throw new Error('Content canvas Copilot requires LOCAL_COPILOT_PROVIDER=deepseek')
  }
  if (!model) {
    throw new Error('Content canvas Copilot requires LOCAL_COPILOT_MODEL to be configured')
  }
  if (!apiKey) {
    throw new Error('Content canvas Copilot requires DEEPSEEK_API_KEY to be configured')
  }

  return { provider: 'deepseek' as const, model, apiKey }
}

function buildPlannerSystemPrompt(thinkingLevel: 'standard' | 'extra'): string {
  return [
    'You are the Sim content canvas Copilot for TapNow-style content nodes.',
    'Only operate on content canvas nodes of type: text, image, video, audio.',
    'You may add, update, delete, connect, lay out, and generate node output.',
    'When the user only wants analysis or Q&A, respond with assistantText and no actions.',
    'Use exact existing block IDs from the snapshot when editing existing nodes.',
    'For new nodes, assign a stable clientNodeId such as new_text_1 and reference it later.',
    'If the user directly supplies final copy, prefer add_node/update_node contentText over generation.',
    'If the user asks AI to write, draw, create video, or create audio, include generate_node_output.',
    thinkingLevel === 'extra'
      ? 'Spend extra effort resolving ambiguity and produce a careful multi-step plan.'
      : 'Prefer a concise plan.',
    'Return JSON only.',
  ].join('\n')
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
  plan: ContentCanvasPlan
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
  plan: ContentCanvasPlan
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
}): ContentCanvasPlan | null {
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

function assertNonStreamingProviderResponse(
  response: ProviderResponse | ReadableStream | { stream: ReadableStream; execution: unknown }
): ProviderResponse {
  if (response instanceof ReadableStream) {
    throw new Error('Planner returned an unexpected stream response')
  }
  if (response && typeof response === 'object' && 'stream' in response && 'execution' in response) {
    throw new Error('Planner returned an unexpected streaming execution response')
  }
  return response
}

async function planContentCanvas(params: {
  message: string
  thinkingLevel: 'standard' | 'extra'
  snapshot: ContentCanvasSnapshot
  conversationHistory: PlannerMessage[]
  autoSelectionBlockIds: string[]
  abortSignal?: AbortSignal
}): Promise<ContentCanvasPlan> {
  const config = resolveContentCanvasPlannerConfig()
  const rawResponse = await executeProviderRequest(config.provider, {
    model: config.model,
    apiKey: config.apiKey,
    systemPrompt: buildPlannerSystemPrompt(params.thinkingLevel),
    messages: [
      {
        role: 'user',
        content: buildPlannerUserPrompt(params),
      },
    ],
    temperature: params.thinkingLevel === 'extra' ? 0.15 : 0.1,
    maxTokens: params.thinkingLevel === 'extra' ? 3000 : 1800,
    responseFormat: {
      name: 'content_canvas_plan',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['assistantText', 'summary', 'actions'],
        properties: {
          assistantText: { type: 'string' },
          summary: { type: 'string' },
          actions: {
            type: 'array',
            items: {
              anyOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'clientNodeId', 'nodeType'],
                  properties: {
                    type: { const: 'add_node' },
                    clientNodeId: { type: 'string' },
                    nodeType: { enum: ['text', 'image', 'video', 'audio'] },
                    title: { type: 'string' },
                    contentText: { type: 'string' },
                    prompt: { type: 'string' },
                    targetBlockId: { type: 'string' },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'blockId'],
                  properties: {
                    type: { const: 'update_node' },
                    blockId: { type: 'string' },
                    title: { type: 'string' },
                    contentText: { type: 'string' },
                    prompt: { type: 'string' },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'blockId'],
                  properties: {
                    type: { const: 'delete_node' },
                    blockId: { type: 'string' },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'sourceBlockId', 'targetBlockId'],
                  properties: {
                    type: { const: 'connect_nodes' },
                    sourceBlockId: { type: 'string' },
                    targetBlockId: { type: 'string' },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'direction'],
                  properties: {
                    type: { const: 'layout_nodes' },
                    direction: { enum: ['horizontal', 'vertical', 'grid'] },
                    blockIds: { type: 'array', items: { type: 'string' } },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'blockId'],
                  properties: {
                    type: { const: 'generate_node_output' },
                    blockId: { type: 'string' },
                    textApplyMode: { enum: ['replace', 'append'] },
                  },
                },
              ],
            },
          },
        },
      },
      strict: true,
    },
    abortSignal: params.abortSignal,
  })

  const response = assertNonStreamingProviderResponse(rawResponse)
  try {
    return contentCanvasPlanSchema.parse(extractAndParseJSON(response.content || ''))
  } catch (error) {
    throw new Error(`Content canvas planner returned invalid JSON: ${toError(error).message}`)
  }
}

function buildVariantTitle(variant: ContentNodeVariant, count: number): string {
  const base = getContentNodePreset(variant)?.label ?? variant
  return `${base} ${count}`
}

function buildAddNodeOperation(params: {
  action: Extract<ContentCanvasPlanAction, { type: 'add_node' }>
  snapshot: ContentCanvasSnapshot
  index: number
  generatedBlockId: string
  resolveBlockId: (rawId: string) => string
}): EditWorkflowOperation {
  const variant = params.action.nodeType
  const preset = getContentNodePreset(variant)
  const existingCount = params.snapshot.blocks.filter((block) => block.variant === variant).length
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

  const operation: EditWorkflowOperation = {
    operation_type: 'add',
    block_id: params.generatedBlockId,
    params: {
      type: 'content',
      name:
        params.action.title?.trim() ||
        buildVariantTitle(variant, existingCount + params.index + 1),
      position,
      inputs,
    },
  }

  if (params.action.targetBlockId) {
    operation.params = {
      ...operation.params,
      connections: {
        source: params.resolveBlockId(params.action.targetBlockId),
      },
    }
  }

  return operation
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
  plan: ContentCanvasPlan
  snapshot: ContentCanvasSnapshot
}): {
  operations: EditWorkflowOperation[]
  blockIdMap: Map<string, string>
} {
  const blockIdMap = new Map<string, string>()
  const operations: EditWorkflowOperation[] = []
  const resolveBlockId = (rawId: string) => blockIdMap.get(rawId) ?? rawId

  for (const action of params.plan.actions) {
    if (action.type === 'add_node') {
      blockIdMap.set(action.clientNodeId, generateId())
    }
  }

  let addIndex = 0
  for (const action of params.plan.actions) {
    if (action.type !== 'add_node') continue
    operations.push(
      buildAddNodeOperation({
        action,
        snapshot: params.snapshot,
        index: addIndex++,
        generatedBlockId: resolveBlockId(action.clientNodeId),
        resolveBlockId,
      })
    )
  }

  for (const action of params.plan.actions) {
    if (action.type === 'update_node') {
      const blockId = resolveBlockId(action.blockId)
      const block = params.snapshot.blocks.find((entry) => entry.id === blockId)
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
      continue
    }

    if (action.type === 'delete_node') {
      operations.push({
        operation_type: 'delete',
        block_id: resolveBlockId(action.blockId),
      })
      continue
    }

    if (action.type === 'connect_nodes') {
      operations.push({
        operation_type: 'edit',
        block_id: resolveBlockId(action.sourceBlockId),
        params: {
          connections: {
            source: resolveBlockId(action.targetBlockId),
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

async function executeEditWorkflowOperations(params: {
  workflowId: string
  operations: EditWorkflowOperation[]
  context: StreamingContext
  execContext: ExecutionContext
  options: AgentOptions
}): Promise<void> {
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

async function generateTextOutput(params: {
  block: ContentCanvasBlockSnapshot
  workspaceId: string
}): Promise<string> {
  const model = getStringValue(params.block.values.aiModel) ?? TEXT_MODEL_FALLBACK
  const prompt = getStringValue(params.block.values.aiPrompt)
  if (!prompt) {
    throw new Error(`Text node "${params.block.name}" is missing an AI prompt`)
  }

  const rawResponse = await executeProviderRequest(getProviderFromModel(model), {
    workspaceId: params.workspaceId,
    model,
    systemPrompt: buildTextNodeAiSystemPrompt(),
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1800,
  })
  const response = assertNonStreamingProviderResponse(rawResponse)
  const generated = response.content?.trim()
  if (!generated) {
    throw new Error(`Text node "${params.block.name}" did not return generated content`)
  }
  return generated
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
  plan: ContentCanvasPlan
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

function buildPreviewText(params: { message: string; plan: ContentCanvasPlan }): string {
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

function buildSuccessText(params: { message: string; plan: ContentCanvasPlan }): string {
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

function buildPreviewTextV2(params: {
  message: string
  plan: ContentCanvasPlan
  snapshot: ContentCanvasSnapshot
}): string {
  const summary = buildPlanActionSummaryV2(params)
  return `${summary}\n\n${buildManualConfirmationHintV2(params.message)}`
}

function buildSuccessTextV2(params: {
  message: string
  plan: ContentCanvasPlan
  snapshot: ContentCanvasSnapshot
}): string {
  const chinese = isChineseMessage(params.message)
  const summary = buildPlanActionSummaryV2(params)
  return chinese
    ? summary.replace(
        '\u6211\u51c6\u5907\u6267\u884c\u8fd9\u4e9b\u5185\u5bb9\u753b\u5e03\u64cd\u4f5c\uff1a',
        '\u5df2\u6267\u884c\u4ee5\u4e0b\u5185\u5bb9\u753b\u5e03\u64cd\u4f5c\uff1a'
      )
    : summary.replace(
        'I am ready to apply these canvas actions:',
        'I executed these content canvas actions:'
      )
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
      chinese
        ? '存在指向不存在节点的无效连线'
        : 'there are invalid edges pointing to missing nodes'
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

  if (rawMessage.includes('LOCAL_COPILOT_PROVIDER=deepseek')) {
    return chinese
      ? 'Content Canvas Copilot \u7f3a\u5c11 DeepSeek \u914d\u7f6e\uff1a\u8bf7\u8bbe\u7f6e `LOCAL_COPILOT_PROVIDER=deepseek`\u3002'
      : 'Content canvas Copilot is missing DeepSeek configuration: set `LOCAL_COPILOT_PROVIDER=deepseek`.'
  }
  if (rawMessage.includes('LOCAL_COPILOT_MODEL')) {
    return chinese
      ? 'Content Canvas Copilot \u7f3a\u5c11 `LOCAL_COPILOT_MODEL`\u3002'
      : 'Content canvas Copilot is missing `LOCAL_COPILOT_MODEL`.'
  }
  if (rawMessage.includes('DEEPSEEK_API_KEY')) {
    return chinese
      ? 'Content Canvas Copilot \u7f3a\u5c11 `DEEPSEEK_API_KEY`\u3002'
      : 'Content canvas Copilot is missing `DEEPSEEK_API_KEY`.'
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
  plan: ContentCanvasPlan
  snapshot: ContentCanvasSnapshot
  context: StreamingContext
  execContext: ExecutionContext
  options: AgentOptions
}): Promise<ContentCanvasSnapshot> {
  const { operations, blockIdMap } = compileEditWorkflowOperations({
    plan: params.plan,
    snapshot: params.snapshot,
  })

  if (operations.length > 0) {
    try {
      await executeEditWorkflowOperations({
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

  const snapshotAfterStructure = await loadContentCanvasSnapshot(params.workflowId)
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
        : 'manual'
    const thinkingLevel =
      requestPayload.thinkingLevel === 'extra' || requestPayload.thinkingLevel === 'standard'
        ? requestPayload.thinkingLevel
        : 'standard'

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

    if (pendingPlan && (pendingPlanCommand?.action === 'confirm' || isConfirmationMessage(message))) {
      const snapshotBefore = await loadContentCanvasSnapshot(workflowId)
      const snapshotAfter = await executePlanOperations({
        workflowId,
        workspaceId,
        userId: execContext.userId,
        plan: pendingPlan.plan,
        snapshot: snapshotBefore,
        context,
        execContext,
        options,
      })

      clearPendingPlan(chatKey)
      await emitAssistantText(
        context,
        options,
        buildSuccessTextV2({
          message: pendingPlan.sourceMessage,
          plan: pendingPlan.plan,
          snapshot: snapshotAfter,
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

    let plan: ContentCanvasPlan
    try {
      plan = await planContentCanvas({
        message,
        thinkingLevel,
        snapshot,
        conversationHistory,
        autoSelectionBlockIds,
        abortSignal: options.abortSignal,
      })
    } catch (error) {
      if (toError(error).message.includes('invalid JSON')) {
        throw error
      }
      throw new Error(`planner request failed: ${toError(error).message}`)
    }

    if (plan.actions.length === 0) {
      const fallbackPlan = buildImageToTextFallbackPlan({
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

    if (plan.actions.length === 0) {
      await emitAssistantText(
        context,
        options,
        plan.assistantText.trim() || buildNoActionFallbackV2(message)
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
        text: buildPreviewTextV2({ message, plan, snapshot }),
        optionItems,
      })
      context.streamComplete = true
      return
    }

    const snapshotAfter = await executePlanOperations({
      workflowId,
      workspaceId,
      userId: execContext.userId,
      plan,
      snapshot,
      context,
      execContext,
      options,
    })
    await emitAssistantText(
      context,
      options,
      buildSuccessTextV2({ message, plan, snapshot: snapshotAfter })
    )
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
  buildPreviewTextV2,
  compileEditWorkflowOperations,
  isConfirmationMessage,
  parsePendingPlanCommand,
  resolveContentCanvasPlannerConfig,
}
