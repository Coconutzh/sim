import { z } from 'zod'
import { executeLocalAgentModelRequest } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/config'
import { buildLocalAgentRoleSystemPrompt } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/prompts'
import type {
  LocalAgentContext,
  LocalAgentMemoryData,
  LocalAgentObservation,
  LocalAgentPlan,
  LocalAgentThreadMemoryUpdate,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const summarizerResponseSchema = z.object({
  conversationSummary: z.string().optional(),
  canvasSummary: z.string().optional(),
  taskState: z
    .object({
      goal: z.string().optional(),
      completedSteps: z.array(z.string()).optional(),
      openQuestions: z.array(z.string()).optional(),
      lastObservation: z.string().optional(),
    })
    .optional(),
})

function compactObservation(observation: LocalAgentObservation): LocalAgentObservation {
  return {
    toolName: observation.toolName,
    summary: sanitizeMemoryText(observation.summary),
    success: observation.success,
    timestamp: observation.timestamp,
  }
}

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return value.slice(-maxLength)
}

function sanitizeMemoryText(value: string): string {
  return value
    .replace(
      /-----BEGIN [\s\S]{0,80}?PRIVATE KEY-----[\s\S]*?-----END [\s\S]{0,80}?PRIVATE KEY-----/gi,
      '[redacted-secret]'
    )
    .replace(/https?:\/\/[^\s)]+/gi, '[redacted-url]')
    .replace(/\b(?:storageKey|storagePath|path|url|key)\s*=\s*[^\s]+/gi, '[redacted-path]')
    .replace(/\b(?:workflowId|workspaceId|chatId|userId)\s*[:=]\s*[\w-]+/gi, '[redacted-id]')
    .trim()
}

function sanitizeList(values: string[], maxItems: number, maxLength: number): string[] {
  return values
    .map((value) => sanitizeMemoryText(value).trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(-maxItems)
    .map((value) => clip(value, maxLength))
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function getStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined
}

function extractDecisionMemoryUpdate(
  observations: LocalAgentObservation[]
): LocalAgentThreadMemoryUpdate | null {
  let output: unknown
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    const observation = observations[index]
    if (observation.toolName === 'memory' && observation.success) {
      output = observation.output
      break
    }
  }
  const record = asRecord(output)
  if (Object.keys(record).length === 0) return null
  const taskState = asRecord(record.taskState)
  const openQuestions = getStringArray(taskState.openQuestions)
  return {
    ...(typeof record.conversationSummary === 'string'
      ? { conversationSummary: record.conversationSummary }
      : {}),
    ...(typeof record.canvasSummary === 'string' ? { canvasSummary: record.canvasSummary } : {}),
    ...(Object.keys(taskState).length > 0
      ? {
          taskState: {
            ...(typeof taskState.goal === 'string' ? { goal: taskState.goal } : {}),
            ...(openQuestions ? { openQuestions } : {}),
            ...(typeof taskState.lastObservation === 'string'
              ? { lastObservation: taskState.lastObservation }
              : {}),
          },
        }
      : {}),
  }
}

function extractCanvasSummary(observations: LocalAgentObservation[]): string | undefined {
  const readSummary = observations.find(
    (observation) => observation.toolName === 'canvas.read_summary' && observation.success
  )
  if (!readSummary) return undefined
  const output = asRecord(readSummary.output)
  if (typeof output.summaryText === 'string' && output.summaryText.trim()) {
    return output.summaryText.trim().slice(-4000)
  }
  return readSummary.summary
}

function hasSuccessfulVerification(observations: LocalAgentObservation[]): boolean {
  return observations.some(
    (observation) => observation.toolName === 'canvas.verify_patch' && observation.success
  )
}

function hasEmbeddedApplyVerification(observation: LocalAgentObservation): boolean {
  const output = asRecord(observation.output)
  const verification = asRecord(output.verification)
  return verification.success === true
}

function getTrustedCompletedStepSummaries(observations: LocalAgentObservation[]): string[] {
  const verifiedCanvasTurn = hasSuccessfulVerification(observations)
  return observations
    .filter((observation) => {
      if (!observation.success) return false
      if (observation.toolName === 'canvas.apply_patch') {
        return verifiedCanvasTurn || hasEmbeddedApplyVerification(observation)
      }
      if (observation.toolName === 'canvas.generate_node_output') {
        return verifiedCanvasTurn
      }
      return (
        observation.toolName === 'materialize_file' ||
        observation.toolName === 'update_task_result' ||
        observation.toolName === 'submit_task_result'
      )
    })
    .map((observation) => observation.summary)
}

function inferOpenQuestions(params: {
  plan: LocalAgentPlan
  memory: LocalAgentMemoryData
}): string[] {
  if (params.plan.clarificationQuestion?.trim()) return [params.plan.clarificationQuestion]
  if (params.plan.userIntent === 'consult_design') {
    return [
      '用户希望内容偏种草、剧情、治愈，还是教程说明？',
      '目标视频时长和是否需要口播还未确认。',
      '是否现在创建画布节点，还是继续先讨论方案？',
    ]
  }
  return params.memory.taskState.openQuestions
}

