import { z } from 'zod'
import { executeLocalAgentModelRequest } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/config'
import { buildLocalAgentRoleSystemPrompt } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/prompts'
import { LOCAL_AGENT_TOOL_DESCRIPTORS } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-descriptor'
import { selectAvailableLocalAgentTools } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-registry'
import {
  buildBudgetedObservationPromptWithOptions,
  summarizeAvailableToolNames,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-result-budget'
import type {
  LocalAgentContext,
  LocalAgentDecision,
  LocalAgentDecisionIntent,
  LocalAgentObservation,
  LocalAgentToolName,
  LocalCanvasMutationPolicy,
  LocalCanvasReadPolicy,
  LocalCanvasUserIntent,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const LOCAL_AGENT_TOOL_NAMES = [
  'canvas.read_summary',
  'canvas.read_node',
  'canvas.read_selected_nodes',
  'canvas.search_nodes',
  'canvas.inspect_schema',
  'canvas.propose_patch',
  'canvas.apply_patch',
  'canvas.verify_patch',
  'canvas.generate_node_output',
  'media.analyze_node_media',
  'read_file',
  'search_workspace',
  'materialize_file',
  'query_knowledge',
  'search_docs',
  'read_tasks',
  'update_task_result',
  'submit_task_result',
] as const satisfies readonly LocalAgentToolName[]

const localAgentToolNameSchema = z.enum(LOCAL_AGENT_TOOL_NAMES)
const localAgentRiskSchema = z.enum(['low', 'medium', 'high'])
const decisionIntentSchema = z.enum([
  'consult_design',
  'inspect_canvas',
  'propose_plan',
  'mutate_canvas',
  'generate_output',
  'non_canvas',
  'ask_confirmation',
  'ask_clarification',
  'ambiguous',
] satisfies readonly LocalAgentDecisionIntent[])
const decisionSemanticsSchema = {
  intent: decisionIntentSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  intentReason: z.string().min(1).optional(),
} as const
const toolCallSchema = z.object({
  type: z.literal('tool_call'),
  ...decisionSemanticsSchema,
  toolName: localAgentToolNameSchema,
  toolInput: z.record(z.string(), z.unknown()).catch({}),
  userVisibleReason: z.string().min(1),
  risk: localAgentRiskSchema.catch('low'),
})
const parallelToolCallsSchema = z.object({
  type: z.literal('tool_calls'),
  ...decisionSemanticsSchema,
  toolCalls: z
    .array(
      z.object({
        toolName: localAgentToolNameSchema,
        toolInput: z.record(z.string(), z.unknown()).catch({}),
        userVisibleReason: z.string().min(1).optional(),
      })
    )
    .min(1)
    .max(4),
  userVisibleReason: z.string().min(1),
  risk: localAgentRiskSchema.catch('low'),
})
const askConfirmationSchema = z.object({
  type: z.literal('ask_confirmation'),
  ...decisionSemanticsSchema,
  question: z.string().min(1),
  pendingToolCall: z
    .object({
      name: localAgentToolNameSchema,
      input: z.record(z.string(), z.unknown()).catch({}),
    })
    .optional(),
  risk: z.enum(['medium', 'high']).catch('medium'),
})
const askClarificationSchema = z.object({
  type: z.literal('ask_clarification'),
  ...decisionSemanticsSchema,
  question: z.string().min(1),
})
const memoryUpdateSchema = z.object({
  conversationSummary: z.string().optional(),
  canvasSummary: z.string().optional(),
  taskState: z
    .object({
      goal: z.string().optional(),
      openQuestions: z.array(z.string()).optional(),
      lastObservation: z.string().optional(),
    })
    .optional(),
})
const finalAnswerSchema = z.object({
  type: z.literal('final_answer'),
  ...decisionSemanticsSchema,
  answer: z.string().min(1),
  memoryUpdate: memoryUpdateSchema.optional(),
})

export const localAgentDecisionSchema = z.discriminatedUnion('type', [
  toolCallSchema,
  parallelToolCallsSchema,
  askConfirmationSchema,
  askClarificationSchema,
  finalAnswerSchema,
])

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/)
    return match ? JSON.parse(match[0]) : null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readFirst(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key]
  }
  return undefined
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  const value = readFirst(record, keys)
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  const value = readFirst(record, keys)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function normalizeDecisionType(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (['tool_call', 'call_tool', 'use_tool', 'tool'].includes(normalized)) return 'tool_call'
  if (['tool_calls', 'parallel_tool_calls', 'call_tools', 'use_tools'].includes(normalized)) {
    return 'tool_calls'
  }
  if (['ask_confirmation', 'confirm', 'confirmation'].includes(normalized)) {
    return 'ask_confirmation'
  }
  if (['ask_clarification', 'clarify', 'clarification'].includes(normalized)) {
    return 'ask_clarification'
  }
  if (['final_answer', 'answer', 'final'].includes(normalized)) return 'final_answer'
  return undefined
}

