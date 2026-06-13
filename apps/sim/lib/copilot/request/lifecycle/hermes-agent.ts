import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamingContext,
} from '@/lib/copilot/request/types'
import { callHermesSimAgent } from '@/lib/hermes/sim-agent'

const logger = createLogger('HermesAgentLifecycle')

type HermesAgentOptions = Pick<OrchestratorOptions, 'abortSignal' | 'onEvent'>

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
      message,
      selectedNodeIds,
      userPermission: getString(requestPayload.userPermission),
      traceId: context.requestId,
      model: getString(requestPayload.model),
      signal: options.abortSignal,
    })

    context.usage = result.usage
      ? { prompt: result.usage.prompt, completion: result.usage.completion }
      : context.usage
    await emitAssistantText(
      context,
      options,
      result.content || 'Hermes Agent completed without a text response.'
    )
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
