import { requestLocalAgentDecision } from '@/lib/copilot/request/lifecycle/local-canvas-agent/decision'
import { classifyLocalCanvasUserIntent } from '@/lib/copilot/request/lifecycle/local-canvas-agent/intent'
import {
  buildLocalAgentAnswer,
  selectLocalAgentNextToolCall,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/actor'
import { observationFromToolResult } from '@/lib/copilot/request/lifecycle/local-canvas-agent/observation'
import { buildLocalAgentPlan } from '@/lib/copilot/request/lifecycle/local-canvas-agent/planner'
import { getLocalAgentToolDescriptor } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-descriptor'
import { executeLocalAgentTool } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-executor-bridge'
import type {
  LocalAgentContext,
  LocalAgentDecision,
  LocalAgentObservation,
  LocalAgentPlan,
  LocalAgentThreadMemoryUpdate,
  LocalAgentToolCall,
  LocalAgentToolLoopResult,
  LocalCanvasMutationPolicy,
  LocalCanvasPatch,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const MAX_STEPS = 10

type LocalAgentLoopPhase = 'understand' | 'inspect' | 'act' | 'verify' | 'finish'
type LocalCanvasAgentRuntimeMode = 'legacy' | 'hybrid' | 'model_tool_loop'

interface PendingVerification {
  input: Record<string, unknown>
}

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

interface ModelDrivenLoopState {
  plan: LocalAgentPlan
  observations: LocalAgentObservation[]
  pendingVerification: PendingVerification | null
  toolCallsExecuted: number
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function isRuntimeMode(value: string): value is LocalCanvasAgentRuntimeMode {
  return value === 'legacy' || value === 'hybrid' || value === 'model_tool_loop'
}

function resolveLocalCanvasAgentRuntimeMode(
  context: LocalAgentContext
): LocalCanvasAgentRuntimeMode {
  const payloadMode = asString(context.requestPayload.localAgentMode)
  if (isRuntimeMode(payloadMode)) return payloadMode
  const envMode = process.env.LOCAL_CANVAS_AGENT_MODE?.trim()
  return envMode && isRuntimeMode(envMode) ? envMode : 'model_tool_loop'
}

function buildInitialDecisionPlan(
  context: LocalAgentContext,
  policy: ReturnType<typeof classifyLocalCanvasUserIntent>
): LocalAgentPlan {
  const manualMutation =
    context.confirmationMode === 'manual' && policy.mutationPolicy === 'allow_mutation'
  return {
    goal: context.message,
    risk: policy.requiresUserConfirmation || manualMutation ? 'medium' : 'low',
    userIntent: policy.userIntent,
    mutationPolicy: manualMutation ? 'propose_only' : policy.mutationPolicy,
    canvasReadPolicy: policy.canvasReadPolicy,
    intentConfidence: policy.confidence,
    intentEvidence: policy.evidence,
    requiresUserConfirmation: policy.requiresUserConfirmation || manualMutation,
    requiresClarification: false,
    steps: [],
    successCriteria: ['The model decision loop reaches a verified final answer or safe stop.'],
  }
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
  plan: LocalAgentPlan,
  calls: LocalAgentToolCall[]
): LocalAgentToolCall[] {
  if (plan.canvasReadPolicy === 'none') return []
  if (plan.canvasReadPolicy === 'optional' && !hasReadCall(calls)) return []
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
    plan.mutationPolicy === 'propose_only' ||
      (plan.patch &&
        plannedCalls.some((call) => call.name === 'canvas.propose_patch') &&
        !plannedCalls.some((call) => call.name === 'canvas.apply_patch'))
  )
}

function isToolCallAllowedByPolicy(plan: LocalAgentPlan, call: LocalAgentToolCall): boolean {
  const policy = plan.mutationPolicy ?? 'allow_mutation'
  if (policy === 'allow_mutation') return true
  if (
    call.name === 'canvas.apply_patch' ||
    call.name === 'canvas.generate_node_output' ||
    call.name === 'materialize_file' ||
    call.name === 'update_task_result' ||
    call.name === 'submit_task_result'
  ) {
    return false
  }
  if (policy === 'read_only' && call.name === 'canvas.propose_patch') return false
  if (call.name === 'canvas.verify_patch') return false
  return true
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
  const canMutate = (state.plan.mutationPolicy ?? 'allow_mutation') === 'allow_mutation'

  if (
    canMutate &&
    state.plan.patch &&
    state.plan.patch.operations.length > 0 &&
    !proposalOnly &&
    !alreadyApplied
  ) {
    return { name: 'canvas.apply_patch', input: { patch: state.plan.patch } }
  }

  if (
    canMutate &&
    state.plan.patch &&
    state.plan.patch.operations.length > 0 &&
    !proposalOnly &&
    alreadyApplied &&
    !alreadyVerified
  ) {
    return { name: 'canvas.verify_patch', input: { patch: state.plan.patch } }
  }

  if (state.pendingVerifyAfterGenerate) {
    if (!canMutate) {
      state.pendingVerifyAfterGenerate = null
      return null
    }
    const generation = state.pendingVerifyAfterGenerate
    state.pendingVerifyAfterGenerate = null
    return { name: 'canvas.verify_patch', input: { generation } }
  }

  const generateNodeIds = state.plan.generateNodeIds ?? []
  if (canMutate && state.generatedNodeIndex < generateNodeIds.length) {
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
    return buildRequiredInspectionCalls(context, state.plan, plannedCalls)[0] ?? null
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
    if (!isToolCallAllowedByPolicy(state.plan, actorSelectedCall)) continue
    const key = getCallKey(call)
    if (state.seen.has(key)) continue
    state.seen.add(key)
    return actorSelectedCall
  }
  return null
}

function isMutationToolCallName(toolName: LocalAgentToolCall['name']): boolean {
  return (
    toolName === 'canvas.apply_patch' ||
    toolName === 'canvas.generate_node_output' ||
    toolName === 'materialize_file' ||
    toolName === 'update_task_result' ||
    toolName === 'submit_task_result'
  )
}

function getPolicyViolationSummary(params: {
  mutationPolicy?: LocalCanvasMutationPolicy
  call: LocalAgentToolCall
  readOnly: boolean
}): string | null {
  if (
    params.mutationPolicy === 'read_only' &&
    (!params.readOnly || params.call.name === 'canvas.propose_patch')
  ) {
    return `Blocked ${params.call.name} because this request is read-only.`
  }
  if (params.mutationPolicy === 'propose_only' && isMutationToolCallName(params.call.name)) {
    return `Blocked ${params.call.name} because this request requires proposal or confirmation first.`
  }
  return null
}

function buildDecisionObservation(summary: string, success: boolean): LocalAgentObservation {
  return {
    toolName: 'decision',
    summary,
    success,
    timestamp: new Date().toISOString(),
  }
}

function summarizeDecisionMemoryUpdate(update: LocalAgentThreadMemoryUpdate): string {
  return [
    update.conversationSummary ? 'conversationSummary' : '',
    update.canvasSummary ? 'canvasSummary' : '',
    update.taskState?.goal ? 'taskState.goal' : '',
    update.taskState?.openQuestions?.length ? 'taskState.openQuestions' : '',
    update.taskState?.lastObservation ? 'taskState.lastObservation' : '',
  ]
    .filter(Boolean)
    .join(', ')
}

function buildMemoryUpdateObservation(update: LocalAgentThreadMemoryUpdate): LocalAgentObservation {
  const changedFields = summarizeDecisionMemoryUpdate(update)
  return {
    toolName: 'memory',
    summary: changedFields
      ? `Model requested thread memory update: ${changedFields}`
      : 'Model requested thread memory update.',
    success: true,
    timestamp: new Date().toISOString(),
    output: update,
  }
}

function buildVerificationInputFromToolResult(
  call: LocalAgentToolCall,
  output: unknown
): Record<string, unknown> | null {
  if (call.name === 'canvas.apply_patch') return { patch: call.input.patch }
  if (call.name !== 'canvas.generate_node_output') return null
  const record = asRecord(output)
  const nodeId = typeof record.nodeId === 'string' ? record.nodeId : ''
  const field = typeof record.verifiedField === 'string' ? record.verifiedField : ''
  return nodeId && field ? { generation: { nodeId, field } } : null
}

function getPatchFromToolCall(call: LocalAgentToolCall): LocalCanvasPatch | undefined {
  if (call.name !== 'canvas.apply_patch' && call.name !== 'canvas.propose_patch') return undefined
  const patch = call.input.patch
  if (!patch || typeof patch !== 'object') return undefined
  const operations = (patch as { operations?: unknown }).operations
  return Array.isArray(operations) ? (patch as LocalCanvasPatch) : undefined
}

function applyPendingPatchToPlan(
  plan: LocalAgentPlan,
  patch: LocalCanvasPatch | undefined
): LocalAgentPlan {
  if (!patch) return plan
  return {
    ...plan,
    patch,
    steps: plan.steps.length
      ? plan.steps
      : [
          {
            id: 'confirm_apply_patch',
            title: '确认后执行这次画布修改',
            intent: 'update',
            toolHints: ['canvas.apply_patch'],
            expectedObservation: 'Canvas patch is applied after user confirmation',
          },
          {
            id: 'confirm_verify_patch',
            title: '确认后验证画布修改',
            intent: 'verify',
            toolHints: ['canvas.verify_patch'],
            expectedObservation: 'Canvas patch is verified after user confirmation',
          },
        ],
  }
}

function hasSuccessfulCanvasMutationAndVerify(observations: LocalAgentObservation[]): boolean {
  const hasMutation = observations.some(
    (observation) =>
      observation.success &&
      (observation.toolName === 'canvas.apply_patch' ||
        observation.toolName === 'canvas.generate_node_output')
  )
  const hasVerification = observations.some(
    (observation) => observation.success && observation.toolName === 'canvas.verify_patch'
  )
  return hasMutation && hasVerification
}

function buildMediaAnalysisFallbackAnswer(observations: LocalAgentObservation[]): string | null {
  const hasMutation = observations.some(
    (observation) =>
      observation.success &&
      (observation.toolName === 'canvas.apply_patch' ||
        observation.toolName === 'canvas.generate_node_output')
  )
  if (hasMutation) return null
  const mediaObservation = [...observations]
    .reverse()
    .find(
      (observation) => observation.success && observation.toolName === 'media.analyze_node_media'
    )
  if (!mediaObservation) return null

  const output = asRecord(mediaObservation.output)
  const access = asRecord(output.mediaContentAccess)
  const diagnostics = asRecord(output.binaryAnalysisDiagnostics)
  const analysis = Array.isArray(output.analysis)
    ? output.analysis.map(asString).filter(Boolean).slice(0, 6)
    : []
  const file = asRecord(output.file)
  const fileName = asString(file.name)
  const limitations = asString(output.limitations)

  if (diagnostics.truncated === true) {
    const tokens = asRecord(diagnostics.tokens)
    const finishReason = asString(diagnostics.finishReason)
    const reasoning = typeof tokens.reasoning === 'number' ? tokens.reasoning : undefined
    return [
      '我已读取到选中的媒体节点，但视觉模型输出被截断，本次不能可靠描述真实图片内容。',
      fileName ? `文件：${fileName}` : '',
      finishReason ? `停止原因：${finishReason}` : '',
      typeof reasoning === 'number' ? `隐藏推理 token：${reasoning}` : '',
      '建议重试、提高视觉分析 token 预算，或切换到更稳定的图片理解模型。',
    ]
      .filter(Boolean)
      .join('\n')
  }

  if (access.canDescribeActualMedia === true && analysis.length) {
    return ['我已完成媒体分析，结果如下：', ...analysis.map((line) => `- ${line}`)].join('\n')
  }

  if (analysis.length || limitations) {
    return [
      '我已读取媒体节点，但当前只能基于提示词、文件元数据或已存媒体上下文回答，不能声称看过真实媒体内容。',
      ...analysis.map((line) => `- ${line}`),
      limitations ? `限制：${limitations}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  return '我已读取媒体节点，但没有获得可用于描述真实媒体内容的分析结果。'
}

async function executeDecisionToolCall(params: {
  context: LocalAgentContext
  decision: Extract<LocalAgentDecision, { type: 'tool_call' }>
  state: ModelDrivenLoopState
}): Promise<void> {
  const descriptor = getLocalAgentToolDescriptor(params.decision.toolName)
  if (!descriptor?.isEnabled(params.context)) {
    params.state.observations.push(
      buildDecisionObservation(`Tool ${params.decision.toolName} is not available.`, false)
    )
    return
  }

  const parsedInput = descriptor.inputSchema.safeParse(params.decision.toolInput)
  if (!parsedInput.success) {
    params.state.observations.push(
      buildDecisionObservation(
        `Tool ${params.decision.toolName} input was invalid: ${parsedInput.error.issues
          .map((issue) => issue.message)
          .join('; ')}`,
        false
      )
    )
    return
  }

  let call: LocalAgentToolCall = {
    name: params.decision.toolName,
    input: parsedInput.data,
  }
  if (call.name === 'canvas.verify_patch' && params.state.pendingVerification) {
    call = { name: 'canvas.verify_patch', input: params.state.pendingVerification.input }
  }
  const policyViolation = getPolicyViolationSummary({
    mutationPolicy: params.state.plan.mutationPolicy,
    call,
    readOnly: descriptor.isReadOnly(parsedInput.data),
  })
  if (policyViolation) {
    params.state.observations.push(buildDecisionObservation(policyViolation, false))
    return
  }

  if (descriptor.isDestructive?.(parsedInput.data)) {
    const pendingPatch = getPatchFromToolCall(call)
    params.state.plan = {
      ...applyPendingPatchToPlan(params.state.plan, pendingPatch),
      requiresClarification: true,
      clarificationQuestion: '这个操作会删除或清空画布内容。请先明确确认后我再执行。',
      requiresUserConfirmation: true,
      risk: 'high',
    }
    params.state.observations.push(
      buildDecisionObservation(
        `Blocked destructive tool call ${call.name} until confirmation.`,
        false
      )
    )
    return
  }

  params.state.observations.push(buildDecisionObservation(params.decision.userVisibleReason, true))
  const result = await executeLocalAgentTool(params.context, call)
  params.state.toolCallsExecuted += 1
  params.state.observations.push(observationFromToolResult(result))
  if (result.success) {
    if (call.name === 'canvas.verify_patch') {
      params.state.pendingVerification = null
      return
    }
    const verificationInput = buildVerificationInputFromToolResult(call, result.output)
    if (verificationInput) {
      params.state.pendingVerification = { input: verificationInput }
    }
  }
}

async function executeParallelDecisionToolCalls(params: {
  context: LocalAgentContext
  decision: Extract<LocalAgentDecision, { type: 'tool_calls' }>
  state: ModelDrivenLoopState
}): Promise<void> {
  const calls: LocalAgentToolCall[] = []
  params.state.observations.push(buildDecisionObservation(params.decision.userVisibleReason, true))

  for (const requestedCall of params.decision.toolCalls) {
    const descriptor = getLocalAgentToolDescriptor(requestedCall.toolName)
    if (!descriptor?.isEnabled(params.context)) {
      params.state.observations.push(
        buildDecisionObservation(`Tool ${requestedCall.toolName} is not available.`, false)
      )
      continue
    }

    const parsedInput = descriptor.inputSchema.safeParse(requestedCall.toolInput)
    if (!parsedInput.success) {
      params.state.observations.push(
        buildDecisionObservation(
          `Tool ${requestedCall.toolName} input was invalid: ${parsedInput.error.issues
            .map((issue) => issue.message)
            .join('; ')}`,
          false
        )
      )
      continue
    }

    const call = {
      name: requestedCall.toolName,
      input: parsedInput.data,
    } satisfies LocalAgentToolCall
    const policyViolation = getPolicyViolationSummary({
      mutationPolicy: params.state.plan.mutationPolicy,
      call,
      readOnly: descriptor.isReadOnly(parsedInput.data),
    })
    if (policyViolation) {
      params.state.observations.push(buildDecisionObservation(policyViolation, false))
      continue
    }

    if (
      !descriptor.isReadOnly(parsedInput.data) ||
      !descriptor.isConcurrencySafe(parsedInput.data)
    ) {
      params.state.observations.push(
        buildDecisionObservation(
          `Blocked ${call.name} from parallel execution because it is not read-only and concurrency-safe.`,
          false
        )
      )
      continue
    }

    calls.push(call)
  }

  const results = await Promise.all(
    calls.map((call) => executeLocalAgentTool(params.context, call))
  )
  params.state.toolCallsExecuted += results.length
  params.state.observations.push(...results.map(observationFromToolResult))
}

async function executePendingVerification(params: {
  context: LocalAgentContext
  state: ModelDrivenLoopState
}): Promise<void> {
  if (!params.state.pendingVerification) return
  const result = await executeLocalAgentTool(params.context, {
    name: 'canvas.verify_patch',
    input: params.state.pendingVerification.input,
  })
  params.state.toolCallsExecuted += 1
  params.state.observations.push(observationFromToolResult(result))
  params.state.pendingVerification = null
}

async function runModelDrivenLocalAgentToolLoop(
  context: LocalAgentContext,
  options: { allowInitialFallback: boolean }
): Promise<LocalAgentToolLoopResult | null> {
  const policy = classifyLocalCanvasUserIntent(context)
  const state: ModelDrivenLoopState = {
    plan: buildInitialDecisionPlan(context, policy),
    observations: [
      {
        toolName: 'decision',
        summary: 'Started model-driven local canvas agent decision loop.',
        success: true,
        timestamp: new Date().toISOString(),
      },
    ],
    pendingVerification: null,
    toolCallsExecuted: 0,
  }
  let stopSummary: string | null = null

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (context.options.abortSignal?.aborted) {
      context.streamContext.wasAborted = true
      stopSummary = 'Stopped because the request was cancelled.'
      break
    }

    let decision: LocalAgentDecision
    try {
      decision = await requestLocalAgentDecision({
        context,
        observations: state.observations,
        policy,
      })
    } catch (error) {
      if (options.allowInitialFallback && state.toolCallsExecuted === 0) return null
      const summary = error instanceof Error ? error.message : 'Failed to get AgentDecision'
      const previousDecisionFailures = state.observations.filter(
        (observation) => observation.toolName === 'decision' && !observation.success
      ).length
      state.observations.push(buildDecisionObservation(summary, false))
      if (previousDecisionFailures === 0 && step < MAX_STEPS - 1) {
        continue
      }
      stopSummary = 'Stopped because the model decision could not be produced.'
      break
    }

    if (decision.type === 'ask_clarification') {
      state.plan = {
        ...state.plan,
        requiresClarification: true,
        clarificationQuestion: decision.question,
      }
      return { plan: state.plan, observations: state.observations, answer: decision.question }
    }

    if (decision.type === 'ask_confirmation') {
      const pendingPatch = decision.pendingToolCall
        ? getPatchFromToolCall({
            name: decision.pendingToolCall.name,
            input: decision.pendingToolCall.input,
          })
        : undefined
      state.plan = {
        ...applyPendingPatchToPlan(state.plan, pendingPatch),
        requiresClarification: true,
        clarificationQuestion: decision.question,
        requiresUserConfirmation: true,
        risk: decision.risk,
      }
      return { plan: state.plan, observations: state.observations, answer: decision.question }
    }

    if (decision.type === 'final_answer') {
      if (state.pendingVerification) {
        await executePendingVerification({ context, state })
        continue
      }
      if (decision.memoryUpdate) {
        state.observations.push(buildMemoryUpdateObservation(decision.memoryUpdate))
      }
      return { plan: state.plan, observations: state.observations, answer: decision.answer }
    }

    if (decision.type === 'tool_calls') {
      await executeParallelDecisionToolCalls({ context, decision, state })
      continue
    }

    await executeDecisionToolCall({ context, decision, state })
    if (state.plan.requiresClarification) {
      return {
        plan: state.plan,
        observations: state.observations,
        answer: state.plan.clarificationQuestion ?? '',
      }
    }
  }

  if (state.pendingVerification) {
    await executePendingVerification({ context, state })
  }
  if (hasSuccessfulCanvasMutationAndVerify(state.observations)) {
    return {
      plan: state.plan,
      observations: state.observations,
      answer: '已完成画布修改，并完成验证。',
    }
  }
  const mediaFallbackAnswer = buildMediaAnalysisFallbackAnswer(state.observations)
  if (mediaFallbackAnswer) {
    return {
      plan: state.plan,
      observations: state.observations,
      answer: mediaFallbackAnswer,
    }
  }
  state.observations.push(
    buildDecisionObservation(
      stopSummary ?? `Stopped after reaching the local canvas agent max step limit (${MAX_STEPS}).`,
      false
    )
  )
  const answer = await buildLocalAgentAnswer({
    context,
    plan: state.plan,
    observations: state.observations,
  })
  return { plan: state.plan, observations: state.observations, answer }
}

async function runPlanDrivenLocalAgentToolLoop(
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

export async function runLocalAgentToolLoop(
  context: LocalAgentContext
): Promise<LocalAgentToolLoopResult> {
  const mode = resolveLocalCanvasAgentRuntimeMode(context)
  if (mode === 'legacy') return runPlanDrivenLocalAgentToolLoop(context)
  const modelDrivenResult = await runModelDrivenLocalAgentToolLoop(context, {
    allowInitialFallback: mode === 'hybrid',
  })
  return modelDrivenResult ?? runPlanDrivenLocalAgentToolLoop(context)
}
