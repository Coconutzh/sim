import {
  CANVAS_TOOL_TITLES,
  executeCanvasTool,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-tools'
import { executeContextTool } from '@/lib/copilot/request/lifecycle/local-canvas-agent/context-tools'
import {
  emitLocalAgentToolCall,
  emitLocalAgentToolResult,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/stream'
import { isCanvasToolAvailable } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-registry'
import type {
  LocalAgentContext,
  LocalAgentToolCall,
  LocalAgentToolResult,
  LocalCanvasToolName,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const CONTEXT_TOOL_TITLES = {
  read_file: 'Reading file context',
  search_workspace: 'Searching workspace',
  materialize_file: 'Saving file to workspace',
  query_knowledge: 'Searching knowledge context',
  search_docs: 'Searching documentation',
  read_tasks: 'Reading tasks',
  update_task_result: 'Updating task result',
  submit_task_result: 'Submitting task result',
} as const

function isCanvasToolName(toolName: LocalAgentToolCall['name']): toolName is LocalCanvasToolName {
  return toolName.startsWith('canvas.')
}

function getToolTitle(toolName: LocalAgentToolCall['name']): string {
  return isCanvasToolName(toolName) ? CANVAS_TOOL_TITLES[toolName] : CONTEXT_TOOL_TITLES[toolName]
}

export async function executeLocalAgentTool(
  context: LocalAgentContext,
  call: LocalAgentToolCall
): Promise<LocalAgentToolResult> {
  const toolCallId = await emitLocalAgentToolCall({
    context: context.streamContext,
    options: context.options,
    toolName: call.name,
    title: getToolTitle(call.name),
    input: call.input,
  })

  if (!isCanvasToolAvailable(context, call.name)) {
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

  const result = isCanvasToolName(call.name)
    ? await executeCanvasTool(context, { name: call.name, input: call.input })
    : await executeContextTool(context, call)
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
