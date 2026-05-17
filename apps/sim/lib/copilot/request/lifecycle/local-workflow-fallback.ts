import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId, generateShortId } from '@sim/utils/id'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
  MothershipStreamV1ToolExecutor,
  MothershipStreamV1ToolMode,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { EditWorkflow } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  getLocalCopilotPlannerConfig,
  type LocalWorkflowPlannerResponse,
  planLocalWorkflow,
} from '@/lib/copilot/request/lifecycle/local-workflow-planner'
import { setTerminalToolCallState } from '@/lib/copilot/request/tool-call-state'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamingContext,
  ToolCallState,
} from '@/lib/copilot/request/types'
import { editWorkflowServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow'
import type {
  EditWorkflowOperation,
  EditWorkflowParams,
} from '@/lib/copilot/tools/server/workflow/edit-workflow/types'
import { isBlockEnabled } from '@/lib/product/tool-policy'
import { executeProviderRequest } from '@/providers'
import type { ProviderResponse } from '@/providers/types'

const logger = createLogger('LocalWorkflowFallback')

const IMAGE_HINTS = [
  '\u6587\u751f\u56fe',
  '\u751f\u56fe',
  '\u56fe\u7247',
  '\u56fe\u50cf',
  'image',
  'text to image',
  'text-to-image',
] as const

const VIDEO_HINTS = [
  '\u89c6\u9891',
  '\u751f\u89c6\u9891',
  '\u56fe\u751f\u89c6\u9891',
  'video',
  'image to video',
  'image-to-video',
] as const

const DESCRIBE_HINTS = [
  '\u63cf\u8ff0',
  '\u8bf4\u8bf4',
  '\u89e3\u91ca',
  '\u770b\u770b',
  'describe',
  'explain',
  'summarize',
] as const

const CANVAS_HINTS = [
  '\u753b\u5e03',
  '\u5de5\u4f5c\u6d41',
  '\u6d41\u7a0b',
  '\u8282\u70b9',
  'canvas',
  'workflow',
  'nodes',
] as const

const STORYBOARD_HINTS = [
  '\u5206\u955c',
  '\u591a\u4e2a',
  '\u591a\u5f20',
  '\u591a\u5e45',
  '\u591a\u573a\u666f',
  'storyboard',
  'multiple',
  'several',
  'shots',
  'scenes',
] as const

const LAYOUT_HINTS = [
  '\u5e03\u5c40',
  '\u6392\u5217',
  '\u6574\u7406',
  '\u6a2a\u5411',
  '\u7eb5\u5411',
  'layout',
  'arrange',
  'align',
  'horizontal',
  'vertical',
] as const

const TEXT_AGENT_HINTS = [
  '\u6587\u672c\u751f\u6210',
  '\u6587\u751f\u6587',
  '\u5927\u6a21\u578b',
  '\u6a21\u578b\u8282\u70b9',
  '\u6587\u672c\u8282\u70b9',
  'text generation',
  'llm',
  'agent',
  'chat model',
] as const

const DEFAULT_MEDIA_PROMPT =
  'Create a cinematic hero shot that can first be rendered as a still image and then animated into a short video.'

const CHINESE_WORKFLOW_INTENT = '\u6587\u751f\u56fe\u751f\u89c6\u9891'
const CHINESE_ON_CANVAS = '\u5728\u753b\u5e03\u4e0a'
const CHINESE_GENERATE = '\u751f\u6210'
const CHINESE_NODE = '\u8282\u70b9'
const CHINESE_CONNECT = '\u8fde\u7ebf'
const CHINESE_FEATURE = '\u529f\u80fd'
const CHINESE_REALIZE = '\u5b9e\u73b0'
const VIDEO_BLOCK_TYPE = isBlockEnabled('video_generator_v2')
  ? 'video_generator_v2'
  : 'video_generator'
const DEFAULT_STORYBOARD_IMAGE_COUNT = 3
const MAX_STORYBOARD_IMAGE_COUNT = 6
const DEFAULT_BLOCK_X = 0
const DEFAULT_BLOCK_Y = 0
const HORIZONTAL_LAYOUT_GAP_X = 360
const HORIZONTAL_LAYOUT_GAP_Y = 180
const VERTICAL_LAYOUT_GAP_X = 320
const VERTICAL_LAYOUT_GAP_Y = 240

type LocalWorkflowFallbackPlan =
  | {
      kind: 'image_to_video'
      assistantText: string
      operations: EditWorkflowOperation[]
      planningSource: 'heuristic' | 'llm'
    }
  | {
      kind: 'describe_workflow'
      assistantText: string
      operations: []
      planningSource: 'heuristic'
    }
  | {
      kind: 'storyboard_to_video'
      assistantText: string
      operations: EditWorkflowOperation[]
      planningSource: 'heuristic'
    }
  | {
      kind: 'layout_workflow'
      assistantText: string
      operations: EditWorkflowOperation[]
      planningSource: 'heuristic'
    }
  | {
      kind: 'text_agent'
      assistantText: string
      operations: EditWorkflowOperation[]
      planningSource: 'heuristic'
    }
  | {
      kind: 'generic_chat'
      assistantText: string
      operations: []
      planningSource: 'heuristic' | 'llm'
    }
  | {
      kind: 'unsupported'
      assistantText: string
      operations: []
      planningSource: 'heuristic' | 'llm'
    }

interface WorkflowSnapshotBlock {
  id: string
  type: string
  name: string
  inputs: Record<string, unknown>
  position: { x: number; y: number }
}

interface WorkflowSnapshot {
  blocks: WorkflowSnapshotBlock[]
  edges: Array<{
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
  }>
}

interface LocalConversationMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

function hasHint(message: string, hints: readonly string[]): boolean {
  const normalized = message.toLowerCase()
  return hints.some((hint) => normalized.includes(hint.toLowerCase()))
}

function isChineseMessage(message: string): boolean {
  return /[\u4e00-\u9fff]/.test(message)
}

/**
 * Returns true when the local workflow scaffold can satisfy the request.
 */
export function isLocalWorkflowFallbackIntent(message: string): boolean {
  const normalized = message.trim()
  if (!normalized) {
    return false
  }

  if (isDescribeCurrentWorkflowIntent(normalized)) {
    return true
  }

  if (
    isLayoutWorkflowIntent(normalized) ||
    isTextAgentIntent(normalized) ||
    isStoryboardEditIntent(normalized)
  ) {
    return true
  }

  if (
    normalized.includes(CHINESE_WORKFLOW_INTENT) ||
    normalized.toLowerCase().includes('text to image') ||
    normalized.toLowerCase().includes('image to video')
  ) {
    return true
  }

  return hasHint(normalized, IMAGE_HINTS) || hasHint(normalized, VIDEO_HINTS)
}

function isDescribeCurrentWorkflowIntent(message: string): boolean {
  return hasHint(message, DESCRIBE_HINTS) && hasHint(message, CANVAS_HINTS)
}

function isStoryboardEditIntent(message: string): boolean {
  return hasHint(message, STORYBOARD_HINTS) && hasHint(message, VIDEO_HINTS)
}

function isLayoutWorkflowIntent(message: string): boolean {
  return hasHint(message, LAYOUT_HINTS) && hasHint(message, CANVAS_HINTS)
}

function isTextAgentIntent(message: string): boolean {
  const asksToCreate = hasHint(message, [
    '\u6dfb\u52a0',
    '\u521b\u5efa',
    '\u751f\u6210',
    'add',
    'create',
  ])
  return asksToCreate && hasHint(message, TEXT_AGENT_HINTS)
}

function getRecordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  return (value as Record<string, unknown>)[key]
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getNumberValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function getPositionValue(value: unknown): { x: number; y: number } {
  if (!value || typeof value !== 'object') {
    return { x: DEFAULT_BLOCK_X, y: DEFAULT_BLOCK_Y }
  }

  const x = getNumberValue(getRecordValue(value, 'x')) ?? DEFAULT_BLOCK_X
  const y = getNumberValue(getRecordValue(value, 'y')) ?? DEFAULT_BLOCK_Y
  return { x, y }
}

function getSubBlockInputs(block: Record<string, unknown>): Record<string, unknown> {
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

function normalizeWorkflowSnapshot(rawState: unknown): WorkflowSnapshot | null {
  if (!rawState || typeof rawState !== 'object') {
    return null
  }

  const rawBlocks = getRecordValue(rawState, 'blocks')
  const rawEdges = getRecordValue(rawState, 'edges')
  if (!rawBlocks || typeof rawBlocks !== 'object') {
    return null
  }

  const blocks = Object.entries(rawBlocks as Record<string, unknown>)
    .map(([id, rawBlock]) => {
      if (!rawBlock || typeof rawBlock !== 'object') {
        return null
      }

      const block = rawBlock as Record<string, unknown>
      const type = getStringValue(getRecordValue(block, 'type'))
      if (!type) {
        return null
      }

      return {
        id,
        type,
        name: getStringValue(getRecordValue(block, 'name')) ?? type,
        inputs: getSubBlockInputs(block),
        position: getPositionValue(getRecordValue(block, 'position')),
      }
    })
    .filter((block): block is WorkflowSnapshotBlock => block !== null)

  const edges = Array.isArray(rawEdges)
    ? rawEdges
        .map((edge) => {
          if (!edge || typeof edge !== 'object') {
            return null
          }

          const source = getStringValue(getRecordValue(edge, 'source'))
          const target = getStringValue(getRecordValue(edge, 'target'))
          if (!source || !target) {
            return null
          }

          const sourceHandle = getStringValue(getRecordValue(edge, 'sourceHandle'))
          const targetHandle = getStringValue(getRecordValue(edge, 'targetHandle'))
          return {
            source,
            target,
            ...(sourceHandle ? { sourceHandle } : {}),
            ...(targetHandle ? { targetHandle } : {}),
          }
        })
        .filter((edge): edge is WorkflowSnapshot['edges'][number] => edge !== null)
    : []

  return { blocks, edges }
}

async function loadCurrentWorkflowSnapshot(workflowId?: string): Promise<WorkflowSnapshot | null> {
  if (!workflowId) {
    return null
  }

  try {
    const { loadWorkflowFromNormalizedTables } = await import('@/lib/workflows/persistence/utils')
    const normalized = await loadWorkflowFromNormalizedTables(workflowId)
    return normalizeWorkflowSnapshot(normalized)
  } catch (error) {
    logger.warn('Failed to load current workflow snapshot for local fallback', {
      workflowId,
      error: toError(error).message,
    })
    return null
  }
}

function extractPromptSeed(message: string): string {
  const readableChineseThemeMatch = message.match(
    /(?:\u753b\u9762\u4e3b\u9898|\u4e3b\u9898|\u573a\u666f|\u5185\u5bb9)(?:\u662f|\u4e3a)?\s*[:\uff1a]?\s*([^\uff0c\u3002\uff01\uff1f\n]+)/u
  )
  const readableChineseTheme = readableChineseThemeMatch?.[1]?.trim()
  if (readableChineseTheme && readableChineseTheme.length >= 4) {
    return readableChineseTheme
  }

  const preferredChineseThemeMatch = message.match(
    /(?:画面主题|主题|场景|内容)(?:是|为)?\s*[:：]?\s*([^，。！？\n]+)/u
  )
  const chineseThemeMatch =
    preferredChineseThemeMatch ??
    message.match(/(?:画面主题|主题|场景|内容)(?:是|为)?\s*[:：]?\s*([^，。！？\n]+)/u)
  const chineseTheme = chineseThemeMatch?.[1]?.trim()
  if (chineseTheme && chineseTheme.length >= 4) {
    return chineseTheme
  }

  const cleaned = message
    .replace(/[\uFF0C\u3002\uFF01\uFF1F]/g, ' ')
    .replace(new RegExp(CHINESE_ON_CANVAS, 'g'), ' ')
    .replace(new RegExp(CHINESE_GENERATE, 'g'), ' ')
    .replace(new RegExp(CHINESE_WORKFLOW_INTENT, 'g'), ' ')
    .replace(/\u6587\u751f\u56fe/g, ' ')
    .replace(/\u56fe\u751f\u89c6\u9891/g, ' ')
    .replace(/\u751f\u89c6\u9891/g, ' ')
    .replace(/workflow/gi, ' ')
    .replace(/copilot/gi, ' ')
    .replace(/agent/gi, ' ')
    .replace(/image-to-video/gi, ' ')
    .replace(/image to video/gi, ' ')
    .replace(/text-to-image/gi, ' ')
    .replace(/text to image/gi, ' ')
    .replace(/connected/gi, ' ')
    .replace(/connection/gi, ' ')
    .replace(/nodes?/gi, ' ')
    .replace(/canvas/gi, ' ')
    .replace(new RegExp(CHINESE_NODE, 'g'), ' ')
    .replace(new RegExp(CHINESE_CONNECT, 'g'), ' ')
    .replace(new RegExp(CHINESE_FEATURE, 'g'), ' ')
    .replace(new RegExp(CHINESE_REALIZE, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned.length >= 12 ? cleaned : DEFAULT_MEDIA_PROMPT
}

function formatBlockForDescription(block: WorkflowSnapshotBlock): string {
  const prompt = getStringValue(block.inputs.prompt)
  const provider = getStringValue(block.inputs.provider)
  const model = getStringValue(block.inputs.model)
  const details = [provider ? `provider=${provider}` : null, model ? `model=${model}` : null]
    .filter((item): item is string => item !== null)
    .join(', ')
  const promptDetail = prompt
    ? `, prompt="${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}"`
    : ''
  return `${block.name} (${block.type}${details ? `, ${details}` : ''}${promptDetail})`
}

function buildWorkflowDescriptionPlan(
  message: string,
  snapshot: WorkflowSnapshot | null
): LocalWorkflowFallbackPlan {
  if (!snapshot || snapshot.blocks.length === 0) {
    return {
      kind: 'describe_workflow',
      assistantText: isChineseMessage(message)
        ? '\u5f53\u524d\u753b\u5e03\u91cc\u8fd8\u6ca1\u6709\u53ef\u8bfb\u53d6\u7684\u8282\u70b9\uff0c\u6240\u4ee5\u6682\u65f6\u4e0d\u80fd\u603b\u7ed3\u51fa\u5df2\u5b9e\u73b0\u7684\u529f\u80fd\u3002'
        : 'The current canvas does not have readable nodes yet, so there is no implemented workflow to summarize.',
      operations: [],
      planningSource: 'heuristic',
    }
  }

  const byId = new Map(snapshot.blocks.map((block) => [block.id, block]))
  const edgeLines = snapshot.edges
    .map((edge) => {
      const source = byId.get(edge.source)
      const target = byId.get(edge.target)
      if (!source || !target) {
        return null
      }
      return `${source.name} -> ${target.name}`
    })
    .filter((line): line is string => line !== null)

  if (isChineseMessage(message)) {
    const blockSummary = snapshot.blocks.map(formatBlockForDescription).join('\n- ')
    const connectionSummary =
      edgeLines.length > 0 ? edgeLines.join('\n- ') : '\u6682\u65e0\u8fde\u7ebf'
    return {
      kind: 'describe_workflow',
      assistantText: [
        `\u5f53\u524d\u753b\u5e03\u91cc\u6709 ${snapshot.blocks.length} \u4e2a\u8282\u70b9\u3001${snapshot.edges.length} \u6761\u8fde\u7ebf\u3002`,
        '',
        `\u8282\u70b9\uff1a\n- ${blockSummary}`,
        '',
        `\u8fde\u7ebf\uff1a\n- ${connectionSummary}`,
        '',
        inferWorkflowPurposeChinese(snapshot),
      ].join('\n'),
      operations: [],
      planningSource: 'heuristic',
    }
  }

  return {
    kind: 'describe_workflow',
    assistantText: [
      `The current canvas has ${snapshot.blocks.length} node(s) and ${snapshot.edges.length} connection(s).`,
      '',
      `Nodes:\n- ${snapshot.blocks.map(formatBlockForDescription).join('\n- ')}`,
      '',
      `Connections:\n- ${edgeLines.length > 0 ? edgeLines.join('\n- ') : 'No connections yet'}`,
      '',
      inferWorkflowPurposeEnglish(snapshot),
    ].join('\n'),
    operations: [],
    planningSource: 'heuristic',
  }
}

function inferWorkflowPurposeChinese(snapshot: WorkflowSnapshot): string {
  const hasImage = snapshot.blocks.some((block) => block.type === 'image_generator')
  const hasVideo = snapshot.blocks.some((block) => block.type.startsWith('video_generator'))
  if (hasImage && hasVideo) {
    return '\u529f\u80fd\u7406\u89e3\uff1a\u8fd9\u662f\u4e00\u4e2a\u5148\u6839\u636e\u6587\u672c\u751f\u6210\u56fe\u50cf\uff0c\u518d\u628a\u751f\u6210\u56fe\u50cf\u4f5c\u4e3a\u53c2\u8003\u6765\u751f\u6210\u89c6\u9891\u7684\u5de5\u4f5c\u6d41\u3002'
  }
  if (hasImage) {
    return '\u529f\u80fd\u7406\u89e3\uff1a\u8fd9\u4e2a\u5de5\u4f5c\u6d41\u76ee\u524d\u4e3b\u8981\u7528\u4e8e\u6587\u751f\u56fe\u3002'
  }
  if (hasVideo) {
    return '\u529f\u80fd\u7406\u89e3\uff1a\u8fd9\u4e2a\u5de5\u4f5c\u6d41\u76ee\u524d\u4e3b\u8981\u7528\u4e8e\u751f\u6210\u89c6\u9891\u3002'
  }
  return '\u529f\u80fd\u7406\u89e3\uff1a\u8fd9\u4e2a\u5de5\u4f5c\u6d41\u7531\u4e0a\u9762\u7684\u8282\u70b9\u548c\u8fde\u7ebf\u7ec4\u6210\u3002'
}

function inferWorkflowPurposeEnglish(snapshot: WorkflowSnapshot): string {
  const hasImage = snapshot.blocks.some((block) => block.type === 'image_generator')
  const hasVideo = snapshot.blocks.some((block) => block.type.startsWith('video_generator'))
  if (hasImage && hasVideo) {
    return 'Purpose: this workflow generates image(s) from text, then uses generated image output as reference for video generation.'
  }
  if (hasImage) {
    return 'Purpose: this workflow currently focuses on text-to-image generation.'
  }
  if (hasVideo) {
    return 'Purpose: this workflow currently focuses on video generation.'
  }
  return 'Purpose: this workflow is composed from the nodes and connections listed above.'
}

function extractConversationHistory(value: unknown): LocalConversationMessage[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((message) => {
      if (!message || typeof message !== 'object') {
        return null
      }

      const record = message as Record<string, unknown>
      const role = getStringValue(record.role)
      const content = getStringValue(record.content)
      if (!content || (role !== 'user' && role !== 'assistant' && role !== 'system')) {
        return null
      }

      return { role, content }
    })
    .filter((message): message is LocalConversationMessage => message !== null)
}

function getPreviousUserMessage(history: LocalConversationMessage[]): string | null {
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index]
    if (message.role === 'user') {
      return message.content
    }
  }

  return null
}

function buildWorkflowContextForChat(snapshot: WorkflowSnapshot | null): string {
  if (!snapshot || snapshot.blocks.length === 0) {
    return 'Current canvas: empty or unavailable.'
  }

  const edgeSummary = snapshot.edges.map((edge) => `${edge.source} -> ${edge.target}`).join(', ')

  return [
    `Current canvas has ${snapshot.blocks.length} blocks and ${snapshot.edges.length} edges.`,
    `Blocks: ${snapshot.blocks
      .map((block) => `${block.id}:${block.name}:${block.type}`)
      .join(', ')}`,
    `Edges: ${edgeSummary || 'none'}`,
  ].join('\n')
}

function assertNonStreamingProviderResponse(
  response: ProviderResponse | ReadableStream | { stream: ReadableStream; execution: unknown }
): ProviderResponse {
  if (response instanceof ReadableStream) {
    throw new Error('Local Copilot chat returned an unexpected stream response')
  }

  if (response && typeof response === 'object' && 'stream' in response && 'execution' in response) {
    throw new Error('Local Copilot chat returned an unexpected StreamingExecution response')
  }

  return response
}

async function buildGenericChatPlan(params: {
  message: string
  conversationHistory: LocalConversationMessage[]
  snapshot: WorkflowSnapshot | null
  abortSignal?: AbortSignal
}): Promise<LocalWorkflowFallbackPlan> {
  const config = getLocalCopilotPlannerConfig()
  if (config) {
    const historyMessages = params.conversationHistory.slice(-8)
    const response = assertNonStreamingProviderResponse(
      await executeProviderRequest(config.provider, {
        model: config.model,
        apiKey: config.apiKey,
        systemPrompt: [
          'You are the local Sim canvas Copilot.',
          'Be a capable general assistant first: answer normal questions directly, including math and factual questions.',
          'When the user asks about the canvas, use the current canvas context.',
          'When the user asks to change the canvas, explain what can be changed locally if no tool plan is available.',
          'Reply in the user language.',
          '',
          buildWorkflowContextForChat(params.snapshot),
        ].join('\n'),
        messages: [
          ...historyMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          { role: 'user', content: params.message },
        ],
        temperature: 0.3,
        maxTokens: 1200,
        abortSignal: params.abortSignal,
      })
    )

    return {
      kind: 'generic_chat',
      assistantText: response.content || buildOfflineGenericAssistantText(params),
      operations: [],
      planningSource: 'llm',
    }
  }

  return {
    kind: 'generic_chat',
    assistantText: buildOfflineGenericAssistantText(params),
    operations: [],
    planningSource: 'heuristic',
  }
}

function buildOfflineGenericAssistantText(params: {
  message: string
  conversationHistory: LocalConversationMessage[]
  snapshot: WorkflowSnapshot | null
}): string {
  const normalized = params.message.trim().toLowerCase()

  if (/^(1\s*\+\s*1|one\s+plus\s+one|一\s*加\s*一)/i.test(normalized)) {
    return isChineseMessage(params.message) ? '1 + 1 = 2。' : '1 + 1 = 2.'
  }

  if (
    normalized.includes('\u521a\u624d') ||
    normalized.includes('\u4e0a\u4e00\u53e5') ||
    normalized.includes('previous message') ||
    normalized.includes('what did i just')
  ) {
    const previous = getPreviousUserMessage(params.conversationHistory)
    if (previous) {
      return isChineseMessage(params.message)
        ? `你上一条用户消息是：“${previous}”。`
        : `Your previous user message was: "${previous}".`
    }
  }

  const canvasLine =
    params.snapshot && params.snapshot.blocks.length > 0
      ? isChineseMessage(params.message)
        ? `我也能读取当前画布：现在有 ${params.snapshot.blocks.length} 个节点、${params.snapshot.edges.length} 条连线。`
        : `I can also read the current canvas: ${params.snapshot.blocks.length} node(s), ${params.snapshot.edges.length} edge(s).`
      : ''

  return isChineseMessage(params.message)
    ? [
        '我现在处在本地 Copilot 模式。基础问答和上下文引用已经不会再被硬性限制到图像/视频工作流。',
        canvasLine,
        '如果你配置 `LOCAL_COPILOT_PROVIDER` + 对应 API key，我还可以用本地模型处理更开放的聊天和规划。',
      ]
        .filter(Boolean)
        .join('\n')
    : [
        'I am running in local Copilot mode. Basic chat and context references are no longer hard-limited to image/video workflows.',
        canvasLine,
        'Configure `LOCAL_COPILOT_PROVIDER` plus the matching API key to enable broader local model-backed replies.',
      ]
        .filter(Boolean)
        .join('\n')
}

function buildDefaultAssistantText(message: string, planningSource: 'heuristic' | 'llm'): string {
  if (isChineseMessage(message)) {
    return planningSource === 'llm'
      ? '\u6211\u5df2\u7ecf\u6839\u636e\u4f60\u7684\u63cf\u8ff0\u89c4\u5212\u4e86\u4e00\u5957\u201c\u6587\u751f\u56fe -> \u56fe\u751f\u89c6\u9891\u201d\u7684\u5de5\u4f5c\u6d41\u63d0\u6848\u3002\u5de6\u4fa7\u753b\u5e03\u5e94\u8be5\u4f1a\u51fa\u73b0\u5df2\u7ecf\u8fde\u597d\u7684 Image Generator \u548c Video Generator \u8282\u70b9\uff0c\u63a5\u4e0b\u6765\u53ea\u9700\u8981\u5728 diff \u9762\u677f\u91cc\u70b9\u51fb Accept\u3002'
      : '\u6211\u5df2\u7ecf\u5207\u6362\u5230\u672c\u5730 Copilot scaffold \u6a21\u5f0f\uff0c\u5e76\u4e3a\u5f53\u524d\u5de5\u4f5c\u6d41\u751f\u6210\u4e86\u4e00\u5957\u201c\u6587\u751f\u56fe -> \u56fe\u751f\u89c6\u9891\u201d\u7684\u63d0\u6848\u3002\u5de6\u4fa7\u753b\u5e03\u5e94\u8be5\u4f1a\u51fa\u73b0\u5df2\u7ecf\u8fde\u597d\u7684 Image Generator \u548c Video Generator \u8282\u70b9\uff0c\u63a5\u4e0b\u6765\u53ea\u9700\u8981\u5728 diff \u9762\u677f\u91cc\u70b9\u51fb Accept\u3002'
  }

  return planningSource === 'llm'
    ? 'I planned a local text-to-image then image-to-video workflow for this canvas. The left canvas should show connected Image Generator and Video Generator nodes, and you can accept the diff to apply it.'
    : 'I switched to the local Copilot scaffold mode and generated a text-to-image then image-to-video proposal for this canvas. The left canvas should show connected Image Generator and Video Generator nodes, and you can accept the diff to apply it.'
}

function buildUnsupportedAssistantText(message: string): string {
  if (isChineseMessage(message)) {
    return '当前本地右侧 agent 已支持基础聊天、读取当前画布、描述工作流、调整简单横向/纵向布局，以及创建或编辑常见画布节点。更开放的自然语言规划需要配置 `LOCAL_COPILOT_PROVIDER` 和对应 API key。'
  }

  return 'The local right-side agent supports basic chat, current-canvas summaries, simple horizontal/vertical layout edits, and common canvas node creation or edits. Configure `LOCAL_COPILOT_PROVIDER` plus the matching API key for broader natural-language planning.'
}

function buildUnsupportedPlan(
  message: string,
  planningSource: 'heuristic' | 'llm'
): LocalWorkflowFallbackPlan {
  return {
    kind: 'unsupported',
    assistantText: buildUnsupportedAssistantText(message),
    operations: [],
    planningSource,
  }
}

function buildImageToVideoOperations(params: {
  message: string
  assistantText?: string
  imagePrompt: string
  videoPrompt: string
  imageModel: 'dall-e-3' | 'gpt-image-1' | 'gpt-image-2'
  videoProvider: 'runway' | 'veo' | 'luma' | 'minimax' | 'falai'
  durationSeconds: 4 | 5 | 6 | 8 | 9 | 10
  aspectRatio: '16:9' | '9:16' | '1:1'
  planningSource: 'heuristic' | 'llm'
}): LocalWorkflowFallbackPlan {
  const suffix = generateShortId(6).toUpperCase()
  const imageBlockId = generateId()
  const videoBlockId = generateId()
  const imageBlockName = `Image Generator ${suffix}`
  const videoBlockName = `Video Generator ${suffix}`
  const videoInputs: Record<string, string> = {
    provider: params.videoProvider,
    prompt: params.videoPrompt,
    duration: String(params.durationSeconds),
    aspectRatio: params.aspectRatio,
  }

  if (VIDEO_BLOCK_TYPE === 'video_generator_v2' && params.videoProvider === 'runway') {
    videoInputs.visualReferenceInput = `<${imageBlockName}.image>`
  }

  const operations: EditWorkflowOperation[] = [
    {
      operation_type: 'add',
      block_id: imageBlockId,
      params: {
        type: 'image_generator',
        name: imageBlockName,
        inputs: {
          model: params.imageModel,
          prompt: params.imagePrompt,
          size: params.imageModel === 'dall-e-3' ? '1024x1024' : 'auto',
          quality: params.imageModel === 'dall-e-3' ? 'standard' : 'auto',
          background: 'auto',
          outputFormat: 'png',
          moderation: 'auto',
        },
        connections: {
          success: videoBlockId,
        },
      },
    },
    {
      operation_type: 'add',
      block_id: videoBlockId,
      params: {
        type: VIDEO_BLOCK_TYPE,
        name: videoBlockName,
        inputs: videoInputs,
      },
    },
  ]

  return {
    kind: 'image_to_video',
    assistantText:
      params.assistantText?.trim() ||
      buildDefaultAssistantText(params.message, params.planningSource),
    operations,
    planningSource: params.planningSource,
  }
}

function isVideoBlock(block: WorkflowSnapshotBlock): boolean {
  return block.type === 'video_generator' || block.type === 'video_generator_v2'
}

function findPrimaryVideoBlock(snapshot: WorkflowSnapshot): WorkflowSnapshotBlock | null {
  return snapshot.blocks.find(isVideoBlock) ?? null
}

function findImageBlocksFeedingVideo(
  snapshot: WorkflowSnapshot,
  videoBlockId: string
): WorkflowSnapshotBlock[] {
  const imageBlocksById = new Map(
    snapshot.blocks
      .filter((block) => block.type === 'image_generator')
      .map((block) => [block.id, block])
  )

  const connected = snapshot.edges
    .filter((edge) => edge.target === videoBlockId)
    .map((edge) => imageBlocksById.get(edge.source))
    .filter((block): block is WorkflowSnapshotBlock => block !== undefined)

  return connected.length > 0 ? connected : Array.from(imageBlocksById.values())
}

function getLayoutDirection(message: string): 'horizontal' | 'vertical' {
  if (
    message.includes('\u7eb5\u5411') ||
    message.toLowerCase().includes('vertical') ||
    message.toLowerCase().includes('column')
  ) {
    return 'vertical'
  }

  return 'horizontal'
}

function orderBlocksForLayout(snapshot: WorkflowSnapshot): WorkflowSnapshotBlock[] {
  const byId = new Map(snapshot.blocks.map((block) => [block.id, block]))
  const incomingCount = new Map(snapshot.blocks.map((block) => [block.id, 0]))
  const outgoing = new Map<string, string[]>()

  for (const edge of snapshot.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) {
      continue
    }

    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1)
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
  }

  const queue = snapshot.blocks
    .filter((block) => (incomingCount.get(block.id) ?? 0) === 0)
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
  const ordered: WorkflowSnapshotBlock[] = []
  const seen = new Set<string>()

  while (queue.length > 0) {
    const block = queue.shift()
    if (!block || seen.has(block.id)) {
      continue
    }

    seen.add(block.id)
    ordered.push(block)

    for (const targetId of outgoing.get(block.id) ?? []) {
      incomingCount.set(targetId, (incomingCount.get(targetId) ?? 0) - 1)
      if ((incomingCount.get(targetId) ?? 0) <= 0) {
        const target = byId.get(targetId)
        if (target && !seen.has(target.id)) {
          queue.push(target)
        }
      }
    }
  }

  for (const block of snapshot.blocks) {
    if (!seen.has(block.id)) {
      ordered.push(block)
    }
  }

  return ordered
}

