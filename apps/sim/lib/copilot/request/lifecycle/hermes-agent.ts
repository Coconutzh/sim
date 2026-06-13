import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
} from '@/lib/copilot/generated/mothership-stream-v1'
import {
  LOCAL_CANVAS_CONFIRM_PREFIX,
  parseLocalAgentPendingPlanCommand,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/pending-plan'
import { emitLocalAgentOptions } from '@/lib/copilot/request/lifecycle/local-canvas-agent/stream'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamingContext,
} from '@/lib/copilot/request/types'
import { callHermesSimAgent } from '@/lib/hermes/sim-agent'

const logger = createLogger('HermesAgentLifecycle')

type HermesAgentOptions = Pick<OrchestratorOptions, 'abortSignal' | 'onEvent'>

interface HermesCanvasProposalConfirmation {
  pendingActionId: string
}

export interface RunHermesAgentParams {
  requestPayload: Record<string, unknown>
  context: StreamingContext
  execContext: ExecutionContext
  options: HermesAgentOptions
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function collectSelectedNodeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (record.kind !== 'blocks' || !Array.isArray(record.blockIds)) continue
    for (const blockId of record.blockIds) {
      if (typeof blockId === 'string' && blockId.trim()) ids.add(blockId)
    }
  }
  return [...ids]
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readArray(record: Record<string, unknown> | undefined, key: string): unknown[] {
  const value = record?.[key]
  return Array.isArray(value) ? value : []
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value)
  if (record) return record
  if (typeof value !== 'string') return undefined
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return undefined
  }
}

function responseOutputItems(payload: unknown): Record<string, unknown>[] {
  return readArray(asRecord(payload), 'output')
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
}

function responseFunctionCallOutputs(payload: unknown): Record<string, unknown>[] {
  return responseOutputItems(payload)
    .filter((item) => item.type === 'function_call_output')
    .map((item) => parseJsonObject(item.output))
    .filter((item): item is Record<string, unknown> => Boolean(item))
}

function extractHermesCanvasProposalConfirmation(
  payload: unknown
): HermesCanvasProposalConfirmation | null {
  for (const output of responseFunctionCallOutputs(payload)) {
    if (
      output.success !== true ||
      output.mode !== 'propose' ||
      output.requiresConfirmation !== true
    ) {
      continue
    }
    const pendingActionId = output.pendingActionId
    if (typeof pendingActionId === 'string' && pendingActionId.trim()) {
      return { pendingActionId: pendingActionId.trim() }
    }
  }
  return null
}

function buildHermesInputMessage(message: string): string {
  const pendingCommand = parseLocalAgentPendingPlanCommand(message)
  const pendingActionId = pendingCommand?.id.trim()
  if (pendingCommand?.action !== 'confirm' || !pendingActionId) return message

  return [
    `The user explicitly confirmed SIM canvas pendingActionId "${pendingActionId}".`,
    'You must now call sim_canvas_agent_run with mode=apply_after_confirm and that exact pendingActionId.',
    'After SIM returns, summarize only the verified execution result. Do not create a new proposal.',
  ].join(' ')
}

async function emitAssistantText(
  context: StreamingContext,
  options: HermesAgentOptions,
  text: string
): Promise<void> {
  if (!text) return

  context.accumulatedContent = text
  context.contentBlocks.push({
    type: 'text',
    content: text,
    timestamp: Date.now(),
    endedAt: Date.now(),
  })

  await options.onEvent?.({
    type: MothershipStreamV1EventType.text,
    payload: {
      channel: MothershipStreamV1TextChannel.assistant,
      text,
    },
  })
}

async function emitCanvasProposalOptions(
  context: StreamingContext,
  options: HermesAgentOptions,
  text: string,
  confirmation: HermesCanvasProposalConfirmation
): Promise<void> {
  await emitLocalAgentOptions({
    context,
    options,
    text,
    optionItems: [
      {
        id: 'confirm-hermes-canvas-proposal',
        label: '确认执行画布修改',
        value: `${LOCAL_CANVAS_CONFIRM_PREFIX}${confirmation.pendingActionId}`,
      },
    ],
  })
}

export async function runHermesAgent({
  requestPayload,
  context,
  execContext,
  options,
}: RunHermesAgentParams): Promise<void> {
  const message = getString(requestPayload.message)
  if (!message) {
    context.errors.push('Hermes Agent request is missing a message')
    return
  }

  const selectedNodeIds = collectSelectedNodeIds(requestPayload.autoSelectionContexts)

  try {
    const result = await callHermesSimAgent({
      userId: execContext.userId,
      organizationId: getString(requestPayload.organizationId),
      workspaceId: getString(requestPayload.workspaceId) ?? execContext.workspaceId,
      workflowId: getString(requestPayload.workflowId) ?? execContext.workflowId,
      chatId: execContext.chatId,
      message: buildHermesInputMessage(message),
      selectedNodeIds,
      userPermission: getString(requestPayload.userPermission),
      traceId: context.requestId,
      model: getString(requestPayload.model),
      signal: options.abortSignal,
    })

    context.usage = result.usage
      ? { prompt: result.usage.prompt, completion: result.usage.completion }
      : context.usage
    const responseText = result.content || 'Hermes Agent completed without a text response.'
    const confirmation = extractHermesCanvasProposalConfirmation(result.raw)
    if (confirmation) {
      await emitCanvasProposalOptions(context, options, responseText, confirmation)
    } else {
      await emitAssistantText(context, options, responseText)
    }
    context.streamComplete = true

    logger.info('Hermes Agent request completed', {
      requestId: context.requestId,
      chatId: execContext.chatId,
      workspaceId: execContext.workspaceId,
      workflowId: execContext.workflowId,
      hermesSessionId: result.sessionId,
      hermesSessionKey: result.sessionKey,
    })
  } catch (error) {
    const err = toError(error)
    const messageText = `Hermes Agent is unavailable: ${err.message}`
    context.errors.push(messageText)
    await emitAssistantText(context, options, messageText)
    context.streamComplete = true

    logger.error('Hermes Agent request failed', {
      requestId: context.requestId,
      chatId: execContext.chatId,
      workspaceId: execContext.workspaceId,
      workflowId: execContext.workflowId,
      error: err.message,
    })
  }
}
