import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { resolveLocalAgentContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/context-manager'
import {
  appendLocalAgentToolResultRefs,
  loadLocalAgentMemory,
  persistLocalAgentToolResultRefs,
  saveLocalAgentMemory,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/memory'
import {
  buildLocalAgentAnswer,
  hasInternalFieldLeak,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/actor'
import { summarizeLocalAgentRun } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/summarizer'
import { verifyLocalAgentFinalAnswer } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/verifier'
import {
  deleteLocalAgentPendingPlan,
  executeConfirmedLocalAgentPlan,
  isSimpleLocalAgentPendingPlanConfirm,
  LOCAL_CANVAS_CONFIRM_PREFIX,
  LOCAL_CANVAS_REVISE_PREFIX,
  parseLocalAgentPendingPlanCommand,
  peekLocalAgentPendingPlan,
  putLocalAgentPendingPlan,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/pending-plan'
import { classifyLocalCanvasAgentRouting } from '@/lib/copilot/request/lifecycle/local-canvas-agent/routing'
import { planRequiresDeleteConfirmation } from '@/lib/copilot/request/lifecycle/local-canvas-agent/safety'
import { persistLocalAgentSessionMetadata } from '@/lib/copilot/request/lifecycle/local-canvas-agent/session'
import {
  emitLocalAgentOptions,
  emitLocalAgentText,
  emitLocalAgentThinking,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/stream'
import { runLocalAgentToolLoop } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-loop'
import { prepareLocalAgentMemoryPersistDecision } from '@/lib/copilot/request/lifecycle/local-canvas-agent/turn-finalizer'
import type {
  LocalAgentContext,
  LocalAgentMemoryData,
  LocalAgentObservation,
  LocalAgentPlan,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamingContext,
} from '@/lib/copilot/request/types'

const logger = createLogger('LocalCanvasAgentRuntime')

async function persistMemoryBestEffort(params: {
  context: LocalAgentContext
  memory: LocalAgentMemoryData
  plan: LocalAgentPlan
  observations: LocalAgentObservation[]
}): Promise<void> {
  try {
    const persistDecision = prepareLocalAgentMemoryPersistDecision(params)
    if (!persistDecision.persist) {
      logger.info('Skipped local canvas agent memory persist for interrupted turn', {
        chatId: params.context.chatId,
        workspaceId: params.context.workspaceId,
        workflowId: params.context.workflowId,
        reason: persistDecision.reason,
      })
      return
    }
    const toolResultRefs = await persistLocalAgentToolResultRefs({
      context: persistDecision.context,
      observations: persistDecision.observations,
    })
    const summary = await summarizeLocalAgentRun({
      context: persistDecision.context,
      memory: persistDecision.memory,
      plan: persistDecision.plan,
      observations: persistDecision.observations,
    })
    await saveLocalAgentMemory(
      persistDecision.context,
      appendLocalAgentToolResultRefs(summary, toolResultRefs)
    )
  } catch (error) {
    logger.warn('Failed to persist local canvas agent memory', {
      chatId: params.context.chatId,
      workspaceId: params.context.workspaceId,
      workflowId: params.context.workflowId,
      error: toError(error).message,
    })
  }
}

function scheduleMemoryPersistBestEffort(params: {
  context: LocalAgentContext
  memory: LocalAgentMemoryData
  plan: LocalAgentPlan
  observations: LocalAgentObservation[]
}): void {
  const persistDecision = prepareLocalAgentMemoryPersistDecision(params)
  if (!persistDecision.persist) {
    logger.info('Skipped scheduling local canvas agent memory persist for interrupted turn', {
      chatId: params.context.chatId,
      workspaceId: params.context.workspaceId,
      workflowId: params.context.workflowId,
      reason: persistDecision.reason,
    })
    return
  }
  setTimeout(() => {
    void persistMemoryBestEffort(persistDecision)
  }, 0)
}

function hasSuccessfulVerifiedMutation(observations: LocalAgentObservation[]): boolean {
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

function canUseAnswerWithoutVerifier(params: {
  observations: LocalAgentObservation[]
  answer: string
}): boolean {
  const answer = params.answer.trim()
  return (
    Boolean(answer) &&
    !hasInternalFieldLeak(answer) &&
    params.observations.every((observation) => observation.success) &&
    hasSuccessfulVerifiedMutation(params.observations)
  )
}

async function finalizeLocalAgentRun(params: {
  context: LocalAgentContext
  streamContext: StreamingContext
  options: Pick<OrchestratorOptions, 'abortSignal' | 'onEvent'>
  memory: LocalAgentMemoryData
  plan: LocalAgentPlan
  observations: LocalAgentObservation[]
  answer: string
}): Promise<void> {
  const answer = canUseAnswerWithoutVerifier({
    observations: params.observations,
    answer: params.answer,
  })
    ? params.answer
    : await verifyLocalAgentFinalAnswer({
        context: params.context,
        plan: params.plan,
        observations: params.observations,
        answer: params.answer,
      })
  await emitLocalAgentText(params.streamContext, params.options, answer)
  params.streamContext.streamComplete = true
  scheduleMemoryPersistBestEffort({
    context: params.context,
    memory: params.memory,
    plan: params.plan,
    observations: params.observations,
  })
}

async function loadMemoryBestEffort(context: LocalAgentContext): Promise<LocalAgentMemoryData> {
  try {
    return await loadLocalAgentMemory(context)
  } catch (error) {
    logger.warn('Failed to load local canvas agent memory', {
      chatId: context.chatId,
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      error: toError(error).message,
    })
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
}

async function maybeHandlePendingPlan(context: LocalAgentContext): Promise<boolean> {
  const command = parseLocalAgentPendingPlanCommand(context.message)
  const pendingResult = peekLocalAgentPendingPlan(context)
  const shouldConfirm =
    command?.action === 'confirm' || isSimpleLocalAgentPendingPlanConfirm(context.message)
  if (pendingResult.status === 'expired') {
    if (shouldConfirm || command?.action === 'revise') {
      await emitLocalAgentText(
        context.streamContext,
        context.options,
        '这个确认请求已经过期，请重新发送你的需求。'
      )
      context.streamContext.streamComplete = true
      return true
    }
    return false
  }
  if (pendingResult.status !== 'found') return false
  if (!shouldConfirm && command?.action !== 'revise') return false

  const pending = pendingResult.pending
  if (command && command.id !== pending.id) {
    deleteLocalAgentPendingPlan(context)
    await emitLocalAgentText(
      context.streamContext,
      context.options,
      '这个确认请求已经过期，请重新发送你的需求。'
    )
    context.streamContext.streamComplete = true
    return true
  }

  if (command?.action === 'revise') {
    deleteLocalAgentPendingPlan(context)
    await emitLocalAgentText(
      context.streamContext,
      context.options,
      '请告诉我你想如何调整这次画布修改计划。'
    )
    context.streamContext.streamComplete = true
    return true
  }

  deleteLocalAgentPendingPlan(context)
  const memory = await loadMemoryBestEffort(context)
  const contextWithMemory = { ...context, memory }
  const observations = await executeConfirmedLocalAgentPlan(contextWithMemory, pending.plan)
  const answer = await buildLocalAgentAnswer({
    context: contextWithMemory,
    plan: pending.plan,
    observations,
  })
  await finalizeLocalAgentRun({
    context: contextWithMemory,
    streamContext: context.streamContext,
    options: context.options,
    memory,
    plan: pending.plan,
    observations,
    answer,
  })
  return true
}

function buildPlanPreview(plan: LocalAgentPlan): string {
  const steps =
    plan.steps.length > 0
      ? plan.steps.map((step, index) => `${index + 1}. ${step.title}`).join('\n')
      : '1. 执行这次待确认的画布修改\n2. 重新读取并验证修改结果'
  return [
    plan.clarificationQuestion ?? '我准备按下面步骤操作当前画布：',
    steps,
    `风险等级：${plan.risk}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function buildNonCanvasResponse(): string {
  return [
    '这条请求看起来不是当前画布相关任务，我不会读取或修改画布。',
    '如果你希望把这个主题用于当前画布，请说明要创建、更新、连接或生成的节点内容。',
  ].join('\n')
}

async function emitDeleteConfirmationOptions(params: {
  context: LocalAgentContext
  streamContext: StreamingContext
  options: Pick<OrchestratorOptions, 'abortSignal' | 'onEvent'>
  plan: LocalAgentPlan
}): Promise<void> {
  const pending = putLocalAgentPendingPlan({
    context: params.context,
    plan: params.plan,
    source: 'sim_ui',
  })
  await emitLocalAgentOptions({
    context: params.streamContext,
    options: params.options,
    text: buildPlanPreview(params.plan),
    optionItems: [
      {
        id: `${LOCAL_CANVAS_CONFIRM_PREFIX}${pending.id}`,
        label: '确认删除',
        value: `${LOCAL_CANVAS_CONFIRM_PREFIX}${pending.id}`,
      },
      {
        id: `${LOCAL_CANVAS_REVISE_PREFIX}${pending.id}`,
        label: '调整方案',
        value: `${LOCAL_CANVAS_REVISE_PREFIX}${pending.id}`,
      },
    ],
  })
  params.streamContext.streamComplete = true
}

export async function runLocalCanvasAgent(params: {
  requestPayload: Record<string, unknown>
  context: StreamingContext
  execContext: ExecutionContext
  options: Pick<OrchestratorOptions, 'abortSignal' | 'onEvent'>
}): Promise<void> {
  const localContext = await resolveLocalAgentContext({
    requestPayload: params.requestPayload,
    execContext: params.execContext,
    streamContext: params.context,
    options: params.options,
  })

  const routingDecision = classifyLocalCanvasAgentRouting(localContext)
  await persistLocalAgentSessionMetadata(localContext)

  if (routingDecision.kind === 'non_canvas') {
    logger.info('Local canvas agent skipped non-canvas request', {
      chatId: localContext.chatId,
      workspaceId: localContext.workspaceId,
      workflowId: localContext.workflowId,
      reason: routingDecision.reason,
    })
    await emitLocalAgentText(params.context, params.options, buildNonCanvasResponse())
    params.context.streamComplete = true
    return
  }

  if (await maybeHandlePendingPlan(localContext)) return

  await emitLocalAgentThinking(params.context, params.options, '正在理解你的需求。')
  const memory = await loadMemoryBestEffort(localContext)
  const contextWithMemory = { ...localContext, memory }

  if (localContext.confirmationMode === 'manual') {
    const manualLoopContext = {
      ...contextWithMemory,
      requestPayload: {
        ...contextWithMemory.requestPayload,
        localAgentMode: 'model_tool_loop',
      },
    }
    const manualLoopResult = await runLocalAgentToolLoop(manualLoopContext).catch(async (error) => {
      const err = toError(error)
      logger.error('Local canvas agent manual proposal loop failed', {
        chatId: localContext.chatId,
        workspaceId: localContext.workspaceId,
        workflowId: localContext.workflowId,
        error: err.message,
      })
      params.context.errors = params.context.errors ?? []
      params.context.errors.push(err.message)
      await emitLocalAgentText(
        params.context,
        params.options,
        `我没有完成这次画布确认方案：${err.message}`
      )
      params.context.streamComplete = true
      return null
    })
    if (!manualLoopResult) return
    const { plan, observations, answer } = manualLoopResult

    if (hasSuccessfulVerifiedMutation(observations)) {
      await finalizeLocalAgentRun({
        context: manualLoopContext,
        streamContext: params.context,
        options: params.options,
        memory,
        plan,
        observations,
        answer,
      })
      return
    }

    if (planRequiresDeleteConfirmation(plan)) {
      await emitDeleteConfirmationOptions({
        context: localContext,
        streamContext: params.context,
        options: params.options,
        plan,
      })
      return
    }

    if (plan.requiresClarification) {
      await emitLocalAgentText(
        params.context,
        params.options,
        plan.clarificationQuestion ?? '我需要更多信息才能安全修改画布。'
      )
      params.context.streamComplete = true
      return
    }

    await finalizeLocalAgentRun({
      context: manualLoopContext,
      streamContext: params.context,
      options: params.options,
      memory,
      plan,
      observations,
      answer,
    })
    return
  }

  const loopResult = await runLocalAgentToolLoop(contextWithMemory).catch(async (error) => {
    const err = toError(error)
    logger.error('Local canvas agent tool loop failed', {
      chatId: localContext.chatId,
      workspaceId: localContext.workspaceId,
      workflowId: localContext.workflowId,
      error: err.message,
    })
    params.context.errors = params.context.errors ?? []
    params.context.errors.push(err.message)
    await emitLocalAgentText(
      params.context,
      params.options,
      `我没有完成这次画布操作：${err.message}`
    )
    params.context.streamComplete = true
    return null
  })
  if (!loopResult) return
  const { plan, observations, answer } = loopResult

  if (hasSuccessfulVerifiedMutation(observations)) {
    await finalizeLocalAgentRun({
      context: contextWithMemory,
      streamContext: params.context,
      options: params.options,
      memory,
      plan,
      observations,
      answer,
    })
    return
  }

  if (planRequiresDeleteConfirmation(plan)) {
    await emitDeleteConfirmationOptions({
      context: localContext,
      streamContext: params.context,
      options: params.options,
      plan,
    })
    return
  }

  if (plan.requiresClarification) {
    await emitLocalAgentText(
      params.context,
      params.options,
      plan.clarificationQuestion ?? '我需要更多信息才能安全修改画布。'
    )
    params.context.streamComplete = true
    return
  }

  await finalizeLocalAgentRun({
    context: contextWithMemory,
    streamContext: params.context,
    options: params.options,
    memory,
    plan,
    observations,
    answer,
  })
}