function buildLayoutWorkflowPlan(
  message: string,
  snapshot: WorkflowSnapshot | null
): LocalWorkflowFallbackPlan {
  if (!snapshot || snapshot.blocks.length === 0) {
    return {
      kind: 'layout_workflow',
      assistantText: isChineseMessage(message)
        ? '\u5f53\u524d\u753b\u5e03\u91cc\u8fd8\u6ca1\u6709\u53ef\u4ee5\u91cd\u65b0\u5e03\u5c40\u7684\u8282\u70b9\u3002'
        : 'There are no readable nodes on the current canvas to lay out yet.',
      operations: [],
      planningSource: 'heuristic',
    }
  }

  const direction = getLayoutDirection(message)
  const orderedBlocks = orderBlocksForLayout(snapshot)
  const operations = orderedBlocks.map((block, index): EditWorkflowOperation => {
    const position =
      direction === 'vertical'
        ? {
            x: DEFAULT_BLOCK_X + (index % 2) * VERTICAL_LAYOUT_GAP_X,
            y: DEFAULT_BLOCK_Y + index * VERTICAL_LAYOUT_GAP_Y,
          }
        : {
            x: DEFAULT_BLOCK_X + index * HORIZONTAL_LAYOUT_GAP_X,
            y: DEFAULT_BLOCK_Y + (index % 2) * HORIZONTAL_LAYOUT_GAP_Y,
          }

    return {
      operation_type: 'edit',
      block_id: block.id,
      params: { position },
    }
  })

  return {
    kind: 'layout_workflow',
    assistantText: isChineseMessage(message)
      ? `\u6211\u5df2\u7ecf\u4e3a\u5f53\u524d ${snapshot.blocks.length} \u4e2a\u8282\u70b9\u751f\u6210\u4e86${direction === 'vertical' ? '\u7eb5\u5411' : '\u6a2a\u5411'}\u5e03\u5c40\u63d0\u6848\uff0c\u4f1a\u4fdd\u7559\u539f\u6709\u8282\u70b9\u548c\u8fde\u7ebf\uff0c\u53ea\u8c03\u6574\u4f4d\u7f6e\u3002`
      : `I prepared a ${direction} layout proposal for the current ${snapshot.blocks.length} node(s). It keeps existing nodes and edges and only updates positions.`,
    operations,
    planningSource: 'heuristic',
  }
}

