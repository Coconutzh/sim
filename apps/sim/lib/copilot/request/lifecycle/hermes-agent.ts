import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
} from '@/lib/copilot/generated/mothership-stream-v1'
import {
  LOCAL_CANVAS_CONFIRM_PREFIX,
  LOCAL_CANVAS_PREVIEW_CONFIRM_PREFIX,
  LOCAL_CANVAS_PREVIEW_DISCARD_PREFIX,
  parseLocalAgentPendingPlanCommand,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/pending-plan'
import { emitLocalAgentOptions } from '@/lib/copilot/request/lifecycle/local-canvas-agent/stream'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamingContext,
} from '@/lib/copilot/request/types'
import type { HermesResponseConversationMessage } from '@/lib/hermes/client'
import { buildHermesMultimodalInput } from '@/lib/hermes/multimodal-attachments'
import { callHermesSimAgent } from '@/lib/hermes/sim-agent'

const logger = createLogger('HermesAgentLifecycle')
const MAX_HERMES_HISTORY_MESSAGES = 12
const MAX_HERMES_HISTORY_MESSAGE_CHARS = 1600
const MAX_HERMES_HISTORY_ATTACHMENTS = 6

type HermesAgentOptions = Pick<OrchestratorOptions, 'abortSignal' | 'onEvent'>

interface HermesCanvasProposalConfirmation {
  kind: 'pending'
  pendingActionId: string
}

interface HermesCanvasPreviewConfirmation {
  kind: 'preview'
  previewActionId: string
}

