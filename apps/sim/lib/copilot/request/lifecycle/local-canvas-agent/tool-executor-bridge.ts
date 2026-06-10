import { createLogger } from '@sim/logger'
import { executeCanvasTool } from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-tools'
import { executeContextTool } from '@/lib/copilot/request/lifecycle/local-canvas-agent/context-tools'
import { executeMediaTool } from '@/lib/copilot/request/lifecycle/local-canvas-agent/media-tools'
import {
  buildLocalAgentToolTraceFields,
  createLocalAgentOperationTrace,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/observability'
import {
  emitLocalAgentToolCall,
  emitLocalAgentToolResult,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/stream'
import { parseLocalAgentToolInputWithRepair } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-call-repair'
import {
  getLocalAgentToolDescriptor,
  getLocalAgentToolTitle,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-descriptor'
import {
  applyLocalAgentToolRequestMiddleware,
  applyLocalAgentToolResultMiddleware,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-middleware'
import type {
  LocalAgentContext,
  LocalAgentToolCall,
  LocalAgentToolResult,
  LocalCanvasToolName,
  LocalMediaToolName,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const logger = createLogger('LocalCanvasAgentToolExecutor')

function isCanvasToolName(toolName: LocalAgentToolCall['name']): toolName is LocalCanvasToolName {
  return toolName.startsWith('canvas.')
}

function isMediaToolName(toolName: LocalAgentToolCall['name']): toolName is LocalMediaToolName {
  return toolName.startsWith('media.')
}

function validateToolOutput(
  call: LocalAgentToolCall,
  result: LocalAgentToolResult
): LocalAgentToolResult {
  const descriptor = getLocalAgentToolDescriptor(call.name)
  if (!result.success || !descriptor?.outputSchema) return result
  const parsedOutput = descriptor.outputSchema.safeParse(result.output)
  if (parsedOutput.success) {
    return {
      ...result,
      output: parsedOutput.data,
    }
  }
  const error = parsedOutput.error.issues.map((issue) => issue.message).join('; ')
  return {
    name: call.name,
    success: false,
    error,
    summary: `Tool ${call.name} output was invalid: ${error}`,
  }
}

export async function executeLocalAgentTool(
  context: LocalAgentContext,
  call: LocalAgentToolCall
): Promise<LocalAgentToolResult> {
  const startedAt = Date.now()
  const trace = createLocalAgentOperationTrace({
    kind: 'tool',
    name: call.name,
    startedAtMs: startedAt,
  })
  const activeCall = await applyLocalAgentToolRequestMiddleware({
    call,
    middlewareContext: { context, trace },
  })
  const toolCallId = await emitLocalAgentToolCall({
    context: context.streamContext,
    options: context.options,
    toolName: activeCall.name,
    title: getLocalAgentToolTitle(activeCall.name),
    input: activeCall.input,
  })

  const descriptor = getLocalAgentToolDescriptor(activeCall.name)
  if (!descriptor?.isEnabled(context)) {
    const result = {
      name: activeCall.name,
      success: false,
      error: `Tool ${activeCall.name} is not available for this request`,
      summary: `Tool ${activeCall.name} is not available`,
    } satisfies LocalAgentToolResult
    logger.warn('Local canvas agent tool unavailable', {
      ...buildLocalAgentToolTraceFields({
        context,
        trace,
        call: activeCall,
        result,
      }),
    })
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

  const parsedInput = parseLocalAgentToolInputWithRepair({
    toolName: activeCall.name,
    input: activeCall.input,
    inputSchema: descriptor.inputSchema,
  })
  if (!parsedInput.success) {
    logger.warn('Local canvas agent tool input invalid', {
      ...buildLocalAgentToolTraceFields({
        context,
        trace,
        call: activeCall,
        result: parsedInput.result,
      }),
      error: parsedInput.error,
      repairReason: parsedInput.repairReason,
    })
    await emitLocalAgentToolResult({
      context: context.streamContext,
      options: context.options,
      toolCallId,
      success: false,
      summary: parsedInput.result.summary,
      error: parsedInput.result.error,
    })
    return parsedInput.result
  }

  const executableCall = {
    name: activeCall.name,
    input: parsedInput.data,
  } satisfies LocalAgentToolCall
  if (parsedInput.repaired) {
    logger.info('Local canvas agent tool input repaired', {
      ...buildLocalAgentToolTraceFields({
        context,
        trace,
        call: executableCall,
      }),
      repairReason: parsedInput.repairReason,
    })
  }
  const rawResult = isCanvasToolName(executableCall.name)
    ? await executeCanvasTool(context, {
        name: executableCall.name,
        input: executableCall.input,
      })
    : isMediaToolName(executableCall.name)
      ? await executeMediaTool(context, {
          name: executableCall.name,
          input: executableCall.input,
        })
      : await executeContextTool(context, executableCall)
  const validatedResult = validateToolOutput(executableCall, rawResult)
  const result = await applyLocalAgentToolResultMiddleware({
    call: executableCall,
    result: validatedResult,
    middlewareContext: { context, trace },
  })
  logger.info('Local canvas agent tool executed', {
    ...buildLocalAgentToolTraceFields({
      context,
      trace,
      call: executableCall,
      result,
    }),
  })
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