function buildTextAgentPlan(
  message: string,
  snapshot: WorkflowSnapshot | null
): LocalWorkflowFallbackPlan {
  const suffix = generateShortId(6).toUpperCase()
  const agentBlockId = generateId()
  const orderedBlocks = snapshot ? orderBlocksForLayout(snapshot) : []
  const lastBlock = orderedBlocks[orderedBlocks.length - 1]
  const agentBlockName = `Text Agent ${suffix}`
  const promptSeed = extractPromptSeed(message)

  return {
    kind: 'text_agent',
    assistantText: isChineseMessage(message)
      ? '\u6211\u5df2\u7ecf\u751f\u6210\u4e86\u4e00\u4e2a\u6587\u672c\u751f\u6210 Agent \u8282\u70b9\u63d0\u6848\u3002\u5b83\u4f7f\u7528\u901a\u7528 LLM Agent block\uff0c\u4f60\u53ef\u4ee5\u5728 diff \u9762\u677f\u63a5\u53d7\u540e\u7ee7\u7eed\u8c03\u6574\u6a21\u578b\u548c prompt\u3002'
      : 'I prepared a text-generation Agent node proposal. It uses the generic LLM Agent block, and you can adjust the model and prompt after accepting the diff.',
    operations: [
      {
        operation_type: 'add',
        block_id: agentBlockId,
        params: {
          type: 'agent',
          name: agentBlockName,
          position: lastBlock
            ? { x: lastBlock.position.x + HORIZONTAL_LAYOUT_GAP_X, y: lastBlock.position.y }
            : { x: DEFAULT_BLOCK_X, y: DEFAULT_BLOCK_Y },
          inputs: {
            model: 'claude-sonnet-4-6',
            messages: [
              {
                role: 'system',
                content:
                  'You are a helpful text generation assistant. Produce clear, useful responses for the user request.',
              },
              {
                role: 'user',
                content: promptSeed === DEFAULT_MEDIA_PROMPT ? '<start.input>' : promptSeed,
              },
            ],
          },
        },
      },
    ],
    planningSource: 'heuristic',
  }
}