function normalizeDecisionSemantics(record: Record<string, unknown>): Record<string, unknown> {
  const intent = readString(record, ['intent', 'userIntent', 'user_intent'])
  const confidence = readNumber(record, ['confidence', 'intentConfidence', 'intent_confidence'])
  const intentReason = readString(record, ['intentReason', 'intent_reason', 'reasoning'])
  return {
    ...(intent ? { intent } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(intentReason ? { intentReason } : {}),
  }
}

function normalizeToolCallRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  return {
    ...value,
    ...normalizeDecisionSemantics(value),
    toolName: readFirst(value, ['toolName', 'tool_name', 'name', 'tool']),
    toolInput: readFirst(value, ['toolInput', 'tool_input', 'input', 'arguments', 'args']) ?? {},
    userVisibleReason:
      readString(value, ['userVisibleReason', 'user_visible_reason', 'reason']) ??
      '调用工具读取或处理当前请求。',
  }
}

function normalizePendingToolCall(value: unknown): unknown {
  if (!isRecord(value)) return value
  return {
    ...value,
    name: readFirst(value, ['name', 'toolName', 'tool_name', 'tool']),
    input: readFirst(value, ['input', 'toolInput', 'tool_input', 'arguments', 'args']) ?? {},
  }
}

function normalizeAgentDecisionInput(value: unknown): unknown {
  const wrapped = isRecord(value)
    ? (readFirst(value, ['decision', 'agentDecision', 'agent_decision']) ?? value)
    : value
  if (!isRecord(wrapped)) return wrapped

  const type =
    normalizeDecisionType(readString(wrapped, ['type', 'kind', 'action'])) ??
    (readFirst(wrapped, ['toolCalls', 'tool_calls']) ? 'tool_calls' : undefined) ??
    (readFirst(wrapped, ['toolName', 'tool_name', 'tool']) ? 'tool_call' : undefined) ??
    (readFirst(wrapped, ['pendingToolCall', 'pending_tool_call'])
      ? 'ask_confirmation'
      : undefined) ??
    (readString(wrapped, ['answer', 'finalAnswer', 'final_answer']) ? 'final_answer' : undefined) ??
    (readString(wrapped, ['question']) ? 'ask_clarification' : undefined)

  if (type === 'tool_call') {
    return {
      ...normalizeToolCallRecord(wrapped),
      type,
      risk: readFirst(wrapped, ['risk']) ?? 'low',
    }
  }

  if (type === 'tool_calls') {
    const rawToolCalls = readFirst(wrapped, ['toolCalls', 'tool_calls'])
    return {
      ...wrapped,
      ...normalizeDecisionSemantics(wrapped),
      type,
      toolCalls: Array.isArray(rawToolCalls) ? rawToolCalls.map(normalizeToolCallRecord) : [],
      userVisibleReason:
        readString(wrapped, ['userVisibleReason', 'user_visible_reason', 'reason']) ??
        '并行读取当前请求所需的画布信息。',
      risk: readFirst(wrapped, ['risk']) ?? 'low',
    }
  }

  if (type === 'ask_confirmation') {
    return {
      ...wrapped,
      ...normalizeDecisionSemantics(wrapped),
      type,
      question:
        readString(wrapped, ['question', 'confirmationQuestion', 'confirmation_question']) ??
        '是否确认执行这次画布修改？',
      pendingToolCall: normalizePendingToolCall(
        readFirst(wrapped, ['pendingToolCall', 'pending_tool_call', 'pending'])
      ),
      risk: readFirst(wrapped, ['risk']) ?? 'medium',
    }
  }

  if (type === 'ask_clarification') {
    return {
      ...wrapped,
      ...normalizeDecisionSemantics(wrapped),
      type,
      question:
        readString(wrapped, ['question', 'clarificationQuestion', 'clarification_question']) ??
        '请补充你希望我如何处理当前画布。',
    }
  }

  if (type === 'final_answer') {
    return {
      ...wrapped,
      ...normalizeDecisionSemantics(wrapped),
      type,
      answer: readString(wrapped, ['answer', 'finalAnswer', 'final_answer', 'message']),
      memoryUpdate: readFirst(wrapped, ['memoryUpdate', 'memory_update']),
    }
  }

  return wrapped
}

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 16))}\n...[truncated]`
}

function buildMemoryContext(context: LocalAgentContext): string {
  const memory = context.memory
  if (!memory) return 'No thread memory is loaded.'
  const toolResultRefs = (memory.toolResultRefs ?? [])
    .slice(-6)
    .map((ref) =>
      [
        `- ${ref.id}: ${ref.toolName}; ${ref.summary}`,
        typeof ref.outputSizeChars === 'number' ? `outputSizeChars=${ref.outputSizeChars}` : '',
        ref.outputPreview ? `preview=${clip(ref.outputPreview, 500)}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n')
  return [
    `Thread memory scope: ${memory.scope} v${memory.version}`,
    memory.chatId ? `chatId: ${memory.chatId}` : 'chatId: transient',
    memory.conversationSummary ? `conversationSummary: ${memory.conversationSummary}` : '',
    memory.canvasSummary ? `canvasSummary: ${memory.canvasSummary}` : '',
    memory.taskState.goal ? `taskGoal: ${memory.taskState.goal}` : '',
    memory.taskState.openQuestions.length
      ? `openQuestions: ${memory.taskState.openQuestions.join('; ')}`
      : '',
    toolResultRefs ? `persistentToolResultRefs:\n${toolResultRefs}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildSkillContext(context: LocalAgentContext): string {
  const skills = context.skills
    .filter((skill) => skill.enabled)
    .slice(0, 6)
    .map((skill) => [`- ${skill.name}: ${skill.description}`, clip(skill.content, 700)].join('\n'))
    .join('\n')
  return skills || 'No local skill instructions are enabled.'
}

function buildToolDescriptorContext(context: LocalAgentContext): string {
  const availableNames = new Set(selectAvailableLocalAgentTools(context))
  const descriptors = LOCAL_AGENT_TOOL_DESCRIPTORS.filter((descriptor) =>
    availableNames.has(descriptor.name)
  )
  return descriptors
    .map((descriptor) => {
      const schema = JSON.stringify(z.toJSONSchema(descriptor.inputSchema))
      return [
        `- ${descriptor.name}: ${descriptor.description}`,
        `  inputSchema: ${clip(schema, 650)}`,
      ].join('\n')
    })
    .join('\n')
}

function buildRuntimeConstraintsContext(context: LocalAgentContext): string {
  return [
    `confirmationMode: ${context.confirmationMode}`,
    `canWriteCanvas: ${context.permissions.canWrite}`,
    context.permissions.readonlyReason
      ? `writeBlockedReason: ${context.permissions.readonlyReason}`
      : '',
    'confidenceThresholds: read=0.45, ordinary_canvas_mutation=0.68, structural_canvas_mutation=0.72, generation=0.72, complex_chain_generation=0.76',
    'destructive canvas changes require ask_confirmation regardless of confidence',
    'if confidence is below the threshold for the intended action, return ask_clarification instead of calling tools',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildPatchProtocolContext(): string {
  return [
    'Patch protocol for canvas.propose_patch and canvas.apply_patch:',
    '- Use input shape {"patch":{"operations":[...]}}.',
    '- operations must be JSON objects, not JSON-encoded strings. Never put an operation object inside quotes.',
    '- Supported operation types: create_node, update_node, connect, add_content_reference, remove_content_reference, layout_nodes.',
    '- create_node requires kind and title; use clientNodeId for nodes created in the same patch.',
    '- update_node requires an existing nodeId and fields.',
    '- connect can reference clientNodeId values from create_node operations.',
    '- add_content_reference uses consumerNodeId, sourceNodeId, and role. It means the consumer node will use the source node as generation context/material.',
    '- Reference roles: text_context, image_reference, video_first_frame, video_last_frame, audio_reference.',
    '- For video first/last frame, use add_content_reference with consumerNodeId as the video node and sourceNodeId as the image node; the runtime will sync contentReferences, reference edges, and videoMedia when a file exists.',
    '- layout_nodes uses direction horizontal, vertical, or grid.',
    '- Do not create raw workflow operations. Do not write block ids unless updating an existing node.',
    '- Never fabricate file outputs; file is written only by canvas.generate_node_output.',
    '- Patch examples are recipes, not fixed templates. Adapt node count, kinds, fields, and edges to the user request and current canvas.',
    '- For selected-node edits: if exactly one selected node id is present and the user clearly names the target kind/field (for example image prompt, video prompt, audio prompt, or text content), your first tool call should be canvas.apply_patch with that selected nodeId. Read first only when the target node or field is ambiguous.',
    '- Direct selected edit field map: image prompt -> aiPrompt; video prompt -> videoPrompt; audio prompt -> audioPrompt; text content -> contentHtml.',
    '- Direct selected edit example: selected id "node-1" plus "把选中视频节点提示词改成慢镜头推进" should update node-1.videoPrompt with canvas.apply_patch, not read_node first.',
    '- For media description: if exactly one selected node id is present, call media.analyze_node_media directly because it reads the node and media. Use canvas.read_node first only when no selected node id is available or the user asks for non-media node fields. Obey output.mediaContentAccess. If output.binaryAnalysisDiagnostics.truncated is true, say the vision model output was truncated and do not describe actual media content. If canDescribeActualMedia is false, answer from prompt/metadata only and do not claim you saw/heard the media. If contentEvidence is binary_image_analysis, you may describe the fetched image evidence returned by the tool.',
    '- For content chains: choose the structure from the request. Do not force text->image->video->audio unless that matches the requested workflow.',
    '- If the user asks to create and generate a new media node, first call canvas.apply_patch to create/update prompts, then use the createdNodeMap from the tool result and call canvas.generate_node_output on the real node id.',
    'Writable content fields:',
    '- text: contentHtml, aiPrompt, aiModel, blockStyle, backgroundColor, fontSize, width, height.',
    '- image: aiPrompt, aiModel, aiAspectRatio. Do not set file.',
    '- video: videoPrompt, videoModelFamily, videoMedia, videoParameters, videoFrameAspectRatioPreset. Do not set file.',
    '- audio: audioPrompt, audioModel, audioParameters. Do not set file.',
    'Optional short-video content chain example for a script + main visual + video + music request:',
    JSON.stringify({
      patch: {
        operations: [
          {
            type: 'create_node',
            clientNodeId: 'script',
            kind: 'text',
            title: 'Script',
            fields: { contentHtml: '<p>Write a concise draft script here.</p>' },
          },
          {
            type: 'create_node',
            clientNodeId: 'visual',
            kind: 'image',
            title: 'Main Visual',
            fields: { aiPrompt: 'Describe the main visual without copying the raw user command.' },
          },
          {
            type: 'create_node',
            clientNodeId: 'video',
            kind: 'video',
            title: 'Video',
            fields: {
              videoPrompt: 'Describe camera movement, subject, style, and scene.',
              videoParameters: { duration: 5, resolution: '720P' },
            },
          },
          {
            type: 'create_node',
            clientNodeId: 'audio',
            kind: 'audio',
            title: 'Music',
            fields: { audioPrompt: 'Describe mood, rhythm, instruments, and duration.' },
          },
          {
            type: 'add_content_reference',
            consumerNodeId: 'visual',
            sourceNodeId: 'script',
            role: 'text_context',
          },
          {
            type: 'add_content_reference',
            consumerNodeId: 'video',
            sourceNodeId: 'visual',
            role: 'video_first_frame',
          },
          {
            type: 'layout_nodes',
            nodeIds: ['script', 'visual', 'video', 'audio'],
            direction: 'horizontal',
          },
        ],
        reason: 'Create a verified short-video content chain.',
      },
    }),
  ].join('\n')
}

function isLengthFinishReason(finishReason: string | undefined): boolean {
  const normalized = finishReason?.trim().toLowerCase()
  return (
    normalized === 'length' || normalized === 'max_tokens' || normalized === 'max_output_tokens'
  )
}

export function parseLocalAgentDecision(content: string): LocalAgentDecision {
  const parsed = localAgentDecisionSchema.safeParse(
    normalizeAgentDecisionInput(parseJsonObject(content))
  )
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join('; ')
    throw new Error(`Invalid AgentDecision: ${message}`)
  }
  return parsed.data
}

export function buildLocalAgentDecisionPrompt(params: {
  context: LocalAgentContext
  observations: LocalAgentObservation[]
  policy: {
    userIntent?: LocalCanvasUserIntent
    mutationPolicy?: LocalCanvasMutationPolicy
    canvasReadPolicy?: LocalCanvasReadPolicy
    confidence?: number
    evidence?: string[]
    reason?: string
  }
}): string {
  const availableTools = selectAvailableLocalAgentTools(params.context)
  return [
    `User request:\n${params.context.message}`,
    `Selected node ids: ${params.context.selectedNodeIds.join(', ') || 'none'}`,
    `Confirmation mode: ${params.context.confirmationMode}`,
    `Available tools: ${summarizeAvailableToolNames(availableTools)}`,
    `Runtime constraints:\n${buildRuntimeConstraintsContext(params.context)}`,
    `Thread memory:\n${buildMemoryContext(params.context)}`,
    `Enabled skill context:\n${buildSkillContext(params.context)}`,
    `Tool observations:\n${buildBudgetedObservationPromptWithOptions(params.observations, {
      maxOutputChars: 560,
      maxPromptChars: 5400,
    })}`,
    `Tool descriptors:\n${buildToolDescriptorContext(params.context)}`,
    buildPatchProtocolContext(),
    [
      'Return only AgentDecision JSON.',
      'Do not include chain-of-thought, markdown, or prose outside JSON.',
      'Determine intent and confidence yourself from the latest request, conversation history, selected nodes, canvas context, tool observations, and available tools.',
      'Include intent and confidence in every AgentDecision. Use intentReason for a concise reason when useful.',
      'Use tools to read canvas state instead of guessing from memory.',
      'If a user asks to discuss, plan, or wait for confirmation, do not call mutation tools.',
      'If confirmation mode is manual and a canvas write is needed, return ask_confirmation with pendingToolCall instead of applying the patch.',
      'For ask_confirmation pendingToolCall, pendingToolCall.input.patch.operations must be an array of operation objects, not strings.',
      'If a user asks for a destructive action, ask for confirmation first.',
      'Use type=tool_calls only for independent read-only concurrency-safe tools; never include mutation, generation, verification, or destructive tools in tool_calls.',
      'Never invent generated file outputs. Use canvas.generate_node_output for real generation.',
      'After canvas.apply_patch or canvas.generate_node_output succeeds, verify with canvas.verify_patch before final_answer.',
    ].join('\n'),
  ].join('\n\n')
}

export async function requestLocalAgentDecision(params: {
  context: LocalAgentContext
  observations: LocalAgentObservation[]
  policy: {
    userIntent?: LocalCanvasUserIntent
    mutationPolicy?: LocalCanvasMutationPolicy
    canvasReadPolicy?: LocalCanvasReadPolicy
    confidence?: number
    evidence?: string[]
    reason?: string
  }
}): Promise<LocalAgentDecision> {
  const request = {
    role: 'decision',
    workspaceId: params.context.workspaceId,
    systemPrompt: buildLocalAgentRoleSystemPrompt({
      context: params.context,
      role: 'decision',
      roleInstruction:
        'You are the decision layer in a local canvas agent runtime. Choose exactly one next action as AgentDecision JSON, based on the user request, tool observations, runtime constraints, and available tools.',
    }),
    prompt: buildLocalAgentDecisionPrompt(params),
    temperature: params.context.thinkingLevel === 'extra' ? 0.15 : 0.05,
    maxTokens: params.context.thinkingLevel === 'extra' ? 2200 : 1400,
    responseFormat: {
      name: 'local_canvas_agent_decision',
      schema: z.toJSONSchema(localAgentDecisionSchema),
      strict: true,
    },
    abortSignal: params.context.options.abortSignal,
  } as const
  const response = await executeLocalAgentModelRequest(params.context.model, request)
  try {
    return parseLocalAgentDecision(response.content ?? '')
  } catch (error) {
    if (!isLengthFinishReason(response.finishReason)) throw error
    const retryResponse = await executeLocalAgentModelRequest(params.context.model, {
      ...request,
      maxTokens: params.context.thinkingLevel === 'extra' ? 6000 : 4200,
    })
    try {
      return parseLocalAgentDecision(retryResponse.content ?? '')
    } catch (retryError) {
      if (isLengthFinishReason(retryResponse.finishReason)) {
        throw new Error('AgentDecision JSON was truncated by the model output limit.')
      }
      throw retryError
    }
  }
}