function buildDeterministicSummary(params: {
  context: LocalAgentContext
  memory: LocalAgentMemoryData
  plan: LocalAgentPlan
  observations: LocalAgentObservation[]
}): LocalAgentMemoryData {
  const completedSteps = getTrustedCompletedStepSummaries(params.observations).slice(-8)
  const lastObservation = params.observations.at(-1)?.summary
  const decisionMemoryUpdate = extractDecisionMemoryUpdate(params.observations)
  return {
    ...params.memory,
    conversationSummary: [
      params.memory.conversationSummary,
      sanitizeMemoryText(params.context.message),
      decisionMemoryUpdate?.conversationSummary
        ? sanitizeMemoryText(decisionMemoryUpdate.conversationSummary)
        : '',
    ]
      .filter(Boolean)
      .join('\n')
      .slice(-4000),
    taskState: {
      goal: sanitizeMemoryText(
        decisionMemoryUpdate?.taskState?.goal ||
          params.plan.goal ||
          params.memory.taskState.goal ||
          ''
      ),
      completedSteps: sanitizeList(
        [...params.memory.taskState.completedSteps, ...completedSteps],
        20,
        240
      ),
      openQuestions: sanitizeList(
        decisionMemoryUpdate?.taskState?.openQuestions ?? inferOpenQuestions(params),
        8,
        240
      ),
      lastObservation: decisionMemoryUpdate?.taskState?.lastObservation
        ? sanitizeMemoryText(decisionMemoryUpdate.taskState.lastObservation)
        : lastObservation
          ? sanitizeMemoryText(lastObservation)
          : undefined,
    },
    canvasSummary: sanitizeMemoryText(
      decisionMemoryUpdate?.canvasSummary ??
        extractCanvasSummary(params.observations) ??
        params.memory.canvasSummary
    ),
    recentObservations: [
      ...params.memory.recentObservations.map(compactObservation),
      ...params.observations.map(compactObservation),
    ].slice(-20),
    updatedAt: new Date().toISOString(),
  }
}

function buildSummarizerPrompt(params: {
  context: LocalAgentContext
  memory: LocalAgentMemoryData
  plan: LocalAgentPlan
  observations: LocalAgentObservation[]
}): string {
  return [
    `Previous conversation summary:\n${params.memory.conversationSummary || 'none'}`,
    `User request:\n${params.context.message}`,
    `Plan goal:\n${params.plan.goal}`,
    `Completed observations:\n${params.observations
      .map(
        (observation) =>
          `- ${observation.toolName}: success=${observation.success}; ${observation.summary}`
      )
      .join('\n')}`,
    [
      'You are the Summarizer in a local canvas agent runtime.',
      'Return compact JSON for private runtime memory, not user-facing prose.',
      'Schema: {"conversationSummary": string, "canvasSummary": string, "taskState": {"goal": string, "completedSteps": string[], "openQuestions": string[], "lastObservation": string}}.',
      'Only mark verified canvas writes, generation writebacks, file materialization, or task submissions as completedSteps.',
      'For consult/design turns, preserve the goal and open questions but do not mark a canvas change as completed.',
      'Do not include raw JSON, workflowId, workspaceId, internal fields, database IDs, or large tool outputs.',
    ].join('\n'),
  ].join('\n\n')
}

function mergeModelSummary(
  fallback: LocalAgentMemoryData,
  content: string
): LocalAgentMemoryData | null {
  const parsed = summarizerResponseSchema.safeParse(parseJsonObject(content))
  if (!parsed.success) {
    const summary = sanitizeMemoryText(content)
    return summary ? { ...fallback, conversationSummary: clip(summary, 4000) } : null
  }
  const data = parsed.data
  return {
    ...fallback,
    conversationSummary: data.conversationSummary
      ? clip(sanitizeMemoryText(data.conversationSummary), 4000)
      : fallback.conversationSummary,
    canvasSummary: data.canvasSummary
      ? clip(sanitizeMemoryText(data.canvasSummary), 4000)
      : fallback.canvasSummary,
    taskState: {
      goal: data.taskState?.goal
        ? clip(sanitizeMemoryText(data.taskState.goal), 240)
        : fallback.taskState.goal,
      completedSteps: fallback.taskState.completedSteps,
      openQuestions: sanitizeList(
        data.taskState?.openQuestions?.length
          ? data.taskState.openQuestions
          : fallback.taskState.openQuestions,
        8,
        240
      ),
      lastObservation: data.taskState?.lastObservation
        ? clip(sanitizeMemoryText(data.taskState.lastObservation), 240)
        : fallback.taskState.lastObservation,
    },
  }
}

export async function summarizeLocalAgentRun(params: {
  context: LocalAgentContext
  memory: LocalAgentMemoryData
  plan: LocalAgentPlan
  observations: LocalAgentObservation[]
}): Promise<LocalAgentMemoryData> {
  const fallback = buildDeterministicSummary(params)
  try {
    const response = await executeLocalAgentModelRequest(params.context.model, {
      role: 'summarizer',
      workspaceId: params.context.workspaceId,
      systemPrompt: buildLocalAgentRoleSystemPrompt({
        context: params.context,
        role: 'summarizer',
        roleInstruction:
          'You are the Summarizer in a local canvas agent runtime. Summaries are private runtime memory, not user-facing prose.',
      }),
      prompt: buildSummarizerPrompt(params),
      temperature: 0,
      maxTokens: 800,
      responseFormat: {
        name: 'local_canvas_agent_memory_summary',
        schema: z.toJSONSchema(summarizerResponseSchema),
        strict: true,
      },
      abortSignal: params.context.options.abortSignal,
    })
    const summary = response.content?.trim()
    if (!summary) return fallback
    return mergeModelSummary(fallback, summary) ?? fallback
  } catch {
    return fallback
  }
}
