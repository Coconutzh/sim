import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { resolveLocalAgentContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/context-manager'
import {
  loadLocalAgentMemory,
  saveLocalAgentMemory,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/memory'
import { buildLocalAgentAnswer } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/actor'
import { summarizeLocalAgentRun } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/summarizer'
import { verifyLocalAgentFinalAnswer } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/verifier'
import { observationFromToolResult } from '@/lib/copilot/request/lifecycle/local-canvas-agent/observation'
import { classifyLocalCanvasAgentRouting } from '@/lib/copilot/request/lifecycle/local-canvas-agent/routing'
import { persistLocalAgentSessionMetadata } from '@/lib/copilot/request/lifecycle/local-canvas-agent/session'
import {
  emitLocalAgentOptions,
  emitLocalAgentText,
  emitLocalAgentThinking,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/stream'
import { executeLocalAgentTool } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-executor-bridge'
import { runLocalAgentToolLoop } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-loop'
import type {
  LocalAgentContext,
  LocalAgentMemoryData,
  LocalAgentObservation,
  LocalAgentPlan,
  LocalAgentToolCall,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamingContext,
} from '@/lib/copilot/request/types'

const logger = createLogger('LocalCanvasAgentRuntime')
const CONFIRM_PREFIX = '__local_canvas_confirm__:'
const REVISE_PREFIX = '__local_canvas_revise__:'
const PENDING_PLAN_TTL_MS = 30 * 60 * 1000
const pendingPlans = new Map<
  string,
  {
    id: string
    context: LocalAgentContext
    plan: LocalAgentPlan
    createdAt: number
  }
>()

function getPendingKey(context: LocalAgentContext): string {
  return [
    context.userId,
    context.workspaceId,
    context.workflowId,
    context.chatId ?? 'no-chat',
  ].join(':')
}

function parseCommand(message: string): { action: 'confirm' | 'revise'; id: string } | null {
  if (message.startsWith(CONFIRM_PREFIX))
    return { action: 'confirm', id: message.slice(CONFIRM_PREFIX.length) }
  if (message.startsWith(REVISE_PREFIX))
    return { action: 'revise', id: message.slice(REVISE_PREFIX.length) }
  return null
}

function isSimpleConfirm(message: string): boolean {
  return /^(确认|继续|执行|开始执行|可以执行|yes|confirm|go ahead|run it)$/i.test(message.trim())
}

function isPendingPlanExpired(pending: { createdAt: number }, now = Date.now()): boolean {
  return now - pending.createdAt > PENDING_PLAN_TTL_MS
}

function deleteExpiredPendingPlans(now = Date.now()): void {
  for (const [key, pending] of pendingPlans) {
    if (isPendingPlanExpired(pending, now)) pendingPlans.delete(key)
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function throwIfAborted(context: LocalAgentContext): void {
  if (context.options.abortSignal?.aborted) {
    context.streamContext.wasAborted = true
    throw new Error('Request was cancelled')
  }
}

function buildGenerationVerifyInput(output: unknown): Record<string, unknown> {
  const record = asRecord(output)
  const nodeId = typeof record.nodeId === 'string' ? record.nodeId : ''
  const field = typeof record.verifiedField === 'string' ? record.verifiedField : ''
  return nodeId && field ? { generation: { nodeId, field } } : {}
}

async function executeConfirmedPlan(context: LocalAgentContext, plan: LocalAgentPlan) {
  const observations: LocalAgentObservation[] = []
  if (plan.patch) {
    throwIfAborted(context)
    const result = await executeLocalAgentTool(context, {
      name: 'canvas.apply_patch',
      input: { patch: plan.patch },
    } satisfies LocalAgentToolCall)
    observations.push(observationFromToolResult(result))
    if (result.success) {
      throwIfAborted(context)
      const verifyResult = await executeLocalAgentTool(context, {
        name: 'canvas.verify_patch',
        input: { patch: plan.patch },
      })
      observations.push(observationFromToolResult(verifyResult))
    }
  }
  for (const nodeId of plan.generateNodeIds ?? []) {
    throwIfAborted(context)
    const result = await executeLocalAgentTool(context, {
      name: 'canvas.generate_node_output',
      input: { nodeId },
    })
    observations.push(observationFromToolResult(result))
    if (result.success) {
      throwIfAborted(context)
      const verifyResult = await executeLocalAgentTool(context, {
        name: 'canvas.verify_patch',
        input: buildGenerationVerifyInput(result.output),
      })
      observations.push(observationFromToolResult(verifyResult))
    }
  }
  return observations
}

async function persistMemoryBestEffort(params: {
  context: LocalAgentContext
  memory: LocalAgentMemoryData
  plan: LocalAgentPlan
  observations: Awaited<ReturnType<typeof executeConfirmedPlan>>
}): Promise<void> {
  try {
    const summary = await summarizeLocalAgentRun({
      context: params.context,
      memory: params.memory,
      plan: params.plan,
      observations: params.observations,
    })
    await saveLocalAgentMemory(params.context, summary)
  } catch (error) {
    logger.warn('Failed to persist local canvas agent memory', {
      chatId: params.context.chatId,
      workspaceId: params.context.workspaceId,
      workflowId: params.context.workflowId,
      error: toError(error).message,
    })
  }
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
      updatedAt: new Date().toISOString(),
    }
  }
}

async function maybeHandlePendingPlan(context: LocalAgentContext): Promise<boolean> {
  const command = parseCommand(context.message)
  const pendingKey = getPendingKey(context)
  const pending = pendingPlans.get(pendingKey)
  const shouldConfirm = command?.action === 'confirm' || isSimpleConfirm(context.message)
  if (pending && isPendingPlanExpired(pending)) {
    pendingPlans.delete(pendingKey)
    if (shouldConfirm || command?.action === 'revise') {
      await emitLocalAgentText(
        context.streamContext,
        context.options,
        '这个确认请求已经过期，请重新发送你的需求。'
      )
      context.streamContext.streamComplete = true
      return true
    }
    deleteExpiredPendingPlans()
    return false
  }
  deleteExpiredPendingPlans()
  if (!pending) return false
  if (!shouldConfirm && command?.action !== 'revise') return false

  if (command && command.id !== pending.id) {
    pendingPlans.delete(pendingKey)
    await emitLocalAgentText(
      context.streamContext,
      context.options,
      '这个确认请求已经过期，请重新发送你的需求。'
    )
    context.streamContext.streamComplete = true
    return true
  }

  if (command?.action === 'revise') {
    pendingPlans.delete(pendingKey)
    await emitLocalAgentText(
      context.streamContext,
      context.options,
      '请告诉我你想如何调整这次画布修改计划。'
    )
    context.streamContext.streamComplete = true
    return true
  }

  pendingPlans.delete(pendingKey)
  const memory = await loadMemoryBestEffort(context)
  const contextWithMemory = { ...context, memory }
  const observations = await executeConfirmedPlan(contextWithMemory, pending.plan)
  const answer = await buildLocalAgentAnswer({
    context: contextWithMemory,
    plan: pending.plan,
    observations,
  })
  await emitLocalAgentText(
    context.streamContext,
    context.options,
    await verifyLocalAgentFinalAnswer({
      context: contextWithMemory,
      plan: pending.plan,
      observations,
      answer,
    })
  )
  await persistMemoryBestEffort({
    context: contextWithMemory,
    memory,
    plan: pending.plan,
    observations,
  })
  context.streamContext.streamComplete = true
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

function hasManualMutation(plan: LocalAgentPlan): boolean {
  return (
    Boolean(plan.patch && plan.patch.operations.length > 0) ||
    Boolean(plan.generateNodeIds && plan.generateNodeIds.length > 0)
  )
}

function buildNonCanvasResponse(): string {
  return [
    '这条请求看起来不是当前画布相关任务，我不会读取或修改画布。',
    '如果你希望把这个主题用于当前画布，请说明要创建、更新、连接或生成的节点内容。',
  ].join('\n')
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

    if (hasManualMutation(plan)) {
      deleteExpiredPendingPlans()
      const id = generateId()
      pendingPlans.set(getPendingKey(localContext), {
        id,
        context: contextWithMemory,
        plan,
        createdAt: Date.now(),
      })
      await emitLocalAgentOptions({
        context: params.context,
        options: params.options,
        text: buildPlanPreview(plan),
        optionItems: [
          { id: `${CONFIRM_PREFIX}${id}`, label: 'Confirm', value: `${CONFIRM_PREFIX}${id}` },
          { id: `${REVISE_PREFIX}${id}`, label: 'Revise', value: `${REVISE_PREFIX}${id}` },
        ],
      })
      params.context.streamComplete = true
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

    await emitLocalAgentText(
      params.context,
      params.options,
      await verifyLocalAgentFinalAnswer({
        context: manualLoopContext,
        plan,
        observations,
        answer,
      })
    )
    await persistMemoryBestEffort({
      context: manualLoopContext,
      memory,
      plan,
      observations,
    })
    params.context.streamComplete = true
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

  if (plan.requiresUserConfirmation && hasManualMutation(plan)) {
    deleteExpiredPendingPlans()
    const id = generateId()
    pendingPlans.set(getPendingKey(localContext), {
      id,
      context: contextWithMemory,
      plan,
      createdAt: Date.now(),
    })
    await emitLocalAgentOptions({
      context: params.context,
      options: params.options,
      text: buildPlanPreview(plan),
      optionItems: [
        { id: `${CONFIRM_PREFIX}${id}`, label: 'Confirm', value: `${CONFIRM_PREFIX}${id}` },
        { id: `${REVISE_PREFIX}${id}`, label: 'Revise', value: `${REVISE_PREFIX}${id}` },
      ],
    })
    params.context.streamComplete = true
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

  await emitLocalAgentText(
    params.context,
    params.options,
    await verifyLocalAgentFinalAnswer({ context: contextWithMemory, plan, observations, answer })
  )
  await persistMemoryBestEffort({
    context: contextWithMemory,
    memory,
    plan,
    observations,
  })
  params.context.streamComplete = true
}