type HermesCanvasConfirmation = HermesCanvasProposalConfirmation | HermesCanvasPreviewConfirmation

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

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 18))}\n...[truncated]`
}

function extractMessageText(record: Record<string, unknown>): string {
  if (typeof record.content === 'string') return record.content
  const blocks = record.contentBlocks
  if (!Array.isArray(blocks)) return ''
  return blocks
    .map((block) => {
      const blockRecord = asRecord(block)
      return typeof blockRecord?.content === 'string' ? blockRecord.content : ''
    })
    .filter(Boolean)
    .join('\n')
}

function summarizeHistoryAttachments(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return ''
  const lines = value.slice(0, MAX_HERMES_HISTORY_ATTACHMENTS).map((attachment, index) => {
    const record = asRecord(attachment) ?? {}
    const name =
      getString(record.filename) ??
      getString(record.name) ??
      getString(record.title) ??
      `attachment-${index + 1}`
    const mediaType =
      getString(record.media_type) ?? getString(record.mimeType) ?? getString(record.mediaType)
    const id =
      getString(record.workspaceFileId) ??
      getString(record.fileId) ??
      getString(record.id) ??
      getString(record.key)
    return [`${index + 1}. ${name}`, mediaType ? `type=${mediaType}` : '', id ? `ref=${id}` : '']
      .filter(Boolean)
      .join(' ')
  })
  const omitted = value.length - lines.length
  return [
    'Attachments recorded on this SIM chat turn:',
    lines.join('\n'),
    omitted > 0 ? `${omitted} additional attachment(s) omitted from the seed.` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildHermesConversationHistorySeed(
  value: unknown
): HermesResponseConversationMessage[] | undefined {
  if (!Array.isArray(value)) return undefined

  const messages = value
    .map((message) => {
      const record = asRecord(message)
      if (!record) return null
      const role = record.role
      if (role !== 'user' && role !== 'assistant' && role !== 'system') return null

      const text = extractMessageText(record).trim()
      const attachmentSummary = summarizeHistoryAttachments(record.fileAttachments)
      const content = [text, attachmentSummary].filter(Boolean).join('\n\n').trim()
      if (!content) return null

      return {
        role,
        content: clip(content, MAX_HERMES_HISTORY_MESSAGE_CHARS),
      }
    })
    .filter((message): message is HermesResponseConversationMessage => Boolean(message))

  return messages.length ? messages.slice(-MAX_HERMES_HISTORY_MESSAGES) : undefined
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

function extractHermesCanvasConfirmation(payload: unknown): HermesCanvasConfirmation | null {
  let latestConfirmation: HermesCanvasConfirmation | null = null
  let sawSuccessfulApplyAfterLatestProposal = false

  for (const output of responseFunctionCallOutputs(payload)) {
    if (
      output.success === true &&
      (output.mode === 'apply_after_confirm' ||
        output.operation === 'apply_pending' ||
        output.operation === 'preview_commit')
    ) {
      sawSuccessfulApplyAfterLatestProposal = true
      continue
    }

    if (
      output.success === true &&
      (output.operation === 'preview_discard' || output.operation === 'preview_commit')
    ) {
      sawSuccessfulApplyAfterLatestProposal = true
      continue
    }

    if (
      output.success === true &&
      (output.mode === 'propose' || output.operation === 'propose') &&
      output.requiresConfirmation === true
    ) {
      const pendingActionId = output.pendingActionId
      if (typeof pendingActionId === 'string' && pendingActionId.trim()) {
        latestConfirmation = { kind: 'pending', pendingActionId: pendingActionId.trim() }
        sawSuccessfulApplyAfterLatestProposal = false
      }
      continue
    }

    if (
      output.success === true &&
      (output.operation === 'preview_create' || output.operation === 'preview_update')
    ) {
      const previewActionId = output.previewActionId
      if (typeof previewActionId === 'string' && previewActionId.trim()) {
        latestConfirmation = { kind: 'preview', previewActionId: previewActionId.trim() }
        sawSuccessfulApplyAfterLatestProposal = false
      }
    }
  }

  return sawSuccessfulApplyAfterLatestProposal ? null : latestConfirmation
}

function buildHermesInputMessage(message: string): string {
  const pendingCommand = parseLocalAgentPendingPlanCommand(message)
  const actionId = pendingCommand?.id.trim()
  if (!pendingCommand || !actionId) return message

  if (pendingCommand.action === 'confirm') {
    return [
      `The user explicitly confirmed SIM canvas pendingActionId "${actionId}".`,
      'You must now call sim_canvas_apply_pending with that exact pendingActionId.',
      'After SIM returns, summarize only the verified execution result. Do not create a new proposal.',
    ].join(' ')
  }

  if (pendingCommand.action === 'preview_confirm') {
    return [
      `The user explicitly confirmed SIM canvas previewActionId "${actionId}".`,
      'You must now call sim_canvas_preview_commit with that exact previewActionId.',
      'After SIM returns, summarize only the verified preview commit result. Do not create a new preview.',
    ].join(' ')
  }

  if (pendingCommand.action === 'preview_discard') {
    return [
      `The user explicitly rejected SIM canvas previewActionId "${actionId}".`,
      'You must now call sim_canvas_preview_discard with that exact previewActionId.',
      'After SIM returns, summarize that the preview was discarded. Do not create a new preview.',
    ].join(' ')
  }

  return message
}

function buildCanvasConfirmationOptions(confirmation: HermesCanvasConfirmation) {
  if (confirmation.kind === 'pending') {
    return [
      {
        id: 'confirm-hermes-canvas-proposal',
        label: '确认执行画布修改',
        value: `${LOCAL_CANVAS_CONFIRM_PREFIX}${confirmation.pendingActionId}`,
      },
    ]
  }

  return [
    {
      id: 'confirm-hermes-canvas-preview',
      label: '确认保留预览',
      value: `${LOCAL_CANVAS_PREVIEW_CONFIRM_PREFIX}${confirmation.previewActionId}`,
    },
    {
      id: 'discard-hermes-canvas-preview',
      label: '取消并回退预览',
      value: `${LOCAL_CANVAS_PREVIEW_DISCARD_PREFIX}${confirmation.previewActionId}`,
    },
  ]
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
  confirmation: HermesCanvasConfirmation
): Promise<void> {
  await emitLocalAgentOptions({
    context,
    options,
    text,
    optionItems: buildCanvasConfirmationOptions(confirmation),
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
  const workspaceId = getString(requestPayload.workspaceId) ?? execContext.workspaceId
  const workflowId = getString(requestPayload.workflowId) ?? execContext.workflowId
  const chatId = getString(requestPayload.chatId) ?? execContext.chatId
  const hermesMessage = buildHermesInputMessage(message)
  const conversationHistory = buildHermesConversationHistorySeed(requestPayload.conversationHistory)

  try {
    const hermesInput = await buildHermesMultimodalInput({
      requestPayload,
      message: hermesMessage,
      workspaceId,
      chatId,
    })

    const result = await callHermesSimAgent({
      userId: execContext.userId,
      organizationId: getString(requestPayload.organizationId),
      workspaceId,
      workflowId,
      chatId,
      message: hermesMessage,
      ...(hermesInput ? { input: hermesInput } : {}),
      ...(conversationHistory ? { conversationHistory } : {}),
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
    const confirmation = extractHermesCanvasConfirmation(result.raw)
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