function buildStoryboardPrompt(basePrompt: string, index: number): string {
  const shotDescriptions = [
    'Opening establishing storyboard frame with clear subject, environment, lighting, and cinematic composition.',
    'Middle storyboard frame showing the key action beat with consistent characters, location, and visual style.',
    'Final storyboard frame resolving the motion beat, designed to transition naturally into the generated video.',
  ]

  return `${shotDescriptions[index] ?? shotDescriptions[shotDescriptions.length - 1]} Core concept: ${basePrompt}`
}

function resolveStoryboardImageCount(message: string): number {
  const digitMatch = message.match(/(\d+)\s*(?:\u4e2a|\u5f20|\u5e45|shots?|scenes?|frames?)/i)
  if (digitMatch) {
    const parsed = Number.parseInt(digitMatch[1], 10)
    if (Number.isFinite(parsed)) {
      return Math.min(Math.max(parsed, 2), MAX_STORYBOARD_IMAGE_COUNT)
    }
  }

  const chineseNumbers: Array<[string, number]> = [
    ['\u516d', 6],
    ['\u4e94', 5],
    ['\u56db', 4],
    ['\u4e09', 3],
    ['\u4e8c', 2],
    ['\u4e24', 2],
  ]
  const chineseMatch = chineseNumbers.find(([label]) =>
    new RegExp(`${label}\\s*(?:\\u4e2a|\\u5f20|\\u5e45)?\\s*\\u5206\\u955c`).test(message)
  )

  return chineseMatch?.[1] ?? DEFAULT_STORYBOARD_IMAGE_COUNT
}

