import { generateId } from '@sim/utils/id'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
  MothershipStreamV1ToolExecutor,
  MothershipStreamV1ToolMode,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { LocalAgentToolName } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import type {
  OptionItem,
  OrchestratorOptions,
  StreamingContext,
  ToolCallState,
} from '@/lib/copilot/request/types'
import { ContentBlockType } from '@/lib/copilot/request/types'

type StreamOptions = Pick<OrchestratorOptions, 'onEvent'>
type LocalAgentAssistantTextPayload = {
  text: string
  channel: typeof MothershipStreamV1TextChannel.assistant
  textMode: 'replace'
}

function buildOptionsTag(options: OptionItem[]): string {
  return `<options>${JSON.stringify(
    Object.fromEntries(
      options.map((option) => [
        option.value ?? option.id,
        {
          title: option.label,
          description: '',
        },
      ])
    )
  )}</options>`
}

function buildAssistantTextPayload(text: string): LocalAgentAssistantTextPayload {
  return {
    text,
    channel: MothershipStreamV1TextChannel.assistant,
    textMode: 'replace',
  }
}

export async function emitLocalAgentText(
  context: StreamingContext,
  options: StreamOptions,
  text: string
): Promise<void> {
  context.accumulatedContent = text
  context.contentBlocks.push({
    type: ContentBlockType.text,
    content: text,
    timestamp: Date.now(),
  })
  const payload = buildAssistantTextPayload(text)
  await options.onEvent?.({
    type: MothershipStreamV1EventType.text,
    payload,
  })
}

export async function emitLocalAgentThinking(
  context: StreamingContext,
  options: StreamOptions,
  text: string
): Promise<void> {
  context.contentBlocks.push({
    type: ContentBlockType.thinking,
    content: text,
    timestamp: Date.now(),
    endedAt: Date.now(),
  })
  await options.onEvent?.({
    type: MothershipStreamV1EventType.text,
    payload: {
      text,
      channel: MothershipStreamV1TextChannel.thinking,
    },
  })
}

export async function emitLocalAgentOptions(params: {
  context: StreamingContext
  options: StreamOptions
  text: string
  optionItems: OptionItem[]
}): Promise<void> {
  const renderedText =
    params.optionItems.length > 0
      ? `${params.text.trim() ? `${params.text}\n\n` : ''}${buildOptionsTag(params.optionItems)}`
      : params.text
  params.context.accumulatedContent = renderedText
  params.context.contentBlocks.push({
    type: ContentBlockType.text,
    content: params.text,
    timestamp: Date.now(),
  })
  params.context.contentBlocks.push({
    type: ContentBlockType.options,
    options: params.optionItems,
    timestamp: Date.now(),
  })
  const payload = buildAssistantTextPayload(renderedText)
  await params.options.onEvent?.({
    type: MothershipStreamV1EventType.text,
    payload,
  })
}

export async function emitLocalAgentToolCall(params: {
  context: StreamingContext
  options: StreamOptions
  toolName: LocalAgentToolName
  title: string
  input: Record<string, unknown>
}): Promise<string> {
  const id = generateId()
  const toolCall: ToolCallState = {
    id,
    name: params.toolName,
    status: 'executing',
    displayTitle: params.title,
    params: params.input,
    startTime: Date.now(),
  }
  params.context.toolCalls.set(id, toolCall)
  params.context.contentBlocks.push({
    type: ContentBlockType.tool_call,
    toolCall,
    timestamp: Date.now(),
  })
  await params.options.onEvent?.({
    type: MothershipStreamV1EventType.tool,
    payload: {
      toolCallId: id,
      toolName: params.toolName,
      executor: MothershipStreamV1ToolExecutor.sim,
      mode: MothershipStreamV1ToolMode.async,
      phase: MothershipStreamV1ToolPhase.call,
      status: 'executing',
      arguments: params.input,
    },
  })
  return id
}

export async function emitLocalAgentToolResult(params: {
  context: StreamingContext
  options: StreamOptions
  toolCallId: string
  success: boolean
  summary?: string
  output?: unknown
  error?: string
}): Promise<void> {
  const toolCall = params.context.toolCalls.get(params.toolCallId)
  if (!toolCall) return
  toolCall.status = params.success
    ? MothershipStreamV1ToolOutcome.success
    : MothershipStreamV1ToolOutcome.error
  toolCall.endTime = Date.now()
  const streamOutput = params.summary ? { summary: params.summary } : params.output
  toolCall.result = {
    success: params.success,
    output: streamOutput,
  }
  if (params.error) toolCall.error = params.error
  await params.options.onEvent?.({
    type: MothershipStreamV1EventType.tool,
    payload: {
      toolCallId: params.toolCallId,
      toolName: toolCall.name,
      executor: MothershipStreamV1ToolExecutor.sim,
      mode: MothershipStreamV1ToolMode.async,
      phase: MothershipStreamV1ToolPhase.result,
      status: toolCall.status,
      success: params.success,
      output: params.success ? streamOutput : undefined,
      error: params.error,
    },
  })
}
