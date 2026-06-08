import { executeCanvasTool } from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-tools'
import { executeContextTool } from '@/lib/copilot/request/lifecycle/local-canvas-agent/context-tools'
import { executeMediaTool } from '@/lib/copilot/request/lifecycle/local-canvas-agent/media-tools'
import {
  emitLocalAgentToolCall,
  emitLocalAgentToolResult,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/stream'
import {
  getLocalAgentToolDescriptor,
  getLocalAgentToolTitle,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-descriptor'
import type {
  LocalAgentContext,
  LocalAgentToolCall,
  LocalAgentToolResult,
  LocalCanvasToolName,
  LocalMediaToolName,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

function isCanvasToolName(toolName: LocalAgentToolCall['name']): toolName is LocalCanvasToolName {
  return toolName.startsWith('canvas.')
}

function isMediaToolName(toolName: LocalAgentToolCall['name']): toolName is LocalMediaToolName {
  return toolName.startsWith('media.')
}

export async function executeLocalAgentTool(
  context: LocalAgentContext,
  call: LocalAgentToolCall
): Promise<LocalAgentToolResult> {
  const toolCallId = await emitLocalAgentToolCall({
    context: context.streamContext,
    options: context.options,
    toolName: call.name,
    title: getLocalAgentToolTitle(call.name),
    input: call.input,
  })

  const descriptor = getLocalAgentToolDescriptor(call.name)
  if (!descriptor?.isEnabled(context)) {
    const result = {
      name: call.name,
      success: false,
      error: `Tool ${call.name} is not available for this request`,
      summary: `Tool ${call.name} is not available`,
    } satisfies LocalAgentToolResult
    await emitLocalAgentToolResult({
      context: context.streamContext,
      options: context.options,
      toolCallId,
      success: false,
      summary: result.summary,
      error: result.error,
    })
    return result
  }

  const parsedInput = descriptor.inputSchema.safeParse(call.input)
  if (!parsedInput.success) {
    const error = parsedInput.error.issues.map((issue) => issue.message).join('; ')
    const result = {
      name: call.name,
      success: false,
      error,
      summary: `Tool ${call.name} input was invalid: ${error}`,
    } satisfies LocalAgentToolResult
    await emitLocalAgentToolResult({
      context: context.streamContext,
      options: context.options,
      toolCallId,
      success: false,
      summary: result.summary,
      error: result.error,
    })
    return result
  }

  const result = isCanvasToolName(call.name)
    ? await executeCanvasTool(context, { name: call.name, input: parsedInput.data })
    : isMediaToolName(call.name)
      ? await executeMediaTool(context, { name: call.name, input: parsedInput.data })
      : await executeContextTool(context, { name: call.name, input: parsedInput.data })
  await emitLocalAgentToolResult({
    context: context.streamContext,
    options: context.options,
    toolCallId,
    success: result.success,
    summary: result.summary,
    output: result.output,
    error: result.error,
  })
  return result
}