function buildStoryboardVideoPrompt(basePrompt: string, imageNames: string[]): string {
  return [
    'Animate the storyboard into one coherent cinematic video.',
    `Use the generated storyboard frames as visual guidance: ${imageNames.join(', ')}.`,
    'Preserve character, setting, lighting, and style consistency across the motion.',
    `Core concept: ${basePrompt}`,
  ].join(' ')
}

function buildStoryboardAssistantText(params: {
  message: string
  editedExistingChain: boolean
  imageCount: number
}): string {
  if (isChineseMessage(params.message)) {
    return params.editedExistingChain
      ? `\u6211\u5df2\u7ecf\u57fa\u4e8e\u5f53\u524d\u753b\u5e03\u4e2d\u5df2\u6709\u7684\u56fe\u751f\u89c6\u9891\u94fe\u8def\u751f\u6210\u4e86\u4fee\u6539\u63d0\u6848\uff1a\u628a\u539f\u6765\u7684\u5355\u5f20 Image Generator \u6269\u5c55\u4e3a ${params.imageCount} \u4e2a\u5206\u955c\u56fe\u8282\u70b9\uff0c\u5e76\u7ee7\u7eed\u8fde\u5230\u539f\u6709 Video Generator\u3002\u5728 diff \u9762\u677f\u70b9\u51fb Accept \u540e\uff0c\u8fd9\u4e2a\u5de5\u4f5c\u6d41\u5c31\u4f1a\u53d8\u6210\u201c\u6587\u751f\u591a\u4e2a\u5206\u955c\u56fe -> \u56fe\u751f\u89c6\u9891\u201d\u3002`
      : `\u6211\u5df2\u7ecf\u4e3a\u5f53\u524d\u753b\u5e03\u751f\u6210\u4e86\u4e00\u5957\u201c\u6587\u751f\u591a\u4e2a\u5206\u955c\u56fe -> \u56fe\u751f\u89c6\u9891\u201d\u63d0\u6848\uff1a${params.imageCount} \u4e2a Image Generator \u8282\u70b9\u4f1a\u4ea7\u51fa\u5206\u955c\u56fe\uff0c\u7136\u540e\u8fde\u5230 Video Generator\u3002\u63a5\u4e0b\u6765\u5728 diff \u9762\u677f\u70b9\u51fb Accept \u5373\u53ef\u5e94\u7528\u3002`
  }

  return params.editedExistingChain
    ? `I prepared an edit proposal for the existing image-to-video chain: the single image step becomes ${params.imageCount} storyboard image nodes feeding the existing Video Generator. Accept the diff to apply it.`
    : `I prepared a storyboard-to-video proposal with ${params.imageCount} Image Generator nodes feeding a Video Generator. Accept the diff to apply it.`
}

