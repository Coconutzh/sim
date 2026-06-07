import {
  buildLocalAgentAnswer,
  selectLocalAgentNextToolCall,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/actor'
import { observationFromToolResult } from '@/lib/copilot/request/lifecycle/local-canvas-agent/observation'
import { buildLocalAgentPlan } from '@/lib/copilot/request/lifecycle/local-canvas-agent/planner'
import { executeLocalAgentTool } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-executor-bridge'
import type {
  LocalAgentContext,
  LocalAgentObservation,
  LocalAgentPlan,
  LocalAgentToolCall,
  LocalAgentToolLoopResult,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const MAX_STEPS = 10

type LocalAgentLoopPhase = 'understand' | 'inspect' | 'act' | 'verify' | 'finish'

interface LocalAgentLoopState {
  phase: LocalAgentLoopPhase
  plan: LocalAgentPlan
  observations: LocalAgentObservation[]
  plannedCallIndex: number
  generatedNodeIndex: number
  readNodeIndex: number
  pendingVerifyAfterGenerate: { nodeId: string; field: string } | null
  seen: Set<string>
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function extractTaskId(context: LocalAgentContext): string {
  const payloadTaskId = asString(context.requestPayload.taskId)
  if (payloadTaskId) return payloadTaskId
  const quoted = context.message.match(/(?:taskId|任务ID|任务 id)[:：\s]+([a-zA-Z0-9_-]{3,})/i)?.[1]
  if (quoted) return quoted
  return context.message.match(/\btask[-_][a-zA-Z0-9_-]{2,}\b/i)?.[0] ?? ''
}

function inferTaskStatus(message: string): string {
  if (/开始|进行中|in[_ -]?progress/i.test(message)) return 'in_progress'
  if (/归档|archive/i.test(message)) return 'archived'
  if (/待办|todo/i.test(message)) return 'todo'
  return ''
}

function buildMaterializeInput(context: LocalAgentContext): Record<string, unknown> {
  const explicitFileName = asString(context.requestPayload.fileName)
  const fileNames = Array.isArray(context.requestPayload.fileNames)
    ? context.requestPayload.fileNames.filter((item): item is string => typeof item === 'string')
    : []
  const inferredFileName = context.attachments?.length === 1 ? context.attachments[0]?.name : ''
  const operation = /导入|import/i.test(context.message) ? 'import' : 'save'
  return {
    ...(fileNames.length > 0 ? { fileNames } : {}),
    ...(explicitFileName || inferredFileName
      ? { fileName: explicitFileName || inferredFileName }
      : {}),
    operation,
  }
}

function buildToolCall(
  context: LocalAgentContext,
  plan: LocalAgentPlan,
  toolName: LocalAgentToolCall['name']
): LocalAgentToolCall | null {
  if (toolName === 'canvas.apply_patch') {
    return plan.patch ? { name: toolName, input: { patch: plan.patch } } : null
  }
  if (toolName === 'canvas.propose_patch') {
    return plan.patch ? { name: toolName, input: { patch: plan.patch } } : null
  }
  if (toolName === 'canvas.verify_patch') {
    return { name: toolName, input: plan.patch ? { patch: plan.patch } : {} }
  }
  if (toolName === 'canvas.search_nodes') {
    return { name: toolName, input: { query: context.message } }
  }
  if (toolName === 'canvas.inspect_schema') {
    const kind =
      plan.patch?.operations.find((operation) => operation.type === 'create_node')?.kind ?? 'text'
    return { name: toolName, input: { kind } }
  }
  if (toolName === 'canvas.read_node') {
    const nodeId = plan.readNodeIds?.[0] ?? context.selectedNodeIds[0]
    return nodeId ? { name: toolName, input: { nodeId } } : null
  }
  if (toolName === 'canvas.generate_node_output') {
    const nodeId = plan.generateNodeIds?.[0]
    return nodeId ? { name: toolName, input: { nodeId } } : null
  }
  if (toolName === 'read_file') {
    return { name: toolName, input: { query: context.message } }
  }
  if (toolName === 'materialize_file') {
    return { name: toolName, input: buildMaterializeInput(context) }
  }
  if (toolName === 'update_task_result') {
    const taskId = extractTaskId(context)
    return {
      name: toolName,
      input: {
        ...(taskId ? { taskId } : {}),
        ...(inferTaskStatus(context.message) ? { status: inferTaskStatus(context.message) } : {}),
      },
    }
  }
  if (toolName === 'submit_task_result') {
    const taskId = extractTaskId(context)
    return {
      name: toolName,
      input: {
        ...(taskId ? { taskId } : {}),
        ...(context.selectedNodeIds[0] ? { nodeId: context.selectedNodeIds[0] } : {}),
        submissionNote: context.message,
      },
    }
  }
  if (
    toolName === 'search_workspace' ||
    toolName === 'query_knowledge' ||
    toolName === 'search_docs' ||
    toolName === 'read_tasks'
  ) {
    return { name: toolName, input: { query: context.message } }
  }
  return { name: toolName, input: {} }
}

function hasReadCall(calls: LocalAgentToolCall[]): boolean {
  return calls.some(
    (call) =>
      call.name === 'canvas.read_summary' ||
      call.name === 'canvas.read_node' ||
      call.name === 'canvas.read_selected_nodes'
  )
}

function getCallKey(call: LocalAgentToolCall): string {
  return `${call.name}:${JSON.stringify(call.input)}`
}

function buildStepToolCalls(
  context: LocalAgentContext,
  plan: LocalAgentPlan
): LocalAgentToolCall[] {
  return plan.steps.flatMap((step) =>
    step.toolHints
      .map((toolName) => buildToolCall(context, plan, toolName))
      .filter((call): call is LocalAgentToolCall => Boolean(call))
  )
}

function buildRequiredInspectionCalls(
  context: LocalAgentContext,
  calls: LocalAgentToolCall[]
): LocalAgentToolCall[] {
  if (hasReadCall(calls)) return []
  return [
    {
      name:
        context.selectedNodeIds.length > 0 ? 'canvas.read_selected_nodes' : 'canvas.read_summary',
      input: {},
    },
  ]
}

function isInspectionTool(
  toolName: LocalAgentToolCall['name'] | LocalAgentObservation['toolName']
) {
  return (
    toolName === 'canvas.read_summary' ||
    toolName === 'canvas.read_node' ||
    toolName === 'canvas.read_selected_nodes' ||
    toolName === 'canvas.search_nodes' ||
    toolName === 'canvas.inspect_schema' ||
    toolName === 'read_file' ||
    toolName === 'search_workspace' ||
    toolName === 'query_knowledge' ||
    toolName === 'search_docs' ||
    toolName === 'read_tasks'
  )
}

function hasFailedInspection(observations: LocalAgentObservation[]): boolean {
  return observations.some(
    (observation) => isInspectionTool(observation.toolName) && !observation.success
  )
}

function hasSuccessfulMutation(observations: LocalAgentObservation[]): boolean {
  return observations.some(
    (observation) =>
      observation.success &&
      (observation.toolName === 'canvas.apply_patch' ||
        observation.toolName === 'canvas.generate_node_output' ||
        observation.toolName === 'materialize_file' ||
        observation.toolName === 'update_task_result' ||
        observation.toolName === 'submit_task_result')
  )
}

function isProposalOnlyPlan(plan: LocalAgentPlan, plannedCalls: LocalAgentToolCall[]): boolean {
  return Boolean(
    plan.patch &&
      plannedCalls.some((call) => call.name === 'canvas.propose_patch') &&
      !plannedCalls.some((call) => call.name === 'canvas.apply_patch')
  )
}

function getNextPlannedStepCall(
  state: LocalAgentLoopState,
  plannedCalls: LocalAgentToolCall[]
): LocalAgentToolCall | null {
  while (state.plannedCallIndex < plannedCalls.length) {
    const call = plannedCalls[state.plannedCallIndex]
    state.plannedCallIndex += 1
    if (call.name === 'canvas.verify_patch') continue
    return call
  }
  return null
}

function getNextImplicitCall(
  state: LocalAgentLoopState,
  plannedCalls: LocalAgentToolCall[]
): LocalAgentToolCall | null {
  const proposalOnly = isProposalOnlyPlan(state.plan, plannedCalls)
  const alreadyApplied = state.observations.some(
    (observation) => observation.toolName === 'canvas.apply_patch'
  )
  const alreadyVerified = state.observations.some(
    (observation) => observation.toolName === 'canvas.verify_patch'
  )

  if (
    state.plan.patch &&
    state.plan.patch.operations.length > 0 &&
    !proposalOnly &&
    !alreadyApplied
  ) {
    return { name: 'canvas.apply_patch', input: { patch: state.plan.patch } }
  }

  if (
    state.plan.patch &&
    state.plan.patch.operations.length > 0 &&
    !proposalOnly &&
    alreadyApplied &&
    !alreadyVerified
  ) {
    return { name: 'canvas.verify_patch', input: { patch: state.plan.patch } }
  }

  if (state.pendingVerifyAfterGenerate) {
    const generation = state.pendingVerifyAfterGenerate
    state.pendingVerifyAfterGenerate = null
    return { name: 'canvas.verify_patch', input: { generation } }
  }

  const generateNodeIds = state.plan.generateNodeIds ?? []
  if (state.generatedNodeIndex < generateNodeIds.length) {
    const nodeId = generateNodeIds[state.generatedNodeIndex]
    state.generatedNodeIndex += 1
    return { name: 'canvas.generate_node_output', input: { nodeId } }
  }

  const readNodeIds = state.plan.readNodeIds ?? []
  if (state.readNodeIndex < readNodeIds.length) {
    const nodeId = readNodeIds[state.readNodeIndex]
    state.readNodeIndex += 1
    return { name: 'canvas.read_node', input: { nodeId } }
  }

  return null
}

function getNextToolCall(
  context: LocalAgentContext,
  state: LocalAgentLoopState,
  plannedCalls: LocalAgentToolCall[]
): LocalAgentToolCall | null {
  if (state.phase === 'understand') {
    state.phase = 'inspect'
  }

  if (state.phase === 'inspect') {
    state.phase = 'act'
    return buildRequiredInspectionCalls(context, plannedCalls)[0] ?? null
  }

  if (state.phase === 'act') {
    if (hasFailedInspection(state.observations)) {
      state.phase = 'finish'
      return null
    }

    const plannedCall = getNextPlannedStepCall(state, plannedCalls)
    if (plannedCall) return plannedCall

    const implicitCall = getNextImplicitCall(state, plannedCalls)
    if (implicitCall) return implicitCall

    state.phase = 'verify'
  }

  if (state.phase === 'verify') {
    state.phase = 'finish'
    if (
      hasSuccessfulMutation(state.observations) &&
      !state.observations.some((observation) => observation.toolName === 'canvas.verify_patch')
    ) {
      return {
        name: 'canvas.verify_patch',
        input: state.plan.patch ? { patch: state.plan.patch } : {},
      }
    }
  }

  return null
}

function getNextUnseenToolCall(
  context: LocalAgentContext,
  state: LocalAgentLoopState,
  plannedCalls: LocalAgentToolCall[]
): LocalAgentToolCall | null {
  while (state.phase !== 'finish') {
    const call = getNextToolCall(context, state, plannedCalls)
    if (!call) continue
    const actorSelectedCall = selectLocalAgentNextToolCall({
      observations: state.observations,
      candidates: [call],
    })
    if (!actorSelectedCall) return null
    const key = getCallKey(call)
    if (state.seen.has(key)) continue
    state.seen.add(key)
    return actorSelectedCall
  }
  return null
}

export async function runLocalAgentToolLoop(
  context: LocalAgentContext
): Promise<LocalAgentToolLoopResult> {
  const plan = await buildLocalAgentPlan(context)
  const observations: LocalAgentObservation[] = [
    {
      toolName: 'planner',
      summary: plan.goal,
      success: !plan.requiresClarification,
      timestamp: new Date().toISOString(),
    },
  ]

  if (plan.requiresClarification) {
    return { plan, observations, answer: plan.clarificationQuestion ?? '' }
  }

  const plannedCalls = buildStepToolCalls(context, plan)
  const state: LocalAgentLoopState = {
    phase: 'understand',
    plan,
    observations,
    plannedCallIndex: 0,
    generatedNodeIndex: 0,
    readNodeIndex: 0,
    pendingVerifyAfterGenerate: null,
    seen: new Set<string>(),
  }
  let executedSteps = 0
  while (state.phase !== 'finish') {
    const call = getNextUnseenToolCall(context, state, plannedCalls)
    if (!call) break
    if (executedSteps >= MAX_STEPS) {
      observations.push({
        toolName: 'planner',
        summary: `Stopped after reaching the local canvas agent max step limit (${MAX_STEPS}).`,
        success: false,
        timestamp: new Date().toISOString(),
      })
      break
    }
    if (context.options.abortSignal?.aborted) {
      context.streamContext.wasAborted = true
      observations.push({
        toolName: 'planner',
        summary: 'Stopped because the request was cancelled.',
        success: false,
        timestamp: new Date().toISOString(),
      })
      break
    }
    const result = await executeLocalAgentTool(context, call)
    executedSteps += 1
    observations.push(observationFromToolResult(result))
    if (result.success && result.name === 'canvas.generate_node_output') {
      const output = asRecord(result.output)
      const nodeId = typeof output.nodeId === 'string' ? output.nodeId : ''
      const field = typeof output.verifiedField === 'string' ? output.verifiedField : ''
      if (nodeId && field) {
        state.pendingVerifyAfterGenerate = { nodeId, field }
      }
    }
    if (context.options.abortSignal?.aborted) {
      context.streamContext.wasAborted = true
      observations.push({
        toolName: 'planner',
        summary: 'Stopped because the request was cancelled.',
        success: false,
        timestamp: new Date().toISOString(),
      })
      break
    }
    if (!result.success) break
  }

  const answer = await buildLocalAgentAnswer({ context, plan, observations })

  return { plan, observations, answer }
}
