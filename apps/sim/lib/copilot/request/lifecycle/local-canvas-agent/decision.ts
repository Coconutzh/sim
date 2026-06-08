import { z } from 'zod'
import { executeLocalAgentModelRequest } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/config'
import { buildLocalAgentRoleSystemPrompt } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/prompts'
import { LOCAL_AGENT_TOOL_DESCRIPTORS } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-descriptor'
import { selectAvailableLocalAgentTools } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-registry'
import {
  buildBudgetedObservationPrompt,
  summarizeAvailableToolNames,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-result-budget'
import type {
  LocalAgentContext,
  LocalAgentDecision,
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
const toolCallSchema = z.object({
  type: z.literal('tool_call'),
  toolName: localAgentToolNameSchema,
  toolInput: z.record(z.string(), z.unknown()).catch({}),
  userVisibleReason: z.string().min(1),
  risk: localAgentRiskSchema.catch('low'),
})
const askConfirmationSchema = z.object({
  type: z.literal('ask_confirmation'),
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
  answer: z.string().min(1),
  memoryUpdate: memoryUpdateSchema.optional(),
})

export const localAgentDecisionSchema = z.discriminatedUnion('type', [
  toolCallSchema,
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

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 16))}\n...[truncated]`
}

function buildMemoryContext(context: LocalAgentContext): string {
  const memory = context.memory
  if (!memory) return 'No thread memory is loaded.'
  return [
    `Thread memory scope: ${memory.scope} v${memory.version}`,
    memory.chatId ? `chatId: ${memory.chatId}` : 'chatId: transient',
    memory.conversationSummary ? `conversationSummary: ${memory.conversationSummary}` : '',
    memory.canvasSummary ? `canvasSummary: ${memory.canvasSummary}` : '',
    memory.taskState.goal ? `taskGoal: ${memory.taskState.goal}` : '',
    memory.taskState.openQuestions.length
      ? `openQuestions: ${memory.taskState.openQuestions.join('; ')}`
      : '',
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
        `  inputSchema: ${clip(schema, 800)}`,
      ].join('\n')
    })
    .join('\n')
}

function buildIntentPolicyContext(policy: {
  userIntent?: LocalCanvasUserIntent
  mutationPolicy?: LocalCanvasMutationPolicy
  canvasReadPolicy?: LocalCanvasReadPolicy
}): string {
  return [
    `userIntent: ${policy.userIntent ?? 'unknown'}`,
    `mutationPolicy: ${policy.mutationPolicy ?? 'unknown'}`,
    `canvasReadPolicy: ${policy.canvasReadPolicy ?? 'unknown'}`,
  ].join('\n')
}

function buildPatchProtocolContext(): string {
  return [
    'Patch protocol for canvas.propose_patch and canvas.apply_patch:',
    '- Use input shape {"patch":{"operations":[...]}}.',
    '- Supported operation types: create_node, update_node, connect, layout_nodes.',
    '- create_node requires kind and title; use clientNodeId for nodes created in the same patch.',
    '- update_node requires an existing nodeId and fields.',
    '- connect can reference clientNodeId values from create_node operations.',
    '- layout_nodes uses direction horizontal, vertical, or grid.',
    '- Do not create raw workflow operations. Do not write block ids unless updating an existing node.',
    '- Never fabricate file outputs; file is written only by canvas.generate_node_output.',
    'Writable content fields:',
    '- text: contentHtml, aiPrompt, aiModel, blockStyle, backgroundColor, fontSize, width, height.',
    '- image: aiPrompt, aiModel, aiAspectRatio. Do not set file.',
    '- video: videoPrompt, videoModelFamily, videoMedia, videoParameters, videoFrameAspectRatioPreset. Do not set file.',
    '- audio: audioPrompt, audioModel, audioParameters. Do not set file.',
    'Example short-video content chain patch:',
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
          { type: 'connect', sourceNodeId: 'script', targetNodeId: 'visual' },
          { type: 'connect', sourceNodeId: 'visual', targetNodeId: 'video' },
          { type: 'connect', sourceNodeId: 'video', targetNodeId: 'audio' },
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

export function parseLocalAgentDecision(content: string): LocalAgentDecision {
  const parsed = localAgentDecisionSchema.safeParse(parseJsonObject(content))
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
  }
}): string {
  const availableTools = selectAvailableLocalAgentTools(params.context)
  return [
    `User request:\n${params.context.message}`,
    `Selected node ids: ${params.context.selectedNodeIds.join(', ') || 'none'}`,
    `Available tools: ${summarizeAvailableToolNames(availableTools)}`,
    `Runtime intent policy:\n${buildIntentPolicyContext(params.policy)}`,
    `Thread memory:\n${buildMemoryContext(params.context)}`,
    `Enabled skill context:\n${buildSkillContext(params.context)}`,
    `Tool observations:\n${buildBudgetedObservationPrompt(params.observations)}`,
    `Tool descriptors:\n${buildToolDescriptorContext(params.context)}`,
    buildPatchProtocolContext(),
    [
      'Return only AgentDecision JSON.',
      'Do not include chain-of-thought, markdown, or prose outside JSON.',
      'Use tools to read canvas state instead of guessing from memory.',
      'If a user asks to discuss, plan, or wait for confirmation, do not call mutation tools.',
      'If a user asks for a destructive action, ask for confirmation first.',
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
  }
}): Promise<LocalAgentDecision> {
  const response = await executeLocalAgentModelRequest(params.context.model, {
    role: 'decision',
    workspaceId: params.context.workspaceId,
    systemPrompt: buildLocalAgentRoleSystemPrompt({
      context: params.context,
      role: 'decision',
      roleInstruction:
        'You are the decision layer in a local canvas agent runtime. Choose exactly one next action as AgentDecision JSON, based on the user request, tool observations, runtime policy, and available tools.',
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
  })
  return parseLocalAgentDecision(response.content ?? '')
}