function buildStoryboardToVideoPlan(params: {
  message: string
  snapshot: WorkflowSnapshot | null
}): LocalWorkflowFallbackPlan {
  const { message, snapshot } = params
  const promptSeed = extractPromptSeed(message)
  const storyboardImageCount = resolveStoryboardImageCount(message)
  const videoBlock = snapshot ? findPrimaryVideoBlock(snapshot) : null
  const existingImages =
    videoBlock && snapshot ? findImageBlocksFeedingVideo(snapshot, videoBlock.id) : []
  const imageBlockEntries = Array.from({ length: storyboardImageCount }, (_, index) => {
    const existingBlock = existingImages[index]
    const name =
      existingBlock?.name ?? `Storyboard Image ${index + 1} ${generateShortId(4).toUpperCase()}`
    const id = existingBlock?.id ?? generateId()
    return {
      id,
      name,
      existing: Boolean(existingBlock),
      prompt: buildStoryboardPrompt(promptSeed, index),
    }
  })

  const videoBlockId = videoBlock?.id ?? generateId()
  const videoBlockName = videoBlock?.name ?? `Video Generator ${generateShortId(6).toUpperCase()}`
  const imageNames = imageBlockEntries.map((entry) => entry.name)
  const operations: EditWorkflowOperation[] = []

  for (const entry of imageBlockEntries) {
    const imageInputs = {
      model: 'gpt-image-1',
      prompt: entry.prompt,
      size: 'auto',
      quality: 'auto',
      background: 'auto',
      outputFormat: 'png',
      moderation: 'auto',
    }

    operations.push({
      operation_type: entry.existing ? 'edit' : 'add',
      block_id: entry.id,
      params: {
        ...(entry.existing ? {} : { type: 'image_generator', name: entry.name }),
        inputs: imageInputs,
        connections: {
          success: videoBlockId,
        },
      },
    })
  }

  const videoInputs: Record<string, string> = {
    provider: 'runway',
    prompt: buildStoryboardVideoPrompt(promptSeed, imageNames),
    duration: '10',
    aspectRatio: '16:9',
  }

  if (VIDEO_BLOCK_TYPE === 'video_generator_v2') {
    videoInputs.visualReferenceInput = `<${imageNames[0]}.image>`
  }

  operations.push({
    operation_type: videoBlock ? 'edit' : 'add',
    block_id: videoBlockId,
    params: {
      ...(videoBlock ? {} : { type: VIDEO_BLOCK_TYPE, name: videoBlockName }),
      inputs: videoInputs,
    },
  })

  return {
    kind: 'storyboard_to_video',
    assistantText: buildStoryboardAssistantText({
      message,
      editedExistingChain: Boolean(videoBlock || existingImages.length > 0),
      imageCount: storyboardImageCount,
    }),
    operations,
    planningSource: 'heuristic',
  }
}

