import { executeLocalAgentModelRequest } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/config'
import { buildLocalAgentRoleSystemPrompt } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/prompts'
import type {
  LocalAgentContext,
  LocalAgentMemoryData,
  LocalAgentObservation,
  LocalAgentPlan,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

function compactObservation(observation: LocalAgentObservation): LocalAgentObservation {
  return {
    toolName: observation.toolName,
    summary: observation.summary,
    success: observation.success,
    timestamp: observation.timestamp,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
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

function buildDeterministicSummary(params: {
  context: LocalAgentContext
  memory: LocalAgentMemoryData
  plan: LocalAgentPlan
  observations: LocalAgentObservation[]
}): LocalAgentMemoryData {
  const successfulSteps = params.observations
    .filter((observation) => observation.success)
    .map((observation) => observation.summary)
    .slice(-8)
  return {
    ...params.memory,
    conversationSummary: [params.memory.conversationSummary, params.context.message]
      .filter(Boolean)
      .join('\n')
      .slice(-4000),
    taskState: {
      goal: params.plan.goal,
      completedSteps: [...params.memory.taskState.completedSteps, ...successfulSteps].slice(-20),
      openQuestions: params.plan.clarificationQuestion ? [params.plan.clarificationQuestion] : [],
      lastObservation: params.observations.at(-1)?.summary,
    },
    canvasSummary: extractCanvasSummary(params.observations) ?? params.memory.canvasSummary,
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
      'Write a compact Chinese memory summary for the next turn.',
      'Do not include raw JSON, workflowId, workspaceId, internal fields, database IDs, or large tool outputs.',
    ].join('\n'),
  ].join('\n\n')
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
      abortSignal: params.context.options.abortSignal,
    })
    const summary = response.content?.trim()
    if (!summary) return fallback
    return {
      ...fallback,
      conversationSummary: summary.slice(-4000),
    }
  } catch {
    return fallback
  }
}
