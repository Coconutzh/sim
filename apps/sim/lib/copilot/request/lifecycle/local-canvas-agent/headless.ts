import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import {
  buildCanvasSummaryTextFromParts,
  loadCanvasSnapshot,
  readCanvasNodeDetail,
  summarizeCanvas,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-context'
import { resolveLocalAgentContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/context-manager'
import { loadLocalAgentMemory } from '@/lib/copilot/request/lifecycle/local-canvas-agent/memory'
import { buildLocalAgentAnswer } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/actor'
import {
  consumeLocalAgentPendingPlan,
  executeConfirmedLocalAgentPlan,
  putLocalAgentPendingPlan,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/pending-plan'
import { persistLocalAgentSessionMetadata } from '@/lib/copilot/request/lifecycle/local-canvas-agent/session'
import { runLocalAgentToolLoop } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-loop'
import type {
  CanvasNodeDetail,
  CanvasNodeSummary,
  LocalAgentContext,
  LocalAgentMemoryData,
  LocalAgentObservation,
  LocalAgentPlan,
  LocalAgentRisk,
  LocalAgentToolLoopResult,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import { TraceCollector } from '@/lib/copilot/request/trace'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamingContext,
} from '@/lib/copilot/request/types'

const logger = createLogger('LocalCanvasAgentHeadless')

export type LocalCanvasAgentHeadlessMode = 'read_only' | 'propose' | 'apply_after_confirm'

export type LocalCanvasAgentHeadlessErrorCode =
  | 'USER_PERMISSION_DENIED'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKFLOW_NOT_FOUND'
  | 'CANVAS_CONTEXT_UNAVAILABLE'
  | 'PATCH_VALIDATION_FAILED'
  | 'CONFIRMATION_REQUIRED'
  | 'CONFIRMATION_EXPIRED'
  | 'TOOL_EXECUTION_FAILED'
  | 'VERIFY_FAILED'
  | 'GENERATION_FAILED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'

export interface LocalCanvasAgentHeadlessInput {
  userId: string
  organizationId?: string
  workspaceId: string
  workflowId: string
  chatId?: string
  message: string
  selectedNodeIds?: string[]
  mode: LocalCanvasAgentHeadlessMode
  confirmationMode?: 'auto' | 'manual'
  pendingActionId?: string
  traceId?: string
  hermesRunId?: string
  auditId?: string
  metadata?: Record<string, unknown>
  abortSignal?: AbortSignal
}

export interface LocalCanvasAgentHeadlessCanvasResult {
  workflowId: string
  workspaceId: string
  nodeCount: number
  edgeCount: number
  selectedNodeIds: string[]
  nodes: CanvasNodeSummary[]
  selectedNodeDetails: CanvasNodeDetail[]
  summaryText: string
}

export type LocalCanvasAgentHeadlessResult =
  | {
      success: true
      answer: string
      mode: LocalCanvasAgentHeadlessMode
      intent?: string
      risk: LocalAgentRisk
      requiresConfirmation: boolean
      pendingActionId?: string
      proposedPatchSummary?: string
      changedNodeIds: string[]
      generatedNodeIds: string[]
      verificationSummary?: string
      auditId: string
      traceId?: string
      canvas?: LocalCanvasAgentHeadlessCanvasResult
    }
  | {
      success: false
      answer: string
      mode?: LocalCanvasAgentHeadlessMode
      intent?: string
      risk?: LocalAgentRisk
      requiresConfirmation?: boolean
      pendingActionId?: string
      proposedPatchSummary?: string
      changedNodeIds?: string[]
      generatedNodeIds?: string[]
      verificationSummary?: string
      auditId: string
      traceId?: string
      errorCode: LocalCanvasAgentHeadlessErrorCode
      error: string
    }

function createHeadlessStreamContext(params: {
  chatId?: string
  traceId?: string
}): StreamingContext {
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

function buildReadOnlyAnswer(params: {
  nodeCount: number
  edgeCount: number
  selectedNodeDetails: CanvasNodeDetail[]
  summaryText: string
}): string {
  const selected =
    params.selectedNodeDetails.length > 0
      ? params.selectedNodeDetails
          .map((node) => `- ${node.id} "${node.name}"：${node.summary}`)
          .join('\n')
      : '- 当前没有选中节点。'

  return [
    `已读取当前画布：共 ${params.nodeCount} 个节点、${params.edgeCount} 条连接。`,
    `选中节点：\n${selected}`,
    `画布摘要：\n${params.summaryText}`,
  ].join('\n\n')
}

function createEmptyHeadlessMemory(context: LocalAgentContext): LocalAgentMemoryData {
  return {
    version: 2,
    scope: 'thread',
    userId: context.userId,
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    agentCode: context.agent.code,
    chatId: context.chatId,
    conversationSummary: '',
    taskState: {
      completedSteps: [],
      openQuestions: [],
    },
    canvasSummary: '',
    recentObservations: [],
    toolResultRefs: [],
    updatedAt: new Date().toISOString(),
  }
}

async function loadMemoryForHeadless(context: LocalAgentContext): Promise<LocalAgentMemoryData> {
  try {
    return await loadLocalAgentMemory(context)
  } catch (error) {
    logger.warn('Failed to load Hermes headless local canvas memory', {
      chatId: context.chatId,
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      error: toError(error).message,
    })
    return createEmptyHeadlessMemory(context)
  }
}

function summarizeProposalPlan(plan: LocalAgentPlan): string {
  const steps = plan.steps.map((step, index) => `${index + 1}. ${step.title}`)
  const operationTypes = plan.patch?.operations.map((operation) => operation.type) ?? []
  const generateCount = plan.generateNodeIds?.length ?? plan.generationTargets?.length ?? 0
  return [
    `Goal: ${plan.goal}`,
    `Risk: ${plan.risk}`,
    `Mutation policy: ${plan.mutationPolicy ?? 'unknown'}`,
    steps.length ? `Steps:\n${steps.join('\n')}` : '',
    operationTypes.length
      ? `Patch operations (${operationTypes.length}): ${operationTypes.join(', ')}`
      : '',
    generateCount > 0 ? `Generation targets: ${generateCount}` : '',
    plan.requiresClarification && plan.clarificationQuestion
      ? `Clarification: ${plan.clarificationQuestion}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function hasProposedMutation(plan: LocalAgentPlan): boolean {
  return Boolean(
    (plan.patch?.operations.length ?? 0) > 0 ||
      (plan.generateNodeIds?.length ?? 0) > 0 ||
      (plan.generationTargets?.length ?? 0) > 0
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function getProposalValidationError(
  observations: LocalAgentObservation[]
): LocalAgentObservation | null {
  for (const observation of observations) {
    if (observation.toolName !== 'canvas.propose_patch') continue
    if (!observation.success) return observation
    const validation = asRecord(asRecord(observation.output).validation)
    if (validation.valid === false) return observation
  }
  return null
}

function getObservationErrorSummary(observation: LocalAgentObservation): string {
  const output = asRecord(observation.output)
  const validation = asRecord(output.validation)
  const validationErrors = readStringArray(validation.errors)
  if (validationErrors.length > 0) return validationErrors.join('; ')
  return observation.summary || 'Local canvas agent tool execution failed'
}

function addString(value: unknown, ids: Set<string>): void {
  if (typeof value === 'string' && value.trim()) ids.add(value)
}

function collectChangedNodeIds(observations: LocalAgentObservation[]): string[] {
  const ids = new Set<string>()
  for (const observation of observations) {
    if (observation.toolName !== 'canvas.apply_patch') continue
    const output = asRecord(observation.output)
    const machineSummary = asRecord(output.machineSummary)
    const createdNodeMap = {
      ...asRecord(output.createdNodeMap),
      ...asRecord(machineSummary.createdNodeMap),
    }
    for (const value of Object.values(createdNodeMap)) addString(value, ids)
    for (const nodeId of readStringArray(machineSummary.deletedNodeIds)) addString(nodeId, ids)

    const writeBackFields = Array.isArray(machineSummary.writeBackFields)
      ? machineSummary.writeBackFields.map(asRecord)
      : []
    for (const item of writeBackFields) addString(item.nodeId, ids)

    const referenceChanges = Array.isArray(machineSummary.referenceChanges)
      ? machineSummary.referenceChanges.map(asRecord)
      : []
    for (const item of referenceChanges) {
      addString(item.consumerNodeId, ids)
      addString(item.sourceNodeId, ids)
    }

    const patch = asRecord(output.patch)
    const operations = Array.isArray(patch.operations) ? patch.operations.map(asRecord) : []
    for (const operation of operations) {
      addString(operation.nodeId, ids)
      addString(operation.sourceNodeId, ids)
      addString(operation.targetNodeId, ids)
      addString(operation.consumerNodeId, ids)
    }
  }
  return [...ids]
}

function collectGeneratedNodeIds(observations: LocalAgentObservation[]): string[] {
  const ids = new Set<string>()
  for (const observation of observations) {
    if (observation.toolName !== 'canvas.generate_node_output' || !observation.success) continue
    addString(asRecord(observation.output).nodeId, ids)
  }
  return [...ids]
}

function buildVerificationSummary(observations: LocalAgentObservation[]): string | undefined {
  const verificationLines = observations
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
  return verificationLines.length ? verificationLines.join('\n') : undefined
}

function isVerificationFailure(observation: LocalAgentObservation): boolean {
  if (observation.toolName === 'canvas.verify_patch' && !observation.success) return true
  if (observation.toolName !== 'canvas.apply_patch') return false
  const verification = asRecord(asRecord(observation.output).verification)
  return verification.success === false
}

function errorCodeForFailedObservation(
  observation: LocalAgentObservation
): LocalCanvasAgentHeadlessErrorCode {
  if (isVerificationFailure(observation)) return 'VERIFY_FAILED'
  if (observation.toolName === 'canvas.generate_node_output') return 'GENERATION_FAILED'
  if (
    observation.toolName === 'canvas.apply_patch' &&
    /valid|validation|required|not found|unsupported|patch/i.test(observation.summary)
  ) {
    return 'PATCH_VALIDATION_FAILED'
  }
  return 'TOOL_EXECUTION_FAILED'
}

function buildProposalAnswer(
  loopResult: LocalAgentToolLoopResult,
  proposalSummary: string
): string {
  return [
    loopResult.answer.trim() || '已生成画布修改建议，等待用户确认后才能执行。',
    proposalSummary ? `\n建议摘要：\n${proposalSummary}` : '',
    '\n当前是 proposal 模式：没有执行任何画布写入。',
  ]
    .filter(Boolean)
    .join('\n')
}

async function runProposalMode(params: {
  input: LocalCanvasAgentHeadlessInput
  auditId: string
  localContext: LocalAgentContext
}): Promise<LocalCanvasAgentHeadlessResult> {
  if (!params.localContext.permissions.canRead) {
    return {
      success: false,
      answer: '',
      mode: params.input.mode,
      risk: 'low',
      requiresConfirmation: false,
      changedNodeIds: [],
      generatedNodeIds: [],
      auditId: params.auditId,
      traceId: params.input.traceId,
      errorCode: 'USER_PERMISSION_DENIED',
      error: params.localContext.permissions.readonlyReason ?? 'Canvas access denied',
    }
  }

  const memory = await loadMemoryForHeadless(params.localContext)
  const proposalContext: LocalAgentContext = {
    ...params.localContext,
    memory,
    confirmationMode: 'manual',
    requestPayload: {
      ...params.localContext.requestPayload,
      localAgentMode: 'model_tool_loop',
      hermesCanvasMode: 'propose',
    },
  }
  const loopResult = await runLocalAgentToolLoop(proposalContext)
  const proposedPatchSummary = summarizeProposalPlan(loopResult.plan)
  const proposalValidationError = getProposalValidationError(loopResult.observations)
  if (proposalValidationError) {
    const error = getObservationErrorSummary(proposalValidationError)
    return {
      success: false,
      answer: `画布修改方案未通过校验：${error}`,
      mode: params.input.mode,
      intent: loopResult.plan.userIntent ?? 'propose_plan',
      risk: loopResult.plan.risk,
      requiresConfirmation: false,
      proposedPatchSummary,
      changedNodeIds: [],
      generatedNodeIds: [],
      verificationSummary: buildVerificationSummary(loopResult.observations),
      auditId: params.auditId,
      traceId: params.input.traceId,
      errorCode: 'PATCH_VALIDATION_FAILED',
      error,
    }
  }

  const hasMutation = hasProposedMutation(loopResult.plan)
  const requiresConfirmation = hasMutation || Boolean(loopResult.plan.requiresUserConfirmation)
  const pending = hasMutation
    ? putLocalAgentPendingPlan({
        context: proposalContext,
        plan: loopResult.plan,
        source: 'hermes',
      })
    : null

  logger.info('Hermes proposal canvas agent request completed', {
    auditId: params.auditId,
    traceId: params.input.traceId,
    hermesRunId: params.input.hermesRunId,
    userId: params.input.userId,
    workspaceId: params.input.workspaceId,
    workflowId: params.input.workflowId,
    risk: loopResult.plan.risk,
    requiresConfirmation,
    pendingActionId: pending?.id,
    observationCount: loopResult.observations.length,
  })

  return {
    success: true,
    answer: buildProposalAnswer(loopResult, proposedPatchSummary),
    mode: params.input.mode,
    intent: loopResult.plan.userIntent ?? 'propose_plan',
    risk: loopResult.plan.risk,
    requiresConfirmation,
    pendingActionId: pending?.id,
    proposedPatchSummary,
    changedNodeIds: [],
    generatedNodeIds: [],
    verificationSummary: 'Proposal-only request; no canvas mutation was executed.',
    auditId: params.auditId,
    traceId: params.input.traceId,
  }
}

function buildConfirmationExpiredResult(params: {
  input: LocalCanvasAgentHeadlessInput
  auditId: string
}): LocalCanvasAgentHeadlessResult {
  return {
    success: false,
    answer: '这个确认请求已经过期或不属于当前画布会话，请重新生成修改方案。',
    mode: params.input.mode,
    risk: 'medium',
    requiresConfirmation: true,
    changedNodeIds: [],
    generatedNodeIds: [],
    auditId: params.auditId,
    traceId: params.input.traceId,
    errorCode: 'CONFIRMATION_EXPIRED',
    error: 'Pending canvas action was not found for the current user/workspace/workflow/chat',
  }
}

async function buildApplySuccessAnswer(params: {
  context: LocalAgentContext
  plan: LocalAgentPlan
  observations: LocalAgentObservation[]
}): Promise<string> {
  try {
    const answer = await buildLocalAgentAnswer(params)
    if (answer.trim()) return answer
  } catch (error) {
    logger.warn('Failed to build Hermes confirmed canvas apply answer', {
      chatId: params.context.chatId,
      workspaceId: params.context.workspaceId,
      workflowId: params.context.workflowId,
      error: toError(error).message,
    })
  }
  return '已完成画布修改，并完成验证。'
}

async function runApplyAfterConfirmMode(params: {
  input: LocalCanvasAgentHeadlessInput
  auditId: string
  localContext: LocalAgentContext
}): Promise<LocalCanvasAgentHeadlessResult> {
  if (!params.input.pendingActionId) {
    return {
      success: false,
      answer: '执行画布写入前需要用户确认产生的 pendingActionId。',
      mode: params.input.mode,
      risk: 'medium',
      requiresConfirmation: true,
      changedNodeIds: [],
      generatedNodeIds: [],
      auditId: params.auditId,
      traceId: params.input.traceId,
      errorCode: 'CONFIRMATION_REQUIRED',
      error: 'pendingActionId is required for apply_after_confirm mode',
    }
  }

  if (!params.localContext.permissions.canRead || !params.localContext.permissions.canWrite) {
    return {
      success: false,
      answer: '',
      mode: params.input.mode,
      risk: 'medium',
      requiresConfirmation: false,
      changedNodeIds: [],
      generatedNodeIds: [],
      auditId: params.auditId,
      traceId: params.input.traceId,
      errorCode: 'USER_PERMISSION_DENIED',
      error: params.localContext.permissions.readonlyReason ?? 'Canvas write access denied',
    }
  }

  const consumed = consumeLocalAgentPendingPlan({
    context: params.localContext,
    pendingActionId: params.input.pendingActionId,
  })
  if (consumed.status !== 'found') {
    return buildConfirmationExpiredResult({ input: params.input, auditId: params.auditId })
  }

  const memory = await loadMemoryForHeadless(params.localContext)
  const applyContext: LocalAgentContext = {
    ...params.localContext,
    memory,
    confirmationMode: 'manual',
    requestPayload: {
      ...params.localContext.requestPayload,
      localAgentMode: 'headless_apply_after_confirm',
      hermesCanvasMode: 'apply_after_confirm',
      pendingActionId: params.input.pendingActionId,
    },
  }
  const observations = await executeConfirmedLocalAgentPlan(applyContext, consumed.pending.plan)
  const changedNodeIds = collectChangedNodeIds(observations)
  const generatedNodeIds = collectGeneratedNodeIds(observations)
  const verificationSummary = buildVerificationSummary(observations)
  const failedObservation = observations.find((observation) => !observation.success)

  if (failedObservation) {
    const error = getObservationErrorSummary(failedObservation)
    const errorCode = errorCodeForFailedObservation(failedObservation)
    return {
      success: false,
      answer:
        errorCode === 'VERIFY_FAILED'
          ? `画布写入后验证失败：${error}`
          : `画布确认执行失败：${error}`,
      mode: params.input.mode,
      intent: consumed.pending.plan.userIntent ?? 'mutate_canvas',
      risk: consumed.pending.plan.risk,
      requiresConfirmation: false,
      pendingActionId: params.input.pendingActionId,
      proposedPatchSummary: summarizeProposalPlan(consumed.pending.plan),
      changedNodeIds,
      generatedNodeIds,
      verificationSummary,
      auditId: params.auditId,
      traceId: params.input.traceId,
      errorCode,
      error,
    }
  }

  const answer = await buildApplySuccessAnswer({
    context: applyContext,
    plan: consumed.pending.plan,
    observations,
  })

  logger.info('Hermes confirmed canvas agent apply completed', {
    auditId: params.auditId,
    traceId: params.input.traceId,
    hermesRunId: params.input.hermesRunId,
    userId: params.input.userId,
    workspaceId: params.input.workspaceId,
    workflowId: params.input.workflowId,
    pendingActionId: params.input.pendingActionId,
    risk: consumed.pending.plan.risk,
    changedNodeCount: changedNodeIds.length,
    generatedNodeCount: generatedNodeIds.length,
  })

  return {
    success: true,
    answer,
    mode: params.input.mode,
    intent: consumed.pending.plan.userIntent ?? 'mutate_canvas',
    risk: consumed.pending.plan.risk,
    requiresConfirmation: false,
    pendingActionId: params.input.pendingActionId,
    proposedPatchSummary: summarizeProposalPlan(consumed.pending.plan),
    changedNodeIds,
    generatedNodeIds,
    verificationSummary,
    auditId: params.auditId,
    traceId: params.input.traceId,
  }
}

export async function runLocalCanvasAgentHeadless(
  input: LocalCanvasAgentHeadlessInput
): Promise<LocalCanvasAgentHeadlessResult> {
  const auditId = input.auditId ?? generateId()

  const streamContext = createHeadlessStreamContext({
    chatId: input.chatId,
    traceId: input.traceId,
  })
  const execContext: ExecutionContext = {
    userId: input.userId,
    workspaceId: input.workspaceId,
    workflowId: input.workflowId,
    chatId: input.chatId,
    requestMode: 'hermes_canvas_agent',
    abortSignal: input.abortSignal,
  }
  const options: Pick<OrchestratorOptions, 'abortSignal' | 'onEvent'> = {
    abortSignal: input.abortSignal,
  }

  try {
    const localContext = await resolveLocalAgentContext({
      requestPayload: {
        message: input.message,
        workspaceId: input.workspaceId,
        workflowId: input.workflowId,
        chatId: input.chatId,
        selectedNodeIds: input.selectedNodeIds ?? [],
        confirmationMode: input.confirmationMode ?? 'manual',
        hermesRunId: input.hermesRunId,
        hermesMetadata: input.metadata,
        localAgentMode:
          input.mode === 'apply_after_confirm'
            ? 'headless_apply_after_confirm'
            : input.mode === 'propose'
              ? 'headless_propose'
              : 'headless_read_only',
      },
      execContext,
      streamContext,
      options,
    })

    await persistLocalAgentSessionMetadata(localContext)

    if (input.mode === 'propose') {
      return await runProposalMode({ input, auditId, localContext })
    }

    if (input.mode === 'apply_after_confirm') {
      return await runApplyAfterConfirmMode({ input, auditId, localContext })
    }

    if (!localContext.permissions.canRead) {
      return {
        success: false,
        answer: '',
        mode: input.mode,
        risk: 'low',
        requiresConfirmation: false,
        changedNodeIds: [],
        generatedNodeIds: [],
        auditId,
        traceId: input.traceId,
        errorCode: 'USER_PERMISSION_DENIED',
        error: localContext.permissions.readonlyReason ?? 'Canvas access denied',
      }
    }

    const snapshot = await loadCanvasSnapshot({
      workflowId: localContext.workflowId,
      workspaceId: localContext.workspaceId,
    })
    const nodes = summarizeCanvas(snapshot, localContext.selectedNodeIds)
    const selectedNodeDetails = localContext.selectedNodeIds
      .map((nodeId) => readCanvasNodeDetail(snapshot, nodeId, localContext.selectedNodeIds))
      .filter((node): node is CanvasNodeDetail => Boolean(node))
    const summaryText = buildCanvasSummaryTextFromParts({
      workflowId: snapshot.workflowId,
      nodes,
      edges: snapshot.edges,
    })
    const answer = buildReadOnlyAnswer({
      nodeCount: nodes.length,
      edgeCount: snapshot.edges.length,
      selectedNodeDetails,
      summaryText,
    })

    logger.info('Hermes read-only canvas agent request completed', {
      auditId,
      traceId: input.traceId,
      hermesRunId: input.hermesRunId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      workflowId: input.workflowId,
      nodeCount: nodes.length,
      edgeCount: snapshot.edges.length,
      selectedNodeCount: selectedNodeDetails.length,
    })

    return {
      success: true,
      answer,
      mode: input.mode,
      intent: 'inspect_canvas',
      risk: 'low',
      requiresConfirmation: false,
      changedNodeIds: [],
      generatedNodeIds: [],
      verificationSummary: 'Read-only request; no canvas mutation was executed.',
      auditId,
      traceId: input.traceId,
      canvas: {
        workflowId: snapshot.workflowId,
        workspaceId: snapshot.workspaceId,
        nodeCount: nodes.length,
        edgeCount: snapshot.edges.length,
        selectedNodeIds: localContext.selectedNodeIds,
        nodes,
        selectedNodeDetails,
        summaryText,
      },
    }
  } catch (error) {
    const err = toError(error)
    logger.error('Hermes headless canvas agent request failed', {
      auditId,
      traceId: input.traceId,
      hermesRunId: input.hermesRunId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      workflowId: input.workflowId,
      error: err.message,
    })
    return {
      success: false,
      answer: '',
      mode: input.mode,
      risk: 'low',
      requiresConfirmation: false,
      changedNodeIds: [],
      generatedNodeIds: [],
      auditId,
      traceId: input.traceId,
      errorCode: 'CANVAS_CONTEXT_UNAVAILABLE',
      error: err.message,
    }
  }
}
