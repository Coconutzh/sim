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
import { persistLocalAgentSessionMetadata } from '@/lib/copilot/request/lifecycle/local-canvas-agent/session'
import { runLocalAgentToolLoop } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-loop'
import type {
  CanvasNodeDetail,
  CanvasNodeSummary,
  LocalAgentContext,
  LocalAgentMemoryData,
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

function notImplementedResult(
  input: LocalCanvasAgentHeadlessInput,
  auditId: string
): LocalCanvasAgentHeadlessResult {
  return {
    success: false,
    answer: '',
    mode: input.mode,
    risk: input.mode === 'read_only' ? 'low' : 'medium',
    requiresConfirmation: input.mode !== 'read_only',
    changedNodeIds: [],
    generatedNodeIds: [],
    auditId,
    traceId: input.traceId,
    errorCode: 'TOOL_EXECUTION_FAILED',
    error: `Hermes canvas mode "${input.mode}" is not implemented yet. Use read_only first.`,
  }
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
  const requiresConfirmation =
    hasProposedMutation(loopResult.plan) || Boolean(loopResult.plan.requiresUserConfirmation)

  logger.info('Hermes proposal canvas agent request completed', {
    auditId: params.auditId,
    traceId: params.input.traceId,
    hermesRunId: params.input.hermesRunId,
    userId: params.input.userId,
    workspaceId: params.input.workspaceId,
    workflowId: params.input.workflowId,
    risk: loopResult.plan.risk,
    requiresConfirmation,
    observationCount: loopResult.observations.length,
  })

  return {
    success: true,
    answer: buildProposalAnswer(loopResult, proposedPatchSummary),
    mode: params.input.mode,
    intent: loopResult.plan.userIntent ?? 'propose_plan',
    risk: loopResult.plan.risk,
    requiresConfirmation,
    proposedPatchSummary,
    changedNodeIds: [],
    generatedNodeIds: [],
    verificationSummary: 'Proposal-only request; no canvas mutation was executed.',
    auditId: params.auditId,
    traceId: params.input.traceId,
  }
}

export async function runLocalCanvasAgentHeadless(
  input: LocalCanvasAgentHeadlessInput
): Promise<LocalCanvasAgentHeadlessResult> {
  const auditId = input.auditId ?? generateId()

  if (input.mode === 'apply_after_confirm') {
    return notImplementedResult(input, auditId)
  }

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
        localAgentMode: 'headless_read_only',
      },
      execContext,
      streamContext,
      options,
    })

    await persistLocalAgentSessionMetadata(localContext)

    if (input.mode === 'propose') {
      return await runProposalMode({ input, auditId, localContext })
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