function buildPlanFromPlannerResponse(
  message: string,
  response: LocalWorkflowPlannerResponse
): LocalWorkflowFallbackPlan {
  if (response.intent !== 'image_to_video') {
    const shouldFallbackToHeuristic = isLocalWorkflowFallbackIntent(message)

    logger.info('Local workflow planner returned a non-image_to_video intent', {
      intent: response.intent,
      shouldFallbackToHeuristic,
      assistantTextPreview: response.assistantText.slice(0, 120),
    })

    if (shouldFallbackToHeuristic) {
      return buildLocalWorkflowFallbackPlan(message)
    }

    return {
      kind: 'unsupported',
      assistantText: response.assistantText.trim() || buildUnsupportedAssistantText(message),
      operations: [],
      planningSource: 'llm',
    }
  }

  const promptSeed = extractPromptSeed(message)
  const imagePrompt = response.imagePrompt.trim() || promptSeed
  const videoPrompt =
    response.videoPrompt.trim() ||
    `Animate the supplied reference image into a short cinematic clip. ${promptSeed}`

  return buildImageToVideoOperations({
    message,
    assistantText: response.assistantText,
    imagePrompt,
    videoPrompt,
    imageModel: response.imageModel,
    videoProvider: response.videoProvider,
    durationSeconds: response.durationSeconds,
    aspectRatio: response.aspectRatio,
    planningSource: 'llm',
  })
}

/**
 * Builds the deterministic local media workflow plan used when the planner is unavailable.
 */
export function buildLocalWorkflowFallbackPlan(message: string): LocalWorkflowFallbackPlan {
  const promptSeed = extractPromptSeed(message)
  return buildImageToVideoOperations({
    message,
    imagePrompt: promptSeed,
    videoPrompt: `Animate the supplied reference image into a short cinematic clip. ${promptSeed}`,
    imageModel: 'gpt-image-1',
    videoProvider: 'runway',
    durationSeconds: 5,
    aspectRatio: '16:9',
    planningSource: 'heuristic',
  })
}

async function createLocalWorkflowFallbackPlan(params: {
  message: string
  workflowId?: string
  conversationHistory?: LocalConversationMessage[]
  abortSignal?: AbortSignal
}): Promise<LocalWorkflowFallbackPlan> {
  const currentWorkflowSnapshot = await loadCurrentWorkflowSnapshot(params.workflowId)
  const conversationHistory = params.conversationHistory ?? []

  if (isDescribeCurrentWorkflowIntent(params.message)) {
    const plan = buildWorkflowDescriptionPlan(params.message, currentWorkflowSnapshot)

    logger.info('Resolved local workflow description plan', {
      blockCount: currentWorkflowSnapshot?.blocks.length ?? 0,
      edgeCount: currentWorkflowSnapshot?.edges.length ?? 0,
    })

    return plan
  }

  if (isLayoutWorkflowIntent(params.message)) {
    const plan = buildLayoutWorkflowPlan(params.message, currentWorkflowSnapshot)

    logger.info('Resolved local workflow layout plan', {
      operationCount: plan.operations.length,
      hasSnapshot: Boolean(currentWorkflowSnapshot),
    })

    return plan
  }

  if (isTextAgentIntent(params.message)) {
    const plan = buildTextAgentPlan(params.message, currentWorkflowSnapshot)

    logger.info('Resolved local text agent workflow plan', {
      operationCount: plan.operations.length,
      hasSnapshot: Boolean(currentWorkflowSnapshot),
    })

    return plan
  }

  if (isStoryboardEditIntent(params.message)) {
    const plan = buildStoryboardToVideoPlan({
      message: params.message,
      snapshot: currentWorkflowSnapshot,
    })

    logger.info('Resolved local storyboard workflow plan', {
      operationCount: plan.operations.length,
      hasSnapshot: Boolean(currentWorkflowSnapshot),
    })

    return plan
  }

  if (!isLocalWorkflowFallbackIntent(params.message)) {
    const plan = await buildGenericChatPlan({
      message: params.message,
      conversationHistory,
      snapshot: currentWorkflowSnapshot,
      abortSignal: params.abortSignal,
    })

    logger.info('Resolved local generic chat plan', {
      planningSource: plan.planningSource,
      hasSnapshot: Boolean(currentWorkflowSnapshot),
      historyCount: conversationHistory.length,
    })

    return plan
  }

  try {
    const planned = await planLocalWorkflow({
      message: params.message,
      abortSignal: params.abortSignal,
    })

    if (planned) {
      logger.info('Local workflow planner produced a plan candidate', {
        provider: planned.config.provider,
        model: planned.config.model,
        intent: planned.plan.intent,
        imageModel: planned.plan.imageModel,
        videoProvider: planned.plan.videoProvider,
        durationSeconds: planned.plan.durationSeconds,
        aspectRatio: planned.plan.aspectRatio,
      })

      const plan = buildPlanFromPlannerResponse(params.message, planned.plan)

      logger.info('Resolved local workflow fallback plan', {
        kind: plan.kind,
        planningSource: plan.planningSource,
        operationCount: plan.operations.length,
      })

      return plan
    }
  } catch (error) {
    logger.warn('Local workflow planner failed, falling back to deterministic scaffold', {
      error: toError(error).message,
    })
  }

  if (isLocalWorkflowFallbackIntent(params.message)) {
    const plan = buildLocalWorkflowFallbackPlan(params.message)

    logger.info('Resolved local workflow fallback plan without LLM planner', {
      kind: plan.kind,
      planningSource: plan.planningSource,
      operationCount: plan.operations.length,
    })

    return plan
  }

  const plan = buildUnsupportedPlan(params.message, 'heuristic')

  logger.info('Resolved unsupported local workflow fallback plan', {
    kind: plan.kind,
    planningSource: plan.planningSource,
    operationCount: plan.operations.length,
  })

  return plan
}

/**
 * Enables the local workflow fallback only for self-hosted debug sessions.
 */
export function shouldUseLocalWorkflowFallback(params: {
  workflowId?: string
  disableAuth: boolean
  hasCopilotApiKey: boolean
  error?: unknown
}): boolean {
  if (!params.workflowId || !params.disableAuth) {
    return false
  }

  if (!params.hasCopilotApiKey) {
    return true
  }

  const error = params.error
  if (!error || typeof error !== 'object') {
    return false
  }

  const status = 'status' in error ? error.status : undefined
  return status === 401
}

type LocalFallbackOptions = Pick<OrchestratorOptions, 'abortSignal' | 'onEvent'>

async function emitAssistantText(
  context: StreamingContext,
  options: LocalFallbackOptions,
  text: string
): Promise<void> {
  if (!text) {
    return
  }

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

/**
 * Executes the local workflow scaffold and emits the same tool events the UI already understands.
 */
export async function runLocalWorkflowFallback(params: {
  requestPayload: Record<string, unknown>
  context: StreamingContext
  execContext: ExecutionContext
  options: LocalFallbackOptions
}): Promise<void> {
  const { requestPayload, context, execContext, options } = params
  const message = typeof requestPayload.message === 'string' ? requestPayload.message : ''
  const workflowId =
    typeof requestPayload.workflowId === 'string' && requestPayload.workflowId.length > 0
      ? requestPayload.workflowId
      : execContext.workflowId
  const conversationHistory = extractConversationHistory(requestPayload.conversationHistory)

  if (!workflowId) {
    throw new Error('Local workflow fallback requires a workflowId')
  }

  const plan = await createLocalWorkflowFallbackPlan({
    message,
    workflowId,
    conversationHistory,
    abortSignal: options.abortSignal,
  })

  if (plan.operations.length === 0) {
    await emitAssistantText(context, options, plan.assistantText)
    context.streamComplete = true
    return
  }

  const toolCallId = generateId()
  const toolCall = createToolCallState({
    toolCallId,
    workflowId,
    operations: plan.operations,
  })

  context.toolCalls.set(toolCallId, toolCall)
  context.contentBlocks.push({
    type: 'tool_call',
    toolCall,
    timestamp: Date.now(),
  })

  await options.onEvent?.({
    type: MothershipStreamV1EventType.tool,
    payload: {
      toolCallId,
      toolName: EditWorkflow.id,
      executor: MothershipStreamV1ToolExecutor.sim,
      mode: MothershipStreamV1ToolMode.async,
      phase: MothershipStreamV1ToolPhase.call,
      status: 'executing',
      arguments: {
        workflowId,
        operations: plan.operations,
      },
    },
  })

  try {
    const toolOutput = await editWorkflowServerTool.execute(
      {
        workflowId,
        operations: plan.operations,
      } satisfies EditWorkflowParams,
      {
        userId: execContext.userId,
        workspaceId: execContext.workspaceId,
        chatId: execContext.chatId,
        messageId: execContext.messageId,
        abortSignal: options.abortSignal,
      }
    )

    setTerminalToolCallState(toolCall, {
      status: MothershipStreamV1ToolOutcome.success,
      output: toolOutput,
    })

    await options.onEvent?.({
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId,
        toolName: EditWorkflow.id,
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.result,
        status: MothershipStreamV1ToolOutcome.success,
        success: true,
        output: toolOutput,
      },
    })

    await emitAssistantText(context, options, plan.assistantText)
    context.streamComplete = true
  } catch (error) {
    const errorMessage = toError(error).message

    logger.error('Local workflow fallback failed', {
      workflowId,
      error: errorMessage,
    })

    setTerminalToolCallState(toolCall, {
      status: MothershipStreamV1ToolOutcome.error,
      error: errorMessage,
    })
    context.errors.push(errorMessage)

    await options.onEvent?.({
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

    await emitAssistantText(
      context,
      options,
      isChineseMessage(message)
        ? `\u672c\u5730 Copilot scaffold \u6a21\u5f0f\u5c1d\u8bd5\u4fee\u6539\u753b\u5e03\u65f6\u5931\u8d25\u4e86\uff1a${errorMessage}`
        : `The local Copilot scaffold failed while editing the canvas: ${errorMessage}`
    )
    context.streamComplete = true
  }
}
